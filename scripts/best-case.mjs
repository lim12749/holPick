#!/usr/bin/env node
/**
 * "돈이 되는 경우의 수" 전수 탐색 — 그리고 그게 진짜인지 판정.
 *
 * 승식 4종 × 매수 수 3 × 등급 6 × 인기대 4 × 모델 확신도 4 = 1,152 가지를 전부 돌린다.
 *
 * **핵심 진단은 최고 ROI 가 아니라 "학습 ROI 가 검증 ROI 를 예측하는가" 다.**
 * 설정을 1,152개 만들면 그중 수십 개는 학습 구간에서 우연히 1.0 을 넘는다.
 * 그게 실력이면 검증 구간에서도 넘어야 하고, 노이즈면 안 넘는다. 두 값의 상관계수가
 * 0 근처면 **학습에서 아무리 좋아 보여도 의미가 없다**는 뜻이고, 그 사실 하나가
 * 개별 후보 수십 개를 보는 것보다 많은 것을 말해 준다.
 *
 * 스테이크는 베팅당 1,000원 플랫.
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법: node scripts/best-case.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "kra");
const STAKE = 1_000;
const MIN_TRAIN_BETS = 120;
const MIN_TEST_BETS = 60;
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

// ─── 확률 유도 (bet-types.mjs 와 동일) ───────────────────────────────────────

function normalize(a, n) {
  if (!a) return null;
  const o = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const v = a[i];
    if (v == null || !(v > 0)) return null;
    o[i] = v;
    s += v;
  }
  if (s <= 0) return null;
  for (let i = 0; i < n; i += 1) o[i] /= s;
  return o;
}

function top3Probs(p) {
  const n = p.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = p[i];
  for (let j = 0; j < n; j += 1) {
    const r1 = 1 - p[j];
    if (r1 <= 1e-12) continue;
    for (let i = 0; i < n; i += 1) if (i !== j) out[i] += (p[j] * p[i]) / r1;
    for (let k = 0; k < n; k += 1) {
      if (k === j) continue;
      const r2 = 1 - p[j] - p[k];
      if (r2 <= 1e-12) continue;
      const lead = (p[j] * p[k]) / r1;
      for (let i = 0; i < n; i += 1) if (i !== j && i !== k) out[i] += (lead * p[i]) / r2;
    }
  }
  return out;
}

function pairTop3Probs(p) {
  const n = p.length;
  const out = new Float64Array((n * (n - 1)) / 2);
  const idx = (i, j) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);
  for (let a = 0; a < n; a += 1) {
    const r1 = 1 - p[a];
    if (r1 <= 1e-12) continue;
    for (let b = 0; b < n; b += 1) {
      if (b === a) continue;
      const r2 = 1 - p[a] - p[b];
      if (r2 <= 1e-12) continue;
      const pab = p[a] * (p[b] / r1);
      for (let c = 0; c < n; c += 1) {
        if (c === a || c === b) continue;
        const q = (pab * p[c]) / r2;
        const s = [a, b, c].sort((x, y) => x - y);
        out[idx(s[0], s[1])] += q;
        out[idx(s[0], s[2])] += q;
        out[idx(s[1], s[2])] += q;
      }
    }
  }
  return out;
}

function quinellaProbs(p) {
  const n = p.length;
  const out = new Float64Array((n * (n - 1)) / 2);
  let k = 0;
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1) {
      const a = Math.min(Math.max(p[i], 1e-9), 0.999);
      const b = Math.min(Math.max(p[j], 1e-9), 0.999);
      out[k] = (a * b) / (1 - a) + (b * a) / (1 - b);
      k += 1;
    }
  return out;
}

const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

function candidatesFor(type, p, chulNo) {
  if (type === "단승") return Array.from(p, (q, i) => ({ key: String(chulNo[i]), prob: q }));
  if (type === "연승") return Array.from(top3Probs(p), (q, i) => ({ key: String(chulNo[i]), prob: q }));
  const probs = type === "복승" ? quinellaProbs(p) : pairTop3Probs(p);
  const n = chulNo.length;
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1) {
      out.push({ key: pairKey(chulNo[i], chulNo[j]), prob: probs[k] });
      k += 1;
    }
  return out;
}

const POOL = { 단승: "win", 연승: "place", 복승: "quinella", 복연: "quinellaPlace" };

// ─── 전처리: 경주당 승식별 상위 3후보를 한 번만 계산 ────────────────────────

function prepare() {
  const recs = JSON.parse(readFileSync(join(CACHE, "roi-records.json"), "utf8"));
  const meta = new Map();
  for (const f of readdirSync(CACHE).filter((x) => x.startsWith("race-result-"))) {
    for (const r of JSON.parse(readFileSync(join(CACHE, f), "utf8")).rows ?? []) {
      const k = `${str(r.rcDate)}-${num(r.rcNo)}`;
      if (!meta.has(k)) meta.set(k, str(r.rank));
    }
  }

  const out = [];
  for (const r of recs.races) {
    const p = normalize(r.modelWin, r.n);
    if (!p) continue;
    // 시장 1인기 배당 근사 — 인기대 필터에 쓴다.
    let favOdds = 0;
    if (r.marketWin) {
      const mx = Math.max(...r.marketWin.filter((v) => v != null && v > 0), 0);
      if (mx > 0) favOdds = 0.8 / mx;
    }
    const entry = {
      date: r.date,
      month: r.month,
      rank: meta.get(`${r.date}-${r.rcNo}`) ?? "",
      favOdds,
      picks: {},
    };
    for (const type of Object.keys(POOL)) {
      const pay = r.payouts?.[POOL[type]];
      if (!pay || Object.keys(pay).length === 0) continue;
      const top = candidatesFor(type, p, r.chulNo)
        .sort((a, b) => b.prob - a.prob)
        .slice(0, 3);
      entry.picks[type] = top.map((c) => ({ prob: c.prob, odds: pay[c.key] ?? 0 }));
    }
    if (Object.keys(entry.picks).length > 0) out.push(entry);
  }
  return out;
}

// ─── 격자 ─────────────────────────────────────────────────────────────────────

const CLASSES = ["전체", "국6등급", "국5등급", "국4등급", "혼4등급", "혼3등급"];
const FAV_BANDS = [
  ["전체", () => true],
  ["1인기≤2.0", (r) => r.favOdds > 0 && r.favOdds <= 2],
  ["1인기 2~3.5", (r) => r.favOdds > 2 && r.favOdds <= 3.5],
  ["1인기>3.5", (r) => r.favOdds > 3.5],
];
const CONF_BANDS = [
  ["전체", () => true],
  ["상위25%", null],
  ["상위50%", null],
  ["하위50%", null],
];

function buildGrid() {
  const g = [];
  for (const type of Object.keys(POOL))
    for (const K of [1, 2, 3])
      for (const cls of CLASSES)
        for (const [fb] of FAV_BANDS)
          for (const [cb] of CONF_BANDS) g.push({ type, K, cls, fb, cb });
  return g;
}

/** 확신도 밴드는 해당 부분집합 안에서의 분위수로 정한다. */
function confThresholds(rows, type) {
  const ps = rows.map((r) => r.picks[type]?.[0]?.prob).filter((v) => v != null).sort((a, b) => a - b);
  if (ps.length === 0) return null;
  const q = (f) => ps[Math.min(ps.length - 1, Math.floor(ps.length * f))];
  return { p50: q(0.5), p75: q(0.75) };
}

function evaluate(rows, cfg, thr) {
  let bets = 0;
  let ret = 0;
  let hitRaces = 0;
  let races = 0;
  const byRace = [];

  const favFn = FAV_BANDS.find(([l]) => l === cfg.fb)[1];
  for (const r of rows) {
    if (cfg.cls !== "전체" && r.rank !== cfg.cls) continue;
    if (!favFn(r)) continue;
    const picks = r.picks[cfg.type];
    if (!picks) continue;
    const lead = picks[0]?.prob ?? 0;
    if (cfg.cb === "상위25%" && !(lead >= thr.p75)) continue;
    if (cfg.cb === "상위50%" && !(lead >= thr.p50)) continue;
    if (cfg.cb === "하위50%" && !(lead < thr.p50)) continue;

    const use = picks.slice(0, cfg.K);
    if (use.length === 0) continue;
    let won = false;
    let rr = 0;
    for (const c of use) {
      bets += 1;
      ret += c.odds;
      rr += c.odds;
      if (c.odds > 0) won = true;
    }
    byRace.push({ ret: rr, n: use.length });
    races += 1;
    if (won) hitRaces += 1;
  }
  if (bets === 0) return null;
  return { bets, races, roi: ret / bets, hitRate: hitRaces / races, byRace };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapRoi(byRace, { B = 4000, seed = 31 } = {}) {
  if (byRace.length < 5) return { lo: NaN, hi: NaN };
  const rnd = mulberry32(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b += 1) {
    let r = 0;
    let n = 0;
    for (let i = 0; i < byRace.length; i += 1) {
      const c = byRace[(rnd() * byRace.length) | 0];
      r += c.ret;
      n += c.n;
    }
    out[b] = n > 0 ? r / n : 0;
  }
  out.sort();
  return { lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)] };
}

const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

function main() {
  const rows = prepare();
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const cut = dates[Math.floor(dates.length * 0.7)];
  const train = rows.filter((r) => r.date < cut);
  const test = rows.filter((r) => r.date >= cut);

  console.log(`전체 ${rows.length}경주`);
  console.log(`학습 ${train.length}경주 (~${cut} 이전) / 검증 ${test.length}경주 (${cut}~)`);
  console.log(`베팅당 ${STAKE.toLocaleString("ko-KR")}원 플랫\n`);

  const grid = buildGrid();
  const thrTrain = {};
  const thrTest = {};
  for (const t of Object.keys(POOL)) {
    thrTrain[t] = confThresholds(train, t);
    thrTest[t] = confThresholds(test, t);
  }

  const evaluated = [];
  for (const cfg of grid) {
    const a = evaluate(train, cfg, thrTrain[cfg.type]);
    if (!a || a.bets < MIN_TRAIN_BETS) continue;
    const b = evaluate(test, cfg, thrTest[cfg.type]);
    if (!b || b.bets < MIN_TEST_BETS) continue;
    evaluated.push({ cfg, tr: a, te: b });
  }

  console.log(`선언한 설정 ${grid.length}개 → 표본 충분 ${evaluated.length}개\n`);

  const overTrain = evaluated.filter((e) => e.tr.roi > 1);
  const overBoth = overTrain.filter((e) => e.te.roi > 1);
  console.log("=== 학습 구간에서 본전을 넘은 설정 ===");
  console.log(`  학습 ROI > 1.0 : ${overTrain.length}개 / ${evaluated.length}`);
  console.log(`  그중 검증에서도 > 1.0 : ${overBoth.length}개`);
  const keepRate = overTrain.length ? overBoth.length / overTrain.length : NaN;
  const baseRate = evaluated.filter((e) => e.te.roi > 1).length / evaluated.length;
  console.log(`  유지율 ${pct(keepRate)} vs 전체 설정의 검증 통과율 ${pct(baseRate)}`);
  console.log(
    keepRate > baseRate * 1.3
      ? `  → 학습 성적이 검증으로 어느 정도 이어진다.`
      : `  → **학습에서 넘은 것이 검증에서 더 잘 넘지 않는다. 학습 성적은 정보가 없다.**`,
  );

  const r = pearson(evaluated.map((e) => e.tr.roi), evaluated.map((e) => e.te.roi));
  console.log(`\n=== 핵심 진단: 학습 ROI 가 검증 ROI 를 예측하는가 ===`);
  console.log(`  상관계수 r = ${f2(r)}  (설정 ${evaluated.length}개)`);
  console.log(
    Math.abs(r) < 0.15
      ? `  → 거의 0. **학습 구간에서 아무리 좋아 보여도 다음 구간 성적과 무관하다.**`
      : r > 0.3
        ? `  → 양의 상관. 학습 성적에 실질 정보가 있다.`
        : `  → 약한 상관. 신중하게 볼 것.`,
  );

  console.log(`\n=== 학습 ROI 상위 10 ===`);
  console.log(
    `  ${"설정".padEnd(34)} ${"학습n".padStart(6)} ${"학습ROI".padStart(8)} ${"검증n".padStart(6)} ${"검증ROI".padStart(8)} ${"검증CI".padStart(14)}`,
  );
  for (const e of [...evaluated].sort((a, b) => b.tr.roi - a.tr.roi).slice(0, 10)) {
    const ci = bootstrapRoi(e.te.byRace);
    const label = `${e.cfg.type} K${e.cfg.K} ${e.cfg.cls} ${e.cfg.fb} ${e.cfg.cb}`;
    console.log(
      `  ${label.padEnd(34)} ${String(e.tr.bets).padStart(6)} ${f4(e.tr.roi).padStart(8)} ${String(e.te.bets).padStart(6)} ${f4(e.te.roi).padStart(8)} ${`[${f2(ci.lo)}, ${f2(ci.hi)}]`.padStart(14)}`,
    );
  }

  console.log(`\n=== 검증 ROI 상위 10 (사후 선택 — 참고용) ===`);
  console.log(
    `  ${"설정".padEnd(34)} ${"검증n".padStart(6)} ${"검증ROI".padStart(8)} ${"적중".padStart(7)} ${"검증CI".padStart(14)} ${"월손익".padStart(10)}`,
  );
  const months = new Set(test.map((r) => r.month)).size;
  for (const e of [...evaluated].sort((a, b) => b.te.roi - a.te.roi).slice(0, 10)) {
    const ci = bootstrapRoi(e.te.byRace);
    const label = `${e.cfg.type} K${e.cfg.K} ${e.cfg.cls} ${e.cfg.fb} ${e.cfg.cb}`;
    const profit = (e.te.bets / months) * STAKE * (e.te.roi - 1);
    console.log(
      `  ${label.padEnd(34)} ${String(e.te.bets).padStart(6)} ${f4(e.te.roi).padStart(8)} ${pct(e.te.hitRate).padStart(7)} ${`[${f2(ci.lo)}, ${f2(ci.hi)}]`.padStart(14)} ${(`${profit >= 0 ? "+" : "−"}${Math.abs(Math.round(profit)).toLocaleString("ko-KR")}원`).padStart(10)}`,
    );
  }
  console.log(
    `  ※ 이 표는 검증 구간을 보고 고른 것이라 **미래 성적의 추정치가 아니다.** 위 상관계수가 낮으면 더더욱.`,
  );

  const ciWin = evaluated.filter((e) => bootstrapRoi(e.te.byRace).lo > 1);
  console.log(`\n=== 최종 판정 ===`);
  console.log(`  검증 구간에서 부트스트랩 신뢰구간 하한이 1.0 을 넘는 설정: ${ciWin.length}개`);
  if (ciWin.length === 0) {
    console.log(`  → **${evaluated.length}개 설정 중 본전 초과를 통계적으로 입증한 것은 없다.**`);
  } else {
    for (const e of ciWin) {
      const ci = bootstrapRoi(e.te.byRace);
      console.log(
        `     ${e.cfg.type} K${e.cfg.K} ${e.cfg.cls} ${e.cfg.fb} ${e.cfg.cb} — 검증 ROI ${f4(e.te.roi)} CI [${f2(ci.lo)}, ${f2(ci.hi)}]`,
      );
    }
  }
}

main();
