import {
  budamBand,
  distanceBand,
  relativeAgeBand,
  restBand,
  shrink,
  type RateEntry,
  type StatsBundle,
} from "./stats";
import { speedBand } from "./sectional";
import type { RunningStyle } from "./style";

/**
 * 복승(2착 이내) 확률 추정.
 *
 * 경주는 "누가 절대적으로 빠른가"가 아니라 **그 경주 안에서 누가 상대적으로
 * 유리한가**의 문제다. 그래서 절대 점수를 쓰지 않고 경주 내에서 정규화한다.
 *
 *   s_i = Σ w_k · logit(p_ik)
 *   P_i = clamp( 2 · softmax(s)_i , 0.01, 0.95 )
 *
 * `× 2` 는 한 경주에서 2착 이내가 정확히 2두라는 제약을 반영한 스케일이다.
 * 따라서 한 경주의 확률 합은 2.0 근처가 되어야 한다. 베팅 대상이 복승식이라
 * 타깃을 3착 이내가 아니라 여기에 맞췄다.
 *
 * **단승 배당률은 입력에 넣는다.** 예전에는 "미시행 경주의 winOdds 는 쓰레기값"
 * 이라며 뺐는데 사실이 아니었다. 경주기록 응답의 미시행(`ord=0`) 행에도 배당이
 * 실려 오고, 경주별 오버라운드가 1.24~1.28 로 시행 완료 경주(1.235~1.265)와 같은
 * 밴드다 — 진짜 시장이다.
 *
 * 확정 단승배당도 누수가 아니다. 파리뮤추얼에서 확정배당은 **발매 마감 시점의
 * 시장 컨센서스**이고, 마권을 사는 사람은 그걸 보고 산다. 결과를 알아야 나오는
 * 값이 아니다. 실제로 배당 인기순은 우리 8개 요인을 합친 것보다 정확했다
 * (상위 2두 적중 0.95 vs 0.80). 가장 강한 예측 변수를 이유 없이 버리고 있었다.
 *
 * 여전히 금지인 것은 **결과를 알아야만 나오는 값**이다 — `ord`·`rcTime`·`diffUnit`.
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
  /** 최근 1년 2착 이내 횟수 (1착 + 2착). 복승이 타깃이므로 3착은 세지 않는다. */
  lastYearTop2: number;
  /** 과거 이력으로 판정한 각질. 첫 출전이면 null. */
  style: RunningStyle | null;
  /**
   * 과거 구간 기록으로 만든 z점수. 표본(2전)이 모자라면 null.
   *
   * 각질과 같은 원천이지만 순위가 아니라 실측 시간이라 훨씬 촘촘하다.
   * `early` 와 `late` 는 상관 −0.29 로 서로 다른 축이다 — 빠른 출발마는 막판이 약하다.
   */
  earlySpeed: number | null;
  lateSpeed: number | null;
  accel: number | null;
  /** 연령·성별·산지. 경주 전에 확보되고 채움률 100% 다. */
  age: number;
  sex: string;
  origin: string;
  /**
   * 단승 배당률. 0이면 결측(미발매·플레이스홀더).
   *
   * 경주 전에도 조회되지만 이른 시간에는 인기 없는 말이 9999.9 같은 자리값으로
   * 오므로, 그대로 믿지 말고 `marketProbabilities` 의 판정을 거쳐야 한다.
   */
  winOdds: number;
}

export interface Weights {
  /**
   * 단승 배당에서 뽑은 시장 내재 확률. 단일 최강 변수다.
   * 배당판이 아직 얇으면 이 항은 자동으로 꺼진다.
   */
  market: number;
  ratingRank: number;
  recentForm: number;
  /** 각질 성향. 4개 범주라 거칠다 — 아래 구간 지표가 같은 정보를 더 촘촘히 담는다. */
  style: number;
  jockey: number;
  trainer: number;
  budam: number;
  gate: number;
  rest: number;
  /** 출발 후 200m 속도 (경주 내 z). 사용자가 말하는 "출발 스퍼트". */
  earlySpeed: number;
  /** 막판 200m 속도. earlySpeed 와 상관 −0.29 로 독립적인 축이다. */
  lateSpeed: number;
  /** 중반 가속 구간. */
  accel: number;
  /** 경주 내 상대 연령 (최연소 대비). */
  relativeAge: number;
  sex: number;
  origin: number;
}

/**
 * 가중치 한 벌 + 소프트맥스 온도.
 *
 * 온도가 따로 필요한 이유: 가중치 합이 1.0 이라 점수는 로그오즈의 가중 **평균**이고,
 * 그대로 소프트맥스에 넣으면 분포가 거의 균등해진다. 온도가 1 이던 시절 1순위 복승
 * 조합의 예측 확률이 3.2% 인데 실측 적중률은 13.0% 였다 — 순위는 맞히면서 확률은
 * 4배 과소평가했다. 확률이 틀리면 그 역수인 "본전 배당"도 틀려서, 살 만한 마권을
 * 사지 말라고 말하게 된다.
 *
 * 모델은 `온도 × 가중치` 에만 의존하므로 둘을 함께 적합한다
 * (`scripts/fit-weights.mjs`).
 */
export interface Model {
  weights: Weights;
  temperature: number;
}

/**
 * 배당판이 여물었을 때 쓰는 가중치. `scripts/fit-weights.mjs` 가 학습 구간
 * 278경주에서만 적합했다 (우승마 다항 로그우도 좌표상승).
 *
 * 검증 구간은 고르는 데 쓰지 않았고, 거기서 재보니 함께 좋아졌다:
 * 로그우도 -1.9735 → -1.8764, Brier 0.1432 → 0.1337, 로그손실 0.5244 → 0.4367.
 *
 * **레이팅·각질·기수·부담중량이 0 으로 떨어졌다.** 손으로 잡았을 때 각질을 0.28 로
 * 가장 크게 뒀던 걸 생각하면 뼈아프지만, 배당이 들어오면 그 정보는 이미 값에
 * 반영되어 있다는 뜻이다. 시장이 모르는 것만 남았다 — 최근 폼·게이트·조교사·휴양.
 *
 * **구간 지표(초반·막판·가속)와 연령·성별·산지를 넣어 다시 적합해 봤지만 채택하지
 * 않았다.** 학습 우도는 -3.7087 → -3.6966 으로 좋아지는데 검증 구간이 전부 나빠졌다
 * (복승 우도 -3.7651 → -3.7758, Brier 0.1337 → 0.1340, 로그손실 0.4365 → 0.4390).
 * 278경주에 요인 15개는 과하다 — 실제로 거의 신호가 없는 산지에 0.147 이 붙는 게
 * 과적합의 증거였다. 그래서 새 요인은 여기서 전부 0 으로 둔다. 배당이 있으면
 * 구간 기록이 말해 줄 것은 이미 값에 들어 있다는 뜻이다.
 * (배당이 없을 때는 이야기가 다르다 — `NO_MARKET_MODEL` 참고.)
 */
export const MARKET_MODEL: Model = {
  temperature: 1.61,
  weights: {
    market: 0.489,
    sex: 0.126,
    accel: 0.12,
    rest: 0.087,
    trainer: 0.073,
    earlySpeed: 0.054,
    gate: 0.052,
    ratingRank: 0,
    recentForm: 0,
    style: 0,
    jockey: 0,
    budam: 0,
    lateSpeed: 0,
    relativeAge: 0,
    origin: 0,
  },
};

/**
 * 배당판이 아직 얇을 때(발매 초반) 쓰는 가중치. 같은 절차로 따로 적합했다.
 *
 * **여기서는 구간 지표가 값을 했다.** 배당이 없으니 시장이 대신 말해 주던 것을
 * 직접 재야 하기 때문이다. 검증 구간이 전부 좋아졌다 —
 * 복승 우도 -4.2025 → -4.1485, Brier 0.1493 → 0.1466, 로그손실 0.4778 → 0.4735.
 *
 * 다만 살아남은 건 **막판 여력(`lateSpeed` 0.122)**이지 초반 스퍼트가 아니다.
 * `earlySpeed` 는 0 으로 떨어졌다 — 단독으로는 강했지만(최상위 분위 1.43배)
 * 상관 0.85 인 4코너 위치, 그리고 최근 폼·상대 연령이 같은 것을 이미 말하고 있어
 * 보탤 게 없었다는 뜻이다.
 *
 * 그래도 배당을 쓸 수 있을 때보다는 확실히 나쁘다(-4.15 vs -3.77). 배당판이
 * 여물면 반드시 `MARKET_MODEL` 로 넘어간다.
 */
export const NO_MARKET_MODEL: Model = {
  temperature: 6.15,
  weights: {
    market: 0,
    relativeAge: 0.14,
    lateSpeed: 0.115,
    recentForm: 0.114,
    accel: 0.1,
    budam: 0.081,
    sex: 0.074,
    origin: 0.07,
    jockey: 0.061,
    style: 0.06,
    ratingRank: 0.046,
    trainer: 0.044,
    gate: 0.042,
    earlySpeed: 0.031,
    rest: 0.023,
  },
};

/** 하위 호환용 별칭. 배당판이 여물었을 때의 기본값이다. */
export const TEMPERATURE = MARKET_MODEL.temperature;
export const DEFAULT_WEIGHTS: Weights = MARKET_MODEL.weights;

/**
 * 이 값 이상은 실제 배당이 아니라 자리값으로 본다.
 *
 * 발매 초반에는 인기 없는 말이 `242.4`·`3729.6`·`9999.9` 처럼 같은 값으로 몰려 온다.
 * 돈이 거의 안 걸린 상태의 자리값이라 확률로 환산하면 안 된다.
 */
const PLACEHOLDER_ODDS = 1000;

/** 배당판이 쓸 만하다고 볼 오버라운드 범위. 실측 정상치는 1.24~1.28 이다. */
const OVERROUND_MIN = 1.15;
const OVERROUND_MAX = 1.4;

/** 시장 항을 켜려면 이 비율 이상의 말에 유효 배당이 있어야 한다. */
const MIN_PRICED_RATIO = 0.5;

export interface MarketRead {
  /** 말별 시장 내재 확률. 배당판을 못 믿으면 전부 null. */
  probs: (number | null)[];
  /** 합산 오버라운드. 판정 근거를 화면에 밝히기 위해 함께 돌려준다. */
  overround: number;
  /** 배당판이 성숙했는지. false 면 시장 항을 끈다. */
  usable: boolean;
}

/**
 * 단승 배당 → 시장 내재 확률.
 *
 * 배당의 역수를 모두 더하면 1 을 넘는다(오버라운드 = 주최 측 공제분). 그 합으로
 * 나눠 확률로 만든다.
 *
 * 자리값을 걸러낸 뒤 남은 말이 절반도 안 되거나 오버라운드가 정상 범위를 벗어나면
 * **배당판이 아직 안 여물었다**고 보고 통째로 버린다. 발매 초반의 얇은 배당을
 * 그대로 쓰면 픽이 시간마다 널뛰기 때문이다.
 */
export function marketProbabilities(oddsList: number[]): MarketRead {
  const valid = oddsList.map((o) => o > 1 && o < PLACEHOLDER_ODDS);
  const priced = valid.filter(Boolean).length;
  const overround = oddsList.reduce((sum, o, i) => (valid[i] ? sum + 1 / o : sum), 0);

  const usable =
    oddsList.length > 0 &&
    priced >= Math.ceil(oddsList.length * MIN_PRICED_RATIO) &&
    overround >= OVERROUND_MIN &&
    overround <= OVERROUND_MAX;

  if (!usable) {
    return { probs: oddsList.map(() => null), overround, usable: false };
  }

  /*
   * 자리값이 붙은 말에도 최소한의 확률은 줘야 한다. 0 을 주면 logit 이 발산하고,
   * 그 말이 절대 못 온다고 단정하는 셈이 된다. 바닥값을 균등 배분한 뒤 유효분을
   * 그만큼 줄여 전체 합을 1 로 맞춘다.
   */
  const unpriced = oddsList.length - priced;
  const floorEach = unpriced > 0 ? Math.min(0.01, 0.5 / oddsList.length) : 0;
  const scale = 1 - floorEach * unpriced;

  return {
    probs: oddsList.map((o, i) => (valid[i] ? (1 / o / overround) * scale : floorEach)),
    overround,
    usable: true,
  };
}

export interface Prediction {
  hrNo: string;
  hrName: string;
  chulNo: number;
  /** 복승(2착 이내) 확률 (0~1). 한 경주 합이 2.0 근처가 된다. */
  top2: number;
  /** 우승 확률. 복승 조합 확률(Harville)을 계산할 때 쓴다. 합이 1.0. */
  win: number;
  /** 확률 내림차순 순위. */
  rank: number;
  /** 레이팅이 미산정이라 중앙값으로 대체했는지. 화면에서 밝힌다. */
  ratingImputed: boolean;
  style: RunningStyle | null;
  /**
   * 이 예측에 단승 배당이 반영됐는지.
   *
   * 발매 초반에는 배당판이 얇아 반영하지 않는다. 그 상태의 픽은 발매가 진행되면
   * 바뀔 수 있으므로 화면에서 그 사실을 밝혀야 한다.
   */
  marketUsed: boolean;
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

/** 요인 이름. 가중치 키와 1:1 로 대응한다. */
export const FEATURES = [
  "market",
  "ratingRank",
  "recentForm",
  "style",
  "jockey",
  "trainer",
  "budam",
  "gate",
  "rest",
  "earlySpeed",
  "lateSpeed",
  "accel",
  "relativeAge",
  "sex",
  "origin",
] as const satisfies readonly (keyof Weights)[];

export type FeatureLogits = Record<keyof Weights, number>;

/**
 * 요인별 로그오즈를 말마다 하나씩 뽑는다. 가중합 이전 단계다.
 *
 * 가중치·온도를 다시 적합하려면 이 행렬과 착순만 있으면 된다. 통계 재구축 없이
 * 가중치만 바꿔 가며 우도를 잴 수 있도록 분리해 뒀다 (`scripts/fit-weights.mjs`).
 * 여기가 요인 정의의 유일한 출처이므로, 적합 스크립트와 실제 예측이 어긋날 수 없다.
 */
export function featureLogits(
  candidates: Candidate[],
  stats: StatsBundle,
  rcDist: number,
): { logits: FeatureLogits[]; ratingImputed: boolean[]; market: MarketRead } {
  const emptyMarket: MarketRead = { probs: [], overround: 0, usable: false };
  if (candidates.length === 0) {
    return { logits: [], ratingImputed: [], market: emptyMarket };
  }

  const base = stats.base;
  const horseMap = toLookup(stats.horse);
  const jockeyMap = toLookup(stats.jockey);
  const trainerMap = toLookup(stats.trainer);
  const gateMap = toLookup(stats.gateByBand);
  const ratingRankMap = toLookup(stats.ratingRank);
  const restMap = toLookup(stats.restBand);
  const budamMap = toLookup(stats.budamBand);
  const styleMap = toLookup(stats.runningStyle);

  const earlyMap = toLookup(stats.earlySpeed);
  const lateMap = toLookup(stats.lateSpeed);
  const accelMap = toLookup(stats.accel);
  const relAgeMap = toLookup(stats.relativeAge);
  const sexMap = toLookup(stats.sex);
  const originMap = toLookup(stats.origin);

  const ratings = imputeRatings(candidates);
  const band = distanceBand(rcDist);

  const budamValues = candidates.map((c) => c.wgBudam).filter((v) => v > 0);
  const minBudam = budamValues.length ? Math.min(...budamValues) : 0;

  const ages = candidates.map((c) => c.age).filter((v) => v > 0);
  const minAge = ages.length ? Math.min(...ages) : 0;

  // 경주 내 레이팅 순위 (1 = 최고). 동점은 같은 순위로 둔다.
  const sortedRatings = [...ratings.map((r) => r.rating)].sort((a, b) => b - a);

  /*
   * 시장 내재 확률. 배당판이 아직 얇으면 usable=false 로 오고, 그때는 시장 항을
   * 기저율로 채워 사실상 무력화한다. 얇은 배당을 그대로 믿으면 화면의 픽이 발매
   * 시간에 따라 널뛴다.
   */
  const market = marketProbabilities(candidates.map((c) => c.winOdds));

  const logits = candidates.map((c, i) => {
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
        ? shrink(c.lastYearTop2, c.lastYearStarts, base)
        : lookup(horseMap, c.hrNo, base);
    // 각질을 모르는 말(첫 출전)은 기저율로 둔다. 불리하게 깎지 않는다.
    const pStyle = c.style ? lookup(styleMap, c.style, base) : base;
    const pJockey = lookup(jockeyMap, c.jkName, base);
    const pTrainer = lookup(trainerMap, c.trName, base);
    const pBudam =
      c.wgBudam > 0 && minBudam > 0
        ? lookup(budamMap, budamBand(c.wgBudam - minBudam), base)
        : base;
    const pGate = c.chulNo > 0 ? lookup(gateMap, `${band} · ${c.chulNo}번`, base) : base;
    const pRest = lookup(restMap, restBand(c.restDays), base);

    /*
     * 구간 지표는 과거 2전 이상이 있어야 판정된다. 없으면 기저율로 둔다 —
     * 0 을 주면 그 말이 최악이라고 단정하는 셈이고 소프트맥스에서 부당하게 깎인다.
     * 첫 출전마를 각질에서 다루는 방식과 같다.
     */
    const pEarly = c.earlySpeed != null ? lookup(earlyMap, speedBand(c.earlySpeed), base) : base;
    const pLate = c.lateSpeed != null ? lookup(lateMap, speedBand(c.lateSpeed), base) : base;
    const pAccel = c.accel != null ? lookup(accelMap, speedBand(c.accel), base) : base;
    const pRelAge =
      c.age > 0 && minAge > 0 ? lookup(relAgeMap, relativeAgeBand(c.age - minAge), base) : base;
    const pSex = c.sex ? lookup(sexMap, c.sex, base) : base;
    const pOrigin = c.origin ? lookup(originMap, c.origin, base) : base;

    /*
     * 배당판을 못 믿으면 시장 항을 균등 확률로 채운다. 모든 말이 같은 값을 받으므로
     * 소프트맥스에서 상수처럼 상쇄되어 결과에 영향을 주지 않는다. 가중치를 0 으로
     * 돌리는 것과 같지만, 요인 행렬의 모양이 항상 같아 적합 스크립트가 단순해진다.
     */
    const pMarket = market.probs[i] ?? 1 / candidates.length;

    return {
      market: logit(pMarket),
      ratingRank: logit(pRatingRank),
      recentForm: logit(pForm),
      style: logit(pStyle),
      jockey: logit(pJockey),
      trainer: logit(pTrainer),
      budam: logit(pBudam),
      gate: logit(pGate),
      rest: logit(pRest),
      earlySpeed: logit(pEarly),
      lateSpeed: logit(pLate),
      accel: logit(pAccel),
      relativeAge: logit(pRelAge),
      sex: logit(pSex),
      origin: logit(pOrigin),
    };
  });

  return { logits, ratingImputed: ratings.map((r) => r.imputed), market };
}

/**
 * 가중 합산 점수. 소프트맥스 이전 단계다.
 */
export function rawScores(
  candidates: Candidate[],
  stats: StatsBundle,
  rcDist: number,
  weights: Weights = DEFAULT_WEIGHTS,
): { scores: number[]; ratingImputed: boolean[]; market: MarketRead } {
  const { logits, ratingImputed, market } = featureLogits(candidates, stats, rcDist);
  const scores = logits.map((row) =>
    FEATURES.reduce((sum, k) => sum + weights[k] * row[k], 0),
  );
  return { scores, ratingImputed, market };
}

/**
 * 점수를 확률로. 온도를 곱한 뒤 소프트맥스한다.
 *
 * 최대값을 빼서 지수 폭주를 막는다.
 */
export function softmaxWin(scores: number[], temperature = TEMPERATURE): number[] {
  const scaled = scores.map((s) => s * temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * 배당판 상태에 따라 모델을 고른다.
 *
 * 두 가중치 집합은 각자의 정보 조건에서 따로 적합한 것이라 섞어 쓰면 안 된다.
 * 배당이 없는데 MARKET_MODEL 을 쓰면 각질·레이팅 가중치가 0 이라 남은 요인이
 * 거의 없어지고, 배당이 있는데 NO_MARKET_MODEL 을 쓰면 가장 강한 변수를 버린다.
 */
export function selectModel(marketUsable: boolean): Model {
  return marketUsable ? MARKET_MODEL : NO_MARKET_MODEL;
}

export function predictRace(
  candidates: Candidate[],
  stats: StatsBundle,
  rcDist: number,
  /** 생략하면 배당판 상태를 보고 자동으로 고른다. 실험할 때만 직접 넘긴다. */
  override?: Model,
): Prediction[] {
  if (candidates.length === 0) return [];

  const { logits, ratingImputed, market } = featureLogits(candidates, stats, rcDist);
  const model = override ?? selectModel(market.usable);
  const scores = logits.map((row) =>
    FEATURES.reduce((sum, k) => sum + model.weights[k] * row[k], 0),
  );
  const win = softmaxWin(scores, model.temperature);

  const withProb = candidates.map((c, i) => ({
    hrNo: c.hrNo,
    hrName: c.hrName,
    chulNo: c.chulNo,
    marketUsed: market.usable,
    // 한 경주의 복승 적중은 2두이므로 2배 스케일한다. 우승 확률은 스케일 없이 그대로.
    top2: Math.min(Math.max(2 * win[i], 0.01), 0.95),
    win: win[i],
    rank: 0,
    ratingImputed: ratingImputed[i],
    style: c.style,
  }));

  return [...withProb]
    .sort((a, b) => b.top2 - a.top2)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
