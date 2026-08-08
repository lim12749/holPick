import { num, str } from "./horse";
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

/** 인기순위 = 확정 단승배당 오름차순. 사후 정보이므로 벤치마크에만 쓴다. */
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
}

export function buildStatsBundle(rows: KraRow[], styleHistory?: StyleHistory): StatsBundle {
  const base = baseTop2Rate(rows);
  const races = groupRows(rows);

  // 경주 내 상대 지표는 경주 단위로 계산해 행에 되붙인다.
  const withRank: KraRow[] = [];
  let styleCovered = 0;
  for (const [key, race] of races) {
    const snapshot = styleHistory?.byRace.get(key);
    for (const row of race) {
      const minBudam = Math.min(...race.map((r) => num(r.wgBudam)).filter((v) => v > 0));
      const myBudam = num(row.wgBudam);
      // 각질은 이 경주 **이전** 이력으로 만든 스냅샷에서 가져온다. 사후 정보가 아니다.
      const style = snapshot?.styleByHorse.get(str(row.hrNo)) ?? null;
      if (style) styleCovered += 1;
      withRank.push({
        ...row,
        __ratingRank: ratingRankInRace(race, row),
        __favRank: favouriteRankInRace(race, row),
        __budamBand:
          myBudam > 0 && Number.isFinite(minBudam) ? budamBand(myBudam - minBudam) : null,
        __style: style,
        __pace: snapshot?.pace ?? null,
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
  };
}
