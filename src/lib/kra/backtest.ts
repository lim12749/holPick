import type { QuinellaDividend } from "./dividend";
import { num, str } from "./horse";
import { actualPair, candidateFromRow, isPickHit, EMPTY_TRAITS, type HorseTraits } from "./pick";
import { predictRace, NO_MARKET_MODEL, type Model } from "./predict";
import { pairKey, quinellaPicks } from "./quinella";
import { buildStatsBundle, groupRows } from "./stats";
import { buildSectionalHistory } from "./sectional";
import { buildStyleHistory, RUNNING_STYLES, type RunningStyle } from "./style";
import type { KraRow } from "./types";

/**
 * 시간 분할 백테스트 — 복승식(1·2착) 기준.
 *
 * 두 가지를 반드시 지킨다.
 *
 * 1. **시간 순 분할.** 앞 기간으로 통계를 만들고 뒤 기간을 맞힌다. 무작위 분할은
 *    미래 정보로 과거를 맞히는 꼴이라 성능이 허수로 부풀려진다.
 * 2. **누수 차단.** 예측 입력에는 **결과를 알아야만 나오는 값**(`ord`, `rcTime`,
 *    `diffUnit`)을 절대 넣지 않는다. 각질도 그 경주 **이전** 이력으로만 만든
 *    스냅샷을 쓴다. `pick.ts` 의 candidateFromRow 가 그 경계다.
 *
 *    `winOdds` 는 예외적으로 **허용**한다. 파리뮤추얼 확정배당은 발매 마감 시점의
 *    시장 컨센서스이고 마권을 사는 사람은 그걸 보고 산다 — 결과 정보가 아니다.
 *    실제로 경주기록 응답은 미시행 경주에도 배당을 실어 보낸다. 예전에는 이걸
 *    사후 정보로 오해해 가장 강한 변수를 버리고 있었다.
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
  /** 배당을 포함한 현재 모델. */
  model: BacktestMetrics;
  /**
   * 배당을 뺀 채 같은 절차로 적합한 모델.
   *
   * 시장 항이 실제로 얼마를 보탰는지 재려면 상대가 필요하다. 낡은 손 가중치와
   * 비교하면 시장의 기여가 부풀려진다.
   */
  modelNoMarket: BacktestMetrics;
  ratingOnly: BacktestMetrics;
  /** 각질 성향만으로 순위를 매긴 기준. 각질만으로 충분하면 나머지는 군더더기다. */
  styleOnly: BacktestMetrics;
  /**
   * 확정배당 인기순. **1차 목표선**이다.
   *
   * 예전에는 "사후 정보라 상한선"이라고 적어 뒀지만, 확정배당은 발매 마감 시점의
   * 시장 컨센서스라 경주 전에 알 수 있다. 넘을 수 없는 선이 아니라 넘어야 하는 선이다.
   */
  favourite: BacktestMetrics;
  randomTop2HitAvg: number;
  /**
   * 모델과 각 기준선의 대응 비교. |z| ≥ 1.96 이면 우연으로 보기 어렵다.
   * 검증 경주가 100여 개뿐이라 이 값 없이 "이겼다"고 말하면 과장이 된다.
   */
  vsStyle: { diff: number; se: number; z: number };
  vsRating: { diff: number; se: number; z: number };
  /** **1차 목표 판정.** z ≥ 1.96 이면 시장을 이긴 것이다. */
  vsMarket: { diff: number; se: number; z: number };
  /** 배당을 넣어서 실제로 좋아졌는지. z ≥ 1.96 이면 시장 항이 값을 했다. */
  vsNoMarket: { diff: number; se: number; z: number };
  /** 추천 1순위 복승 조합이 실제 1·2착과 일치한 비율. */
  quinellaHitRate: number;
  /** 복승 조합을 판정할 수 있었던 경주 수. */
  quinellaRaces: number;
  /**
   * 추천 1순위 조합에 1단위씩 베팅했을 때 회수율. 1.0 이면 본전.
   * 확정 복승배당을 못 구한 경우 null.
   */
  quinellaRoi: number | null;
  /** 확정배당을 실제로 구해 정산할 수 있었던 베팅 수. ROI 의 분모다. */
  quinellaBets: number;
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

/**
 * 검증에 쓸 경주일 비율. 6개월이라도 서울은 주말만 시행해 경주일이 40일 남짓이다.
 *
 * 화면이 검증 구간의 확정배당만 받아오려면 같은 경계를 알아야 하므로 export 한다.
 * 양쪽에 따로 적어 두면 한쪽만 바뀌었을 때 배당 구간과 검증 구간이 어긋난다.
 */
export const TEST_FRACTION = 0.3;

/** 경주일 목록에서 학습·검증 경계 위치. 호출부와 백테스트가 같은 값을 쓴다. */
export function testSplitIndex(dateCount: number): number {
  return Math.max(1, Math.floor(dateCount * (1 - TEST_FRACTION)));
}

export interface BacktestInput {
  rows: KraRow[];
  /** 경주일별 복승 확정배당. 없으면 ROI 를 계산하지 않는다. */
  dividends?: Map<string, Map<string, QuinellaDividend>>;
  /** 생략하면 배당판 상태에 맞는 모델이 자동 선택된다. 실험용 오버라이드. */
  model?: Model;
}

export function runBacktest({ rows, dividends, model: override }: BacktestInput): BacktestReport | null {
  const dates = [...new Set(rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  if (dates.length < 4) return null;

  const splitAt = testSplitIndex(dates.length);
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
  // 구간 지표도 같은 규칙 — 경주별 스냅샷이 그 경주 이전만 반영한다.
  const sectionalHistory = buildSectionalHistory(rows);
  // 통계는 학습 기간만으로 만든다. 검증 기간이 섞이면 누수다.
  const stats = buildStatsBundle(trainRows, styleHistory, sectionalHistory);

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
  // 배당을 뺀 같은 모델. 시장 항이 실제로 무엇을 보탰는지 대응 비교하기 위해 함께 돈다.
  const noMarketHits: number[] = [];
  let noMarketTopHits = 0;
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
    const traits: HorseTraits = {
      style: styleHistory.byRace.get(key)?.styleByHorse ?? EMPTY_TRAITS.style,
      sectional: sectionalHistory.byRace.get(key) ?? EMPTY_TRAITS.sectional,
    };
    const candidates = race.map((r) => candidateFromRow(r, traits));
    const rcDist = num(race[0].rcDist);
    const preds = predictRace(candidates, stats, rcDist, override);
    const byHr = new Map(race.map((r) => [str(r.hrNo), r]));

    /** 예측 상위 2두 중 실제로 1·2착이었던 두수. */
    const top2HitsOf = (ps: typeof preds) =>
      ps
        .slice(0, 2)
        .map((p) => byHr.get(p.hrNo))
        .filter((r): r is KraRow => !!r)
        .filter(isTop2).length;

    modelHits.push(top2HitsOf(preds));

    const top = byHr.get(preds[0]?.hrNo ?? "");
    if (top && isTop2(top)) topHits += 1;

    // 같은 경주를 배당 없는 모델로도 풀어 본다. 대응 비교라 같은 경주여야 한다.
    const noMarketPreds = predictRace(candidates, stats, rcDist, NO_MARKET_MODEL);
    noMarketHits.push(top2HitsOf(noMarketPreds));
    const noMarketTop = byHr.get(noMarketPreds[0]?.hrNo ?? "");
    if (noMarketTop && isTop2(noMarketTop)) noMarketTopHits += 1;

    // 복승 조합 평가 — 실제 1·2착 마번 쌍과 추천 1순위를 대조한다.
    const actual = actualPair(race.map((r) => ({ ord: num(r.ord), chulNo: num(r.chulNo) })));
    if (actual) {
      quinellaRaces += 1;
      const pick = quinellaPicks(preds, 1)[0];
      if (pick) {
        const won = isPickHit(pick, actual);
        if (won) quinellaHits += 1;

        /*
         * **정산 가능한 베팅만 센다.** 배당을 실제 1·2착 조합으로 조회해서, 그 행이
         * 있으면 이 경주는 정산된 것이고(틀렸으면 회수 0), 없으면 데이터가 없는
         * 것이라 베팅을 없던 일로 한다.
         *
         * 예전에는 그날 배당 맵이 있기만 하면 bets 를 늘렸는데,
         * loadQuinellaDividends 는 실패해도 빈 Map 을 돌려주므로 배당을 못 구한
         * 경주일이 전부 "전액 손실"로 집계돼 ROI 가 구조적으로 과소평가됐다.
         */
        const d = dividends
          ?.get(str(race[0].rcDate))
          ?.get(`${num(race[0].rcNo)}:${pairKey(actual[0], actual[1])}`);
        if (d) {
          hadDividend = true;
          bets += 1;
          if (won) returned += d.odds;
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

  const noMarketSummary = summarise(noMarketHits);
  const modelNoMarket: BacktestMetrics = n
    ? {
        races: n,
        runners,
        top2HitAvg: noMarketSummary.avg,
        top2HitSe: noMarketSummary.se,
        topPickHitRate: noMarketTopHits / n,
        // Brier·로그손실은 배당 포함 모델만 잰다. 이 기준선은 순위 비교용이다.
        brier: 0,
        logLoss: 0,
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
    modelNoMarket,
    ratingOnly,
    styleOnly,
    favourite,
    randomTop2HitAvg: 2 * stats.base,
    vsStyle: pairedDiff(modelHits, styleResult.hits),
    vsRating: pairedDiff(modelHits, ratingResult.hits),
    vsMarket: pairedDiff(modelHits, favouriteResult.hits),
    vsNoMarket: pairedDiff(modelHits, noMarketHits),
    quinellaHitRate: quinellaRaces ? quinellaHits / quinellaRaces : 0,
    quinellaRaces,
    quinellaRoi: hadDividend && bets > 0 ? returned / bets : null,
    quinellaBets: bets,
  };
}
