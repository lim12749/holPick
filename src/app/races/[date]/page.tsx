import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import { formatRaceDate, formatStartTime, groupByRace } from "@/lib/kra/entry";
import { formatPrize } from "@/lib/kra/horse";
import { groupResultsByRace, podium, type ResultGroup } from "@/lib/kra/result";

export const dynamic = "force-dynamic";

// 편성표·경주기록 모두 확정된 자료라 실시간일 필요가 없다.
// 제공 측 응답이 느릴 때가 있어 여유 있게 기다리되 결과는 5분간 재사용한다.
const CALL_OPTS = { numOfRows: 200, timeoutMs: 30_000, revalidateSeconds: 300 } as const;

export default async function RaceDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{8}$/.test(date)) notFound();

  // 출전표는 임박한 경주만, 경주기록은 시행 전후 모두 내려온다.
  // 지난 경주일은 출전표가 비므로 경주기록만으로 화면을 채울 수 있어야 한다.
  const [entryResult, resultResult] = await Promise.all([
    callKra("entry-list", { ...CALL_OPTS, extra: { rc_date: date } }),
    callKra("race-result", { ...CALL_OPTS, extra: { rc_date: date } }),
  ]);

  const races = groupByRace(entryResult.rows);
  const resultGroups = groupResultsByRace(resultResult.rows);
  const resultByRcNo = new Map<number, ResultGroup>(resultGroups.map((g) => [g.info.rcNo, g]));

  // 출전표가 있으면 그것을, 없으면(지난 경주일) 경주기록을 목록의 근거로 삼는다.
  const cards = races.length
    ? races.map((r) => ({
        rcNo: r.card.rcNo,
        rcName: r.card.rcName,
        rcDist: r.card.rcDist,
        rank: r.card.rank,
        stTime: formatStartTime(r.card.stTime),
        count: r.entries.length,
        plannedCount: r.card.dusu,
        prize: r.card.prizes[0],
        result: resultByRcNo.get(r.card.rcNo) ?? null,
      }))
    : resultGroups.map((g) => ({
        rcNo: g.info.rcNo,
        rcName: g.info.rcName,
        rcDist: g.info.rcDist,
        rank: g.info.rank,
        stTime: "",
        count: g.results.length,
        plannedCount: 0,
        prize: 0,
        result: g,
      }));

  const head = races[0]
    ? `${races[0].card.meet} · ${races[0].card.rcDay}`
    : resultGroups[0]
      ? `${resultGroups[0].info.meet} · ${resultGroups[0].info.rcDay}`
      : undefined;
  const trackInfo = resultGroups.find((g) => g.info.track)?.info;

  return (
    <>
      <PageHeader
        title={formatRaceDate(date)}
        description={head}
        actions={
          <Link href="/races" className="text-sm text-accent hover:underline">
            ← 출전표
          </Link>
        }
      />

      {trackInfo && (trackInfo.track || trackInfo.weather) && (
        <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
          <span className="text-muted">주로 </span>
          <span className="font-medium">{trackInfo.track || "—"}</span>
          <span className="mx-2 text-border">|</span>
          <span className="text-muted">날씨 </span>
          <span className="font-medium">{trackInfo.weather || "—"}</span>
        </p>
      )}

      {cards.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">이 날짜에 편성된 경주가 없습니다.</p>
          {entryResult.hint && <p className="mt-2 text-sm text-muted">{entryResult.hint}</p>}
          <Link href="/races" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 다른 날짜 보기
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => {
            const top3 = c.result ? podium(c.result) : [];
            return (
              <li key={c.rcNo}>
                <Link
                  href={`/races/${date}/${c.rcNo}`}
                  className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-accent"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold">
                      {c.rcNo}경주
                      {c.rcName && <span className="ml-2 text-sm font-normal">{c.rcName}</span>}
                    </p>
                    <p className="shrink-0 text-sm text-muted">
                      {top3.length > 0 ? "결과" : c.stTime}
                    </p>
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted">거리</dt>
                      <dd className="mt-0.5 font-medium">{c.rcDist}m</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">등급</dt>
                      <dd className="mt-0.5 font-medium">{c.rank || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">출전</dt>
                      <dd className="mt-0.5 font-medium">
                        {c.count}두
                        {c.plannedCount > 0 && c.plannedCount !== c.count && (
                          <span className="text-muted"> / 편성 {c.plannedCount}</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {top3.length > 0 ? (
                    <ol className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      {top3.map((r) => (
                        <li key={r.hrNo} className="flex items-baseline gap-2">
                          <span className="w-6 shrink-0 text-xs font-medium text-muted">
                            {r.ord}착
                          </span>
                          <span className="truncate font-medium">{r.hrName}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted">{r.jkName}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    c.prize > 0 && (
                      <p className="mt-3 text-xs text-muted">1착 상금 {formatPrize(c.prize)}</p>
                    )
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
