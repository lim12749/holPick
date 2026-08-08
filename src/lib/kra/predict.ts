import {
  budamBand,
  distanceBand,
  restBand,
  shrink,
  type RateEntry,
  type StatsBundle,
} from "./stats";

/**
 * 3착 이내 확률 추정.
 *
 * 경주는 "누가 절대적으로 빠른가"가 아니라 **그 경주 안에서 누가 상대적으로
 * 유리한가**의 문제다. 그래서 절대 점수를 쓰지 않고 경주 내에서 정규화한다.
 *
 *   s_i = Σ w_k · logit(p_ik)
 *   P_i = clamp( 3 · softmax(s)_i , 0.01, 0.95 )
 *
 * `× 3` 은 한 경주에서 3착 이내가 정확히 3두라는 제약을 반영한 스케일이다.
 * 따라서 한 경주의 확률 합은 3.0 근처가 되어야 한다.
 *
 * **배당률은 입력에 넣지 않는다.** 경주 전 시점에 신뢰할 수 있는 배당이 없기
 * 때문이기도 하고(미시행 경주의 winOdds 는 쓰레기값), 시장을 베끼는 모델은
 * 가치가 없기 때문이기도 하다. 배당은 사후 검증(ROI)에만 쓴다.
 */

/** 예측에 필요한 출전마 정보. 모두 경주 전에 확보 가능한 값이다. */
export interface Candidate {
  hrNo: string;
  hrName: string;
  chulNo: number;
  /** 0이면 미산정(결측). */
  rating: number;
  wgBudam: number;
  jkName: string;
  trName: string;
  restDays: number;
  lastYearStarts: number;
  lastYearTop3: number;
}

export interface Weights {
  ratingRank: number;
  recentForm: number;
  jockey: number;
  trainer: number;
  budam: number;
  gate: number;
  rest: number;
}

/**
 * 초기 가중치. 백테스트로 조정할 대상이며, 근거는 다음과 같다.
 * 레이팅은 마사회가 산출한 능력 지표라 단일 최강 변수이고, 최근 폼이 통산보다
 * 예측력이 높다. 게이트·휴양은 부수적이다.
 */
export const DEFAULT_WEIGHTS: Weights = {
  ratingRank: 0.35,
  recentForm: 0.25,
  jockey: 0.15,
  trainer: 0.1,
  budam: 0.08,
  gate: 0.04,
  rest: 0.03,
};

export interface Prediction {
  hrNo: string;
  hrName: string;
  chulNo: number;
  /** 3착 이내 확률 (0~1). */
  top3: number;
  /** 확률 내림차순 순위. */
  rank: number;
  /** 레이팅이 미산정이라 중앙값으로 대체했는지. 화면에서 밝힌다. */
  ratingImputed: boolean;
}

function toLookup(entries: RateEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.key, e.adjusted]));
}

/** 확률을 로그오즈로. 0/1 근처에서 발산하지 않도록 가둔다. */
function logit(p: number): number {
  const q = Math.min(Math.max(p, 0.01), 0.99);
  return Math.log(q / (1 - q));
}

function lookup(map: Map<string, number>, key: string, fallback: number): number {
  return map.get(key) ?? fallback;
}

/** 레이팅 결측을 경주 내 중앙값으로 대체한다. 0으로 두면 최하위로 오인된다. */
function imputeRatings(candidates: Candidate[]): { rating: number; imputed: boolean }[] {
  const known = candidates.map((c) => c.rating).filter((r) => r > 0).sort((a, b) => a - b);
  const median =
    known.length === 0
      ? 0
      : known.length % 2 === 1
        ? known[(known.length - 1) / 2]
        : (known[known.length / 2 - 1] + known[known.length / 2]) / 2;
  return candidates.map((c) =>
    c.rating > 0 ? { rating: c.rating, imputed: false } : { rating: median, imputed: true },
  );
}

export function predictRace(
  candidates: Candidate[],
  stats: StatsBundle,
  rcDist: number,
  weights: Weights = DEFAULT_WEIGHTS,
): Prediction[] {
  if (candidates.length === 0) return [];

  const base = stats.base;
  const horseMap = toLookup(stats.horse);
  const jockeyMap = toLookup(stats.jockey);
  const trainerMap = toLookup(stats.trainer);
  const gateMap = toLookup(stats.gateByBand);
  const ratingRankMap = toLookup(stats.ratingRank);
  const restMap = toLookup(stats.restBand);
  const budamMap = toLookup(stats.budamBand);

  const ratings = imputeRatings(candidates);
  const band = distanceBand(rcDist);

  const budamValues = candidates.map((c) => c.wgBudam).filter((v) => v > 0);
  const minBudam = budamValues.length ? Math.min(...budamValues) : 0;

  // 경주 내 레이팅 순위 (1 = 최고). 동점은 같은 순위로 둔다.
  const sortedRatings = [...ratings.map((r) => r.rating)].sort((a, b) => b - a);

  const scores = candidates.map((c, i) => {
    const rating = ratings[i].rating;
    const ratingRank = sortedRatings.filter((v) => v > rating).length + 1;

    const pRatingRank = lookup(ratingRankMap, `레이팅 ${ratingRank}위`, base);
    /*
     * 최근 폼. 출전표가 주는 최근 1년 전적을 우선 쓰고(표본이 작으면 축소추정),
     * 없으면 학습 구간에서 집계한 이 말의 실제 3착이내율로 대체한다.
     * 둘 다 없으면 기저율. 백테스트에서는 후자 경로를 탄다.
     */
    const pForm =
      c.lastYearStarts > 0
        ? shrink(c.lastYearTop3, c.lastYearStarts, base)
        : lookup(horseMap, c.hrNo, base);
    const pJockey = lookup(jockeyMap, c.jkName, base);
    const pTrainer = lookup(trainerMap, c.trName, base);
    const pBudam =
      c.wgBudam > 0 && minBudam > 0
        ? lookup(budamMap, budamBand(c.wgBudam - minBudam), base)
        : base;
    const pGate = c.chulNo > 0 ? lookup(gateMap, `${band} · ${c.chulNo}번`, base) : base;
    const pRest = lookup(restMap, restBand(c.restDays), base);

    const s =
      weights.ratingRank * logit(pRatingRank) +
      weights.recentForm * logit(pForm) +
      weights.jockey * logit(pJockey) +
      weights.trainer * logit(pTrainer) +
      weights.budam * logit(pBudam) +
      weights.gate * logit(pGate) +
      weights.rest * logit(pRest);

    return s;
  });

  // 소프트맥스. 최대값을 빼서 지수 폭주를 막는다.
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);

  const withProb = candidates.map((c, i) => ({
    hrNo: c.hrNo,
    hrName: c.hrName,
    chulNo: c.chulNo,
    // 한 경주의 3착 이내는 3두이므로 3배 스케일한다.
    top3: Math.min(Math.max((3 * exps[i]) / sum, 0.01), 0.95),
    rank: 0,
    ratingImputed: ratings[i].imputed,
  }));

  return [...withProb]
    .sort((a, b) => b.top3 - a.top3)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
