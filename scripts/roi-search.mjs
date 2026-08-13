#!/usr/bin/env node
/**
 * 복승식 플랫 베팅 전략 탐색기.
 *
 * 목표는 "월 ROI +20%(배수 1.20) 를 넘는 전략이 있는가" 이고, 설계 목표는
 * **+20% 를 만들어 내는 것이 아니라 +20% 가 실재하는지 정직하게 판정하는 것**이다.
 * 그래서 이 스크립트의 대부분은 ROI 를 올리는 코드가 아니라 ROI 를 의심하는 코드다.
 *
 * 왜 그런가 — 실측된 제약:
 *   복승 환급률 0.7387 (공제율 26.1%). 아무렇게나 사면 0.7387 이 돌아온다.
 *   인기 2두 조합만 사도 0.9232 다. 넘어야 할 선은 0.74 가 아니라 0.92 다.
 *   베팅당 회수 표준편차가 2.1 이라, ROI 를 ±0.10 으로 좁히려면 1,694 베팅이 필요하다.
 *   한 달은 약 100 베팅이고 그때 신뢰구간 반폭은 ±0.41 이다.
 *   → **월 단위 ROI 목표는 월 단위로 검증할 수 없다.** 이건 의견이 아니라 산술이다.
 *
 * 설정을 1,200개 시도하면 노이즈만으로도 ROI 1.3 짜리 "승자"가 반드시 나온다.
 * 그걸 걸러내는 게 순열 귀무분포(best-of-N)이고, 이 스크립트의 존재 이유다.
 *
 * 사용법:
 *   node scripts/roi-search.mjs coverage
 *   node scripts/roi-search.mjs build
 *   node scripts/roi-search.mjs search
 *   node scripts/roi-search.mjs holdout --config .cache/kra/roi-frozen.json
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadLib, sourceMtimes } from "./compile-lib.mjs";

const CACHE = join(process.cwd(), ".cache", "kra");
const RECORDS = join(CACHE, "roi-records.json");
const FROZEN = join(CACHE, "roi-frozen.json");
const TRIALS = join(CACHE, "roi-search-trials.jsonl");
const HOLDOUT_LOG = join(CACHE, "roi-holdout-log.jsonl");

const ENTRIES = [
  "predict",
  "pick",
  "stats",
  "style",
  "sectional",
  "quinella",
  "dividend-parse",
  "horse",
];

/** 목표 ROI. 사용자가 정한 월 +20%. */
const TARGET_ROI = 1.2;
/** 최소 베팅 수. 이보다 적으면 평가하지 않는다 (노이즈로 ROI 3.0 이 쉽게 나온다). */
const MIN_BETS = 150;
/** 순열 귀무 반복 수. 95%분위만 필요하므로 500 이면 충분히 안정적이다. */
const NULL_REPLICATES = 500;
/** 부트스트랩 반복 수. */
const BOOTSTRAP_B = 10_000;

const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정적 난수 — 순열·부트스트랩이 재현 가능해야 한다.
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시 읽기
// ─────────────────────────────────────────────────────────────────────────────

function loadRows() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-")).sort()) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    // 착순이 매겨진 행만. 94 같은 출전취소 코드는 제외한다.
    // 이 정의가 환급률 분모를 정한다 — 출전표 기준으로 세면 0.7057, 출주 기준이면 0.7387.
    rows.push(...(env.rows ?? []).filter((r) => num(r.ord) > 0 && num(r.ord) <= 90));
  }
  return rows;
}

/**
 * 하루치 배당을 승식 4종으로 나눠 읽는다.
 *
 * 단식·연식은 말 1마리라 `toDividendsOf`(2마리 전제)로는 읽히지 않는다 —
 * 조용히 빈 맵이 나온다. 전용 파서를 쓴다.
 */
function loadDividendsByDate(lib, dates) {
  const { toDividendsOf, toSingleDividendsOf } = lib["dividend-parse"];
  const out = new Map();
  for (const d of dates) {
    const p = join(CACHE, `dividend-${d}-meet1.json`);
    if (!existsSync(p)) continue;
    const rows = JSON.parse(readFileSync(p, "utf8")).rows ?? [];
    out.set(d, {
      win: toSingleDividendsOf(rows, "단식"),
      place: toSingleDividendsOf(rows, "연식"),
      quinella: toDividendsOf(rows, "복식"),
      quinellaPlace: toDividendsOf(rows, "복연"),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 감쇠 Harville
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 마리가 1·2착에 드는 확률.
 *
 *   P(i,j) = q_i · q_j^λ / (S − q_i^λ)  +  q_j · q_i^λ / (S − q_j^λ)
 *   q = p^τ 를 정규화, S = Σ q_k^λ
 *
 * λ=1, τ=1 이면 quinella.ts 의 quinellaProbability 와 **정확히** 같다.
 * 원래 Harville 은 1착마를 뺀 나머지에서 2착을 다시 뽑는데, 실제로는 인기마가
 * 1착을 놓쳤을 때 2착에도 못 드는 경향이 있어 인기마 조합을 과대평가한다.
 * λ<1 이 그 편향을 눌러 준다.
 *
 * @param {Float64Array} p 승리 확률 (합 1)
 * @returns {Float64Array} pairIndex(i,j) 순 조합 확률
 */
function dampedHarvillePairs(p, lambda, tau) {
  const n = p.length;
  const q = new Float64Array(n);
  let qs = 0;
  for (let i = 0; i < n; i += 1) {
    q[i] = tau === 1 ? p[i] : Math.pow(p[i], tau);
    qs += q[i];
  }
  if (qs > 0) for (let i = 0; i < n; i += 1) q[i] /= qs;

  const ql = new Float64Array(n);
  let S = 0;
  for (let i = 0; i < n; i += 1) {
    ql[i] = lambda === 1 ? q[i] : Math.pow(q[i], lambda);
    S += ql[i];
  }

  const out = new Float64Array((n * (n - 1)) / 2);
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const di = S - ql[i];
      const dj = S - ql[j];
      const a = di > 1e-12 ? (q[i] * ql[j]) / di : 0;
      const b = dj > 1e-12 ? (q[j] * ql[i]) / dj : 0;
      out[k] = a + b;
      k += 1;
    }
  }
  return out;
}

function pairIndex(i, j, n) {
  // i < j 전제. (i,j) → 0..C(n,2)-1
  return (i * (2 * n - i - 1)) / 2 + (j - i - 1);
}

/** λ=1,τ=1 이 프로덕션 공식과 일치하는지 시작 시 확인한다. */
function assertHarvilleAgreement(lib) {
  const { quinellaProbability } = lib.quinella;
  const p = Float64Array.from([0.31, 0.22, 0.17, 0.12, 0.09, 0.05, 0.04]);
  const got = dampedHarvillePairs(p, 1, 1);
  let worst = 0;
  const n = p.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const want = quinellaProbability(p[i], p[j]);
      worst = Math.max(worst, Math.abs(got[pairIndex(i, j, n)] - want));
    }
  }
  if (worst > 1e-12) {
    throw new Error(`감쇠 Harville 이 λ=1 에서 quinellaProbability 와 어긋난다 (최대 ${worst})`);
  }
  return worst;
}

// ─────────────────────────────────────────────────────────────────────────────
// build — 워크포워드로 경주 레코드를 만든다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 경주 단위로 저장하는 이유: λ·τ 를 나중에 바꿔 가며 조합 확률을 다시 계산해야
 * 한다. 조합 확률을 굳혀서 저장하면 Harville 보정 계열 전체가 탐색 불가가 된다.
 */
async function buildRecords(lib) {
  const { predictRace, marketProbabilities } = lib.predict;
  const { candidateFromRow, EMPTY_TRAITS, actualPair } = lib.pick;
  const { buildStatsBundle, groupRows } = lib.stats;
  const { buildStyleHistory } = lib.style;
  const { buildSectionalHistory } = lib.sectional;
  const { pairKey } = lib.quinella;

  if (lib.predict.FEATURES.length !== 15) {
    throw new Error(`FEATURES 가 15개가 아니다 (${lib.predict.FEATURES.length}). 모델이 바뀌었다.`);
  }

  const rows = loadRows();
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  const dividends = loadDividendsByDate(lib, dates);

  const styleHistory = buildStyleHistory(rows);
  const sectionalHistory = buildSectionalHistory(rows);

  const byDate = new Map();
  for (const r of rows) {
    const d = str(r.rcDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }

  const races = [];
  const prior = [];
  for (const date of dates) {
    // 첫 날은 이전 기록이 없어 요인이 전부 기저율이다. 건너뛴다.
    if (prior.length > 0) {
      const stats = buildStatsBundle(prior, styleHistory, sectionalHistory);
      const day = dividends.get(date);
      for (const [key, race] of groupRows(byDate.get(date) ?? [])) {
        // 마번 순 정렬은 누수 차단이다. 응답이 착순 순이고 JS sort 가 안정정렬이라
        // 동점이 생기면 착순이 그대로 남는다.
        const runners = [...race].sort((a, b) => num(a.chulNo) - num(b.chulNo));
        if (runners.length < 4) continue;

        const traits = {
          style: styleHistory.byRace.get(key)?.styleByHorse ?? EMPTY_TRAITS.style,
          sectional: sectionalHistory.byRace.get(key) ?? EMPTY_TRAITS.sectional,
        };
        const cands = runners.map((r) => candidateFromRow(r, traits));
        const rcDist = num(runners[0].rcDist);
        const preds = predictRace(cands, stats, rcDist);

        const chulNo = runners.map((r) => num(r.chulNo));
        const winByChul = new Map(preds.map((p) => [p.chulNo, p.win]));
        const modelWin = chulNo.map((c) => winByChul.get(c) ?? 0);

        // 순수 기본 요인 확률(시장 항 0). 시장과 **확률 수준에서** 섞어 보려면
        // 시장이 안 섞인 쪽이 따로 있어야 한다. MARKET_MODEL 은 시장을 요인 하나로
        // 넣어 로짓 단계에서 이미 섞어 버리므로 α 를 분리해서 잴 수 없다.
        const fundPreds = predictRace(cands, stats, rcDist, lib.predict.NO_MARKET_MODEL);
        const fundByChul = new Map(fundPreds.map((p) => [p.chulNo, p.win]));
        const fundWin = chulNo.map((c) => fundByChul.get(c) ?? 0);

        const oddsList = cands.map((c) => c.winOdds);
        const market = marketProbabilities(oddsList);

        // 인기순위: 확정 단승배당 오름차순. 배당이 없으면 맨 뒤로.
        const order = chulNo
          .map((c, i) => ({ i, o: oddsList[i] > 0 ? oddsList[i] : Infinity }))
          .sort((a, b) => a.o - b.o);
        const favRank = new Array(chulNo.length).fill(chulNo.length);
        order.forEach((e, rank) => {
          favRank[e.i] = rank + 1;
        });

        const rcNo = num(runners[0].rcNo);
        // 승식 4종을 각각 담는다. 적중 판정은 언제나 **이 맵의 키 존재 여부**로 하고
        // 착순과 비교하지 않는다 — 동착이면 당첨이 여럿인데 착순 비교는 하나만 잡는다.
        const payouts = { win: {}, place: {}, quinella: {}, quinellaPlace: {} };
        if (day) {
          for (const d of day.win.values()) if (d.rcNo === rcNo) payouts.win[d.horse] = d.odds;
          for (const d of day.place.values()) if (d.rcNo === rcNo) payouts.place[d.horse] = d.odds;
          for (const d of day.quinella.values())
            if (d.rcNo === rcNo) payouts.quinella[pairKey(d.pair[0], d.pair[1])] = d.odds;
          for (const d of day.quinellaPlace.values())
            if (d.rcNo === rcNo) payouts.quinellaPlace[pairKey(d.pair[0], d.pair[1])] = d.odds;
        }

        const actual = actualPair(runners.map((r) => ({ ord: num(r.ord), chulNo: num(r.chulNo) })));
        // 3착까지의 마번. 연승·복연 정산의 기준이며, 동착이면 3개를 넘을 수 있다.
        const top3 = runners
          .filter((r) => num(r.ord) >= 1 && num(r.ord) <= 3)
          .sort((a, b) => num(a.ord) - num(b.ord))
          .map((r) => num(r.chulNo));

        races.push({
          date,
          rcNo,
          month: date.slice(0, 6),
          n: runners.length,
          rcDist,
          chulNo,
          modelWin,
          fundWin,
          marketWin: market.probs,
          marketUsable: market.usable,
          overround: market.overround,
          favRank,
          actual,
          top3,
          // 정산 가능 = 복승 배당맵이 비어 있지 않다. actual 과 비교하지 않는 이유는
          // 2착 동착이면 당첨 조합이 둘인데 actualPair 는 하나만 돌려주기 때문이다.
          // 기존 탐색이 복승 기준이므로 이 필드의 뜻은 그대로 두고, 승식별 정산 가능
          // 여부는 bet-types.mjs 가 각 payouts 맵을 직접 보고 판단한다.
          settled: Object.keys(payouts.quinella).length > 0,
          payouts,
        });
      }
    }
    prior.push(...(byDate.get(date) ?? []));
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    sources: sourceMtimes(ENTRIES),
    temperature: lib.predict.MARKET_MODEL.temperature,
    races,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 환급률 · 분할
// ─────────────────────────────────────────────────────────────────────────────

function paybackUnits(races) {
  return races
    .filter((r) => r.settled)
    .map((r) => ({
      combos: (r.n * (r.n - 1)) / 2,
      payouts: Object.values(r.payouts.quinella),
    }));
}

function measurePayback(lib, races) {
  const { poolPayback } = lib["dividend-parse"];
  return poolPayback(paybackUnits(races));
}

/**
 * 환급률의 경주 단위 부트스트랩 신뢰구간.
 *
 * 공제율은 고정 비율인데도 이 추정량은 974경주로 CI 가 [0.61, 0.79] 나 된다 —
 * 드물게 나오는 거대 배당(최대 847)이 합을 좌우하기 때문이다. **집의 몫조차
 * 1년치로는 ±0.09 밖에 못 좁힌다**는 사실이, 월 ROI 목표를 검증할 수 없다는
 * 이 스크립트의 결론과 같은 뿌리다.
 */
function paybackCi(races, { B = 5000, seed = 7 } = {}) {
  const units = paybackUnits(races);
  if (units.length < 2) return { lo: NaN, hi: NaN };
  const rnd = mulberry32(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b += 1) {
    let c = 0;
    let r = 0;
    for (let i = 0; i < units.length; i += 1) {
      const u = units[(rnd() * units.length) | 0];
      c += u.combos;
      r += u.payouts.reduce((a, v) => a + v, 0);
    }
    out[b] = c > 0 ? r / c : 0;
  }
  out.sort();
  return { lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)] };
}

/**
 * 정산 가능한 경주일 기준 4분할.
 * 홀드아웃은 search 가 **로드 시점에** 버리므로 실수로도 볼 수 없다.
 */
function splitDates(races) {
  const days = [...new Set(races.filter((r) => r.settled).map((r) => r.date))].sort();
  const n = days.length;
  const a = Math.floor(n * 0.15);
  const b = Math.floor(n * 0.45);
  const c = Math.floor(n * 0.75);
  return {
    burnIn: days.slice(0, a),
    train: days.slice(a, b),
    validate: days.slice(b, c),
    holdout: days.slice(c),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1단계 — λ·τ 적합 (탐색이 아니라 적합이므로 다중검정 비용이 없다)
// ─────────────────────────────────────────────────────────────────────────────

/** 관측된 당첨 조합의 로그우도. 배당이 필요 없으므로 모든 경주를 쓴다. */
function pairLogLik(races, probKey, lambda, tau) {
  let ll = 0;
  let n = 0;
  for (const r of races) {
    if (!r.actual) continue;
    const p = probsOf(r, probKey);
    if (!p) continue;
    const ia = r.chulNo.indexOf(r.actual[0]);
    const ib = r.chulNo.indexOf(r.actual[1]);
    if (ia < 0 || ib < 0) continue;
    const pairs = dampedHarvillePairs(p, lambda, tau);
    const i = Math.min(ia, ib);
    const j = Math.max(ia, ib);
    ll += Math.log(Math.max(pairs[pairIndex(i, j, r.n)], 1e-12));
    n += 1;
  }
  return n ? ll / n : -Infinity;
}

function probsOf(r, probKey) {
  const raw = r[probKey];
  if (!raw) return null;
  const out = new Float64Array(r.n);
  let s = 0;
  for (let i = 0; i < r.n; i += 1) {
    const v = raw[i];
    if (v == null || !Number.isFinite(v) || v <= 0) return null;
    out[i] = v;
    s += v;
  }
  if (s <= 0) return null;
  for (let i = 0; i < r.n; i += 1) out[i] /= s;
  return out;
}

/** 황금분할로 λ 를, 격자로 τ 를 찾는다. */
function fitPairModel(races, probKey) {
  const TAUS = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
  let best = { lambda: 1, tau: 1, logLik: -Infinity };
  for (const tau of TAUS) {
    const f = (l) => pairLogLik(races, probKey, l, tau);
    let lo = 0.3;
    let hi = 1.8;
    const gr = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - gr * (hi - lo);
    let x2 = lo + gr * (hi - lo);
    let f1 = f(x1);
    let f2 = f(x2);
    for (let it = 0; it < 30 && hi - lo > 1e-4; it += 1) {
      if (f1 > f2) {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - gr * (hi - lo);
        f1 = f(x1);
      } else {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + gr * (hi - lo);
        f2 = f(x2);
      }
    }
    const lambda = (lo + hi) / 2;
    const logLik = f(lambda);
    if (logLik > best.logLik) best = { lambda, tau, logLik };
  }
  best.logLikAt1 = pairLogLik(races, probKey, 1, 1);
  best.n = races.filter((r) => r.actual && probsOf(r, probKey)).length;
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 확률 수준 결합 (Benter 식) — 기본 요인이 시장에 없는 정보를 갖고 있는가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * p ∝ p_fund^α · p_market^β 로 결합한 승리 확률.
 *
 * 왜 이걸 따로 재는가: predict.ts 는 시장을 **요인 하나로** 넣어 로짓 단계에서
 * 섞는다(가중치 0.489). 그러면 "기본 요인이 시장 위에 무엇을 더했는가"를
 * 분리해서 잴 수가 없다 — 두 정보원이 이미 한 덩어리다.
 *
 * 확률 수준에서 지수를 따로 두면 α 가 그 답을 직접 준다.
 *   α ≈ 0  → 기본 요인은 시장이 이미 아는 것만 안다. 우위 없음.
 *   α > 0  → 시장이 놓친 정보가 있다. 그만큼이 우위의 상한이다.
 * 경마 베팅 문헌(Benter)에서 표준으로 쓰는 2단계 결합이다.
 */
function blendProbs(pFund, pMarket, alpha, beta) {
  const n = pFund.length;
  const out = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const a = Math.pow(Math.max(pFund[i], 1e-9), alpha);
    const b = Math.pow(Math.max(pMarket[i], 1e-9), beta);
    out[i] = a * b;
    s += out[i];
  }
  if (s > 0) for (let i = 0; i < n; i += 1) out[i] /= s;
  return out;
}

/** 결합 확률의 복승(1·2착) 로그우도. λ·τ 는 1로 고정하고 α·β 만 본다. */
function blendLogLik(races, alpha, beta) {
  let ll = 0;
  let n = 0;
  for (const r of races) {
    if (!r.actual) continue;
    const f = probsOf(r, "fundWin");
    const m = probsOf(r, "marketWin");
    if (!f || !m) continue;
    const ia = r.chulNo.indexOf(r.actual[0]);
    const ib = r.chulNo.indexOf(r.actual[1]);
    if (ia < 0 || ib < 0) continue;
    const p = blendProbs(f, m, alpha, beta);
    const pairs = dampedHarvillePairs(p, 1, 1);
    const i = Math.min(ia, ib);
    const j = Math.max(ia, ib);
    ll += Math.log(Math.max(pairs[pairIndex(i, j, r.n)], 1e-12));
    n += 1;
  }
  return n ? ll / n : -Infinity;
}

/** α·β 격자 탐색 + α 의 우도비 검정. */
function fitBlend(races) {
  const GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.1, 1.4];
  const BETAS = [0, 0.3, 0.5, 0.7, 0.9, 1.0, 1.1, 1.3, 1.6, 2.0];
  let best = { alpha: 0, beta: 1, ll: -Infinity };
  for (const alpha of GRID) {
    for (const beta of BETAS) {
      const ll = blendLogLik(races, alpha, beta);
      if (ll > best.ll) best = { alpha, beta, ll };
    }
  }
  // α=0 (시장만) 대비 우도비. 자유도 1.
  let bestAt0 = -Infinity;
  for (const beta of BETAS) bestAt0 = Math.max(bestAt0, blendLogLik(races, 0, beta));
  const n = races.filter((r) => r.actual && probsOf(r, "fundWin") && probsOf(r, "marketWin")).length;
  const lr = 2 * n * (best.ll - bestAt0);
  return { ...best, llMarketOnly: bestAt0, lr, n };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2단계 — 열(column) 구성과 전략 평가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 정산 가능한 경주의 모든 조합을 평평한 타입배열로 편다.
 * 전략 평가는 이 위의 마스크 축약 한 번이라 설정 1,200개를 몇 초에 돈다.
 */
function buildColumns(races, fit, payback) {
  const raceStart = [];
  const raceEnd = [];
  const raceN = [];
  const raceOverround = [];
  const raceDate = [];
  const raceMonth = [];

  const pm = [];
  const pk = [];
  const payout = [];
  const favMax = [];
  const favMin = [];

  const { pairKey } = { pairKey: (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}` };

  for (const r of races) {
    if (!r.settled) continue;
    const p = probsOf(r, "modelWin");
    const q = probsOf(r, "marketWin");
    if (!p || !q) continue;

    const mp = dampedHarvillePairs(p, fit.model.lambda, fit.model.tau);
    const kp = dampedHarvillePairs(q, fit.market.lambda, fit.market.tau);

    raceStart.push(pm.length);
    for (let i = 0; i < r.n; i += 1) {
      for (let j = i + 1; j < r.n; j += 1) {
        const idx = pairIndex(i, j, r.n);
        pm.push(mp[idx]);
        pk.push(kp[idx]);
        payout.push(r.payouts.quinella[pairKey(r.chulNo[i], r.chulNo[j])] ?? 0);
        favMax.push(Math.max(r.favRank[i], r.favRank[j]));
        favMin.push(Math.min(r.favRank[i], r.favRank[j]));
      }
    }
    raceEnd.push(pm.length);
    raceN.push(r.n);
    raceOverround.push(r.overround);
    raceDate.push(r.date);
    raceMonth.push(r.month);
  }

  const cols = {
    pModel: Float64Array.from(pm),
    pMarket: Float64Array.from(pk),
    payout: Float64Array.from(payout),
    favMax: Int32Array.from(favMax),
    favMin: Int32Array.from(favMin),
    raceStart: Int32Array.from(raceStart),
    raceEnd: Int32Array.from(raceEnd),
    raceN: Int32Array.from(raceN),
    raceOverround: Float64Array.from(raceOverround),
    raceDate,
    raceMonth,
    payback,
  };
  cols.estPayout = new Float64Array(cols.pMarket.length);
  cols.ev = new Float64Array(cols.pMarket.length);
  cols.value = new Float64Array(cols.pMarket.length);
  refreshDerived(cols);
  return cols;
}

/**
 * modelWin 이 바뀌었을 때 pModel 열만 제자리에서 다시 채운다.
 *
 * buildColumns 와 **같은 순서·같은 스킵 규칙**으로 돌아야 한다. 순열은 값을 섞을 뿐
 * null 여부를 바꾸지 않으므로 건너뛰는 경주 집합은 동일하다.
 */
function recomputeModelColumn(cols, races, fit) {
  let k = 0;
  for (const r of races) {
    if (!r.settled) continue;
    const p = probsOf(r, "modelWin");
    const q = probsOf(r, "marketWin");
    if (!p || !q) continue;
    const mp = dampedHarvillePairs(p, fit.model.lambda, fit.model.tau);
    for (let i = 0; i < r.n; i += 1) {
      for (let j = i + 1; j < r.n; j += 1) {
        cols.pModel[k] = mp[pairIndex(i, j, r.n)];
        k += 1;
      }
    }
  }
  refreshDerived(cols);
}

/** pModel 이 바뀌면(순열 귀무) 파생 열을 다시 만든다. */
function refreshDerived(cols) {
  const { pModel, pMarket, payback } = cols;
  for (let i = 0; i < pModel.length; i += 1) {
    const est = pMarket[i] > 1e-9 ? payback / pMarket[i] : 0;
    cols.estPayout[i] = est;
    cols.ev[i] = pModel[i] * est - 1;
    cols.value[i] = pMarket[i] > 1e-9 ? pModel[i] / pMarket[i] : 0;
  }
}

/**
 * 선언된 격자. **길이가 곧 다중검정 배수 N 이다.**
 *
 * 격자를 줄이는 건 미용이 아니다. N 이 크면 순열 귀무의 최댓값 분포가 통째로
 * 올라가서, 진짜 우위가 있어도 증명하지 못하게 된다. 그래서 가설로서 약한 차원을
 * 먼저 버린다.
 *
 * **버린 차원: 출주두수.** 두수 자체가 우위를 만들 이유가 없고, 만들더라도 그건
 * 이미 pModel 에 반영되어 있다. 순진한 교차곱 2,970개가 이 컷으로 1,188개가 된다.
 * (버린 사실을 여기 적어 두는 이유는, 조용히 자르면 "전부 다 봤다"로 읽히기 때문이다.)
 */
function buildGrid() {
  // EV 는 value 를 단조변환한 것이라 **순위 규칙으로는 완전히 같다**:
  //   ev = pModel · (P̂ / pMarket) − 1 = value · P̂ − 1,  P̂ 는 상수
  // 처음엔 둘을 따로 뒀는데 상위 표에 같은 결과가 두 줄씩 찍혀서 드러났다.
  // 따로 두면 N 만 1.5배로 부풀어 귀무 문턱이 올라가고, 그만큼 진짜 우위를
  // 증명하기 어려워진다. 그래서 value 로 합치고 게이트를 value 단위 사다리로 쓴다.
  // pMarket 도 순위 규칙에 넣는다. 기준선에서 인기 2두 조합(0.93)이 모델(0.85)을
  // 이겼으므로, 가장 성적이 좋은 계열을 탐색에서 빼면 "전부 봤다"가 거짓이 된다.
  const rules = ["pModel", "value", "pMarket"];
  const gates = [
    { kind: "none" },
    { kind: "value", t: 1.0 },
    { kind: "value", t: 1.05 },
    { kind: "value", t: 1.1 },
    { kind: "value", t: 1.2 },
    { kind: "value", t: 1.35 },
    { kind: "value", t: 1.5 },
    { kind: "value", t: 1.7 },
    { kind: "value", t: 2.0 },
  ];
  const bands = [
    [0, 1],
    [0.04, 1],
    [0.02, 0.25],
    [0.04, 0.2],
  ];
  const favs = [4, 6, 99];

  const out = [];
  for (const rule of rules) {
    for (const K of [1, 2, 3]) {
      for (const gate of gates) {
        for (const band of bands) {
          for (const fav of favs) {
            out.push({ sel: `top${K}-by-${rule}`, rule, K, gate, band, field: "any", fav });
          }
        }
      }
    }
  }
  // 게이트 통과 전부 매수. 게이트가 없으면 전 조합 매수라 의미가 없어 제외한다.
  for (const gate of gates) {
    if (gate.kind === "none") continue;
    for (const band of bands) {
      for (const fav of favs) {
        out.push({ sel: `all-by-value${gate.t}`, rule: "pModel", K: 0, gate, band, field: "any", fav });
      }
    }
  }
  return out.map((c, i) => ({ ...c, id: `c${i}` }));
}

/**
 * 이 설정이 모델 정보를 쓰는가.
 *
 * 순열 귀무는 modelWin 만 섞으므로 **모델을 안 쓰는 설정은 순열에 불변**이다.
 * 그런 설정을 귀무 최댓값에 섞으면 관측 최적과 귀무 최적이 같은 값이 되어
 * p=1.000 이 나온다 — 검정이 무의미해진다. 그래서 귀무는 모델 의존 설정만 돈다.
 * 순수 시장 설정은 "발견"이 아니라 기준선이므로 따로 보고한다.
 */
function usesModel(cfg) {
  // 순위 규칙으로 판정한다. 게이트·밴드로 판정하면 실제로는 걸리지도 않는
  // 조건(p≥0.04 같은) 때문에 시장 전략이 "모델 의존"으로 분류되어 버린다.
  return cfg.rule !== "pMarket";
}

function passes(cfg, cols, i, raceIdx) {
  const p = cols.pModel[i];
  if (p < cfg.band[0] || p > cfg.band[1]) return false;
  if (cols.favMax[i] > cfg.fav) return false;
  if (cfg.gate.kind === "value" && cols.value[i] < cfg.gate.t) return false;
  const n = cols.raceN[raceIdx];
  if (cfg.field === "small" && n > 10) return false;
  if (cfg.field === "large" && n < 11) return false;
  return true;
}

/**
 * 플랫 스테이크. 조합 하나가 1단위다.
 * @returns 베팅 수·ROI·표준편차와, 부트스트랩을 위한 경주별 베팅 인덱스
 */
function evaluate(cfg, cols) {
  const betIdx = [];
  const betRace = [];
  const nRaces = cols.raceStart.length;

  for (let r = 0; r < nRaces; r += 1) {
    const s = cols.raceStart[r];
    const e = cols.raceEnd[r];
    if (cfg.K === 0) {
      for (let i = s; i < e; i += 1) {
        if (passes(cfg, cols, i, r)) {
          betIdx.push(i);
          betRace.push(r);
        }
      }
    } else {
      // 상위 K 개만. K ≤ 3 이라 정렬 없이 선형 스캔으로 고른다.
      const top = [];
      for (let i = s; i < e; i += 1) {
        if (!passes(cfg, cols, i, r)) continue;
        const key =
          cfg.rule === "pModel"
            ? cols.pModel[i]
            : cfg.rule === "pMarket"
              ? cols.pMarket[i]
              : cols.value[i];
        if (top.length < cfg.K) {
          top.push({ i, key });
          top.sort((a, b) => a.key - b.key);
        } else if (key > top[0].key) {
          top[0] = { i, key };
          top.sort((a, b) => a.key - b.key);
        }
      }
      for (const t of top) {
        betIdx.push(t.i);
        betRace.push(r);
      }
    }
  }

  const bets = betIdx.length;
  if (bets === 0) return { bets: 0, roi: 0, returnSd: 0, hitRate: 0, betIdx, betRace };

  let returned = 0;
  let hits = 0;
  for (const i of betIdx) {
    returned += cols.payout[i];
    if (cols.payout[i] > 0) hits += 1;
  }
  const roi = returned / bets;
  let ss = 0;
  for (const i of betIdx) {
    const d = cols.payout[i] - roi;
    ss += d * d;
  }
  const returnSd = bets > 1 ? Math.sqrt(ss / (bets - 1)) : 0;

  return { bets, roi, returnSd, hitRate: hits / bets, betIdx, betRace };
}

/** 목표를 환급률과 구분하는 데 필요한 베팅 수 (80% 검정력). */
function requiredN(sd, target = TARGET_ROI, nullRoi = 0.7387) {
  const d = target - nullRoi;
  if (d <= 0 || sd <= 0) return Infinity;
  return Math.ceil(Math.pow(((1.96 + 0.8416) * sd) / d, 2));
}

/** ROI 를 ±0.10 으로 좁히는 데 필요한 베팅 수. */
function betsForPrecision(sd, halfWidth = 0.1) {
  return sd <= 0 ? 0 : Math.ceil(Math.pow((sd * 1.96) / halfWidth, 2));
}

/** 최고배당 한 건을 뺀 ROI. 빼서 부호가 뒤집히면 그건 전략이 아니라 한 경주다. */
function roiExcludingBest(cols, betIdx) {
  if (betIdx.length < 2) return 0;
  let best = 0;
  let sum = 0;
  for (const i of betIdx) {
    sum += cols.payout[i];
    if (cols.payout[i] > best) best = cols.payout[i];
  }
  return (sum - best) / (betIdx.length - 1);
}

/** 베팅이 며칠에 걸쳐 분산되어 있는가. 하루에 몰리면 그날 운이다. */
function dayCoverage(cols, betRace, splitDays) {
  const days = new Set(betRace.map((r) => cols.raceDate[r]));
  return splitDays.length > 0 ? days.size / splitDays.length : 0;
}

/** 하드 실격. 실격은 "더 나쁨"이 아니라 평가 대상 아님이라 다중검정 비용도 없다. */
function admissible(res, cols, splitDays) {
  if (res.bets < MIN_BETS) return "베팅수부족";
  if (requiredN(res.returnSd) > res.bets) return "검정력부족";
  if (dayCoverage(cols, res.betRace, splitDays) < 0.6) return "날짜편중";
  if (roiExcludingBest(cols, res.betIdx) < cols.payback) return "최고배당의존";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 통계
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 경주 단위 클러스터 부트스트랩.
 * 한 경주 안의 조합들은 완전 음상관(하나만 맞는다)이라 베팅 단위로 재표본하면
 * 신뢰구간이 좁게 나온다.
 */
function bootstrapRoi(cols, betIdx, betRace, { B = BOOTSTRAP_B, seed = 12345 } = {}) {
  const byRace = new Map();
  for (let k = 0; k < betIdx.length; k += 1) {
    const r = betRace[k];
    if (!byRace.has(r)) byRace.set(r, []);
    byRace.get(r).push(cols.payout[betIdx[k]]);
  }
  const clusters = [...byRace.values()];
  if (clusters.length < 2) return { lo: 0, hi: 0 };

  const rnd = mulberry32(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b += 1) {
    let sum = 0;
    let n = 0;
    for (let c = 0; c < clusters.length; c += 1) {
      const pick = clusters[(rnd() * clusters.length) | 0];
      for (const v of pick) {
        sum += v;
        n += 1;
      }
    }
    out[b] = n > 0 ? sum / n : 0;
  }
  out.sort();
  return { lo: out[Math.floor(B * 0.025)], hi: out[Math.floor(B * 0.975)] };
}

/**
 * best-of-N 순열 귀무.
 *
 * 경주 안에서 modelWin 만 섞는다 — 시장·결과·배당은 그대로 둔다. 그러면 모델은
 * 아무 정보가 없고 나머지 구조는 실제 그대로다. 그 상태로 격자 전체를 다시 돌려
 * **최댓값**을 기록한다. 관측된 최적 ROI 가 이 분포 안에 들어가면, 그건 전략이
 * 아니라 1,200번 뽑기의 최댓값이다.
 */
function permutationBestOfN(races, grid, fit, payback, splitDays, { B = NULL_REPLICATES, seed = 999 } = {}) {
  const rnd = mulberry32(seed);
  const maxima = new Float64Array(B);
  const shuffled = races.map((r) => ({ ...r, modelWin: r.modelWin.slice() }));

  // 시장·배당·결과는 순열의 영향을 받지 않으므로 열을 한 번만 만들고,
  // 매 반복에서는 pModel 과 그 파생만 갈아 끼운다.
  const cols = buildColumns(shuffled, fit, payback);

  for (let b = 0; b < B; b += 1) {
    for (const r of shuffled) {
      const w = r.modelWin;
      for (let i = w.length - 1; i > 0; i -= 1) {
        const j = (rnd() * (i + 1)) | 0;
        const t = w[i];
        w[i] = w[j];
        w[j] = t;
      }
    }
    recomputeModelColumn(cols, shuffled, fit);
    let best = -Infinity;
    for (const cfg of grid) {
      if (!usesModel(cfg)) continue; // 순열에 불변이라 귀무 최댓값을 오염시킨다
      const res = evaluate(cfg, cols);
      if (admissible(res, cols, splitDays)) continue;
      if (res.roi > best) best = res.roi;
    }
    maxima[b] = Number.isFinite(best) ? best : 0;
    if ((b + 1) % 50 === 0) process.stderr.write(`    귀무 ${b + 1}/${B}\r`);
  }
  process.stderr.write("                              \r");

  const sorted = Float64Array.from(maxima).sort();
  return {
    maxima: sorted,
    mean: maxima.reduce((a, b) => a + b, 0) / B,
    q95: sorted[Math.floor(B * 0.95)],
    max: sorted[B - 1],
  };
}

function monthlyRoi(cols, betIdx, betRace) {
  const by = new Map();
  for (let k = 0; k < betIdx.length; k += 1) {
    const m = cols.raceMonth[betRace[k]];
    if (!by.has(m)) by.set(m, { n: 0, ret: 0 });
    const e = by.get(m);
    e.n += 1;
    e.ret += cols.payout[betIdx[k]];
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, e]) => ({ month: m, bets: e.n, roi: e.ret / e.n }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 기준선
// ─────────────────────────────────────────────────────────────────────────────

function baselineFavourite(cols) {
  const betIdx = [];
  const betRace = [];
  for (let r = 0; r < cols.raceStart.length; r += 1) {
    for (let i = cols.raceStart[r]; i < cols.raceEnd[r]; i += 1) {
      if (cols.favMax[i] === 2 && cols.favMin[i] === 1) {
        betIdx.push(i);
        betRace.push(r);
      }
    }
  }
  return summarize(cols, betIdx, betRace);
}

function baselineAllPairs(cols) {
  const betIdx = [];
  const betRace = [];
  for (let r = 0; r < cols.raceStart.length; r += 1) {
    for (let i = cols.raceStart[r]; i < cols.raceEnd[r]; i += 1) {
      betIdx.push(i);
      betRace.push(r);
    }
  }
  return summarize(cols, betIdx, betRace);
}

/** 프로덕션이 지금 거는 것: λ=1 Harville 1순위 조합. */
function baselineProduction(races, payback) {
  const cols = buildColumns(races, { model: { lambda: 1, tau: 1 }, market: { lambda: 1, tau: 1 } }, payback);
  const res = evaluate({ sel: "top1-by-pModel", rule: "pModel", K: 1, gate: { kind: "none" }, band: [0, 1], field: "any", fav: 99 }, cols);
  return { ...summarize(cols, res.betIdx, res.betRace), cols };
}

function summarize(cols, betIdx, betRace) {
  const bets = betIdx.length;
  if (bets === 0) return { bets: 0, roi: 0, returnSd: 0, hitRate: 0, betIdx, betRace };
  let ret = 0;
  let hits = 0;
  for (const i of betIdx) {
    ret += cols.payout[i];
    if (cols.payout[i] > 0) hits += 1;
  }
  const roi = ret / bets;
  let ss = 0;
  for (const i of betIdx) ss += (cols.payout[i] - roi) ** 2;
  return { bets, roi, returnSd: bets > 1 ? Math.sqrt(ss / (bets - 1)) : 0, hitRate: hits / bets, betIdx, betRace };
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

// ─────────────────────────────────────────────────────────────────────────────
// 서브커맨드
// ─────────────────────────────────────────────────────────────────────────────

async function cmdCoverage() {
  const lib = await loadLib(ENTRIES, { prefix: "holpick-roi-" });
  const rows = loadRows();
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].sort();
  const dividends = loadDividendsByDate(lib, dates);
  const missing = dates.filter((d) => !dividends.has(d));

  const byRace = new Map();
  for (const r of rows) {
    const k = `${r.rcDate}-${num(r.rcNo)}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k).push(r);
  }

  let settleable = 0;
  for (const race of byRace.values()) {
    const day = dividends.get(str(race[0].rcDate));
    if (!day) continue;
    const rcNo = num(race[0].rcNo);
    if ([...day.values()].some((d) => d.rcNo === rcNo)) settleable += 1;
  }

  console.log(`경주일 ${dates.length}일 (${dates[0]} ~ ${dates[dates.length - 1]})`);
  console.log(`완주 경주 ${byRace.size} · 배당 보유일 ${dividends.size} · 정산 가능 ${settleable}경주`);
  if (missing.length > 0) {
    console.log(`\n배당 없는 날 ${missing.length}일:`);
    console.log(`  ${missing.join(" ")}`);
    console.log(`\n  node --env-file=.env.local scripts/backfill.mjs --dividends-only`);
  }
  if (settleable < 400) {
    console.log(`\n❌ 정산 가능 ${settleable} < 400 — 탐색을 실행하지 않는다.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ 정산 가능 ${settleable} ≥ 400 — 탐색 가능.`);
  }
}

async function cmdBuild() {
  const lib = await loadLib(ENTRIES, { prefix: "holpick-roi-" });
  const worst = assertHarvilleAgreement(lib);
  console.log(`감쇠 Harville λ=1 검증: 최대 오차 ${worst.toExponential(2)} ✓`);

  console.log(`워크포워드 실행 중…`);
  const recs = await buildRecords(lib);
  writeFileSync(RECORDS, JSON.stringify(recs));

  const settled = recs.races.filter((r) => r.settled).length;
  const payback = measurePayback(lib, recs.races);
  console.log(`경주 ${recs.races.length} · 정산 가능 ${settled} · 환급률 ${f4(payback)}`);
  // 밴드가 넓은 이유는 backfill.mjs 의 같은 검사에 적어 두었다 — 이 추정량은
  // 974경주로도 CI 가 [0.61, 0.79] 라, 좁은 밴드는 노이즈에 매번 걸린다.
  if (payback < 0.55 || payback > 0.85) {
    console.log(`⚠ 환급률이 밴드(0.55~0.85) 밖이다. 분모 정의나 동착 처리를 확인할 것.`);
  }
  console.log(`→ ${RECORDS}`);
}

function loadRecords({ dropHoldout }) {
  if (!existsSync(RECORDS)) {
    throw new Error(`레코드가 없다. 먼저 \`node scripts/roi-search.mjs build\` 를 실행할 것.`);
  }
  const recs = JSON.parse(readFileSync(RECORDS, "utf8"));
  const now = sourceMtimes(ENTRIES);
  const stale = Object.keys(now).filter((k) => now[k] !== recs.sources[k]);
  if (stale.length > 0) {
    throw new Error(
      `레코드가 낡았다 (수정된 소스: ${stale.join(", ")}). build 를 다시 실행할 것.`,
    );
  }
  const splits = splitDates(recs.races);
  if (dropHoldout) {
    // 홀드아웃은 여기서 물리적으로 제거한다. 전략 코드가 실행되기 전이라
    // 어떤 게이트도 실수로 훔쳐볼 수 없다.
    const drop = new Set(splits.holdout);
    recs.races = recs.races.filter((r) => !drop.has(r.date));
  }
  return { recs, splits };
}

function printHeader(payback, splits, recs, pbCi) {
  console.log(`\n=== 측정 전제 ===`);
  console.log(
    `복승 풀 환급률 P̂            ${f4(payback)}  CI [${f2(pbCi.lo)}, ${f2(pbCi.hi)}]  (출주두수 기준)`,
  );
  console.log(`  ↑ 공제율은 고정인데도 구간이 이만큼 넓다. 거대 배당이 추정을 흔든다.`);
  console.log(`목표 ${TARGET_ROI} 달성에 필요한 상대우위   +${(((TARGET_ROI - payback) / payback) * 100).toFixed(0)}%`);
  console.log(`ROI 를 ±0.10 으로 좁히는 데 필요한 베팅 수   ${betsForPrecision(2.1)}  ← 이 데이터셋으로는 불가능`);
  console.log(`${TARGET_ROI} 를 ${f4(payback)} 과 구분(80% 검정력)   ${requiredN(2.1, TARGET_ROI, payback)}  ← 가능`);
  console.log(`한 달(약 100베팅) CI 반폭       ±${((1.96 * 2.1) / Math.sqrt(100)).toFixed(2)}  ← 월 단위 목표는 월 단위로 검증 불가`);

  console.log(`\n=== 데이터 ===`);
  const settled = recs.races.filter((r) => r.settled).length;
  console.log(`경주 ${recs.races.length} · 정산 가능 ${settled}`);
  const rng = (a) => (a.length ? `${a[0]}~${a[a.length - 1]} (${a.length}일)` : "없음");
  console.log(`준비   ${rng(splits.burnIn)}`);
  console.log(`학습   ${rng(splits.train)}`);
  console.log(`검증   ${rng(splits.validate)}`);
  console.log(`홀드아웃 ${rng(splits.holdout)}  ← 미개봉`);
}

async function cmdSearch() {
  const lib = await loadLib(ENTRIES, { prefix: "holpick-roi-" });
  assertHarvilleAgreement(lib);
  const { recs, splits } = loadRecords({ dropHoldout: true });

  const trainSet = new Set(splits.train);
  const validSet = new Set(splits.validate);
  const trainRaces = recs.races.filter((r) => r.settled && trainSet.has(r.date));
  const validRaces = recs.races.filter((r) => r.settled && validSet.has(r.date));

  const trainOnly = recs.races.filter((r) => trainSet.has(r.date));
  const payback = measurePayback(lib, trainOnly);
  printHeader(payback, splits, recs, paybackCi(trainOnly));

  // ── 1단계: λ·τ 적합 ────────────────────────────────────────────────────
  // 배당이 필요 없으므로 학습 구간의 **모든** 경주를 쓴다 (정산 가능 여부 무관).
  const fitPool = recs.races.filter((r) => trainSet.has(r.date) || splits.burnIn.includes(r.date));
  const fitModel = fitPairModel(fitPool, "modelWin");
  const fitMarket = fitPairModel(fitPool, "marketWin");
  const fit = { model: fitModel, market: fitMarket };

  console.log(`\n=== 1단계 적합 (탐색 아님) ===`);
  console.log(
    `λ̂_model   ${f2(fitModel.lambda)}  τ̂ ${f2(fitModel.tau)}  LL ${f4(fitModel.logLik)} (λ=1: ${f4(fitModel.logLikAt1)})  n=${fitModel.n}`,
  );
  console.log(
    `λ̂_market  ${f2(fitMarket.lambda)}  τ̂ ${f2(fitMarket.tau)}  LL ${f4(fitMarket.logLik)} (λ=1: ${f4(fitMarket.logLikAt1)})  n=${fitMarket.n}`,
  );
  console.log(
    fitMarket.lambda < 0.95
      ? `→ λ̂_market < 1: Harville 인기마 편향이 실재한다. quinella.ts 에 반영할 값이다.`
      : `→ λ̂_market ≈ 1: 인기마 편향 보정이 유의하지 않다.`,
  );

  // ── 확률 수준 결합: 기본 요인이 시장 위에 무엇을 더하는가 ──────────────
  const blend = fitBlend(fitPool);
  console.log(`\n=== 기본요인 × 시장 결합 (p ∝ p_fund^α · p_market^β) ===`);
  console.log(
    `α̂ ${f2(blend.alpha)}  β̂ ${f2(blend.beta)}  LL ${f4(blend.ll)}  (시장만 α=0: ${f4(blend.llMarketOnly)})  n=${blend.n}`,
  );
  console.log(`우도비 검정 (자유도 1): LR = ${blend.lr.toFixed(2)}  ${blend.lr > 3.84 ? "→ p < 0.05" : "→ 유의하지 않음"}`);
  console.log(
    blend.alpha > 0 && blend.lr > 3.84
      ? `→ 기본 요인이 시장에 없는 정보를 갖고 있다. 우위의 상한이 여기서 나온다.`
      : `→ **기본 요인이 시장 위에 더하는 정보가 없다.** 시장을 이길 재료 자체가 없다는 뜻이다.`,
  );

  // ── 기준선 ──────────────────────────────────────────────────────────────
  const evalRaces = [...trainRaces, ...validRaces];
  const evalDays = [...splits.train, ...splits.validate];
  const cols = buildColumns(evalRaces, fit, payback);

  const all = baselineAllPairs(cols);
  const fav = baselineFavourite(cols);
  const prod = baselineProduction(evalRaces, payback);

  console.log(`\n=== 기준선 (학습+검증 동일 경주 집합) ===`);
  const line = (name, s, c = cols) => {
    const ci = bootstrapRoi(c, s.betIdx, s.betRace, { B: 2000 });
    console.log(
      `${name.padEnd(16)} ROI ${f4(s.roi)}  n=${String(s.bets).padStart(5)}  적중 ${pct(s.hitRate)}  sd ${f2(s.returnSd)}  CI [${f2(ci.lo)}, ${f2(ci.hi)}]`,
    );
  };
  line("전 조합 매수", all);
  line("인기 2두", fav);
  line("프로덕션 1순위", prod, prod.cols);

  // ── 2단계: 격자 탐색 ────────────────────────────────────────────────────
  const grid = buildGrid();
  console.log(`\n=== 탐색 ===`);
  console.log(`선언한 설정 수 N = ${grid.length}`);

  const results = [];
  const rejected = { 베팅수부족: 0, 검정력부족: 0, 날짜편중: 0, 최고배당의존: 0 };
  for (const cfg of grid) {
    const res = evaluate(cfg, cols);
    const why = admissible(res, cols, evalDays);
    if (why) {
      rejected[why] += 1;
      continue;
    }
    results.push({ cfg, res });
  }
  results.sort((a, b) => b.res.roi - a.res.roi);

  console.log(
    `자격 미달 제외: ` +
      Object.entries(rejected)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ") +
      `  → 평가 대상 ${results.length}개`,
  );

  if (results.length === 0) {
    console.log(`\n❌ 자격을 갖춘 설정이 하나도 없다. 표본이 부족하거나 게이트가 과하다.`);
    return;
  }

  console.log(`\n상위 10개:`);
  console.log(
    `  ${"설정".padEnd(30)} ${"베팅".padStart(5)} ${"ROI".padStart(7)} ${"sd".padStart(5)} ${"부트CI".padStart(16)} ${"최고제외".padStart(8)}`,
  );
  for (const { cfg, res } of results.slice(0, 10)) {
    const ci = bootstrapRoi(cols, res.betIdx, res.betRace, { B: 2000 });
    const label = `${cfg.sel} ${cfg.gate.kind}${cfg.gate.t ?? ""} p${cfg.band[0]}-${cfg.band[1]} f${cfg.fav} ${cfg.field}`;
    console.log(
      `  ${label.padEnd(30)} ${String(res.bets).padStart(5)} ${f4(res.roi).padStart(7)} ${f2(res.returnSd).padStart(5)} ${`[${f2(ci.lo)}, ${f2(ci.hi)}]`.padStart(16)} ${f4(roiExcludingBest(cols, res.betIdx)).padStart(8)}`,
    );
  }

  // ── 다중검정 ────────────────────────────────────────────────────────────
  console.log(`\n=== 다중검정 (순열 귀무, ${NULL_REPLICATES}회) ===`);
  console.log(`  모델 순서만 섞는다. 시장·결과·배당은 그대로.`);
  const nul = permutationBestOfN(evalRaces, grid, fit, payback, evalDays);

  // 귀무가 모델 의존 설정만 돌았으므로, 비교 대상도 모델 의존 설정의 최적이어야 한다.
  const modelResults = results.filter((r) => usesModel(r.cfg));
  const marketResults = results.filter((r) => !usesModel(r.cfg));
  const observed = modelResults.length > 0 ? modelResults[0].res.roi : 0;
  let ge = 0;
  for (const v of nul.maxima) if (v >= observed) ge += 1;
  const p = (1 + ge) / (NULL_REPLICATES + 1);

  console.log(`  귀무 최적 ROI 분포: 평균 ${f4(nul.mean)} · 95%분위 ${f4(nul.q95)} · 최대 ${f4(nul.max)}`);
  console.log(`  모델 순위 설정 ${modelResults.length}개 중 최적 ROI ${f4(observed)}  →  p = ${p.toFixed(3)}`);
  if (marketResults.length > 0) {
    console.log(
      `  시장 순위 설정 ${marketResults.length}개 중 최적 ROI ${f4(marketResults[0].res.roi)} — 순열에 불변이라 이 검정 밖이다.`,
    );
    if (marketResults[0].res.roi >= observed) {
      console.log(
        `  ⚠ 전체 최적이 시장 순위 설정이다. 즉 **모델 정보 없이도 같은 성적이 나온다** —`,
      );
      console.log(`     모델이 시장 위에 무엇을 더했다는 증거가 이 구간에는 없다.`);
    }
  }

  const wins = observed > nul.q95;
  console.log(
    wins
      ? `  → 귀무 95%분위를 넘었다. 홀드아웃을 열어 볼 가치가 있다.`
      : `  → 노이즈와 구분되지 않는다. 이 ROI 는 ${grid.length}번 뽑기의 최댓값일 뿐이다.`,
  );

  appendFileSync(
    TRIALS,
    JSON.stringify({ at: new Date().toISOString(), n: grid.length, observed, q95: nul.q95, p }) + "\n",
  );

  // 격자를 바꿔 가며 여러 번 돌리면 실제 시행 횟수는 그 합이다. 한 번 돌린 N 만
  // 보고하면 다중검정을 과소보고하는 셈이라, 누적치를 함께 찍는다.
  const hist = readFileSync(TRIALS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`  누적 시행 (${hist.length}회 실행): N_cum = ${hist.reduce((a, e) => a + e.n, 0)}`);

  // ── 최종 판정 ───────────────────────────────────────────────────────────
  console.log(`\n=== 검증 구간 판정 ===`);
  const over = results.filter((r) => r.res.roi >= TARGET_ROI);
  console.log(`  ROI ≥ ${TARGET_ROI} 인 설정: ${over.length}개`);
  console.log(`  그중 귀무 95%분위(${f4(nul.q95)})도 넘은 설정: ${over.filter((r) => r.res.roi > nul.q95).length}개`);

  if (wins) {
    const winner = modelResults[0];
    const payload = {
      cfg: winner.cfg,
      fit,
      payback,
      gridHash: createHash("sha256").update(JSON.stringify(grid)).digest("hex"),
      gridN: grid.length,
      frozenAt: new Date().toISOString(),
    };
    writeFileSync(FROZEN, JSON.stringify(payload, null, 2));
    console.log(`\n  동결 → ${FROZEN}`);
    console.log(`  node scripts/roi-search.mjs holdout --config ${FROZEN}`);
  } else {
    console.log(`\n  홀드아웃을 열지 않는다. 열어 볼 후보가 없다.`);
  }

  console.log(`\n  월별 ROI (최적 설정 ${results[0].cfg.sel}) — 목표가 "월 +20%" 이므로 월별로 편다:`);
  for (const m of monthlyRoi(cols, results[0].res.betIdx, results[0].res.betRace)) {
    console.log(`    ${m.month}  ${String(m.bets).padStart(4)}베팅  ROI ${f4(m.roi)}`);
  }
}

async function cmdHoldout() {
  const cfgPath = arg("config", FROZEN);
  if (!existsSync(cfgPath)) {
    console.error(`동결 설정이 없다: ${cfgPath}\nsearch 가 후보를 찾아야 생성된다.`);
    process.exit(1);
  }
  const frozen = JSON.parse(readFileSync(cfgPath, "utf8"));

  if (existsSync(HOLDOUT_LOG)) {
    const prior = readFileSync(HOLDOUT_LOG, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const other = prior.filter((e) => e.gridHash !== frozen.gridHash);
    if (other.length > 0) {
      console.log(`⚠ 홀드아웃은 이미 ${other.length}번 다른 설정으로 열렸다:`);
      for (const e of other) console.log(`   ${e.at}  ROI ${f4(e.roi)}  hash ${e.gridHash.slice(0, 12)}`);
      console.log(`  이 구간은 더 이상 미개봉이 아니다. 아래 결과는 그만큼 할인해서 읽을 것.\n`);
    }
  }

  // 홀드아웃은 한 번뿐이라 조합 확률 공식이 프로덕션과 같은지 여기서도 확인한다.
  assertHarvilleAgreement(await loadLib(ENTRIES, { prefix: "holpick-roi-" }));
  const { recs, splits } = loadRecords({ dropHoldout: false });
  const hold = new Set(splits.holdout);
  const races = recs.races.filter((r) => r.settled && hold.has(r.date));

  const cols = buildColumns(races, frozen.fit, frozen.payback);
  const res = evaluate(frozen.cfg, cols);
  const ci = bootstrapRoi(cols, res.betIdx, res.betRace);

  console.log(`\n=== 홀드아웃 (${splits.holdout[0]} ~ ${splits.holdout[splits.holdout.length - 1]}, ${splits.holdout.length}일) ===`);
  console.log(`설정  ${frozen.cfg.sel} ${frozen.cfg.gate.kind}${frozen.cfg.gate.t ?? ""} p${frozen.cfg.band[0]}-${frozen.cfg.band[1]} f${frozen.cfg.fav}`);
  console.log(`베팅 ${res.bets} · 적중 ${pct(res.hitRate)} · sd ${f2(res.returnSd)}`);
  console.log(`ROI ${f4(res.roi)}  부트스트랩 CI [${f2(ci.lo)}, ${f2(ci.hi)}]`);
  console.log(`최고배당 제외 ROI ${f4(roiExcludingBest(cols, res.betIdx))}`);

  // 신뢰구간이 통째로 본전 아래면 "판단 불가"가 아니라 명백히 진 것이다.
  // 이 구분을 빼 두면 확실한 손실을 "모르겠다"로 적어 두게 된다.
  const verdict =
    ci.lo > TARGET_ROI
      ? `이김 (≥${TARGET_ROI})`
      : ci.lo > 1.0
        ? "이김 (>본전)"
        : ci.hi < 1.0
          ? "짐 (본전 미만 확정)"
          : "판단 불가";
  console.log(`\n판정: ${verdict}`);
  if (verdict === "판단 불가") {
    console.log(`  신뢰구간이 본전을 걸친다. 표본으로는 이기는지 지는지 알 수 없다.`);
  } else if (verdict.startsWith("짐")) {
    console.log(`  신뢰구간 상한(${f2(ci.hi)})이 본전에 못 미친다. 이 전략은 잃는다.`);
    if (res.roi < frozen.payback) {
      console.log(
        `  환급률 ${f4(frozen.payback)} 보다도 낮다 — 전 조합을 무작위로 사는 것만도 못하다.`,
      );
    }
  }

  console.log(`\n월별:`);
  for (const m of monthlyRoi(cols, res.betIdx, res.betRace)) {
    console.log(`  ${m.month}  ${String(m.bets).padStart(4)}베팅  ROI ${f4(m.roi)}`);
  }

  appendFileSync(
    HOLDOUT_LOG,
    JSON.stringify({
      at: new Date().toISOString(),
      gridHash: frozen.gridHash,
      gridN: frozen.gridN,
      roi: res.roi,
      bets: res.bets,
      ci,
      verdict,
    }) + "\n",
  );
}

const CMDS = { coverage: cmdCoverage, build: cmdBuild, search: cmdSearch, holdout: cmdHoldout };

const cmd = process.argv[2];
if (!CMDS[cmd]) {
  console.error(`사용법: node scripts/roi-search.mjs <${Object.keys(CMDS).join("|")}>`);
  process.exit(1);
}
CMDS[cmd]().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
