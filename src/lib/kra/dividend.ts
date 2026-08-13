import "server-only";

import { TTL } from "./cache";
import { cachedCall } from "./client";
import { num, str } from "./horse";
import { pairKey } from "./quinella";
import type { KraRow } from "./types";

/**
 * 확정배당 조회 (API179_1 / salesAndDividendRate_1).
 *
 * 복승식 행은 `pool="복식"`, `odds="①⑧-9.7"` 형식이다. 원문자(U+2460~U+2473)가
 * 1~20 마번에 대응한다.
 *
 * 적중률이 높아도 배당이 낮으면 손실이므로, 이 값이 없으면 모델이 실제로
 * 돈이 되는지 알 수 없다. ROI 계산의 유일한 근거다.
 */

const CIRCLED_START = 0x2460; // ①

/** `①⑧` → `[1, 8]`. 원문자가 아닌 문자는 무시한다. */
export function parseCircledNumbers(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code == null) continue;
    const n = code - CIRCLED_START + 1;
    if (n >= 1 && n <= 20) out.push(n);
  }
  return out;
}

export interface QuinellaDividend {
  rcNo: number;
  pair: [number, number];
  odds: number;
  /** 발매금액. 시장 규모 참고용. */
  amount: number;
}

/**
 * 한 행에 들어 있는 복승 배당을 **모두** 파싱한다.
 *
 * 대개 `①⑧-9.7` 한 건이지만, **동착이면 여러 건이 공백으로 이어져 온다** —
 * `④⑦-2.7  ④⑥-3.4` 처럼 2착이 둘이면 적중 조합도 둘이고 배당도 각각 다르다.
 * 첫 건만 읽으면 나머지 조합이 배당 없는 경주로 취급되어 손익 계산에서 통째로
 * 빠지고, 그 조합을 맞혔더라도 적중이 정산되지 않는다. 실측 120경주 중 2경주가
 * 여기에 해당했다.
 */
export function parseQuinellaOdds(raw: string): { pair: [number, number]; odds: number }[] {
  const out: { pair: [number, number]; odds: number }[] = [];
  for (const m of raw.matchAll(/([^\d\s-]+)\s*-\s*([\d.]+)/g)) {
    const nums = parseCircledNumbers(m[1]);
    const odds = Number(m[2]);
    if (nums.length !== 2 || !Number.isFinite(odds) || odds <= 0) continue;
    out.push({ pair: [nums[0], nums[1]], odds });
  }
  return out;
}

/**
 * 승식 코드.
 *
 * `복식` = 복승식(1·2착 두 마리). 경주당 적중 조합 1개(동착이면 여러 개).
 * `복연` = 복연승식(고른 두 마리가 모두 3착 이내). 1·2 / 1·3 / 2·3 세 조합이 적중한다.
 */
export type QuinellaPool = "복식" | "복연";

function toDividendsOf(rows: KraRow[], pool: QuinellaPool): Map<string, QuinellaDividend> {
  const map = new Map<string, QuinellaDividend>();
  for (const row of rows) {
    if (str(row.pool) !== pool) continue;
    const rcNo = num(row.rcNo);
    for (const parsed of parseQuinellaOdds(str(row.odds))) {
      map.set(`${rcNo}:${pairKey(parsed.pair[0], parsed.pair[1])}`, {
        rcNo,
        pair: parsed.pair,
        odds: parsed.odds,
        amount: num(row.amt),
      });
    }
  }
  return map;
}

/**
 * 이 데이터셋만 타임아웃을 짧게 잡는 이유.
 *
 * 지난 픽 화면이 경주일마다 이 함수를 부르므로 콜드 렌더에 20콜쯤이 **동시에**
 * 나가고, 전체 응답 시간은 그중 가장 느린 하나가 결정한다. 제공 측 응답은
 * 오래된 날짜일수록 느려서 실측상 20260628 은 18.8초, 20260606·20260706 은
 * 30초를 넘겨 타임아웃까지 갔다. 30초로 두면 만성적으로 느린 날짜 하나 때문에
 * 화면 전체가 30초를 기다리고 배포 환경의 함수 타임아웃에 걸린다.
 *
 * 짧게 끊으면 그 날짜는 이번에 못 받지만, 실패는 캐시하지 않으므로 다음 방문에
 * 다시 시도한다. 성공한 날짜는 캐시에 쌓이므로 커버리지는 시간이 갈수록 는다.
 * 못 받은 경주는 베팅에서 통째로 빠질 뿐 손익을 왜곡하지 않는다.
 */
const DIVIDEND_TIMEOUT_MS = 15_000;

/**
 * 하루치 복승 확정배당. 경주일당 1콜이며 과거는 불변이라 길게 캐시한다.
 * 키는 `경주번호:작은마번-큰마번`.
 *
 * 디스크 캐시는 배포 환경(Vercel)에서 동작하지 않으므로 Next Data Cache
 * 재사용 시간을 함께 준다. 확정된 배당은 바뀌지 않는다.
 */
export async function loadQuinellaDividends(
  rcDate: string,
): Promise<Map<string, QuinellaDividend>> {
  return (await loadDividends(rcDate)).quinella;
}

/**
 * 승식의 환급률 — 그 경주의 **전 조합을 다 샀을 때** 돌아오는 비율.
 *
 * 파리뮤추얼에서 모든 조합을 1단위씩 사면 비용은 조합 수, 회수는 적중 조합의
 * 배당이다. 여러 경주에 걸쳐 평균하면 주최 측 공제를 뺀 환급률에 수렴한다.
 * 공제율 = 1 − 이 값이며, **어떤 전략이든 여기서 출발한다**. 예측이 아무리 좋아도
 * 이 세금을 넘지 못하면 장기적으로 진다.
 *
 * **적중 조합이 여럿이면 배당을 더한다.** 전 조합을 샀다면 그 여럿을 모두 들고
 * 있기 때문이다. 복연승은 1·2 / 1·3 / 2·3 세 조합이 항상 함께 적중하고, 복승도
 * 동착이면 둘이 적중한다. 하나만 세면 복연승 환급률이 1/3 로 찍힌다.
 */
export function poolPayback(races: { combos: number; payouts: number[] }[]): number | null {
  let cost = 0;
  let returned = 0;
  for (const r of races) {
    if (r.combos <= 0 || r.payouts.length === 0) continue;
    cost += r.combos;
    returned += r.payouts.reduce((a, b) => a + b, 0);
  }
  return cost > 0 ? returned / cost : null;
}

/**
 * 하루치 복승·복연승 확정배당을 한 번의 호출로 가져온다.
 *
 * 응답은 승식별로 한 행씩(단식·연식·복식·복연·쌍식·삼복·삼쌍) 내려오므로 이미
 * 받아 온 것을 두 번 파싱하면 된다. 복연승은 **베팅 대상이 아니라 계측용**이다 —
 * 실측 환급률이 복승 73.9% 대 복연 68.4% 로 세금이 더 비싸다. 대신 적중 조합이
 * 경주당 3개라 분산이 훨씬 작아, 같은 베팅 수로 우위를 더 빨리 가려낼 수 있다.
 */
export async function loadDividends(rcDate: string): Promise<{
  quinella: Map<string, QuinellaDividend>;
  placeQuinella: Map<string, QuinellaDividend>;
}> {
  const result = await cachedCall(
    "betting-sales",
    {
      numOfRows: 200,
      extra: { rc_date: rcDate },
      timeoutMs: DIVIDEND_TIMEOUT_MS,
      revalidateSeconds: 24 * 60 * 60,
    },
    `dividend-${rcDate}-meet1`,
    TTL.pastMonth,
  );
  return {
    quinella: toDividendsOf(result.rows, "복식"),
    placeQuinella: toDividendsOf(result.rows, "복연"),
  };
}
