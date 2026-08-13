import "server-only";

import { monthTtl } from "./cache";
import { cachedCall } from "./client";
import { currentYearMonthKst, shiftMonth } from "./month";
import { num } from "./horse";
import type { KraRow } from "./types";

/**
 * 최근 N개월 경주기록 수집.
 *
 * `numOfRows=2000` 이면 한 달(최대 1,067행 관측)이 단일 호출로 들어온다.
 * 페이지네이션이 필요 없고 실측 0.9초. 3개월이면 3콜이고, 캐시가 살아 있으면 0콜이다.
 */

const MONTH_ROWS = 2000;
const MONTH_TIMEOUT_MS = 60_000;

/**
 * Next Data Cache 재사용 시간.
 *
 * 디스크 캐시는 `process.cwd()` 에 쓰므로 Vercel 서버리스에서는 쓰기가 조용히
 * 실패하고 읽기는 늘 미스다. 그러면 방문마다 6콜이 나가 일일 한도를 태운다.
 * Next 의 Data Cache 는 그 환경에서도 동작하므로 2차 캐시로 함께 쓴다.
 * 과거 월은 불변이고 이번 달도 주말에만 늘어나므로 하루면 충분하다.
 */
const MONTH_REVALIDATE_SECONDS = 6 * 60 * 60;

export interface HistoryLoad {
  /** 시행이 끝난 행만. 미시행 행(ord=0)은 통계를 오염시키므로 제외한다. */
  rows: KraRow[];
  months: string[];
  /** 월별 수집 결과. 화면에서 캐시 절약 효과를 보여준다. */
  detail: { month: string; rows: number; fromCache: boolean }[];
}

/** 최근 n개월의 `YYYYMM` 목록. 이번 달 포함, 과거로 거슬러 간다. */
export function recentMonths(n: number, from = currentYearMonthKst()): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(from, -i)).reverse();
}

/** 기본 6개월. 3개월은 경주일이 20일뿐이라 각질·페이스 표본이 부족했다. */
export const DEFAULT_MONTHS = 6;

export async function loadRecentResults(
  n = DEFAULT_MONTHS,
  fresh = false,
): Promise<HistoryLoad> {
  const current = currentYearMonthKst();
  const months = recentMonths(n, current);

  const loaded = await Promise.all(
    months.map(async (month) => {
      const result = await cachedCall(
        "race-result",
        {
          numOfRows: MONTH_ROWS,
          extra: { rc_month: month },
          timeoutMs: MONTH_TIMEOUT_MS,
          revalidateSeconds: fresh ? undefined : MONTH_REVALIDATE_SECONDS,
        },
        `race-result-${month}-meet1`,
        monthTtl(month, current),
        { fresh },
      );
      return { month, result };
    }),
  );

  const rows: KraRow[] = [];
  const detail: HistoryLoad["detail"] = [];
  for (const { month, result } of loaded) {
    // 착순이 매겨진 행만 분석 대상이다. 경주기록 응답에는 시행 전 경주도 섞여 온다.
    const finished = result.rows.filter((r) => num(r.ord) > 0);
    rows.push(...finished);
    detail.push({ month, rows: finished.length, fromCache: result.fromCache === true });
  }

  return { rows, months, detail };
}
