import { num, str } from "./horse";
import { pairKey } from "./quinella";
import type { KraRow } from "./types";

/**
 * 확정배당 응답의 **순수 파싱부**. 네트워크도 캐시도 건드리지 않는다.
 *
 * `dividend.ts` 에서 분리한 이유: 그쪽은 `server-only` 라 Node 스크립트에서
 * import 하면 즉시 throw 한다. 오프라인 분석 스크립트가 배당을 읽으려면 파서를
 * 복제하는 수밖에 없는데, 동착 처리 같은 규칙이 갈라지면 백테스트 손익이 화면과
 * 달라진다. 순수 부분만 leaf 모듈로 내려 두면 양쪽이 같은 코드를 부른다.
 *
 * 복승식 행은 `pool="복식"`, `odds="①⑧-9.7"` 형식이다. 원문자(U+2460~U+2473)가
 * 1~20 마번에 대응한다.
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

/** 승식 하나를 골라 `경주번호:작은마번-큰마번` → 배당 맵으로. */
export function toDividendsOf(
  rows: KraRow[],
  pool: QuinellaPool,
): Map<string, QuinellaDividend> {
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
 *
 * **분모는 실제 출주두수의 조합 수여야 한다.** 출전표 기준(취소마 포함)으로 세면
 * 팔지도 않은 조합까지 비용에 넣는 것이라 환급률이 낮게 나온다 — 실측으로
 * 출주 기준 0.7387 대 출전표 기준 0.7057 로 4.7%p 차이가 났고, 이는 우리가 쫓는
 * 우위보다 큰 폭이다.
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
