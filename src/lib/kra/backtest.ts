import type { QuinellaDividend } from "./dividend";
import { num, str } from "./horse";
import { predictRace, type Candidate, type Weights } from "./predict";
import { pairKey, quinellaPicks } from "./quinella";
import { buildStatsBundle, groupRows } from "./stats";
import { buildStyleHistory, RUNNING_STYLES, type RunningStyle } from "./style";
import type { KraRow } from "./types";

/**
 * 시간 분할 백테스트 — 복승식(1·2착) 기준.
 *
 * 두 가지를 반드시 지킨다.
 *
 * 1. **시간 순 분할.** 앞 기간으로 통계를 만들고 뒤 기간을 맞힌다. 무작위 분할은
 *    미래 정보로 과거를 맞히는 꼴이라 성능이 허수로 부풀려진다.
 * 2. **누수 차단.** 예측 입력에는 경주 전에 알 수 없는 값(`ord`, `winOdds`,
 *    `rcTime`, `diffUnit`)을 절대 넣지 않는다. 각질도 그 경주 **이전** 이력으로만
 *    만든 스냅샷을 쓴다. 아래 buildCandidate 가 그 경계다.
 */

export interface BacktestMetrics {
  races: number;
  runners: number;
  /** 예측 상위 2두 중 실제 1·2착이었던 두수의 평균. 무작위 기대값은 2×기저율. */
  top2HitAvg: number;
  /**
   * top2HitAvg 의 표준오차. 검증 경주가 100여 개뿐이라 방식 간 차이가
   * 우연인지 실력인지 이 값 없이는 판단할 수 없다. 화면에 ± 로 함께 띄운다.
   */
  top2HitSe: number;
  /** 예측 1위가 실제 2착 이내였던 비율. */
  topPickHitRate: number;
  brier: number;
  logLoss: number;
}

/** 경주별 적중 수(0·1·2)에서 평균과 표준오차를 낸다. */
function summarise(hits: number[]): { avg: number; se: number } {
  const n = hits.length;
  if (n === 0) return { avg: 0, se: 0 };
  const avg = hits.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { avg, se: 0 };
  const variance = hits.reduce((acc, h) => acc + (h - avg) ** 2, 0) / (n - 1);
  return { avg, se: Math.sqrt(variance / n) };
}

/**
 * 두 방식의 차이가 통계적으로 의미 있는지.
 *
 * 같은 경주를 두 방식이 함께 맞히므로 대응 비교(paired)가 맞다. 독립 가정으로
 * 계산하면 SE 가 과대평가되어 실제로는 유의한 차이를 놓친다.
 */
export function pairedDiff(a: number[], b: number[]): { diff: number; se: number; z: number } {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { diff: 0, se: 0, z: 0 };
  const d = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const { avg, se } = summarise(d);
  return { diff: avg, se, z: se > 0 ? avg / se : 0 };
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
  ratingOnly: BacktestMetrics;
  /** 각질 성향만으로 순위를 매긴 기준. 각질만으로 충분하면 나머지는 군더더기다. */
  styleOnly: BacktestMetrics;
  /** 확정배당 인기순. 사후 정보라 사실상 상한선이다. */
  favourite: BacktestMetrics;
  randomTop2HitAvg: number;
  /**
   * 모델과 각 기준선의 대응 비교. |z| ≥ 1.96 이면 우연으로 보기 어렵다.
   * 검증 경주가 100여 개뿐이라 이 값 없이 "이겼다"고 말하면 과장이 된다.
   */
  vsStyle: { diff: number; se: number; z: number };
  vsRating: { diff: number; se: number; z: number };
  vsMarket: { diff: number; se: number; z: number };
  /** 추천 1순위 복승 조합이 실제 1·2착과 일치한 비율. */
  quinellaHitRate: number;
  /** 복승 조합을 판정할 수 있었던 경주 수. */
  quinellaRaces: number;
  /**
   * 추천 1순위 조합에 1단위씩 베팅했을 때 회수율. 1.0 이면 본전.
   * 확정 복승배당을 못 구한 경우 null.
   */
  quinellaRoi: number | null;
  quinellaBets: number;
}

/**
 * 경주기록 행에서 예측 입력을 만든다.
 *
 * **여기가 누수 경계다.** ord·winOdds·plcOdds·rcTime·diffUnit 은 읽지 않는다.
 * 백테스트에는 출전표의 최근 1년 전적이 없으므로 0으로 두고, predictRace 가
 * 학습 구간에서 집계한 마필별 성적으로 대체하게 한다.
 */
function buildCandidate(row: KraRow, style: RunningStyle | null): Candidate {
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
    lastYearTop2: 0,
    style,
  };
}

function isTop2(row: KraRow): boolean {
  const o = num(row.ord);
  return o >= 1 && o <= 2;
}

function emptyMetrics(): BacktestMetrics {
  return {
    races: 0,
    runners: 0,
    top2HitAvg: 0,
    top2HitSe: 0,
    topPickHitRate: 0,
    brier: 0,
    logLoss: 0,
  };
}

/**
 * 순위만 주어졌을 때의 지표. 확률이 없는 기준선(레이팅순·각질순·인기순)에 쓴다.
 * 경주별 적중 수도 함께 돌려줘 방식 간 대응 비교를 할 수 있게 한다.
 */
function metricsFromOrder(
  races: KraRow[][],
  order: (race: KraRow[]) => KraRow[],
): { metrics: BacktestMetrics; hits: number[] } {
  const hits: number[] = [];
  let topHits = 0;
  let runners = 0;

  for (const race of races) {
    const ranked = order(race);
    // 순위를 못 매긴 경주는 0두 적중으로 센다. 건너뛰면 분모가 달라져
    // 방식 간 비교가 공정하지 않다 (레이팅 없는 경주가 유리하게 빠지는 문제).
    if (ranked.length === 0) {
      hits.push(0);
      runners += race.length;
      continue;
    }
    runners += race.length;
    hits.push(ranked.slice(0, 2).filter(isTop2).length);
    if (isTop2(ranked[0])) topHits += 1;
  }

  const { avg, se } = summarise(hits);
  return {
    metrics: {
      races: hits.length,
      runners,
      top2HitAvg: avg,
      top2HitSe: se,
      topPickHitRate: hits.length ? topHits / hits.length : 0,
      brier: 0,
      logLoss: 0,
    },
    hits,
  };
}

/** 검증에 쓸 경주일 비율. 6개월이라도 서울은 주말만 시행해 경주일이 40일 남짓이다. */
const TEST_FRACTION = 0.3;

export interface BacktestInput {
  rows: KraRow[];
  /** 경주일별 복승 확정배당. 없으면 ROI 를 계산하지 않는다. */
  dividends?: Map<string, Map<string, QuinellaDividend>>;
  weights?: Weights;
}

export function runBacktest({ rows, dividends, weights }: BacktestInput): BacktestReport | null {
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

  /*
   * 각질 이력은 전체 구간으로 만들되, 각 경주에는 **그 경주 이전** 스냅샷만
   * 쓴다. buildStyleHistory 가 경주일 순으로 누적하므로 검증 구간 경주도
   * 자기 자신이나 이후 경주를 보지 않는다.
   */
  const styleHistory = buildStyleHistory(rows);
  // 통계는 학습 기간만으로 만든다. 검증 기간이 섞이면 누수다.
  const stats = buildStatsBundle(trainRows, styleHistory);

  /*
   * **순서 누수 차단.** 경주기록 응답은 100% 착순 순으로 정렬되어 온다.
   * JS 의 sort 는 안정 정렬이라 동점일 때 원래 순서를 유지하는데, 각질처럼
   * 범주가 4개뿐인 기준으로 세우면 동점이 대량 발생해 사실상 착순 순으로
   * 정렬된다. 실제로 이 때문에 각질 단독 1순위 적중률이 60.6% 로 부풀려졌다.
   * 평가 전에 착순과 무관하고 결정적인 마번 순으로 재배열한다.
   */
  const testRaceEntries = [...groupRows(testRows).entries()]
    .filter(([, r]) => r.length >= 4)
    .map(([key, r]) => [key, [...r].sort((a, b) => num(a.chulNo) - num(b.chulNo))] as const);
  const testRaces = testRaceEntries.map(([, r]) => r);

  const modelHits: number[] = [];
  let topHits = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let runners = 0;
  let quinellaHits = 0;
  let quinellaRaces = 0;
  let bets = 0;
  let returned = 0;
  let hadDividend = false;

  for (const [key, race] of testRaceEntries) {
    const snapshot = styleHistory.byRace.get(key);
    const candidates = race.map((r) =>
      buildCandidate(r, snapshot?.styleByHorse.get(str(r.hrNo)) ?? null),
    );
    const preds = predictRace(candidates, stats, num(race[0].rcDist), weights);
    const byHr = new Map(race.map((r) => [str(r.hrNo), r]));

    modelHits.push(
      preds
        .slice(0, 2)
        .map((p) => byHr.get(p.hrNo))
        .filter((r): r is KraRow => !!r)
        .filter(isTop2).length,
    );

    const top = byHr.get(preds[0]?.hrNo ?? "");
    if (top && isTop2(top)) topHits += 1;

    // 복승 조합 평가 — 실제 1·2착 마번 쌍과 추천 1순위를 대조한다.
    const actualPair = race
      .filter((r) => num(r.ord) >= 1 && num(r.ord) <= 2)
      .sort((a, b) => num(a.ord) - num(b.ord))
      .map((r) => num(r.chulNo));
    if (actualPair.length === 2 && actualPair.every((n) => n > 0)) {
      quinellaRaces += 1;
      const picks = quinellaPicks(preds, 1);
      const pick = picks[0];
      if (pick) {
        const picked = pairKey(pick.a.chulNo, pick.b.chulNo);
        const actual = pairKey(actualPair[0], actualPair[1]);
        const won = picked === actual;
        if (won) quinellaHits += 1;

        const dayDividends = dividends?.get(str(race[0].rcDate));
        if (dayDividends) {
          hadDividend = true;
          bets += 1;
          if (won) {
            const d = dayDividends.get(`${num(race[0].rcNo)}:${actual}`);
            if (d) returned += d.odds;
          }
        }
      }
    }

    for (const p of preds) {
      const row = byHr.get(p.hrNo);
      if (!row) continue;
      runners += 1;
      const actual = isTop2(row) ? 1 : 0;
      const q = Math.min(Math.max(p.top2, 0.001), 0.999);
      brierSum += (q - actual) ** 2;
      logLossSum += -(actual * Math.log(q) + (1 - actual) * Math.log(1 - q));
    }
  }

  const n = testRaces.length;
  const modelSummary = summarise(modelHits);
  const model: BacktestMetrics = n
    ? {
        races: n,
        runners,
        top2HitAvg: modelSummary.avg,
        top2HitSe: modelSummary.se,
        topPickHitRate: topHits / n,
        brier: runners ? brierSum / runners : 0,
        logLoss: runners ? logLossSum / runners : 0,
      }
    : emptyMetrics();

  const ratingResult = metricsFromOrder(testRaces, (race) =>
    [...race].filter((r) => num(r.rating) > 0).sort((a, b) => num(b.rating) - num(a.rating)),
  );
  const ratingOnly = ratingResult.metrics;

  // 각질 단독: 선행형 → 선입형 → 중위형 → 추입형 순으로 세운다.
  const styleRank = new Map<RunningStyle, number>(RUNNING_STYLES.map((s, i) => [s, i]));
  const styleResult = metricsFromOrder(testRaces, (race) => {
    const key = `${str(race[0].rcDate)}-${num(race[0].rcNo)}`;
    const snapshot = styleHistory.byRace.get(key);
    if (!snapshot) return [];
    const withStyle = race.filter((r) => snapshot.styleByHorse.has(str(r.hrNo)));
    return withStyle.sort(
      (a, b) =>
        (styleRank.get(snapshot.styleByHorse.get(str(a.hrNo))!) ?? 9) -
        (styleRank.get(snapshot.styleByHorse.get(str(b.hrNo))!) ?? 9),
    );
  });

  const styleOnly = styleResult.metrics;

  const favouriteResult = metricsFromOrder(testRaces, (race) =>
    [...race].filter((r) => num(r.winOdds) > 0).sort((a, b) => num(a.winOdds) - num(b.winOdds)),
  );
  const favourite = favouriteResult.metrics;

  return {
    base: stats.base,
    trainRows: trainRows.length,
    testRows: testRows.length,
    trainDays: trainDates.size,
    testDays: testDates.size,
    trainMonths,
    testMonths,
    model,
    ratingOnly,
    styleOnly,
    favourite,
    randomTop2HitAvg: 2 * stats.base,
    vsStyle: pairedDiff(modelHits, styleResult.hits),
    vsRating: pairedDiff(modelHits, ratingResult.hits),
    vsMarket: pairedDiff(modelHits, favouriteResult.hits),
    quinellaHitRate: quinellaRaces ? quinellaHits / quinellaRaces : 0,
    quinellaRaces,
    quinellaRoi: hadDividend && bets > 0 ? returned / bets : null,
    quinellaBets: bets,
  };
}
