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

/** `①⑧-9.7` 한 건을 파싱한다. 형식이 다르면 null. */
export function parseQuinellaOdds(raw: string): { pair: [number, number]; odds: number } | null {
  const m = raw.match(/^([^\d\s-]+)\s*-\s*([\d.]+)/);
  if (!m) return null;
  const nums = parseCircledNumbers(m[1]);
  const odds = Number(m[2]);
  if (nums.length !== 2 || !Number.isFinite(odds) || odds <= 0) return null;
  return { pair: [nums[0], nums[1]], odds };
}

function toDividends(rows: KraRow[]): Map<string, QuinellaDividend> {
  const map = new Map<string, QuinellaDividend>();
  for (const row of rows) {
    if (str(row.pool) !== "복식") continue;
    const parsed = parseQuinellaOdds(str(row.odds));
    if (!parsed) continue;
    const rcNo = num(row.rcNo);
    map.set(`${rcNo}:${pairKey(parsed.pair[0], parsed.pair[1])}`, {
      rcNo,
      pair: parsed.pair,
      odds: parsed.odds,
      amount: num(row.amt),
    });
  }
  return map;
}

/**
 * 하루치 복승 확정배당. 경주일당 1콜이며 과거는 불변이라 길게 캐시한다.
 * 키는 `경주번호:작은마번-큰마번`.
 */
export async function loadQuinellaDividends(
  rcDate: string,
): Promise<Map<string, QuinellaDividend>> {
  const result = await cachedCall(
    "betting-sales",
    { numOfRows: 200, extra: { rc_date: rcDate }, timeoutMs: 30_000 },
    `dividend-${rcDate}-meet1`,
    TTL.pastMonth,
  );
  return toDividends(result.rows);
}
