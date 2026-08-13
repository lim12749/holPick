import { num, str } from "./horse";
import type { KraRow } from "./types";

/**
 * 구간 기록 세이버메트릭 — 출발 스퍼트와 막판 여력.
 *
 * 경주기록 응답에는 구간 **실측 시간**이 들어 있다(시행 완료 행 기준 채움률 98.1%).
 * 그런데 지금까지 쓴 건 초반 1F 통과 **순위**를 두수로 나눠 4개 범주로 뭉갠 각질뿐이었다
 * (`style.ts`). 실측 시간을 버리고 등급만 쓰는 셈이었다.
 *
 * **경주 안에서 z점수로 정규화한다.** 같은 경주의 말들은 거리·주로·날씨·등급을 공유하므로,
 * 경주 내 평균 대비 편차로 바꾸면 그 조건들이 자동으로 상쇄된다. 별도 보정식이 필요 없다.
 *
 * 실측(캐시 4,934행 / 478경주, 워크포워드):
 *
 * |            | 막판 느림 | 막판 빠름 |
 * |------------|-----------|-----------|
 * | 초반 빠름  | 21.4%     | **32.2%** |
 * | 초반 느림  | 9.3%      | 14.8%     |
 *
 * 3.5배 스프레드다(각질은 최고 1.39배). 핵심은 **초반과 막판이 서로 다른 축**이라는 것 —
 * 상관계수 −0.29 로, 빠른 출발마는 막판이 약한 경향이 있다. 둘을 함께 봐야 "둘 다 되는 말"이
 * 걸러진다. 반면 4코너 순위는 초반과 상관 0.85 라 사실상 중복이어서 쓰지 않는다.
 *
 * **누수 주의.** 위 값들은 *그 경주에서의 실제 주파 기록*이라 사후 정보다. 예측에 쓰려면
 * 반드시 **그 경주 이전** 기록으로만 만든 평균을 써야 한다. 자기 자신의 주파 기록을 보면
 * 사실상 정답을 보는 것과 같다. `buildSectionalHistory` 가 경주일 순으로 순회하며 스냅샷을
 * 먼저 찍고 그 뒤에 이력을 갱신하는 이유가 이것이다.
 */

/** 구간 지표를 판정하려면 최소 이만큼의 과거 출전이 있어야 한다. */
export const MIN_RUNS = 2;

/**
 * 경주 안에서 z점수. `lowerIsFaster` 면 값이 작을수록 +z 가 된다(시간·순위가 여기 해당).
 *
 * 0 이하는 결측으로 보고 뺀다. 표본이 4두 미만이거나 전원 동일하면 판정하지 않는다.
 */
function raceZScores(
  race: KraRow[],
  value: (row: KraRow) => number,
  lowerIsFaster: boolean,
): Map<string, number> {
  const measured = race
    .map((row) => ({ hrNo: str(row.hrNo), v: value(row) }))
    .filter((x) => x.v > 0);
  if (measured.length < 4) return new Map();

  const mean = measured.reduce((a, x) => a + x.v, 0) / measured.length;
  const variance = measured.reduce((a, x) => a + (x.v - mean) ** 2, 0) / measured.length;
  const sd = Math.sqrt(variance);
  if (sd <= 0) return new Map();

  return new Map(
    measured.map((x) => [x.hrNo, lowerIsFaster ? (mean - x.v) / sd : (x.v - mean) / sd]),
  );
}

/** 출발 후 200m(1F) 통과 시간. 사용자가 말하는 "출발 스퍼트"가 이 값이다. */
function earlyTime(row: KraRow): number {
  return num(row.seS1fAccTime);
}

/** 막판 200m 소요 시간 = 총 주파기록 − 결승 1F 전 누적. 막판 여력을 잰다. */
function lateTime(row: KraRow): number {
  const total = num(row.rcTime);
  const atG1f = num(row.seG1fAccTime);
  return total > 0 && atG1f > 0 && total > atG1f ? total - atG1f : 0;
}

/** 초반 200m → 결승 3F 전까지 걸린 시간. 중반 가속 구간이다. */
function accelTime(row: KraRow): number {
  const s1f = num(row.seS1fAccTime);
  const g3f = num(row.seG3fAccTime);
  return s1f > 0 && g3f > 0 && g3f > s1f ? g3f - s1f : 0;
}

const METRICS = [
  { key: "early", value: earlyTime },
  { key: "late", value: lateTime },
  { key: "accel", value: accelTime },
] as const;

export type SectionalMetric = (typeof METRICS)[number]["key"];

export interface SectionalSnapshot {
  /** 마번 → 그 경주 **이전**까지의 평균 z. 표본이 모자라면 키 자체가 없다. */
  early: Map<string, number>;
  late: Map<string, number>;
  accel: Map<string, number>;
}

export interface SectionalHistory {
  /** `rcDate-rcNo` → 그 경주 시점의 스냅샷. */
  byRace: Map<string, SectionalSnapshot>;
  /** 전체 이력을 다 반영한 최종값. 다가올 경주 예측에 쓴다. */
  final: SectionalSnapshot;
  /** 초반 지표가 매겨진 행 수 / 전체 행 수. 표본 충분성 판단용. */
  covered: number;
  total: number;
}

function emptySnapshot(): SectionalSnapshot {
  return { early: new Map(), late: new Map(), accel: new Map() };
}

function raceKey(row: KraRow): string {
  return `${str(row.rcDate)}-${num(row.rcNo)}`;
}

/**
 * 경주일 순으로 순회하며 시점별 구간 지표 스냅샷을 만든다.
 *
 * 전체 평균을 한 번에 계산해 되붙이면 미래 경주를 보고 과거를 맞히는 셈이 된다.
 * 반드시 "그 경주 직전까지"의 이력만 반영해야 한다 — `style.ts` 와 같은 규칙이다.
 */
export function buildSectionalHistory(rows: KraRow[]): SectionalHistory {
  const races = new Map<string, KraRow[]>();
  for (const row of rows) {
    const key = raceKey(row);
    const list = races.get(key);
    if (list) list.push(row);
    else races.set(key, [row]);
  }

  // 경주일 → 경주번호 순. 키가 `YYYYMMDD-N` 이라 경주번호는 숫자로 비교해야 한다.
  const orderedKeys = [...races.keys()].sort((a, b) => {
    const [da, na] = a.split("-");
    const [db, nb] = b.split("-");
    return da === db ? Number(na) - Number(nb) : da.localeCompare(db);
  });

  // 마번 → 지표별 누적합·횟수.
  const accum = new Map<string, Record<SectionalMetric, { sum: number; n: number }>>();
  const byRace = new Map<string, SectionalSnapshot>();
  let covered = 0;
  let total = 0;

  const meanOf = (hrNo: string, metric: SectionalMetric): number | null => {
    const acc = accum.get(hrNo)?.[metric];
    return acc && acc.n >= MIN_RUNS ? acc.sum / acc.n : null;
  };

  for (const key of orderedKeys) {
    const race = races.get(key)!;

    // 1) 이 경주 시점의 스냅샷을 먼저 찍는다 (아직 이 경주 기록은 반영 전).
    const snapshot = emptySnapshot();
    for (const row of race) {
      total += 1;
      const hrNo = str(row.hrNo);
      let any = false;
      for (const { key: metric } of METRICS) {
        const mean = meanOf(hrNo, metric);
        if (mean == null) continue;
        snapshot[metric].set(hrNo, mean);
        any = true;
      }
      if (any) covered += 1;
    }
    byRace.set(key, snapshot);

    // 2) 스냅샷을 찍은 뒤에야 이 경주 기록을 이력에 더한다.
    for (const { key: metric, value } of METRICS) {
      for (const [hrNo, z] of raceZScores(race, value, true)) {
        const cur = accum.get(hrNo) ?? {
          early: { sum: 0, n: 0 },
          late: { sum: 0, n: 0 },
          accel: { sum: 0, n: 0 },
        };
        cur[metric].sum += z;
        cur[metric].n += 1;
        accum.set(hrNo, cur);
      }
    }
  }

  const final = emptySnapshot();
  for (const [hrNo] of accum) {
    for (const { key: metric } of METRICS) {
      const mean = meanOf(hrNo, metric);
      if (mean != null) final[metric].set(hrNo, mean);
    }
  }

  return { byRace, final, covered, total };
}

/**
 * 연속 z 를 구간으로 나눈다.
 *
 * 기존 `restBand`·`budamBand` 와 같은 패턴이라 `tallyBy` 로 그대로 집계할 수 있다.
 * 연속값을 그대로 쓰지 않는 이유는, 나머지 요인이 전부 "구간 → 실측 복승률" 조회
 * 방식이라 형태를 맞춰야 가중치 비교가 의미를 갖기 때문이다.
 */
export function speedBand(z: number): string {
  if (z >= 0.7) return "매우 빠름 (+0.7σ↑)";
  if (z >= 0.25) return "빠름 (+0.25~0.7σ)";
  if (z >= -0.25) return "보통 (±0.25σ)";
  if (z >= -0.7) return "느림 (−0.25~−0.7σ)";
  return "매우 느림 (−0.7σ↓)";
}

/** 화면 표시용 축약. 숫자를 그대로 늘어놓으면 표에서 읽히지 않는다. */
export function speedArrow(z: number): string {
  if (z >= 0.7) return "▲▲";
  if (z >= 0.25) return "▲";
  if (z >= -0.25) return "△";
  if (z >= -0.7) return "▽";
  return "▽▽";
}

export const SECTIONAL_DESCRIPTION: Record<SectionalMetric, string> = {
  early: "출발 후 200m 통과 속도 (경주 내 평균 대비)",
  late: "막판 200m 속도 (경주 내 평균 대비)",
  accel: "초반 200m 이후 중반 가속 (경주 내 평균 대비)",
};
