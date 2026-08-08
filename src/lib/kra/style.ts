import { num, str } from "./horse";
import type { KraRow } from "./types";

/**
 * 각질(주행 스타일) 분석.
 *
 * 초반 1F 통과 순위(`sjS1fOrd`, 채움률 92.9%)를 출주두수로 나눈 비율로 판정한다.
 * 실측 신호가 매우 크다 — 3개월 기준 선행 35.7% vs 추입 10.8% (복승 적중률).
 *
 * **누수 주의.** 위 수치는 *그 경주에서의 실제* 위치라 사후 정보다. 예측에 쓰려면
 * 반드시 **그 경주 이전** 이력으로 만든 성향을 써야 한다. buildStyleHistory 가
 * 경주일 순으로 순회하며 시점별 스냅샷을 만드는 이유가 이것이다.
 * 과거 성향만으로도 선행형 27.5% vs 추입형 12.9% 로 신호가 유지된다.
 */

export type RunningStyle = "선행형" | "선입형" | "중위형" | "추입형";

export const RUNNING_STYLES: RunningStyle[] = ["선행형", "선입형", "중위형", "추입형"];

/** 초반 위치 비율(0=선두, 1=최후미) → 성향. */
export function styleOf(ratio: number | null): RunningStyle | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio <= 0.3) return "선행형";
  if (ratio <= 0.55) return "선입형";
  if (ratio <= 0.75) return "중위형";
  return "추입형";
}

/** 한 경주에서 그 말의 초반 위치 비율. 구간 기록이 없으면 null. */
export function earlyRatio(row: KraRow, fieldSize: number): number | null {
  const pos = num(row.sjS1fOrd);
  if (pos <= 0 || fieldSize <= 0) return null;
  return pos / fieldSize;
}

export type PaceBand = "선행형 0~1두" | "선행형 2~3두" | "선행형 4두+";

/** 경주 내 선행형 두수로 페이스를 가늠한다. 선행마가 몰리면 초반이 과열된다. */
export function paceBand(styles: (RunningStyle | null)[]): PaceBand {
  const front = styles.filter((s) => s === "선행형").length;
  if (front <= 1) return "선행형 0~1두";
  if (front <= 3) return "선행형 2~3두";
  return "선행형 4두+";
}

export interface RaceStyleSnapshot {
  /** 마번 → 그 경주 시점의 성향. 첫 출전이면 키 자체가 없다. */
  styleByHorse: Map<string, RunningStyle>;
  /** 마번 → 그 시점까지의 평균 초반위치 비율. */
  ratioByHorse: Map<string, number>;
  pace: PaceBand;
}

export interface StyleHistory {
  /** `rcDate-rcNo` → 그 경주 시점의 스냅샷. */
  byRace: Map<string, RaceStyleSnapshot>;
  /** 전체 이력을 다 반영한 최종 성향. 다가올 경주 예측에 쓴다. */
  finalStyle: Map<string, RunningStyle>;
  finalRatio: Map<string, number>;
  /** 성향이 매겨진 행 수 / 전체 행 수. 표본 충분성 판단용. */
  covered: number;
  total: number;
}

function raceKey(row: KraRow): string {
  return `${str(row.rcDate)}-${num(row.rcNo)}`;
}

/**
 * 경주일 순으로 순회하며 시점별 성향 스냅샷을 만든다.
 *
 * 전체 평균을 한 번에 계산해 되붙이면 미래 경주를 보고 과거를 맞히는 셈이 된다.
 * 반드시 "그 경주 직전까지"의 이력만 반영해야 한다.
 */
export function buildStyleHistory(rows: KraRow[]): StyleHistory {
  const races = new Map<string, KraRow[]>();
  for (const row of rows) {
    const key = raceKey(row);
    const list = races.get(key);
    if (list) list.push(row);
    else races.set(key, [row]);
  }

  // 경주일 → 경주번호 순. 키가 `YYYYMMDD-N` 이라 날짜는 사전순으로 정렬되지만
  // 경주번호는 문자열 비교하면 10이 2보다 앞서므로 분리해서 비교한다.
  const orderedKeys = [...races.keys()].sort((a, b) => {
    const [da, na] = a.split("-");
    const [db, nb] = b.split("-");
    return da === db ? Number(na) - Number(nb) : da.localeCompare(db);
  });

  const accum = new Map<string, { sum: number; n: number }>();
  const byRace = new Map<string, RaceStyleSnapshot>();
  let covered = 0;
  let total = 0;

  for (const key of orderedKeys) {
    const race = races.get(key)!;
    const fieldSize = race.length;

    // 1) 이 경주 시점의 스냅샷을 먼저 찍는다 (아직 이 경주 결과는 반영 전).
    const styleByHorse = new Map<string, RunningStyle>();
    const ratioByHorse = new Map<string, number>();
    const styles: (RunningStyle | null)[] = [];

    for (const row of race) {
      total += 1;
      const hrNo = str(row.hrNo);
      const acc = accum.get(hrNo);
      if (!acc || acc.n === 0) {
        styles.push(null);
        continue;
      }
      const ratio = acc.sum / acc.n;
      const style = styleOf(ratio);
      styles.push(style);
      if (style) {
        styleByHorse.set(hrNo, style);
        ratioByHorse.set(hrNo, ratio);
        covered += 1;
      }
    }

    byRace.set(key, { styleByHorse, ratioByHorse, pace: paceBand(styles) });

    // 2) 스냅샷을 찍은 뒤에야 이 경주 결과를 이력에 더한다.
    for (const row of race) {
      const ratio = earlyRatio(row, fieldSize);
      if (ratio == null) continue;
      const hrNo = str(row.hrNo);
      const acc = accum.get(hrNo) ?? { sum: 0, n: 0 };
      acc.sum += ratio;
      acc.n += 1;
      accum.set(hrNo, acc);
    }
  }

  const finalStyle = new Map<string, RunningStyle>();
  const finalRatio = new Map<string, number>();
  for (const [hrNo, acc] of accum) {
    if (acc.n === 0) continue;
    const ratio = acc.sum / acc.n;
    const style = styleOf(ratio);
    if (style) {
      finalStyle.set(hrNo, style);
      finalRatio.set(hrNo, ratio);
    }
  }

  return { byRace, finalStyle, finalRatio, covered, total };
}

/** 성향을 한 줄로 설명한다. 화면에서 툴팁으로 쓴다. */
export const STYLE_DESCRIPTION: Record<RunningStyle, string> = {
  선행형: "초반부터 선두권에서 달리는 유형",
  선입형: "선두 바로 뒤에 붙어 따라가는 유형",
  중위형: "중위권에서 기회를 보는 유형",
  추입형: "후미에서 막판에 치고 나오는 유형",
};
