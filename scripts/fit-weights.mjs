#!/usr/bin/env node
/**
 * 요인 가중치와 소프트맥스 온도를 학습 구간에서만 다시 적합한다.
 *
 * 왜 필요한가: 시장(단승 배당)을 요인으로 들이면 기존 8개 요인보다 훨씬 강해서
 * 손으로 잡아 둔 DEFAULT_WEIGHTS·TEMPERATURE 가 더는 맞지 않는다.
 *
 * 왜 TS 를 컴파일해서 쓰는가: 다른 스크립트처럼 로직을 복제하면 적합에 쓴 요인과
 * 실제 예측이 어긋날 수 있다. 그러면 이 스크립트의 결과가 거짓이 된다.
 * predict.ts 의 featureLogits 를 **그대로** 불러 쓰는 게 유일하게 안전한 방법이다.
 *
 * 누수 방지: 경주일마다 그 날 **이전** 기록으로 통계를 새로 만들어 요인을 뽑는다
 * (워크포워드). 검증 구간은 파라미터를 고르는 데 절대 쓰지 않고, 고른 뒤 확인용으로만 본다.
 *
 * 사용법:
 *   node scripts/fit-weights.mjs
 *   node scripts/fit-weights.mjs --warmup 0.6
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "kra");

/**
 * 어느 승식에 맞출 것인가. 목적함수의 깊이가 곧 승식이다.
 *   `--objective top1` 단승 · `top2` 복승(기본) · `top3` 연승·복연
 */
const OBJECTIVES = { top1: 1, top2: 2, top3: 3 };
const OBJECTIVE = (() => {
  const i = process.argv.indexOf("--objective");
  const name = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "top2";
  if (!(name in OBJECTIVES)) {
    console.error(`--objective 는 ${Object.keys(OBJECTIVES).join(" | ")} 중 하나여야 한다 (받은 값: ${name})`);
    process.exit(1);
  }
  return name;
})();
const DEPTH = OBJECTIVES[OBJECTIVE];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

/** predict.ts 와 그 의존 모듈을 임시 디렉터리에 컴파일하고 동적 import 한다. */
async function loadLib() {
  const out = mkdtempSync(join(tmpdir(), "holpick-fit-"));
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/kra/predict.ts",
      "src/lib/kra/pick.ts",
      "src/lib/kra/stats.ts",
      "src/lib/kra/style.ts",
      "src/lib/kra/sectional.ts",
      "--outDir",
      out,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
    ],
    { stdio: "inherit" },
  );
  // tsc 는 확장자 없는 import 를 내보내므로 Node ESM 이 읽도록 붙여 준다.
  for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
    const p = join(out, f);
    writeFileSync(p, readFileSync(p, "utf8").replace(/(from\s+")(\.\/[^"]+)(")/g, "$1$2.js$3"));
  }
  writeFileSync(join(out, "package.json"), '{"type":"module"}');
  return {
    predict: await import(join(out, "predict.js")),
    pick: await import(join(out, "pick.js")),
    stats: await import(join(out, "stats.js")),
    style: await import(join(out, "style.js")),
    sectional: await import(join(out, "sectional.js")),
  };
}

const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;

function loadRows() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-")).sort()) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    // 착순이 매겨진 행만. 94 같은 출전취소 코드는 제외한다.
    rows.push(...env.rows.filter((r) => num(r.ord) > 0 && num(r.ord) <= 90));
  }
  return rows;
}

/**
 * 경주마다 (요인행렬, 착순) 을 뽑아 둔다.
 * 가중치만 바꿔 가며 재평가할 수 있도록 통계 재구축은 여기서 한 번만 한다.
 */
function collect(lib, rows) {
  const { featureLogits } = lib.predict;
  const { candidateFromRow, EMPTY_TRAITS } = lib.pick;
  const { buildStatsBundle, groupRows } = lib.stats;
  const { buildStyleHistory } = lib.style;
  const { buildSectionalHistory } = lib.sectional;

  const dates = [...new Set(rows.map((r) => String(r.rcDate)))].filter(Boolean).sort();
  const styleHistory = buildStyleHistory(rows);
  const sectionalHistory = buildSectionalHistory(rows);
  const byDate = new Map();
  for (const r of rows) {
    const d = String(r.rcDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }

  const prior = [];
  const out = [];
  for (const date of dates) {
    // 첫 날은 이전 기록이 없어 요인이 전부 기저율이다. 건너뛴다.
    if (prior.length > 0) {
      const stats = buildStatsBundle(prior, styleHistory, sectionalHistory);
      for (const [key, race] of groupRows(byDate.get(date) ?? [])) {
        const runners = [...race].sort((a, b) => num(a.chulNo) - num(b.chulNo));
        if (runners.length < 4) continue;
        const traits = {
          style: styleHistory.byRace.get(key)?.styleByHorse ?? EMPTY_TRAITS.style,
          sectional: sectionalHistory.byRace.get(key) ?? EMPTY_TRAITS.sectional,
        };
        const cands = runners.map((r) => candidateFromRow(r, traits));
        const { logits, market } = featureLogits(cands, stats, num(runners[0].rcDist));
        out.push({
          date,
          logits,
          ords: runners.map((r) => num(r.ord)),
          marketUsable: market.usable,
        });
      }
    }
    prior.push(...(byDate.get(date) ?? []));
  }
  return { races: out, dates };
}

// predict.ts 의 FEATURES 와 같아야 한다. 어긋나면 적합한 가중치가 엉뚱한 요인에 붙는다.
const FEATURES = [
  "market",
  "ratingRank",
  "recentForm",
  "style",
  "jockey",
  "trainer",
  "budam",
  "gate",
  "rest",
  "earlySpeed",
  "lateSpeed",
  "accel",
  "relativeAge",
  "sex",
  "origin",
];

/** score = Σ v_k · x_k. 모델은 T·w 에만 의존하므로 v = T·w 를 직접 최적화한다. */
function scoresOf(race, v) {
  return race.logits.map((row) => FEATURES.reduce((s, k) => s + v[k] * row[k], 0));
}

function softmax(scores) {
  const max = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

/**
 * 상위 `depth` 착까지의 Plackett–Luce 로그우도.
 *
 *   P(1착=a, 2착=b, 3착=c) = p_a · p_b/(1−p_a) · p_c/(1−p_a−p_b)
 *
 *   depth 1 → 단승 (1착)
 *   depth 2 → 복승 (1·2착) — 기본값
 *   depth 3 → 연승·복연 (3착 이내)
 *
 * **승식과 목적함수가 갈리면 손해가 난다.** 처음엔 depth 를 두지 않고 복승 하나로만
 * 적합했는데, 그전에 우승마 우도(depth 1 에 해당)로 적합했을 때 학습·검증 우승 우도는
 * 좋아지면서 검증 복승 로그손실이 0.4365 → 0.4488 로 나빠진 기록이 있다. 온도가
 * 1.79 → 2.08 로 올라 우승 예측은 날카로워지고 2착 이내 확률은 과신하게 된 것이다.
 * 그래서 승식마다 목적함수를 따로 두고, 채택은 **그 승식의 검증 지표**로만 판단한다.
 *
 * 복승·연승은 순서를 따지지 않지만 순서를 지정한 우도가 더 많은 정보를 쓰고 최적해는
 * 같은 방향을 가리킨다.
 */
function plackettLuceLogLik(races, v, depth) {
  let ll = 0;
  let n = 0;
  for (const race of races) {
    const idx = [];
    for (let k = 1; k <= depth; k += 1) {
      const i = race.ords.indexOf(k);
      if (i < 0) break;
      idx.push(i);
    }
    if (idx.length < depth) continue;

    const p = softmax(scoresOf(race, v));
    let remaining = 1;
    let acc = 0;
    for (const i of idx) {
      acc += Math.log(Math.max(p[i], 1e-12) / Math.max(remaining, 1e-12));
      remaining -= p[i];
    }
    ll += acc;
    n += 1;
  }
  return n ? ll / n : -Infinity;
}


/** 복승 타깃의 Brier / 로그손실. 파라미터 선택에는 쓰지 않고 확인용으로만 본다. */
function top2Metrics(races, v) {
  let brier = 0;
  let logloss = 0;
  let n = 0;
  for (const race of races) {
    const p = softmax(scoresOf(race, v));
    race.ords.forEach((ord, i) => {
      const y = ord >= 1 && ord <= 2 ? 1 : 0;
      const q = Math.min(Math.max(2 * p[i], 0.001), 0.999);
      brier += (q - y) ** 2;
      logloss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
      n += 1;
    });
  }
  return { brier: brier / n, logLoss: logloss / n };
}

/**
 * 좌표상승. 요인 하나씩 후보값을 훑어 우도가 가장 좋아지는 값으로 갈아탄다.
 *
 * 후보에 0 을 넣어 쓸모없는 요인은 빠질 수 있게 하고, 절대 크기 후보도 함께 넣어
 * 한 번 0 이 된 요인이 되살아날 수 있게 한다 (배수만 쓰면 0 에서 못 빠져나온다).
 */
function fit(races, start, depth = DEPTH) {
  const v = { ...start };
  let best = plackettLuceLogLik(races, v, depth);
  const unit = FEATURES.reduce((s, k) => s + start[k], 0) / FEATURES.length;
  const mults = [0.5, 0.7, 0.85, 1.15, 1.4, 2];
  const absolutes = [0, unit * 0.25, unit * 0.5, unit, unit * 2];

  for (let round = 0; round < 12; round += 1) {
    let improved = false;
    for (const k of FEATURES) {
      const before = v[k];
      let bestVal = before;
      for (const cand of [...mults.map((m) => before * m), ...absolutes]) {
        if (cand === bestVal) continue;
        v[k] = cand;
        const ll = plackettLuceLogLik(races, v, depth);
        if (ll > best + 1e-9) {
          best = ll;
          bestVal = cand;
          improved = true;
        }
      }
      v[k] = bestVal;
    }
    if (!improved) break;
  }
  return { v, ll: best };
}

const lib = await loadLib();
const rows = loadRows();
const { races, dates } = collect(lib, rows);
const warmup = arg("warmup", 0.6);
const splitDate = dates[Math.max(1, Math.floor(dates.length * warmup))];
const train = races.filter((r) => r.date < splitDate);
const test = races.filter((r) => r.date >= splitDate);

console.log(`목적함수 ${OBJECTIVE} (상위 ${DEPTH}착 Plackett–Luce) — ${{ top1: "단승", top2: "복승", top3: "연승·복연" }[OBJECTIVE]}`);
console.log(`경주일 ${dates.length}일 · 경주 ${races.length}개`);
console.log(`학습 ${train.length}경주 (~${splitDate} 이전) / 검증 ${test.length}경주`);
console.log(
  `배당판 사용 가능: 학습 ${train.filter((r) => r.marketUsable).length}/${train.length} · ` +
    `검증 ${test.filter((r) => r.marketUsable).length}/${test.length}`,
);

// 현재 코드 값 (v = T · w)
const cur = lib.predict.DEFAULT_WEIGHTS;
const curV = Object.fromEntries(FEATURES.map((k) => [k, lib.predict.TEMPERATURE * cur[k]]));

const { v, ll } = fit(train, curV);
const scale = FEATURES.reduce((s, k) => s + v[k], 0);
const weights = Object.fromEntries(FEATURES.map((k) => [k, v[k] / scale]));

/*
 * 배당을 뺀 채로도 한 번 적합한다. 백테스트의 "모델(배당 제외)" 기준선이 손으로
 * 잡은 낡은 가중치를 쓰면 비교가 불공정해진다 — 시장의 기여를 실제보다 크게
 * 보이게 만든다. 같은 절차로 적합한 값끼리 비교해야 한다.
 */
const noMarketStart = { ...curV, market: 0 };
const fitNoMarket = fit(
  train.map((r) => ({ ...r, logits: r.logits.map((row) => ({ ...row, market: 0 })) })),
  noMarketStart,
);
const scaleNm = FEATURES.reduce((s, k) => s + fitNoMarket.v[k], 0);
const weightsNm = Object.fromEntries(FEATURES.map((k) => [k, fitNoMarket.v[k] / scaleNm]));

const show = (label, vec) => {
  // 목적함수 LL 과 함께 **복승 지표를 항상 같이** 찍는다. 목적함수를 바꾸면 그쪽 LL 은
  // 당연히 좋아지므로, 다른 승식 지표가 얼마나 희생됐는지 보이지 않으면 판단할 수 없다.
  const tr = plackettLuceLogLik(train, vec, DEPTH);
  const te = plackettLuceLogLik(test, vec, DEPTH);
  const m = top2Metrics(test, vec);
  console.log(
    `${label.padEnd(12)} 학습 ${OBJECTIVE}LL ${tr.toFixed(4)} · 검증 ${OBJECTIVE}LL ${te.toFixed(4)} · ` +
      `검증 복승Brier ${m.brier.toFixed(4)} · 검증 복승logLoss ${m.logLoss.toFixed(4)}`,
  );
};

// 배당 제외 모델도 "현재 코드 vs 재적합" 을 나란히 봐야 채택 여부를 판단할 수 있다.
const curNm = lib.predict.NO_MARKET_MODEL;
const curNmV = Object.fromEntries(
  FEATURES.map((k) => [k, curNm.temperature * curNm.weights[k]]),
);

console.log("\n=== 적합 전후 (검증 구간은 선택에 쓰지 않음) ===");
console.log("[배당 포함]");
show("  현재 코드", curV);
show("  재적합", v);
console.log("[배당 제외 — 발매 초반용]");
show("  현재 코드", curNmV);
show("  재적합", fitNoMarket.v);
console.log(`\n학습 구간 복승 로그우도 ${ll.toFixed(4)}`);

const emit = (name, w, t) => {
  console.log(`\nexport const ${name.temp} = ${t.toFixed(2)};\n`);
  console.log(`export const ${name.weights}: Weights = {`);
  for (const k of FEATURES.slice().sort((a, b) => w[b] - w[a])) {
    console.log(`  ${k}: ${w[k].toFixed(3)},`);
  }
  console.log("};");
};

console.log("\n=== predict.ts 에 넣을 값 ===");
emit({ temp: "TEMPERATURE", weights: "DEFAULT_WEIGHTS" }, weights, scale);
console.log("\n=== 배당 제외 기준선 (백테스트 비교용) ===");
emit({ temp: "NO_MARKET_TEMPERATURE", weights: "NO_MARKET_WEIGHTS" }, weightsNm, scaleNm);
