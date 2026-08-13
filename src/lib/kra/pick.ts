import type { Entry } from "./entry";
import { num, str } from "./horse";
import { predictRace, type Candidate, type Model, type Prediction } from "./predict";
import { pairKey, quinellaPicks, type QuinellaPick } from "./quinella";
import type { RaceResult } from "./result";
import type { SectionalSnapshot } from "./sectional";
import type { StatsBundle } from "./stats";
import type { RunningStyle } from "./style";
import type { KraRow } from "./types";

/**
 * 출전마 → 예측 입력 → 복승 조합. 픽을 만드는 단 하나의 경로.
 *
 * 이 변환은 경주 목록·경주 상세·지난 픽 원장·백테스트 네 곳에서 필요하다.
 * 각자 손으로 쓰면 곧 서로 다른 확률을 내놓고, 어느 쪽이 맞는지 알 수 없게 된다.
 * 화면에 띄우는 픽과 성적표에 기록되는 픽은 반드시 같은 함수에서 나와야 한다.
 */

/** 출전표와 경주 결과를 마번으로 짝지은 한 줄. 어느 한쪽만 있을 수도 있다. */
export interface RaceRunner {
  hrNo: string;
  hrName: string;
  chulNo: number;
  entry: Entry | null;
  result: RaceResult | null;
}

/**
 * 출전표와 경주기록을 마번(hrNo)으로 병합한다.
 *
 * 지난 경주일은 출전표가 비고, 다가올 경주일은 결과가 빈다. 어느 쪽이든 화면이
 * 채워져야 하므로 합집합을 만든다. 정렬은 호출부가 목적에 맞게 한다.
 */
export function mergeRunners(entries: Entry[], results: RaceResult[]): RaceRunner[] {
  const entryByHr = new Map(entries.map((e) => [e.hrNo, e]));
  const resultByHr = new Map(results.map((r) => [r.hrNo, r]));

  return [...new Set([...entryByHr.keys(), ...resultByHr.keys()])].map((hrNo) => {
    const entry = entryByHr.get(hrNo) ?? null;
    const result = resultByHr.get(hrNo) ?? null;
    return {
      hrNo,
      hrName: entry?.hrName || result?.hrName || "",
      chulNo: entry?.chulNo || result?.chulNo || 0,
      entry,
      result,
    };
  });
}

/**
 * 예측에 쓸 출전마만 남긴다.
 *
 * 출전표는 편성 시점 명단이라 **출전취소된 말이 남아 있다.** 실제로 20260808
 * 5경주는 출전표 12두 / 실주 11두였다. 취소마를 넣은 채 예측하면 소프트맥스
 * 분모가 달라져 조합 순위가 바뀌고, 같은 경주인데 경주 목록 화면과 지난 픽
 * 원장이 서로 다른 픽을 말하게 된다.
 *
 * 그래서 시행이 끝난 경주는 경주기록에 이름이 있는 말만 쓴다. 실격으로 착순이
 * 없는 말(ord=0)은 출발은 했으므로 남긴다. 아직 시행 전이면 손대지 않는다 —
 * 그 시점에는 누가 빠질지 알 수 없고, 그게 실제 베팅 상황이다.
 */
export function predictionRunners(runners: RaceRunner[]): RaceRunner[] {
  const ran = runners.some((r) => (r.result?.ord ?? 0) > 0);
  return ran ? runners.filter((r) => r.result) : runners;
}

/**
 * 마필별 과거 성향 스냅샷 묶음.
 *
 * 각질과 구간 지표는 모두 **그 경주 이전** 이력에서만 나와야 한다. 두 경로
 * (`toCandidates`·`candidateFromRow`)가 같은 것을 받게 묶어 두면, 한쪽만 옛 스냅샷을
 * 쓰는 사고를 막을 수 있다. 다가올 경주는 `final`, 과거 경주는 그 경주 시점의
 * `byRace` 스냅샷을 넘긴다.
 */
export interface HorseTraits {
  style: Map<string, RunningStyle>;
  sectional: SectionalSnapshot;
}

/** 스냅샷이 없을 때(통계 부족) 쓰는 빈 묶음. 전부 기저율로 떨어진다. */
export const EMPTY_TRAITS: HorseTraits = {
  style: new Map(),
  sectional: { early: new Map(), late: new Map(), accel: new Map() },
};

/**
 * 예측 입력을 만든다. 출전표 값을 우선하고, 없으면 경주기록에서 채운다.
 *
 * **누수 경계다.** 착순·주파기록·착차는 읽지 않는다. 각질과 구간 지표는 호출부가
 * 넘긴 스냅샷에서만 가져온다.
 *
 * **마번 순으로 세워서 돌려준다.** 경주기록 응답은 착순 순으로 오는데, 확률이
 * 상한(0.95)에 걸려 동점이 나면 안정 정렬이 그 착순을 그대로 유지해 순위가
 * 정답 순서로 매겨진다. 입력 순서로 답이 새는 경로를 여기서 끊는다.
 */
export function toCandidates(runners: RaceRunner[], traits: HorseTraits): Candidate[] {
  return [...runners]
    .sort((a, b) => a.chulNo - b.chulNo)
    .map((r) => ({
      hrNo: r.hrNo,
      hrName: r.hrName,
      chulNo: r.chulNo,
      rating: r.entry?.rating ?? r.result?.rating ?? 0,
      wgBudam: r.entry?.wgBudam ?? r.result?.wgBudam ?? 0,
      jkName: r.entry?.jkName ?? r.result?.jkName ?? "",
      trName: r.entry?.trName ?? r.result?.trName ?? "",
      restDays: r.entry?.restDays ?? 0,
      lastYearStarts: r.entry?.lastYear.starts ?? 0,
      // 복승이 타깃이므로 최근 1년도 1·2착만 센다.
      lastYearTop2: (r.entry?.lastYear.first ?? 0) + (r.entry?.lastYear.second ?? 0),
      style: traits.style.get(r.hrNo) ?? null,
      earlySpeed: traits.sectional.early.get(r.hrNo) ?? null,
      lateSpeed: traits.sectional.late.get(r.hrNo) ?? null,
      accel: traits.sectional.accel.get(r.hrNo) ?? null,
      age: r.entry?.age ?? r.result?.age ?? 0,
      sex: r.entry?.sex ?? r.result?.sex ?? "",
      origin: r.entry?.origin ?? r.result?.origin ?? "",
      // 출전표에는 배당이 없다. 경주기록 쪽에만 실려 오고, 미시행 경주에도 들어 있다.
      winOdds: r.result?.winOdds ?? 0,
    }));
}

/**
 * 경주기록 행 하나에서 예측 입력을 만든다. 백테스트·지난 픽 원장이 쓰는 경로다.
 *
 * 경주기록에는 최근 1년 전적 필드가 없으므로 0으로 두고, `predictRace` 가 학습
 * 구간에서 집계한 마필별 성적으로 대체하게 한다.
 *
 * `winOdds` 는 넣는다. 확정 단승배당은 발매 마감 시점의 시장 컨센서스라 경주 전에
 * 알 수 있는 값이고, 결과를 알아야 나오는 값이 아니다. 결과에서 나오는 값
 * (`ord`·`rcTime`·`diffUnit`)은 여전히 읽지 않는다.
 */
export function candidateFromRow(row: KraRow, traits: HorseTraits): Candidate {
  const hrNo = str(row.hrNo);
  return {
    hrNo,
    hrName: str(row.hrName),
    chulNo: num(row.chulNo),
    rating: num(row.rating),
    wgBudam: num(row.wgBudam),
    jkName: str(row.jkName),
    trName: str(row.trName),
    restDays: num(row.ilsu),
    lastYearStarts: 0,
    lastYearTop2: 0,
    style: traits.style.get(hrNo) ?? null,
    earlySpeed: traits.sectional.early.get(hrNo) ?? null,
    lateSpeed: traits.sectional.late.get(hrNo) ?? null,
    accel: traits.sectional.accel.get(hrNo) ?? null,
    age: num(row.age),
    sex: str(row.sex),
    origin: str(row.name),
    winOdds: num(row.winOdds),
  };
}

export interface RacePick {
  predictions: Prediction[];
  /** 확률 내림차순 복승 조합. 1순위가 우리가 "산다"고 말하는 조합이다. */
  picks: QuinellaPick[];
}

export function buildRacePick(
  candidates: Candidate[],
  stats: StatsBundle,
  rcDist: number,
  limit = 3,
  /** 생략하면 배당판 상태에 맞는 모델이 자동으로 선택된다. */
  model?: Model,
): RacePick {
  if (candidates.length === 0) return { predictions: [], picks: [] };
  const predictions = predictRace(candidates, stats, rcDist, model);
  return { predictions, picks: quinellaPicks(predictions, limit) };
}

/**
 * 실제 1·2착 마번 쌍. 착순이 안 매겨졌거나 두 자리를 못 채우면 null.
 *
 * 동착으로 2착이 둘인 경우가 있어 착순 순으로 앞의 두 마리만 취한다.
 */
export function actualPair(
  runners: { ord: number; chulNo: number }[],
): [number, number] | null {
  const top = runners
    .filter((r) => r.ord >= 1 && r.ord <= 2 && r.chulNo > 0)
    .sort((a, b) => a.ord - b.ord)
    .slice(0, 2);
  return top.length === 2 ? [top[0].chulNo, top[1].chulNo] : null;
}

/** 추천 조합이 실제 1·2착과 일치하는지. 순서는 따지지 않는다. */
export function isPickHit(pick: QuinellaPick, actual: [number, number] | null): boolean {
  if (!actual) return false;
  return pairKey(pick.a.chulNo, pick.b.chulNo) === pairKey(actual[0], actual[1]);
}
