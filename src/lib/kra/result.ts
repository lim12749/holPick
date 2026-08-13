import { num, str } from "./horse";
import type { KraRow } from "./types";

/**
 * 경주기록(API4_3/raceResult_3) 파서.
 *
 * 이 응답은 **시행 전 경주도 함께 내려온다.** 그때는 `ord`(착순)과 `rcTime`이 0이다.
 * 따라서 "결과가 있다"의 판정은 반드시 `ord > 0` 으로 해야 하며, 0을 그대로
 * 착순으로 표시하면 아직 달리지도 않은 경주를 결과처럼 보여주게 된다.
 */

export interface RaceResult {
  /** 착순. 0이면 미시행. */
  ord: number;
  chulNo: number;
  hrNo: string;
  hrName: string;
  jkName: string;
  trName: string;
  /** 주파기록(초). 미시행이면 0. */
  rcTime: number;
  /** 착차 표기 ("머리", "2½" 등). */
  diffUnit: string;
  /** 단승 배당률. */
  winOdds: number;
  /** 연승 배당률. */
  plcOdds: number;
  /**
   * 마체중 표기 ("481(+3)"). 시행 전에는 `"0()"` 로 온다 — 경주 당일 계측이라
   * 경주 전에는 값이 없다. 그래서 예측 입력이 아니라 표시·분석용으로만 쓴다.
   */
  wgHr: string;
  wgBudam: number;
  rating: number;
  /**
   * 연령·성별·산지.
   *
   * 지난 경주일은 출전표가 조회되지 않으므로, 이 값들이 없으면 과거 경주의 예측을
   * 재현할 때 해당 요인이 통째로 빠진다. 경주기록에도 채움률 100% 로 들어오므로
   * 여기서 함께 파싱한다.
   */
  age: number;
  sex: string;
  origin: string;
}

/** 경주 단위 정보 중 결과 응답에만 있는 것 (주로상태·날씨). */
export interface ResultRaceInfo {
  rcDate: string;
  rcDay: string;
  rcNo: number;
  rcName: string;
  rcDist: number;
  rank: string;
  /** 주로상태 ("다습 (10%)"). 거리·주로별 성적 분해에 필요하다. */
  track: string;
  weather: string;
  meet: string;
}

export function parseResult(row: KraRow): RaceResult {
  return {
    ord: num(row.ord),
    chulNo: num(row.chulNo),
    hrNo: str(row.hrNo),
    hrName: str(row.hrName),
    jkName: str(row.jkName),
    trName: str(row.trName),
    rcTime: num(row.rcTime),
    diffUnit: str(row.diffUnit),
    winOdds: num(row.winOdds),
    plcOdds: num(row.plcOdds),
    wgHr: str(row.wgHr),
    wgBudam: num(row.wgBudam),
    rating: num(row.rating),
    age: num(row.age),
    sex: str(row.sex),
    // 경주기록은 산지를 `name`, 출전표는 `prd` 로 준다.
    origin: str(row.name),
  };
}

export function toResultRaceInfo(row: KraRow): ResultRaceInfo {
  return {
    rcDate: str(row.rcDate),
    rcDay: str(row.rcDay),
    rcNo: num(row.rcNo),
    rcName: str(row.rcName),
    rcDist: num(row.rcDist),
    rank: str(row.rank),
    track: str(row.track),
    weather: str(row.weather),
    meet: str(row.meet),
  };
}

export interface ResultGroup {
  info: ResultRaceInfo;
  results: RaceResult[];
  /** 실제로 시행되어 착순이 매겨졌는지. */
  finished: boolean;
}

/** 경주번호별로 묶고 착순 순으로 정렬한다. 미시행 경주는 출전번호 순. */
export function groupResultsByRace(rows: KraRow[]): ResultGroup[] {
  const buckets = new Map<number, KraRow[]>();
  for (const row of rows) {
    const rcNo = num(row.rcNo);
    const list = buckets.get(rcNo);
    if (list) list.push(row);
    else buckets.set(rcNo, [row]);
  }

  return [...buckets.values()]
    .map((group) => {
      const results = group.map(parseResult);
      const finished = results.some((r) => r.ord > 0);
      results.sort((a, b) =>
        finished
          ? // 실격·미출전으로 ord 가 0인 행은 뒤로 보낸다.
            (a.ord || Number.MAX_SAFE_INTEGER) - (b.ord || Number.MAX_SAFE_INTEGER)
          : a.chulNo - b.chulNo,
      );
      return { info: toResultRaceInfo(group[0]), results, finished };
    })
    .sort((a, b) => a.info.rcNo - b.info.rcNo);
}

/** 1·2·3착. 시행되지 않았으면 빈 배열. */
export function podium(group: ResultGroup): RaceResult[] {
  if (!group.finished) return [];
  return group.results.filter((r) => r.ord >= 1 && r.ord <= 3).slice(0, 3);
}

/** 착순 → 표시용 라벨. 0은 미시행/제외이므로 착순으로 쓰지 않는다. */
export function ordLabel(ord: number): string {
  return ord > 0 ? `${ord}착` : "—";
}

/** 주파기록 초를 `1:02.2` 형태로. 60초 미만이면 초만 표시한다. */
export function formatRaceTime(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return seconds.toFixed(1);
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** 착순별 강조 색. 1~3착만 구분한다. */
export function ordClassName(ord: number): string {
  if (ord === 1) return "bg-ok-bg text-ok";
  if (ord === 2 || ord === 3) return "bg-surface-muted text-foreground";
  return "";
}
