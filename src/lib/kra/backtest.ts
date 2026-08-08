import { num, str } from "./horse";
import { predictRace, type Candidate, type Weights } from "./predict";
import { buildStatsBundle, groupRows } from "./stats";
import type { KraRow } from "./types";

/**
 * 시간 분할 백테스트.
 *
 * 두 가지를 반드시 지킨다.
 *
 * 1. **시간 순 분할.** 앞 기간으로 통계를 만들고 뒤 기간을 맞힌다. 무작위 분할은
 *    미래 정보로 과거를 맞히는 꼴이라 성능이 허수로 부풀려진다.
 * 2. **누수 차단.** 예측 입력에는 경주 전에 알 수 없는 값(`ord`, `winOdds`,
 *    `rcTime`, `diffUnit`)을 절대 넣지 않는다. 아래 buildCandidate 가 그 경계다.
 */

export interface BacktestMetrics {
  races: number;
  runners: number;
  /** 예측 상위 3두 중 실제 3착 이내였던 두수의 평균. 무작위 기대값은 3×기저율. */
  top3HitAvg: number;
  /** 예측 1위가 실제 3착 이내였던 비율. */
  topPickHitRate: number;
  brier: number;
  logLoss: number;
}

export interface BacktestReport {
  base: number;
  trainRows: number;
  testRows: number;
  trainDays: number;
  testDays: number;
  trainMonths: string[];
  testMonths: string[];
  model: BacktestMetrics;
  /** 레이팅만으로 순위를 매긴 단순 기준. */
  ratingOnly: BacktestMetrics;
  /** 확정배당 인기순. 사후 정보라 사실상 상한선이다. */
  favourite: BacktestMetrics;
  randomTop3HitAvg: number;
  /** 예측 1위에 연승 베팅했을 때 수익률. 1.0 이면 본전. */
  roiTopPick: number | null;
}

/**
 * 경주기록 행에서 예측 입력을 만든다.
 *
 * **여기가 누수 경계다.** ord·winOdds·plcOdds·rcTime·diffUnit 은 읽지 않는다.
 * 백테스트에서는 최근 1년 전적을 알 수 없으므로 0으로 두고, 축소추정이 기저율로
 * 처리하게 한다 — 실제 예측 화면은 출전표에서 이 값을 받는다.
 */
function buildCandidate(row: KraRow): Candidate {
  return {
    hrNo: str(row.hrNo),
    hrName: str(row.hrName),
    chulNo: num(row.chulNo),
    rating: num(row.rating),
    wgBudam: num(row.wgBudam),
    jkName: str(row.jkName),
    trName: str(row.trName),
    restDays: num(row.ilsu),
    lastYearStarts: 0,
    lastYearTop3: 0,
  };
}

function isTop3(row: KraRow): boolean {
  const o = num(row.ord);
  return o >= 1 && o <= 3;
}

function emptyMetrics(): BacktestMetrics {
  return { races: 0, runners: 0, top3HitAvg: 0, topPickHitRate: 0, brier: 0, logLoss: 0 };
}

/** 순위만 주어졌을 때의 지표. 확률이 없는 기준선(레이팅순·인기순)에 쓴다. */
function metricsFromOrder(races: KraRow[][], order: (race: KraRow[]) => KraRow[]): BacktestMetrics {
  let hitSum = 0;
  let topHits = 0;
  let runners = 0;
  let counted = 0;

  for (const race of races) {
    const ranked = order(race);
    if (ranked.length === 0) continue;
    counted += 1;
    runners += race.length;
    hitSum += ranked.slice(0, 3).filter(isTop3).length;
    if (isTop3(ranked[0])) topHits += 1;
  }

  return {
    races: counted,
    runners,
    top3HitAvg: counted ? hitSum / counted : 0,
    topPickHitRate: counted ? topHits / counted : 0,
    brier: 0,
    logLoss: 0,
  };
}

/** 검증에 쓸 경주일 비율. 3개월에 경주일이 20일뿐이라 월 단위로 자르면 표본이 말라붙는다. */
const TEST_FRACTION = 0.3;

export function runBacktest(rows: KraRow[], weights?: Weights): BacktestReport | null {
  // 월이 아니라 **경주일** 기준으로 시간 분할한다. 서울은 주말에만 시행해서
  // 3개월이라도 경주일은 20일 남짓이고, 마지막 달을 통째로 검증에 쓰면
  // 검증 경주가 10개로 줄어 어떤 결론도 낼 수 없다.
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  if (dates.length < 4) return null;

  const splitAt = Math.max(1, Math.floor(dates.length * (1 - TEST_FRACTION)));
  const trainDates = new Set(dates.slice(0, splitAt));
  const testDates = new Set(dates.slice(splitAt));

  const trainRows = rows.filter((r) => trainDates.has(str(r.rcDate)));
  const testRows = rows.filter((r) => testDates.has(str(r.rcDate)));
  if (trainRows.length === 0 || testRows.length === 0) return null;

  const trainMonths = [...new Set([...trainDates].map((d) => d.slice(0, 6)))].sort();
  const testMonths = [...new Set([...testDates].map((d) => d.slice(0, 6)))].sort();

  // 통계는 학습 기간만으로 만든다. 검증 기간이 섞이면 누수다.
  const stats = buildStatsBundle(trainRows);
  const testRaces = [...groupRows(testRows).values()].filter((r) => r.length >= 4);

  let hitSum = 0;
  let topHits = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let runners = 0;
  let stake = 0;
  let ret = 0;

  for (const race of testRaces) {
    const candidates = race.map(buildCandidate);
    const preds = predictRace(candidates, stats, num(race[0].rcDist), weights);
    const byHr = new Map(race.map((r) => [str(r.hrNo), r]));

    hitSum += preds
      .slice(0, 3)
      .map((p) => byHr.get(p.hrNo))
      .filter((r): r is KraRow => !!r)
      .filter(isTop3).length;

    const top = byHr.get(preds[0]?.hrNo ?? "");
    if (top) {
      if (isTop3(top)) topHits += 1;
      // 연승 베팅 1단위. 적중 시 확정 연승배당을 회수한다.
      stake += 1;
      if (isTop3(top)) ret += num(top.plcOdds);
    }

    for (const p of preds) {
      const row = byHr.get(p.hrNo);
      if (!row) continue;
      runners += 1;
      const actual = isTop3(row) ? 1 : 0;
      const q = Math.min(Math.max(p.top3, 0.001), 0.999);
      brierSum += (q - actual) ** 2;
      logLossSum += -(actual * Math.log(q) + (1 - actual) * Math.log(1 - q));
    }
  }

  const n = testRaces.length;
  const model: BacktestMetrics = n
    ? {
        races: n,
        runners,
        top3HitAvg: hitSum / n,
        topPickHitRate: topHits / n,
        brier: runners ? brierSum / runners : 0,
        logLoss: runners ? logLossSum / runners : 0,
      }
    : emptyMetrics();

  const ratingOnly = metricsFromOrder(testRaces, (race) =>
    [...race].filter((r) => num(r.rating) > 0).sort((a, b) => num(b.rating) - num(a.rating)),
  );
  const favourite = metricsFromOrder(testRaces, (race) =>
    [...race].filter((r) => num(r.winOdds) > 0).sort((a, b) => num(a.winOdds) - num(b.winOdds)),
  );

  const base = stats.base;

  return {
    base,
    trainRows: trainRows.length,
    testRows: testRows.length,
    trainDays: trainDates.size,
    testDays: testDates.size,
    trainMonths,
    testMonths,
    model,
    ratingOnly,
    favourite,
    randomTop3HitAvg: 3 * base,
    roiTopPick: stake > 0 ? ret / stake : null,
  };
}
