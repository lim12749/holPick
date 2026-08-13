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

/**
 * `①⑧` → `[1, 8]`, `②(16)` → `[2, 16]`.
 *
 * **16번마는 원문자가 아니라 ASCII `(16)` 으로 온다.** 실측 3,098경주의 배당 문자열을
 * 전수 조사하니 쓰인 원문자는 ①~⑮ 뿐이고 ⑯(U+246F) 이상은 한 번도 나오지 않았다.
 * 대신 16두 경주(20231217 8R) 에서만 괄호 표기가 나왔다:
 *   복연 `②(16)-2.3  ②⑦-2.5  ⑦(16)-5.6`
 * 원문자만 읽으면 그 경주의 당첨 3개 중 2개를 잃는다.
 */
export function parseCircledNumbers(text: string): number[] {
  const out: number[] = [];
  // 왼쪽부터 위치 순으로 훑는다. 괄호를 먼저 걷어내면 `②(16)` 이 [16, 2] 가 되는데,
  // 복승·쌍승은 마번 순서가 **착순**이라 순서가 뒤집히면 의미가 달라진다.
  for (const m of text.matchAll(/\((\d+)\)|([①-⑳])/g)) {
    if (m[1] != null) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 30) out.push(n);
    } else if (m[2] != null) {
      out.push(m[2].codePointAt(0)! - CIRCLED_START + 1);
    }
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
  return parsePoolOdds(raw, 2).map((e) => ({ pair: [e.horses[0], e.horses[1]] as [number, number], odds: e.odds }));
}

/**
 * 승식 무관 배당 파서. 엔트리당 말이 1·2·3 마리인 모든 승식을 읽는다.
 *
 * 기존 `parseQuinellaOdds` 는 `nums.length === 2` 로 못 박혀 있어서 **단식·연식(1마리)과
 * 삼복·삼쌍(3마리)을 조용히 전부 버렸다** — 각 3,098경주 전량이 빈 배열로 나왔고
 * 오류도 로그도 없었다. 승식을 비교하려면 이 제약을 풀어야 한다.
 *
 * 형식: `<말들><->  <배당>` 을 공백 두 칸으로 이어 붙인다. 말은 구분자 없이 붙어 온다.
 *   단식 `⑨-3.6`                      1마리 · 보통 1엔트리 (1착 동착이면 2)
 *   연식 `②-1.2  ⑨-1.2  ⑤-1.4`        1마리 · 보통 3엔트리
 *   복식 `⑨②-3.7`                     2마리 · 보통 1엔트리
 *   복연 `⑨②-1.6  ②⑤-1.8  ⑨⑤-2.3`    2마리 · 보통 3엔트리
 *
 * **엔트리 개수를 하드코딩하지 않는다.** 연식은 출주 7두 이하면 2엔트리, 3착 동착이면
 * 4엔트리다(실측 3,098경주 중 12경주). 복연도 4두가 3착 이내면 C(4,2)=6 엔트리가 온다.
 */
export function parsePoolOdds(
  raw: string,
  horsesPerEntry: 1 | 2 | 3,
): { horses: number[]; odds: number }[] {
  const out: { horses: number[]; odds: number }[] = [];
  // `[^\d\s-]+` 로는 `(16)` 을 못 잡는다(숫자·괄호 포함). 말 토큰을 명시적으로 나열한다.
  for (const m of raw.matchAll(/((?:\((?:\d+)\)|[①-⑳])+)\s*-\s*([\d.]+)/g)) {
    const horses = parseCircledNumbers(m[1]);
    const odds = Number(m[2]);
    if (horses.length !== horsesPerEntry || !Number.isFinite(odds) || odds <= 0) continue;
    out.push({ horses, odds });
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

/** 말 1마리를 고르는 승식. `단식` = 1착, `연식` = 3착 이내(7두 이하면 2착 이내). */
export type SinglePool = "단식" | "연식";

/**
 * 승식별 엔트리당 말 수. 응답에 실린 7개 승식 전부를 적어 둔다.
 *
 * 쌍식·삼복·삼쌍은 이번 분석 범위 밖이지만, 값을 여기 남겨 두면 나중에 붙일 때
 * 다시 조사하지 않아도 된다. **쌍식·삼쌍은 순서가 의미를 갖는다** — 마번을 정렬해
 * 키를 만들면 `③⑨-12.9` 와 `⑨③-22.6`(20240707 7R) 이 한 칸으로 뭉개져 배당 하나가
 * 사라지므로, 붙일 때는 정렬하지 않은 튜플로 키를 만들어야 한다.
 */
export const POOL_ENTRY_SIZE = {
  단식: 1,
  연식: 1,
  복식: 2,
  복연: 2,
  쌍식: 2,
  삼복: 3,
  삼쌍: 3,
} as const;

/**
 * 말 1마리 승식(단식·연식)을 `경주번호:마번` → 배당 맵으로.
 *
 * 연식은 보통 3엔트리(1·2·3착 각각의 배당)라, 고른 말이 3착 안에 들면 **그 말의**
 * 배당을 받는다. 복승처럼 조합 하나가 아니라 말마다 값이 다르다는 점이 다르다.
 */
export function toSingleDividendsOf(
  rows: KraRow[],
  pool: SinglePool,
): Map<string, { rcNo: number; horse: number; odds: number; amount: number }> {
  const map = new Map<string, { rcNo: number; horse: number; odds: number; amount: number }>();
  for (const row of rows) {
    if (str(row.pool) !== pool) continue;
    const rcNo = num(row.rcNo);
    for (const e of parsePoolOdds(str(row.odds), 1)) {
      map.set(`${rcNo}:${e.horses[0]}`, {
        rcNo,
        horse: e.horses[0],
        odds: e.odds,
        amount: num(row.amt),
      });
    }
  }
  return map;
}

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
