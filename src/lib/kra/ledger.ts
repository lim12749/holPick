import type { QuinellaDividend } from "./dividend";
import { num, str } from "./horse";
import {
  actualPair,
  buildRacePick,
  candidateFromRow,
  isPickHit,
  EMPTY_TRAITS,
  type HorseTraits,
} from "./pick";
import { pairKey } from "./quinella";
import { buildStatsBundle, groupRows } from "./stats";
import { buildSectionalHistory } from "./sectional";
import { buildStyleHistory } from "./style";
import type { KraRow } from "./types";

/**
 * 지난 픽 원장 — 우리가 그날 공개했을 픽의 성적표.
 *
 * `backtest.ts` 와 목적이 다르다. 백테스트는 6개월을 한 번 잘라 "모델이 기준선보다
 * 나은가"를 묻는다. 이쪽은 **경주 하나하나에 대해 그날 화면에 떴을 픽을 그대로
 * 재현하고, 그걸 실제로 샀다면 돈이 어떻게 됐는지**를 기록한다.
 *
 * 두 가지를 지킨다.
 *
 * 1. **워크포워드.** 경주일 D 의 픽은 `rcDate < D` 기록만으로 만든 통계로 낸다.
 *    경주일마다 통계를 다시 만드는 이유가 이것이다. 한 번 만들어 돌려쓰면 미래를
 *    보고 과거를 맞히는 셈이라 성적표가 실제보다 좋아진다.
 * 2. **분모를 숨기지 않는다.** 픽을 못 낸 경주는 `skipped` 로 세어 드러내고,
 *    확정배당을 못 구한 경주는 투자·회수 양쪽에서 통째로 뺀다. 적중을 손실로
 *    세거나(분모만 늘리거나) 손실을 조용히 빼면 숫자가 거짓말을 한다.
 */

/** 1경주 1조합에 거는 금액. 손익을 원화로 보여주기 위한 기준 단위다. */
export const BET_UNIT = 10_000;

/**
 * 앞쪽 몇 할을 통계 축적에만 쓸지. 초기 경주일은 이전 기록이 거의 없어 픽이
 * 사실상 무작위라, 원장에 넣으면 성적을 부당하게 깎는다.
 */
export const DEFAULT_WARMUP_FRACTION = 0.6;

/** 출전이 너무 적은 경주는 조합 자체가 무의미하다. 백테스트와 같은 기준. */
const MIN_RUNNERS = 4;

/** 보정 표에 실을 조합 순위 개수. */
const CALIBRATION_RANKS = 3;

/**
 * 조합 순위별 예측 확률 vs 실제 적중률.
 *
 * 모델이 말하는 확률과 실제로 맞은 비율이 얼마나 다른지 그대로 드러낸다.
 * 화면에 뜨는 "적중 확률"과 "본전 배당"을 어느 정도 할인해서 봐야 하는지가
 * 이 표에서 나온다.
 */
export interface RankCalibration {
  rank: number;
  races: number;
  /** 모델이 말한 확률의 평균. */
  predicted: number;
  /** 실제로 맞은 비율. */
  actual: number;
  /** 실측 기준 본전 배당 = 1 / actual. 실제 배당이 이보다 높아야 이득이다. */
  breakEvenOdds: number | null;
}

export interface PickRecord {
  rcDate: string;
  rcNo: number;
  rcName: string;
  /** 우리가 낸 1순위 복승 조합. */
  pick: {
    a: number;
    b: number;
    aName: string;
    bName: string;
    prob: number;
    fairOdds: number;
  };
  /** 실제 1·2착 마번. */
  actual: [number, number];
  hit: boolean;
  /**
   * 실제 1·2착 조합의 확정 복승배당. 적중했다면 이게 곧 우리 배당이다.
   * 배당 데이터를 못 구하면 null 이고, 그 경주는 베팅에서 제외된다.
   */
  payoutOdds: number | null;
  /** 손익(원). 배당을 확인한 경주에만 값이 있다. */
  profit: number | null;
  /** 이 경주까지의 누적 손익(원). 제외된 경주는 직전 값을 유지한다. */
  cum: number;
}

export interface PickLedger {
  /** 경주일·경주번호 오름차순. 화면에서 뒤집어 쓴다. */
  records: PickRecord[];
  fromDate: string;
  toDate: string;
  warmupDays: number;
  ledgerDays: number;
  /** 픽을 낸 경주 수 = 적중률의 분모. */
  races: number;
  /** 출전 부족·통계 없음·착순 결측으로 픽을 못 낸 경주 수. */
  skipped: number;
  hits: number;
  hitRate: number;
  /** 적중률의 표준오차. 표본이 작아 이 값 없이는 우연과 구분되지 않는다. */
  hitRateSe: number;
  /** 확정배당을 구해 손익이 확정된 베팅 수 = 회수율의 분모. */
  settledBets: number;
  stake: number;
  returned: number;
  profit: number;
  /** 회수율. 1.00 이 본전. 확정된 베팅이 없으면 null. */
  roi: number | null;
  /**
   * 1베팅당 회수 배수의 표준편차. 모든 불확실성 계산의 출발점이다.
   *
   * 복승 배당은 꼬리가 길어서 이 값이 크다. 크면 같은 베팅 수로도 회수율이
   * 훨씬 덜 정해진다.
   */
  returnSd: number;
  /** 회수율의 95% 신뢰구간. */
  roiCi: { lo: number; hi: number } | null;
  /**
   * 판정. 구간이 1.00 을 걸치면 **판단 불가**다.
   *
   * 표본이 작을 때 점추정만 보여주면 노이즈를 실력으로 읽게 된다. 이 화면이
   * 실제로 답해야 하는 질문은 "얼마 벌었나"가 아니라 "번 게 맞나"다.
   */
  verdict: "이김" | "짐" | "판단 불가";
  /**
   * 지금 표준편차에서 회수율을 ±0.10 안으로 좁히는 데 필요한 총 베팅 수.
   *
   * 목표를 월 단위로 잡으면 안 되는 이유를 숫자로 보여주기 위한 값이다.
   */
  betsNeeded: number;
  /**
   * 가장 큰 배당 한 건을 뺐을 때의 손익·회수율.
   *
   * 복승 배당은 꼬리가 길어서 고배당 한 번이 전체 수익의 부호를 바꿔 놓는다.
   * 그 한 건에 기대고 있는 성적을 "이 방식은 돈이 된다"로 읽으면 안 되므로
   * 함께 계산해 나란히 보여준다.
   */
  bestPayout: { rcDate: string; rcNo: number; odds: number } | null;
  profitExcludingBest: number | null;
  roiExcludingBest: number | null;
  /** 조합 순위별 예측 대 실측. 1~3순위. */
  calibration: RankCalibration[];
  /** 무작위로 한 조합을 골랐을 때의 기대 적중률. 비교 기준선. */
  randomHitRate: number;
}

/** 경주일 목록에서 워밍업·원장 경계 위치. */
function splitIndex(dateCount: number, warmupFraction: number): number {
  return Math.max(1, Math.floor(dateCount * warmupFraction));
}

/**
 * 원장 구간에 해당하는 경주일.
 *
 * 화면은 이 날짜의 확정배당만 받아오면 된다. 경계를 화면에 따로 적어 두면
 * 배당을 받아온 구간과 원장 구간이 어긋나 손익이 조용히 틀어진다.
 */
export function ledgerDates(
  rows: KraRow[],
  warmupFraction = DEFAULT_WARMUP_FRACTION,
): string[] {
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  if (dates.length < 4) return [];
  return dates.slice(splitIndex(dates.length, warmupFraction));
}

export interface PickLedgerInput {
  rows: KraRow[];
  /** 경주일 → (`${rcNo}:${작은마번-큰마번}` → 확정배당). */
  dividends: Map<string, Map<string, QuinellaDividend>>;
  warmupFraction?: number;
}

export function buildPickLedger({
  rows,
  dividends,
  warmupFraction = DEFAULT_WARMUP_FRACTION,
}: PickLedgerInput): PickLedger | null {
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  if (dates.length < 4) return null;

  const splitAt = splitIndex(dates.length, warmupFraction);
  const warmupDates = dates.slice(0, splitAt);
  const targetDates = dates.slice(splitAt);
  if (targetDates.length === 0) return null;

  /*
   * 각질 이력은 전체 구간으로 한 번만 만든다. buildStyleHistory 가 경주일 순으로
   * 순회하며 **그 경주 직전까지**의 스냅샷을 찍어 두므로, 뒤쪽 경주일의 스냅샷도
   * 자기 자신이나 이후 경주를 보지 않는다. 누수가 아니다.
   */
  const styleHistory = buildStyleHistory(rows);
  const sectionalHistory = buildSectionalHistory(rows);

  const byDate = new Map<string, KraRow[]>();
  for (const row of rows) {
    const date = str(row.rcDate);
    const list = byDate.get(date);
    if (list) list.push(row);
    else byDate.set(date, [row]);
  }

  const records: PickRecord[] = [];
  let skipped = 0;
  let hits = 0;
  let settledBets = 0;
  let returned = 0;
  let cum = 0;
  // 조합 순위별 누적 (보정 표용). 인덱스 0 = 1순위.
  const rankTally = Array.from({ length: CALIBRATION_RANKS }, () => ({
    n: 0,
    hits: 0,
    predSum: 0,
  }));
  let combinationSum = 0;

  // 워밍업 구간을 초기 통계로 깔고, 경주일을 하루씩 넘기며 그 날을 뒤에 더한다.
  const priorRows: KraRow[] = warmupDates.flatMap((d) => byDate.get(d) ?? []);

  for (const date of targetDates) {
    const dayRows = byDate.get(date) ?? [];
    // 이 날 픽을 낼 때 쓸 수 있었던 기록만으로 통계를 만든다.
    const stats = buildStatsBundle(priorRows, styleHistory, sectionalHistory);
    const dayDividends = dividends.get(date);

    const raceKeys = [...groupRows(dayRows).entries()].sort(
      (a, b) => num(a[1][0].rcNo) - num(b[1][0].rcNo),
    );

    for (const [key, race] of raceKeys) {
      /*
       * 마번 순으로 재정렬한 뒤 예측한다. 경주기록 응답은 착순 순으로 오는데,
       * 그대로 넣으면 동점일 때 안정 정렬이 착순을 유지해 정답이 새어 들어온다.
       * backtest.ts 에 같은 함정이 기록되어 있다.
       */
      const runners = [...race].sort((a, b) => num(a.chulNo) - num(b.chulNo));

      const actual = actualPair(
        runners.map((r) => ({ ord: num(r.ord), chulNo: num(r.chulNo) })),
      );
      if (runners.length < MIN_RUNNERS || !actual) {
        skipped += 1;
        continue;
      }

      const traits: HorseTraits = {
        style: styleHistory.byRace.get(key)?.styleByHorse ?? EMPTY_TRAITS.style,
        sectional: sectionalHistory.byRace.get(key) ?? EMPTY_TRAITS.sectional,
      };
      const candidates = runners.map((r) => candidateFromRow(r, traits));
      const { picks } = buildRacePick(
        candidates,
        stats,
        num(runners[0].rcDist),
        CALIBRATION_RANKS,
      );
      const pick = picks[0];
      if (!pick) {
        skipped += 1;
        continue;
      }

      const hit = isPickHit(pick, actual);
      if (hit) hits += 1;

      // 2·3순위는 베팅하지 않지만, 모델의 확률이 맞는지 재려면 함께 세야 한다.
      picks.forEach((p, i) => {
        const t = rankTally[i];
        if (!t) return;
        t.n += 1;
        t.predSum += p.prob;
        if (isPickHit(p, actual)) t.hits += 1;
      });
      // 무작위 기준선: 이 경주에서 조합 하나를 찍었을 때 맞을 확률 1/C(n,2).
      combinationSum += 2 / (runners.length * (runners.length - 1));

      const rcNo = num(runners[0].rcNo);
      /*
       * 배당은 **실제 1·2착 조합**으로 조회한다. 그 행이 있으면 이 경주는 정산이
       * 가능한 것이고(우리가 틀렸으면 회수 0), 없으면 데이터가 없는 것이라 베팅
       * 자체를 없던 일로 한다. 적중을 전액 손실로 세지 않기 위한 구분이다.
       */
      const payoutOdds = dayDividends?.get(`${rcNo}:${pairKey(actual[0], actual[1])}`)?.odds ?? null;

      let profit: number | null = null;
      if (payoutOdds != null) {
        settledBets += 1;
        const back = hit ? payoutOdds * BET_UNIT : 0;
        returned += back;
        profit = back - BET_UNIT;
        cum += profit;
      }

      records.push({
        rcDate: date,
        rcNo,
        rcName: str(runners[0].rcName),
        pick: {
          a: pick.a.chulNo,
          b: pick.b.chulNo,
          aName: pick.a.hrName,
          bName: pick.b.hrName,
          prob: pick.prob,
          fairOdds: pick.fairOdds,
        },
        actual,
        hit,
        payoutOdds,
        profit,
        cum,
      });
    }

    priorRows.push(...dayRows);
  }

  const races = records.length;
  if (races === 0) return null;

  const hitRate = hits / races;
  const stake = settledBets * BET_UNIT;

  /*
   * 회수율의 불확실성. 베팅 1건의 회수 배수(적중이면 배당, 아니면 0)가 표본이다.
   * 적중률만 보고 판단하면 안 된다 — 회수율은 배당 분포의 꼬리 때문에 적중률보다
   * 훨씬 더 흔들린다.
   */
  const returns = records.filter((r) => r.payoutOdds != null).map((r) => (r.hit ? r.payoutOdds! : 0));
  const meanReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnSd =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((acc, v) => acc + (v - meanReturn) ** 2, 0) / (returns.length - 1),
        )
      : 0;
  const roiSe = returns.length > 0 ? returnSd / Math.sqrt(returns.length) : 0;
  const roiCi =
    returns.length > 1 ? { lo: meanReturn - 1.96 * roiSe, hi: meanReturn + 1.96 * roiSe } : null;
  const verdict: PickLedger["verdict"] =
    roiCi == null || (roiCi.lo <= 1 && roiCi.hi >= 1) ? "판단 불가" : roiCi.lo > 1 ? "이김" : "짐";
  // ±0.10 을 가려내려면 1.96·sd/√n ≤ 0.10 이어야 한다.
  const betsNeeded = returnSd > 0 ? Math.ceil(((returnSd * 1.96) / 0.1) ** 2) : 0;

  /*
   * 최고 배당 한 건을 빼 본다. 고배당 하나가 전체 손익의 부호를 뒤집는 일이
   * 흔해서, 이걸 보여주지 않으면 운을 실력으로 읽게 된다.
   */
  const best = records
    .filter((r) => r.hit && r.payoutOdds != null)
    .reduce<PickRecord | null>((a, r) => (!a || r.payoutOdds! > a.payoutOdds! ? r : a), null);
  const restBets = settledBets - (best ? 1 : 0);
  const restReturned = returned - (best ? best.payoutOdds! * BET_UNIT : 0);
  const restStake = restBets * BET_UNIT;

  return {
    records,
    // 실제로 픽을 낸 경주가 있는 날짜로 잡는다. 창의 끝날에 유효한 경주가
    // 없으면(오늘처럼 결과가 한두 행만 들어온 날) 없는 기간을 보여주게 된다.
    fromDate: records[0].rcDate,
    toDate: records[records.length - 1].rcDate,
    warmupDays: warmupDates.length,
    ledgerDays: new Set(records.map((r) => r.rcDate)).size,
    races,
    skipped,
    hits,
    hitRate,
    // 이항 표준오차. 적중률이 기저와 다른지 눈대중할 최소한의 근거다.
    hitRateSe: Math.sqrt((hitRate * (1 - hitRate)) / races),
    settledBets,
    stake,
    returned,
    profit: returned - stake,
    roi: stake > 0 ? returned / stake : null,
    returnSd,
    roiCi,
    verdict,
    betsNeeded,
    bestPayout: best
      ? { rcDate: best.rcDate, rcNo: best.rcNo, odds: best.payoutOdds! }
      : null,
    profitExcludingBest: best && restStake > 0 ? restReturned - restStake : null,
    roiExcludingBest: best && restStake > 0 ? restReturned / restStake : null,
    calibration: rankTally
      .map((t, i) => {
        const actual = t.n > 0 ? t.hits / t.n : 0;
        return {
          rank: i + 1,
          races: t.n,
          predicted: t.n > 0 ? t.predSum / t.n : 0,
          actual,
          breakEvenOdds: actual > 0 ? 1 / actual : null,
        };
      })
      .filter((c) => c.races > 0),
    // 경주마다 조합 수가 다르므로 "1/조합수" 의 평균으로 낸다.
    randomHitRate: races > 0 ? combinationSum / races : 0,
  };
}
