import "server-only";

import { TTL } from "./cache";
import { cachedCall } from "./client";
import { toDividendsOf, type QuinellaDividend } from "./dividend-parse";

/**
 * 확정배당 조회 (API179_1 / salesAndDividendRate_1).
 *
 * 적중률이 높아도 배당이 낮으면 손실이므로, 이 값이 없으면 모델이 실제로
 * 돈이 되는지 알 수 없다. ROI 계산의 유일한 근거다.
 *
 * 파싱 규칙은 `dividend-parse.ts` 에 있다. 이 파일은 `server-only` 라 Node
 * 스크립트에서 import 할 수 없어서, 오프라인 분석과 화면이 같은 파서를 쓰도록
 * 순수 부분을 그쪽으로 내려 두었다.
 */

// 호출부가 어느 쪽을 import 하든 되도록 파싱부를 그대로 다시 내보낸다.
export {
  parseCircledNumbers,
  parseQuinellaOdds,
  poolPayback,
  toDividendsOf,
  type QuinellaDividend,
  type QuinellaPool,
} from "./dividend-parse";

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
 *
 * 백필 스크립트는 한 번에 하나씩 느긋하게 받으면 되므로 이 값을 쓰지 않는다.
 */
export const DIVIDEND_TIMEOUT_MS = 15_000;

/** 하루치 확정배당 캐시 키. 백필 스크립트와 공유한다. */
export function dividendCacheKey(rcDate: string): string {
  return `dividend-${rcDate}-meet1`;
}

/**
 * 하루치 복승 확정배당. 경주일당 1콜이며 과거는 불변이라 길게 캐시한다.
 * 키는 `경주번호:작은마번-큰마번`.
 */
export async function loadQuinellaDividends(
  rcDate: string,
): Promise<Map<string, QuinellaDividend>> {
  return (await loadDividends(rcDate)).quinella;
}

/**
 * 하루치 복승·복연승 확정배당을 한 번의 호출로 가져온다.
 *
 * 응답은 승식별로 한 행씩(단식·연식·복식·복연·쌍식·삼복·삼쌍) 내려오므로 이미
 * 받아 온 것을 두 번 파싱하면 된다. 복연승은 **베팅 대상이 아니라 계측용**이다 —
 * 실측 환급률이 복승 73.9% 대 복연 68.4% 로 세금이 더 비싸다. 대신 적중 조합이
 * 경주당 3개라 분산이 훨씬 작아, 같은 베팅 수로 우위를 더 빨리 가려낼 수 있다.
 *
 * 디스크 캐시는 배포 환경(Vercel)에서 동작하지 않으므로 Next Data Cache
 * 재사용 시간을 함께 준다. 확정된 배당은 바뀌지 않는다.
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
    dividendCacheKey(rcDate),
    TTL.pastMonth,
  );
  return {
    quinella: toDividendsOf(result.rows, "복식"),
    placeQuinella: toDividendsOf(result.rows, "복연"),
  };
}
