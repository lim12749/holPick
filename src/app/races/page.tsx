import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { callKra } from "@/lib/kra/client";
import { formatRaceDate, groupByDate } from "@/lib/kra/entry";
import { currentYearMonthKst, shiftMonth } from "@/lib/kra/month";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "출전표 — holPick",
};

// 한 달 편성이 여러 페이지로 잘리지 않도록 넉넉히 받는다 (관측치: 2026-08 서울 210행).
const MONTH_ROWS = 500;

/**
 * 월 단위 조회는 제공 측 응답이 1.7~29초로 널뛴다(실측). 기본 10초로는 자주
 * 타임아웃 나므로 이 화면만 넉넉히 잡고, 결과는 5분간 재사용해 반복 대기를 없앤다.
 */
const MONTH_TIMEOUT_MS = 40_000;
const MONTH_REVALIDATE_SEC = 300;

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const yearMonth = /^\d{6}$/.test(month ?? "") ? (month as string) : currentYearMonthKst();

  const result = await callKra("entry-list", {
    numOfRows: MONTH_ROWS,
    extra: { rc_month: yearMonth },
    timeoutMs: MONTH_TIMEOUT_MS,
    revalidateSeconds: MONTH_REVALIDATE_SEC,
  });

  const dates = groupByDate(result.rows);
  const label = `${yearMonth.slice(0, 4)}년 ${Number(yearMonth.slice(4))}월`;

  return (
    <>
      <PageHeader
        title="출전표"
        description="서울 경마장 편성. 경주일을 선택하면 그날의 경주 목록으로 이동합니다."
        actions={<StatusBadge status={result.status} />}
      />

      <nav className="mb-6 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
        <Link
          href={`/races?month=${shiftMonth(yearMonth, -1)}`}
          className="text-sm text-accent hover:underline"
        >
          ← 이전 달
        </Link>
        <span className="font-medium">{label}</span>
        <Link
          href={`/races?month=${shiftMonth(yearMonth, 1)}`}
          className="text-sm text-accent hover:underline"
        >
          다음 달 →
        </Link>
      </nav>

      {dates.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">{label}에 편성된 경주가 없습니다.</p>
          {result.status !== "ok" && result.status !== "no_data" && (
            <p className="mt-2 text-sm text-muted">{result.message}</p>
          )}
          {result.hint && <p className="mt-2 text-sm text-muted">{result.hint}</p>}
          <p className="mt-3 text-sm text-muted">
            위 화살표로 다른 달을 확인하거나,{" "}
            <Link href="/diagnostics" className="text-accent hover:underline">
              API 진단
            </Link>
            에서 연결 상태를 보세요.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dates.map((d) => (
            <li key={d.rcDate}>
              <Link
                href={`/races/${d.rcDate}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-accent"
              >
                <p className="text-lg font-semibold">{formatRaceDate(d.rcDate)}</p>
                <p className="mt-0.5 text-sm text-muted">{d.rcDay}</p>
                <p className="mt-3 text-sm">
                  <span className="font-medium">{d.raceCount}</span>
                  <span className="text-muted"> 경주 · </span>
                  <span className="font-medium">{d.entryCount}</span>
                  <span className="text-muted">두 출전</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
