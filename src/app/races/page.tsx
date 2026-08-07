import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { callKra } from "@/lib/kra/client";
import { formatRaceDate, groupByDate } from "@/lib/kra/entry";
import { currentYearMonthKst, dayDiff, relativeDayLabel, shiftMonth, todayKst } from "@/lib/kra/month";

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
  const explicitMonth = /^\d{6}$/.test(month ?? "") ? (month as string) : null;
  const today = todayKst();

  /**
   * 출전표는 임박한 경주만, 경주기록은 시행 전후 모두 담고 있다.
   * 둘을 합쳐야 지난 경주일과 다가올 경주일이 한 달력에 함께 보인다.
   */
  const fetchMonth = async (ym: string) => {
    const opts = {
      numOfRows: MONTH_ROWS,
      extra: { rc_month: ym },
      timeoutMs: MONTH_TIMEOUT_MS,
      revalidateSeconds: MONTH_REVALIDATE_SEC,
    };
    const [entry, result] = await Promise.all([
      callKra("entry-list", opts),
      callKra("race-result", opts),
    ]);
    // 같은 날짜가 양쪽에 있으면 groupByDate 가 합산해버리므로, 경주기록에만 있는
    // 날짜(= 지난 경주일)만 골라 덧붙인다.
    const entryDates = new Set(entry.rows.map((r) => String(r.rcDate ?? "")));
    const extraRows = result.rows.filter((r) => !entryDates.has(String(r.rcDate ?? "")));
    return {
      status: entry.status,
      message: entry.message,
      hint: entry.hint,
      rows: [...entry.rows, ...extraRows],
    };
  };

  let yearMonth = explicitMonth ?? currentYearMonthKst();
  let result = await fetchMonth(yearMonth);
  let dates = groupByDate(result.rows);

  // 월말에는 다가올 경주가 다음 달로 넘어간다. 사용자가 달을 직접 고르지 않았다면
  // 이번 달에 남은 경주가 없을 때 다음 달을 대신 보여준다.
  if (!explicitMonth && !dates.some((d) => dayDiff(today, d.rcDate) >= 0)) {
    const nextMonth = shiftMonth(yearMonth, 1);
    const nextResult = await fetchMonth(nextMonth);
    const nextDates = groupByDate(nextResult.rows);
    if (nextDates.length > 0) {
      yearMonth = nextMonth;
      result = nextResult;
      dates = nextDates;
    }
  }
  const label = `${yearMonth.slice(0, 4)}년 ${Number(yearMonth.slice(4))}월`;

  // 가장 가까운 다가올 경주일. 출전표는 임박한 경주만 실리므로 대개 이번 주말이다.
  const next = dates.find((d) => dayDiff(today, d.rcDate) >= 0) ?? null;
  const nextRaceDate = next?.rcDate ?? null;

  return (
    <>
      <PageHeader
        title="출전표"
        description="서울 경마장 편성. 마사회는 임박한 경주만 공개하므로 대개 이번 주말 이틀만 조회됩니다."
        actions={<StatusBadge status={result.status} />}
      />

      {next && (
        <Link
          href={`/races/${next.rcDate}`}
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent bg-surface px-4 py-3 hover:bg-surface-muted"
        >
          <div>
            <p className="text-xs text-muted">다가올 경주</p>
            <p className="mt-0.5 font-semibold">
              {relativeDayLabel(next.rcDate, today)} · {formatRaceDate(next.rcDate)} {next.rcDay}
            </p>
          </div>
          <p className="text-sm text-muted">
            {next.raceCount}경주 · {next.entryCount}두 출전 <span className="text-accent">→</span>
          </p>
        </Link>
      )}

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
            출전표는 경주 며칠 전에야 공개되므로, 먼 미래의 달은 비어 있는 것이 정상입니다.
            위 화살표로 다른 달을 확인하거나,{" "}
            <Link href="/diagnostics" className="text-accent hover:underline">
              API 진단
            </Link>
            에서 연결 상태를 보세요.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dates.map((d) => {
            const rel = relativeDayLabel(d.rcDate, today);
            const isNext = d.rcDate === nextRaceDate;
            const isPast = dayDiff(today, d.rcDate) < 0;
            return (
              <li key={d.rcDate}>
                <Link
                  href={`/races/${d.rcDate}`}
                  className={`block rounded-lg border bg-surface p-4 hover:border-accent ${
                    isNext ? "border-accent" : "border-border"
                  } ${isPast ? "opacity-60" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-lg font-semibold">{formatRaceDate(d.rcDate)}</p>
                    {rel && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          isNext ? "bg-accent text-white" : "bg-surface-muted text-muted"
                        }`}
                      >
                        {rel}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {d.rcDay}
                    {isPast && " · 종료"}
                  </p>
                  <p className="mt-3 text-sm">
                    <span className="font-medium">{d.raceCount}</span>
                    <span className="text-muted"> 경주 · </span>
                    <span className="font-medium">{d.entryCount}</span>
                    <span className="text-muted">두 출전</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
