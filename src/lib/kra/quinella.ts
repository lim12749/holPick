import type { Prediction } from "./predict";

/**
 * 복승식 조합 확률.
 *
 * 말별 확률만으로는 마권을 살 수 없다. 복승식은 두 마리를 고르는 베팅이므로
 * "이 둘이 1·2착을 차지할 확률"이 필요하다.
 *
 * **Harville 모델**을 쓴다. 우승 확률 p 가 주어졌을 때, i 가 1착이면 나머지
 * 중에서 j 가 1착일 확률은 `p_j / (1 − p_i)` 로 재정규화된다는 가정이다.
 *
 *   P(i,j 복승) = p_i · p_j/(1−p_i) + p_j · p_i/(1−p_j)
 *
 * 순서를 따지지 않으므로 두 방향을 더한다. 강한 말의 확률을 다소 과대평가하는
 * 알려진 편향이 있지만, 계산이 투명하고 추가 학습이 필요 없다.
 */

export interface QuinellaPick {
  a: Prediction;
  b: Prediction;
  /** 이 조합이 1·2착을 차지할 확률. */
  prob: number;
  /** 본전 배당 — 이 확률의 역수. 실제 배당이 이보다 높으면 기대값이 양수다. */
  fairOdds: number;
}

export function quinellaProbability(pi: number, pj: number): number {
  // 확률이 1에 붙으면 분모가 0이 되므로 가둔다.
  const a = Math.min(Math.max(pi, 1e-6), 0.999);
  const b = Math.min(Math.max(pj, 1e-6), 0.999);
  return (a * b) / (1 - a) + (b * a) / (1 - b);
}

/** 모든 조합을 확률 내림차순으로. */
export function quinellaPicks(predictions: Prediction[], limit = 5): QuinellaPick[] {
  const picks: QuinellaPick[] = [];
  for (let i = 0; i < predictions.length; i += 1) {
    for (let j = i + 1; j < predictions.length; j += 1) {
      const prob = quinellaProbability(predictions[i].win, predictions[j].win);
      picks.push({
        a: predictions[i],
        b: predictions[j],
        prob,
        fairOdds: prob > 0 ? 1 / prob : Infinity,
      });
    }
  }
  return picks.sort((x, y) => y.prob - x.prob).slice(0, limit);
}

/** 전체 조합 확률의 합. 정확히 한 조합만 적중하므로 1.0 근처여야 한다 (검증용). */
export function totalQuinellaProbability(predictions: Prediction[]): number {
  let sum = 0;
  for (let i = 0; i < predictions.length; i += 1) {
    for (let j = i + 1; j < predictions.length; j += 1) {
      sum += quinellaProbability(predictions[i].win, predictions[j].win);
    }
  }
  return sum;
}

/** 마번 두 개를 순서 무관 키로. 조합 대조에 쓴다. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
