import { num, str } from "./horse";
import { speedBand, type SectionalHistory } from "./sectional";
import type { StyleHistory } from "./style";
import type { KraRow } from "./types";

/**
 * 과거 경주기록 집계.
 *
 * 모든 비율은 **복승(2착 이내)** 기준이다. 실제로 베팅할 종목이 복승식이라
 * 타깃을 여기에 맞춘다. 관측 기저율은 19.6%(2 ÷ 평균두수 10.2).
 *
 * 핵심은 표본이 작은 항목을 그대로 믿지 않는 것이다. 3전 2착인 기수를 66%로
 * 두면 예측이 그 기수에 끌려간다. 축소추정으로 기저율 쪽으로 당긴다.
 */

/** 축소추정 강도. 이 횟수만큼의 "가상 평균 출주"를 섞는다. */
export const SHRINK_K = 20;

export interface Tally {
  starts: number;
  first: number;
  second: number;
  third: number;
  /** 복승 적중(1~2착) 횟수. 예측 타깃이다. */
  top2: number;
  /** 3착 이내 횟수. 화면 표시용으로만 남긴다. */
  top3: number;
}

export interface RateEntry extends Tally {
  key: string;
  /** 원시 복승 적중률. 표본이 작으면 요동친다. */
  raw: number;
  /** 축소추정된 복승 적중률. 예측에는 이 값을 쓴다. */
  adjusted: number;
}

function emptyTally(): Tally {
  return { starts: 0, first: 0, second: 0, third: 0, top2: 0, top3: 0 };
}

function add(t: Tally, ord: number): void {
  t.starts += 1;
  if (ord === 1) t.first += 1;
  else if (ord === 2) t.second += 1;
  else if (ord === 3) t.third += 1;
  if (ord >= 1 && ord <= 2) t.top2 += 1;
  if (ord >= 1 && ord <= 3) t.top3 += 1;
}

/**
 * 축소추정. `p_adj = (hits + k·base) / (starts + k)`
 *
 * starts 가 0이면 기저율 그대로, 충분히 크면 원시 비율에 수렴한다.
 */
export function shrink(hits: number, starts: number, base: number, k = SHRINK_K): number {
  return (hits + k * base) / (starts + k);
}

/** 전체 복승(2착 이내) 기저율. 모든 축소추정의 기준점이 된다. */
export function baseTop2Rate(rows: KraRow[]): number {
  if (rows.length === 0) return 0;
  const hits = rows.filter((r) => {
    const o = num(r.ord);
    return o >= 1 && o <= 2;
  }).length;
  return hits / rows.length;
}

/** 임의의 키 함수로 집계하고 축소추정까지 붙인다. */
export function tallyBy(
  rows: KraRow[],
  keyOf: (row: KraRow) => string | null,
  base: number,
): RateEntry[] {
  const map = new Map<string, Tally>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const t = map.get(key) ?? emptyTally();
    add(t, num(row.ord));
    map.set(key, t);
  }

  return [...map.entries()]
    .map(([key, t]) => ({
      key,
      ...t,
      raw: t.starts > 0 ? t.top2 / t.starts : 0,
      adjusted: shrink(t.top2, t.starts, base),
    }))
    .sort((a, b) => b.adjusted - a.adjusted);
}

/** 거리 구간. 게이트 유불리가 거리에 따라 달라지므로 나눠서 본다. */
export function distanceBand(dist: number): string {
  if (dist <= 1200) return "단거리(≤1200)";
  if (dist <= 1700) return "중거리(1300~1700)";
  return "장거리(≥1800)";
}

/** 휴양일수 구간. 너무 짧거나 너무 길면 불리하다는 통념을 데이터로 확인한다. */
export function restBand(days: number): string {
  if (days <= 0) return "미상";
  if (days <= 13) return "≤13일";
  if (days <= 27) return "14~27일";
  if (days <= 55) return "28~55일";
  return "56일+";
}

/** 부담중량 편차 구간 (경주 내 최저 대비). */
export function budamBand(delta: number): string {
  if (delta <= 0) return "최저";
  if (delta <= 1) return "+0.5~1.0";
  if (delta <= 2) return "+1.5~2.0";
  return "+2.5 이상";
}

/**
 * 경주 내 상대 연령 (최연소 대비 몇 살 위인가).
 *
 * 절대 연령을 그대로 쓰면 편성 효과를 학습한다 — 3세 전용 경주가 따로 있어서
 * "3세가 잘한다"에 그 구성이 섞인다. 최연소 대비로 바꾸면 같은 경주 안에서의
 * 나이 우위만 남는다. 실측 최연소 1.38배 → +2세 0.49배로 단조 감소하며,
 * 전원 동갑인 경주는 478개 중 32개뿐이라 대부분의 경주에서 변별이 생긴다.
 */
export function relativeAgeBand(delta: number): string {
  if (delta <= 0) return "최연소";
  if (delta <= 1) return "+1세";
  if (delta <= 2) return "+2세";
  return "+3세 이상";
}

export interface RaceKey {
  rcDate: string;
  rcNo: number;
}

/** 같은 경주끼리 묶는다. 경주 내 상대 순위를 매기려면 필요하다. */
export function groupRows(rows: KraRow[]): Map<string, KraRow[]> {
  const map = new Map<string, KraRow[]>();
  for (const row of rows) {
    const key = `${str(row.rcDate)}-${num(row.rcNo)}`;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * 경주 내 레이팅 순위 (1 = 최고). 레이팅 0은 미산정이므로 순위에서 제외하고
 * `null` 을 돌려준다. 0을 최하위로 두면 미산정 마필이 전부 불리하게 평가된다.
 */
export function ratingRankInRace(race: KraRow[], row: KraRow): number | null {
  const rating = num(row.rating);
  if (rating <= 0) return null;
  const rated = race.map(num_rating).filter((v) => v > 0);
  if (rated.length === 0) return null;
  return rated.filter((v) => v > rating).length + 1;
}

function num_rating(r: KraRow): number {
  return num(r.rating);
}

/**
 * 인기순위 = 확정 단승배당 오름차순.
 *
 * 확정배당은 발매 마감 시점의 시장 컨센서스라 경주 전에 알 수 있다. 사후 정보가
 * 아니므로 예측 입력으로 써도 되고, 실제로 `predict.ts` 가 시장 항으로 쓴다.
 * 여기서는 "시장을 이겼는가"를 재는 기준선으로 쓴다.
 */
export function favouriteRankInRace(race: KraRow[], row: KraRow): number | null {
  const odds = num(row.winOdds);
  if (odds <= 0) return null;
  const valid = race.map((r) => num(r.winOdds)).filter((v) => v > 0);
  if (valid.length === 0) return null;
  return valid.filter((v) => v < odds).length + 1;
}

export interface StatsBundle {
  base: number;
  totalRows: number;
  totalRaces: number;
  jockey: RateEntry[];
  trainer: RateEntry[];
  /**
   * 마필별 과거 3착이내율 (마번 기준).
   *
   * 말 자신의 최근 성적은 가장 직관적인 예측 재료인데, 경주기록 응답에는
   * 최근 1년 전적 필드가 없다. 그래서 학습 구간의 실제 착순에서 직접 집계한다.
   * 출전표에는 rcCntY/ord1CntY 가 있으므로 실전에서는 둘 다 쓸 수 있다.
   */
  horse: RateEntry[];
  gateByBand: RateEntry[];
  ratingRank: RateEntry[];
  restBand: RateEntry[];
  budamBand: RateEntry[];
  /** 확정배당 인기순위별 실제 적중률. 시장이 얼마나 맞히는지 보여준다. */
  favouriteRank: RateEntry[];
  /** 각질 성향별. 경주 시점 이전 이력으로만 판정한 값이라 누수가 없다. */
  runningStyle: RateEntry[];
  /** 각질 × 페이스 교차. 선행마가 몰릴 때 추입이 유리해지는지 확인한다. */
  stylePace: RateEntry[];
  /** 각질 성향이 매겨진 행 수. 표본 충분성 판단용. */
  styleCovered: number;
  /**
   * 구간 기록 지표. 각질과 같은 원천이지만 순위가 아니라 **실측 시간**을 경주 내
   * z점수로 정규화한 값이라 훨씬 촘촘하다. 전부 그 경주 이전 이력으로만 만든다.
   */
  earlySpeed: RateEntry[];
  lateSpeed: RateEntry[];
  accel: RateEntry[];
  /** 경주 내 상대 연령. 절대 연령은 편성 효과가 섞여 쓰지 않는다. */
  relativeAge: RateEntry[];
  sex: RateEntry[];
  origin: RateEntry[];
  /**
   * 마체중 증감. **예측에는 쓰지 않는다** — 경주 당일 계측이라 경주 전에는 `"0()"` 로
   * 오기 때문이다. 넣으면 백테스트에서만 값이 있고 실전에는 없는 학습–서빙 불일치가 된다.
   * 분석 화면 표시용으로만 집계한다.
   */
  bodyWeightDelta: RateEntry[];
  /** 구간 지표가 하나라도 매겨진 행 수. */
  sectionalCovered: number;
}

/** `"481(+3)"` → 증감 +3. 형식이 다르거나 미계측(`"0()"`)이면 null. */
export function parseBodyWeightDelta(raw: string): number | null {
  const m = raw.match(/^(\d+)\(([+-]?\d+)\)$/);
  if (!m || Number(m[1]) <= 0) return null;
  return Number(m[2]);
}

function bodyWeightBand(delta: number): string {
  if (delta <= -6) return "−6kg 이하";
  if (delta < 0) return "−5~−1kg";
  if (delta === 0) return "변화 없음";
  if (delta <= 5) return "+1~+5kg";
  return "+6kg 이상";
}

export function buildStatsBundle(
  rows: KraRow[],
  styleHistory?: StyleHistory,
  sectionalHistory?: SectionalHistory,
): StatsBundle {
  const base = baseTop2Rate(rows);
  const races = groupRows(rows);

  // 경주 내 상대 지표는 경주 단위로 계산해 행에 되붙인다.
  const withRank: KraRow[] = [];
  let styleCovered = 0;
  let sectionalCovered = 0;
  for (const [key, race] of races) {
    const snapshot = styleHistory?.byRace.get(key);
    const sectional = sectionalHistory?.byRace.get(key);
    // 경주 단위 값이라 행마다 다시 구할 필요가 없다.
    const budamValues = race.map((r) => num(r.wgBudam)).filter((v) => v > 0);
    const minBudam = budamValues.length ? Math.min(...budamValues) : NaN;
    const ages = race.map((r) => num(r.age)).filter((v) => v > 0);
    const minAge = ages.length ? Math.min(...ages) : NaN;

    for (const row of race) {
      const hrNo = str(row.hrNo);
      const myBudam = num(row.wgBudam);
      // 각질은 이 경주 **이전** 이력으로 만든 스냅샷에서 가져온다. 사후 정보가 아니다.
      const style = snapshot?.styleByHorse.get(hrNo) ?? null;
      if (style) styleCovered += 1;

      // 구간 지표도 마찬가지로 이 경주 이전 스냅샷에서만 가져온다.
      const early = sectional?.early.get(hrNo);
      const late = sectional?.late.get(hrNo);
      const accel = sectional?.accel.get(hrNo);
      if (early != null || late != null || accel != null) sectionalCovered += 1;

      const myAge = num(row.age);
      const weightDelta = parseBodyWeightDelta(str(row.wgHr));

      withRank.push({
        ...row,
        __ratingRank: ratingRankInRace(race, row),
        __favRank: favouriteRankInRace(race, row),
        __budamBand:
          myBudam > 0 && Number.isFinite(minBudam) ? budamBand(myBudam - minBudam) : null,
        __style: style,
        __pace: snapshot?.pace ?? null,
        __early: early != null ? speedBand(early) : null,
        __late: late != null ? speedBand(late) : null,
        __accel: accel != null ? speedBand(accel) : null,
        __relAge:
          myAge > 0 && Number.isFinite(minAge) ? relativeAgeBand(myAge - minAge) : null,
        __weightBand: weightDelta != null ? bodyWeightBand(weightDelta) : null,
      });
    }
  }

  return {
    base,
    totalRows: rows.length,
    totalRaces: races.size,
    jockey: tallyBy(rows, (r) => str(r.jkName) || null, base),
    trainer: tallyBy(rows, (r) => str(r.trName) || null, base),
    horse: tallyBy(rows, (r) => str(r.hrNo) || null, base),
    gateByBand: tallyBy(
      rows,
      (r) => {
        const gate = num(r.chulNo);
        if (gate <= 0) return null;
        return `${distanceBand(num(r.rcDist))} · ${gate}번`;
      },
      base,
    ),
    ratingRank: tallyBy(
      withRank,
      (r) => (r.__ratingRank ? `레이팅 ${r.__ratingRank}위` : null),
      base,
    ),
    restBand: tallyBy(rows, (r) => restBand(num(r.ilsu)), base),
    budamBand: tallyBy(withRank, (r) => (r.__budamBand as string | null) ?? null, base),
    favouriteRank: tallyBy(withRank, (r) => (r.__favRank ? `인기 ${r.__favRank}위` : null), base),
    runningStyle: tallyBy(withRank, (r) => (r.__style as string | null) ?? null, base),
    stylePace: tallyBy(
      withRank,
      (r) => (r.__style && r.__pace ? `${r.__pace} · ${r.__style}` : null),
      base,
    ),
    styleCovered,
    earlySpeed: tallyBy(withRank, (r) => (r.__early as string | null) ?? null, base),
    lateSpeed: tallyBy(withRank, (r) => (r.__late as string | null) ?? null, base),
    accel: tallyBy(withRank, (r) => (r.__accel as string | null) ?? null, base),
    relativeAge: tallyBy(withRank, (r) => (r.__relAge as string | null) ?? null, base),
    sex: tallyBy(rows, (r) => str(r.sex) || null, base),
    origin: tallyBy(rows, (r) => str(r.name) || null, base),
    bodyWeightDelta: tallyBy(withRank, (r) => (r.__weightBand as string | null) ?? null, base),
    sectionalCovered,
  };
}
