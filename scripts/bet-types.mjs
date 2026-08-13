#!/usr/bin/env node
/**
 * 승식 4종 비교 — 단승 · 연승 · 복승 · 복연.
 *
 * 지금까지는 복승 하나만 봤다. 그런데 실측 환급률이 승식마다 다르고, 무엇보다
 * **분산이 크게 다르다**. 경주당 당첨이 3개인 연승은 회수 표준편차가 복승의 1/3 수준이라,
 * 같은 베팅 수로 우위를 훨씬 빨리 가려낼 수 있다.
 *
 * 실측 환급률 (3,098경주 전수):
 *   연승 0.7599 (SE 0.0066)  ← 공제가 가장 싸고 측정도 가장 정확하다
 *   단승 0.7417 (SE 0.0177)
 *   복승 0.6741 (SE 0.0238)
 *   복연 0.6571 (SE 0.0120)
 *
 * 스테이크는 **베팅당 1,000원 고정**. 판단 기준은 월 손익(ROI) 우선이다.
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법:
 *   node scripts/bet-types.mjs
 *   node scripts/bet-types.mjs --class 국6등급
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "kra");
const RECORDS = join(CACHE, "roi-records.json");
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

/** 베팅당 스테이크(원). */
const STAKE = 1_000;
/** 목표 ROI. */
const TARGET = 1.2;
/** 구간 판단 최소 베팅 수. */
const MIN_BETS = 100;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ─── 확률 유도 (Plackett–Luce) ────────────────────────────────────────────────

/**
 * 각 말이 3착 이내에 들 확률.
 *
 *   P(i=2착) = Σ_{j≠i} p_j · p_i/(1−p_j)
 *   P(i=3착) = Σ_{j≠i} Σ_{k≠i,j} p_j · p_k/(1−p_j) · p_i/(1−p_j−p_k)
 *
 * n ≤ 16 이라 O(n³) 이어도 무해하다. Σ_i P(i∈top3) = 3 이 되어야 하고,
 * 그 검산을 assertDerivations 에서 강제한다.
 */
function top3Probs(p) {
  const n = p.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = p[i];

  for (let j = 0; j < n; j += 1) {
    const rest1 = 1 - p[j];
    if (rest1 <= 1e-12) continue;
    for (let i = 0; i < n; i += 1) {
      if (i === j) continue;
      out[i] += (p[j] * p[i]) / rest1; // i 가 2착
    }
    for (let k = 0; k < n; k += 1) {
      if (k === j) continue;
      const rest2 = 1 - p[j] - p[k];
      if (rest2 <= 1e-12) continue;
      const lead = (p[j] * p[k]) / rest1;
      for (let i = 0; i < n; i += 1) {
        if (i === j || i === k) continue;
        out[i] += (lead * p[i]) / rest2; // i 가 3착
      }
    }
  }
  return out;
}

/** 두 마리가 **모두** 3착 이내일 확률. 1·2 / 1·3 / 2·3 세 배치를 더한다. */
function pairTop3Probs(p) {
  const n = p.length;
  const out = new Float64Array((n * (n - 1)) / 2);
  const idx = (i, j) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);

  // 세 자리 (a,b,c) 를 채우는 모든 순열을 훑고, 그중 두 자리를 차지한 쌍에 확률을 더한다.
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
        // 이 순열이 만드는 top3 집합 {a,b,c} 의 세 쌍에 각각 더한다.
        //
        // **여기서 6으로 나누면 안 된다.** 더하는 값은 집합 확률 P(S) 가 아니라
        // 그 **순열 하나**의 확률 q 다. 집합 S 의 6개 순열에 걸친 q 의 합이 곧 P(S) 이므로,
        // 쌍 (i,j) 는 Σ_k P({i,j,k}) = P(i·j 둘 다 top3) 를 정확히 누적한다.
        // 처음에 /6 을 넣었다가 검산에서 Σ 가 3 이 아니라 0.5 로 나와 잡았다.
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
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = Math.min(Math.max(p[i], 1e-9), 0.999);
      const b = Math.min(Math.max(p[j], 1e-9), 0.999);
      out[k] = (a * b) / (1 - a) + (b * a) / (1 - b);
      k += 1;
    }
  }
  return out;
}

/**
 * 유도가 맞는지 확인한다. 틀리면 이후 숫자가 전부 거짓이 되므로 즉시 멈춘다.
 * 정확히 3마리가 3착 안에 들므로 Σ P(i∈top3) = 3,
 * 그 3마리에서 나오는 쌍이 C(3,2)=3 개이므로 Σ P(둘 다 top3) = 3.
 */
function assertDerivations() {
  for (const raw of [[0.3, 0.25, 0.2, 0.15, 0.1], [0.5, 0.2, 0.1, 0.1, 0.06, 0.04], [0.12, 0.12, 0.12, 0.12, 0.13, 0.13, 0.13, 0.13]]) {
    const p = Float64Array.from(raw);
    const s1 = top3Probs(p).reduce((a, b) => a + b, 0);
    const s2 = pairTop3Probs(p).reduce((a, b) => a + b, 0);
    if (Math.abs(s1 - 3) > 1e-9) throw new Error(`Σ P(top3) = ${s1}, 3 이어야 한다`);
    if (Math.abs(s2 - 3) > 1e-9) throw new Error(`Σ P(pair top3) = ${s2}, 3 이어야 한다`);
  }
}

// ─── 승식 정의 ────────────────────────────────────────────────────────────────

const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * 각 승식은 (후보 나열, 배당 조회) 두 가지만 다르다.
 * 후보는 `{ key, prob }` 목록이고, key 로 배당맵을 조회한다.
 */
const BET_TYPES = {
  단승: {
    pool: "win",
    candidates: (p, chulNo) => Array.from(p, (q, i) => ({ key: String(chulNo[i]), prob: q })),
  },
  연승: {
    pool: "place",
    candidates: (p, chulNo) => Array.from(top3Probs(p), (q, i) => ({ key: String(chulNo[i]), prob: q })),
  },
  복승: {
    pool: "quinella",
    candidates: (p, chulNo) => pairList(quinellaProbs(p), chulNo),
  },
  복연: {
    pool: "quinellaPlace",
    candidates: (p, chulNo) => pairList(pairTop3Probs(p), chulNo),
  },
};

function pairList(probs, chulNo) {
  const n = chulNo.length;
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      out.push({ key: pairKey(chulNo[i], chulNo[j]), prob: probs[k] });
      k += 1;
    }
  }
  return out;
}

// ─── 통계 ─────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 경주 단위 클러스터 부트스트랩. 한 경주 안의 베팅은 서로 강하게 얽혀 있다. */
function bootstrapRoi(byRace, { B = 5000, seed = 4242 } = {}) {
  if (byRace.length < 5) return { lo: NaN, hi: NaN };
  const rnd = mulberry32(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b += 1) {
    let ret = 0;
    let n = 0;
    for (let i = 0; i < byRace.length; i += 1) {
      const c = byRace[(rnd() * byRace.length) | 0];
      ret += c.ret;
      n += c.n;
    }
    out[b] = n > 0 ? ret / n : 0;
  }
  out.sort();
  return { lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)] };
}

const requiredN = (sd, target, nullRoi) => {
  const d = target - nullRoi;
  return d <= 0 || sd <= 0 ? Infinity : Math.ceil(((1.96 + 0.8416) * sd / d) ** 2);
};
const betsForPrecision = (sd, hw = 0.1) => (sd <= 0 ? 0 : Math.ceil(((sd * 1.96) / hw) ** 2));

// ─── 평가 ─────────────────────────────────────────────────────────────────────

function evaluate(races, typeName, K, filter) {
  const type = BET_TYPES[typeName];
  const byRace = [];
  const returns = [];
  const byMonth = new Map();
  let hitRaces = 0;

  for (const r of races) {
    if (filter && !filter(r)) continue;
    const pay = r.payouts?.[type.pool];
    if (!pay || Object.keys(pay).length === 0) continue; // 이 승식 배당이 없는 경주는 제외

    const p = normalize(r.modelWin, r.n);
    if (!p) continue;

    const cand = type.candidates(p, r.chulNo).sort((a, b) => b.prob - a.prob).slice(0, K);
    if (cand.length === 0) continue;

    let ret = 0;
    let won = false;
    for (const c of cand) {
      const odds = pay[c.key] ?? 0;
      ret += odds;
      if (odds > 0) won = true;
      returns.push(odds);
    }
    byRace.push({ ret, n: cand.length });
    if (won) hitRaces += 1;

    const m = byMonth.get(r.month) ?? { bets: 0, ret: 0 };
    m.bets += cand.length;
    m.ret += ret;
    byMonth.set(r.month, m);
  }

  const bets = returns.length;
  if (bets === 0) return null;
  const roi = returns.reduce((a, b) => a + b, 0) / bets;
  const sd = bets > 1 ? Math.sqrt(returns.reduce((a, v) => a + (v - roi) ** 2, 0) / (bets - 1)) : 0;

  return {
    races: byRace.length,
    bets,
    roi,
    sd,
    raceHitRate: hitRaces / byRace.length,
    betHitRate: returns.filter((v) => v > 0).length / bets,
    ci: bootstrapRoi(byRace),
    byMonth,
  };
}

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

/** 승식별 환급률 — 전 조합을 다 샀을 때. 파서·정산이 맞는지 재현 검사로도 쓴다. */
function payback(races, typeName) {
  const type = BET_TYPES[typeName];
  let cost = 0;
  let ret = 0;
  for (const r of races) {
    const pay = r.payouts?.[type.pool];
    if (!pay || Object.keys(pay).length === 0) continue;
    const combos = type.pool === "win" || type.pool === "place" ? r.n : (r.n * (r.n - 1)) / 2;
    cost += combos;
    ret += Object.values(pay).reduce((a, b) => a + b, 0);
  }
  return cost > 0 ? ret / cost : NaN;
}

const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
const won = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("ko-KR")}원`;

// ─── main ─────────────────────────────────────────────────────────────────────

function loadMeta() {
  const meta = new Map();
  for (const f of readdirSync(CACHE).filter((x) => x.startsWith("race-result-"))) {
    for (const r of JSON.parse(readFileSync(join(CACHE, f), "utf8")).rows ?? []) {
      const k = `${str(r.rcDate)}-${num(r.rcNo)}`;
      if (!meta.has(k)) meta.set(k, { rank: str(r.rank), budam: str(r.budam) });
    }
  }
  return meta;
}

function main() {
  assertDerivations();
  console.log("확률 유도 검산 통과 — Σ P(3착이내)=3 · Σ P(쌍 3착이내)=3 ✓\n");

  const recs = JSON.parse(readFileSync(RECORDS, "utf8"));
  const meta = loadMeta();
  for (const r of recs.races) {
    const m = meta.get(`${r.date}-${r.rcNo}`);
    r.rank = m?.rank ?? "";
  }
  const all = recs.races;
  const cls = arg("class", null);
  const races = cls ? all.filter((r) => r.rank === cls) : all;
  const months = new Set(races.map((r) => r.month)).size;

  console.log(`대상 ${races.length}경주${cls ? ` (${cls})` : ""} · ${months}개월 · 베팅당 ${STAKE.toLocaleString("ko-KR")}원\n`);

  console.log("=== 환급률 재현 (전 조합 매수) ===");
  for (const t of Object.keys(BET_TYPES)) {
    console.log(`  ${t}  ${f4(payback(races, t))}`);
  }

  console.log(`\n=== 승식 × 경주당 매수 수 ===`);
  console.log(
    `  ${"승식".padEnd(6)} ${"K".padStart(2)} ${"경주".padStart(5)} ${"베팅".padStart(6)} ${"경주적중".padStart(8)} ${"ROI".padStart(8)} ${"sd".padStart(6)} ${"부트CI".padStart(15)} ${"월베팅액".padStart(9)} ${"월손익".padStart(10)}`,
  );

  const results = [];
  for (const t of Object.keys(BET_TYPES)) {
    for (const K of [1, 2, 3]) {
      const r = evaluate(races, t, K, null);
      if (!r || r.bets < MIN_BETS) continue;
      const perMonthBets = r.bets / months;
      const stake = perMonthBets * STAKE;
      const profit = stake * (r.roi - 1);
      results.push({ t, K, ...r, stake, profit });
      const flag = r.ci.lo > 1 ? " ◀ 본전 초과 확정" : r.roi >= 1 ? " · ROI>1" : "";
      console.log(
        `  ${t.padEnd(6)} ${String(K).padStart(2)} ${String(r.races).padStart(5)} ${String(r.bets).padStart(6)} ${pct(r.raceHitRate).padStart(8)} ${f4(r.roi).padStart(8)} ${f2(r.sd).padStart(6)} ${`[${f2(r.ci.lo)}, ${f2(r.ci.hi)}]`.padStart(15)} ${Math.round(stake).toLocaleString("ko-KR").padStart(8)}원 ${won(profit).padStart(10)}${flag}`,
      );
    }
  }

  console.log(`\n=== 검정력 (승식별 K=1) ===`);
  console.log(`  ${"승식".padEnd(6)} ${"sd".padStart(6)} ${"±0.10 확정".padStart(11)} ${"1.20 검출".padStart(10)}  현재 베팅 수`);
  for (const t of Object.keys(BET_TYPES)) {
    const r = results.find((x) => x.t === t && x.K === 1);
    if (!r) continue;
    const pb = payback(races, t);
    const need = requiredN(r.sd, TARGET, pb);
    const enough = need <= r.bets ? "✓ 충분" : "✗ 부족";
    console.log(
      `  ${t.padEnd(6)} ${f2(r.sd).padStart(6)} ${String(betsForPrecision(r.sd)).padStart(11)} ${String(need).padStart(10)}  ${r.bets} ${enough}`,
    );
  }

  // 최근 구간 비교 — 최신 데이터부터 12/24/36개월
  const sortedMonths = [...new Set(races.map((r) => r.month))].sort().reverse();
  console.log(`\n=== 최근 구간별 ROI (K=1) ===`);
  console.log(`  ${"승식".padEnd(6)} ${"최근12개월".padStart(11)} ${"최근24개월".padStart(11)} ${"전체".padStart(11)}`);
  for (const t of Object.keys(BET_TYPES)) {
    const cells = [12, 24, sortedMonths.length].map((k) => {
      const keep = new Set(sortedMonths.slice(0, k));
      const r = evaluate(races.filter((x) => keep.has(x.month)), t, 1, null);
      return r && r.bets >= 50 ? `${f4(r.roi)}` : "—";
    });
    console.log(`  ${t.padEnd(6)} ${cells[0].padStart(11)} ${cells[1].padStart(11)} ${cells[2].padStart(11)}`);
  }

  // 등급별 — 복승에서 나온 국6등급 우위가 다른 승식에도 있는가
  if (!cls) {
    const ranks = [...new Set(all.map((r) => r.rank))].filter(Boolean);
    const big = ranks.filter((k) => all.filter((r) => r.rank === k).length >= 200);
    console.log(`\n=== 등급 × 승식 (K=1, ROI) ===`);
    console.log(`  ${"등급".padEnd(10)} ${"경주".padStart(5)} ` + Object.keys(BET_TYPES).map((t) => t.padStart(9)).join(" "));
    for (const k of big.sort()) {
      const sub = all.filter((r) => r.rank === k);
      const cells = Object.keys(BET_TYPES).map((t) => {
        const r = evaluate(sub, t, 1, null);
        if (!r || r.bets < MIN_BETS) return "—";
        return (r.ci.lo > 1 ? "◀" : "") + f4(r.roi);
      });
      console.log(`  ${k.padEnd(10)} ${String(sub.length).padStart(5)} ` + cells.map((c) => c.padStart(9)).join(" "));
    }
    console.log(`  (◀ = 부트스트랩 신뢰구간 하한이 1.0 초과)`);
  }

  // 최적 후보의 월별 표
  const best = results.filter((r) => r.bets >= MIN_BETS).sort((a, b) => b.roi - a.roi)[0];
  if (best) {
    console.log(`\n=== 최적 후보 월별: ${best.t} K=${best.K} (ROI ${f4(best.roi)}) ===`);
    const ms = [...best.byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    let plus = 0;
    for (const [m, v] of ms) {
      const roi = v.ret / v.bets;
      const profit = v.bets * STAKE * (roi - 1);
      if (roi >= 1) plus += 1;
      console.log(`    ${m}  ${String(v.bets).padStart(4)}베팅  ROI ${f4(roi)}  ${won(profit).padStart(10)}`);
    }
    console.log(`  본전 이상인 달 ${plus}/${ms.length}`);
  }
}

main();
