#!/usr/bin/env node
/**
 * 요인 하나하나가 **시장 배당 위에** 정보를 더하는지 따로 검정한다.
 *
 * 왜 필요한가: roi-search 의 결합 검정은 기본 요인 15개를 **묶은** 모델(NO_MARKET_MODEL)
 * 대 시장으로 α 를 쟀고 α̂=0 이 나왔다. 그런데 그 묶음은 우도를 최대화하도록 적합된
 * 것이지 시장과 직교하도록 만든 게 아니다. 묶었을 때 0 이어도 **어떤 한 요인**은
 * 시장이 놓친 정보를 갖고 있을 수 있다 — 다른 14개의 잡음에 묻혀서 안 보일 뿐.
 *
 * 그래서 요인별로 증분 검정을 돌린다:
 *
 *   p_i  ∝  p_market_i^β · exp(γ · L_ik)
 *
 * γ 가 그 요인이 시장 위에 더하는 무게다. γ=0 대비 우도비로 검정한다.
 * 15개를 한꺼번에 보므로 본페로니로 보정한다 (α=0.05 → 요인당 0.00333, χ² 8.62).
 *
 * 사용법:  node scripts/feature-edge.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadLib } from "./compile-lib.mjs";

const CACHE = join(process.cwd(), ".cache", "kra");
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

/** 학습 구간만 쓴다. 검증·홀드아웃은 건드리지 않는다. */
const TRAIN_FRACTION = 0.6;

function loadRows() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-")).sort()) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    rows.push(...(env.rows ?? []).filter((r) => num(r.ord) > 0 && num(r.ord) <= 90));
  }
  return rows;
}

/** 두 마리가 1·2착에 들 확률 (Harville). */
function pairProb(p, i, j) {
  const a = Math.min(Math.max(p[i], 1e-9), 0.999);
  const b = Math.min(Math.max(p[j], 1e-9), 0.999);
  return (a * b) / (1 - a) + (b * a) / (1 - b);
}

/** p ∝ p_market^β · exp(γ·L) */
function combine(marketP, logit, beta, gamma) {
  const n = marketP.length;
  const out = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.pow(Math.max(marketP[i], 1e-9), beta) * Math.exp(gamma * logit[i]);
    s += out[i];
  }
  if (s > 0) for (let i = 0; i < n; i += 1) out[i] /= s;
  return out;
}

function logLik(races, key, beta, gamma) {
  let ll = 0;
  let n = 0;
  for (const r of races) {
    const p = combine(r.market, r.logits[key], beta, gamma);
    ll += Math.log(Math.max(pairProb(p, r.first, r.second), 1e-12));
    n += 1;
  }
  return n ? ll / n : -Infinity;
}

/** β·γ 격자 + γ 황금분할. */
function fitGamma(races, key) {
  const BETAS = [0.6, 0.8, 0.9, 1.0, 1.1, 1.3];
  let best = { beta: 1, gamma: 0, ll: -Infinity };
  let bestNull = -Infinity;

  for (const beta of BETAS) {
    bestNull = Math.max(bestNull, logLik(races, key, beta, 0));
    // γ 를 넓게 훑고 최적 근처를 좁힌다.
    for (let g = -1.2; g <= 1.2001; g += 0.05) {
      const ll = logLik(races, key, beta, g);
      if (ll > best.ll) best = { beta, gamma: g, ll };
    }
  }
  const lr = 2 * races.length * (best.ll - bestNull);
  return { ...best, llNull: bestNull, lr };
}

async function main() {
  const lib = await loadLib(
    ["predict", "pick", "stats", "style", "sectional", "quinella", "horse"],
    { prefix: "holpick-featedge-" },
  );
  const { featureLogits, FEATURES } = lib.predict;
  const { candidateFromRow, EMPTY_TRAITS, actualPair } = lib.pick;
  const { buildStatsBundle, groupRows } = lib.stats;
  const { buildStyleHistory } = lib.style;
  const { buildSectionalHistory } = lib.sectional;

  const rows = loadRows();
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  const splitAt = dates[Math.max(1, Math.floor(dates.length * TRAIN_FRACTION))];

  const styleHistory = buildStyleHistory(rows);
  const sectionalHistory = buildSectionalHistory(rows);
  const byDate = new Map();
  for (const r of rows) {
    const d = str(r.rcDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }

  // 워크포워드로 요인 행렬을 모은다. 시장 배당이 쓸 만한 경주만 남긴다 —
  // 검정의 질문 자체가 "시장 **위에** 더하는가" 이므로 시장이 있어야 한다.
  const races = [];
  const prior = [];
  for (const date of dates) {
    if (date >= splitAt) break;
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
        if (!market.usable) continue;

        const actual = actualPair(
          runners.map((r) => ({ ord: num(r.ord), chulNo: num(r.chulNo) })),
        );
        if (!actual) continue;
        const chulNo = runners.map((r) => num(r.chulNo));
        const first = chulNo.indexOf(actual[0]);
        const second = chulNo.indexOf(actual[1]);
        if (first < 0 || second < 0) continue;

        const mp = market.probs.map((v) => (v == null || !(v > 0) ? 1e-6 : v));
        const sum = mp.reduce((a, b) => a + b, 0);
        const marketP = Float64Array.from(mp.map((v) => v / sum));

        // 요인별 로짓을 경주 내에서 중심화한다. 상수항은 소프트맥스에서 상쇄되므로
        // 중심화해야 γ 가 "경주 안에서의 상대 차이"에 붙는 무게가 된다.
        const byFeature = {};
        for (const k of FEATURES) {
          const col = logits.map((row) => row[k]);
          const mean = col.reduce((a, b) => a + b, 0) / col.length;
          byFeature[k] = Float64Array.from(col.map((v) => v - mean));
        }
        races.push({ market: marketP, logits: byFeature, first, second });
      }
    }
    prior.push(...(byDate.get(date) ?? []));
  }

  console.log(`학습 구간 ${dates[0]} ~ ${splitAt} · 시장 사용 가능 ${races.length}경주\n`);
  console.log(`요인별 증분 검정 — p ∝ p_market^β · exp(γ·L)`);
  console.log(`본페로니 임계 (15개 검정, α=0.05): LR > 8.62\n`);
  console.log(`  ${"요인".padEnd(13)} ${"γ̂".padStart(7)} ${"β̂".padStart(5)} ${"LR".padStart(8)}   판정`);

  const out = [];
  for (const k of FEATURES) {
    if (k === "market") continue; // 시장 자기 자신은 검정 대상이 아니다
    const fit = fitGamma(races, k);
    out.push({ k, ...fit });
  }
  out.sort((a, b) => b.lr - a.lr);

  for (const o of out) {
    const verdict = o.lr > 8.62 ? "◀ 유의 (본페로니 통과)" : o.lr > 3.84 ? "· 단독 p<0.05, 보정 후 탈락" : "";
    console.log(
      `  ${o.k.padEnd(13)} ${o.gamma.toFixed(2).padStart(7)} ${o.beta.toFixed(1).padStart(5)} ${o.lr.toFixed(2).padStart(8)}   ${verdict}`,
    );
  }

  const winners = out.filter((o) => o.lr > 8.62);
  console.log(``);
  if (winners.length > 0) {
    console.log(`✅ 시장 위에 정보를 더하는 요인 ${winners.length}개: ${winners.map((w) => w.k).join(", ")}`);
    console.log(`   이 요인들만으로 결합 모델을 다시 만들면 우위가 나올 수 있다.`);
  } else {
    console.log(`❌ 15개 요인 중 시장 위에 정보를 더하는 것이 하나도 없다.`);
    console.log(`   묶어서 쟀을 때 α̂=0 이었던 것이 개별 요인의 신호가 묻힌 탓이 아니라,`);
    console.log(`   애초에 개별 요인에도 신호가 없어서였다는 뜻이다.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
