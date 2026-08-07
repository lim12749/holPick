import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import { formatRaceDate, formatStartTime, groupByRace } from "@/lib/kra/entry";
import { formatPrize } from "@/lib/kra/horse";

export const dynamic = "force-dynamic";

export default async function RaceDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{8}$/.test(date)) notFound();

  // 하루 편성은 넉넉히 200행이면 전부 담긴다 (11~12경주 × 12두 남짓).
  // 편성표는 확정된 자료라 실시간일 필요가 없다. 제공 측 응답이 느릴 때가 있어
  // 여유 있게 기다리되 결과는 5분간 재사용한다.
  const result = await callKra("entry-list", {
    numOfRows: 200,
    extra: { rc_date: date },
    timeoutMs: 30_000,
    revalidateSeconds: 300,
  });

  const races = groupByRace(result.rows);

  return (
    <>
      <PageHeader
        title={formatRaceDate(date)}
        description={races[0] ? `${races[0].card.meet} · ${races[0].card.rcDay}` : undefined}
        actions={
          <Link href="/races" className="text-sm text-accent hover:underline">
            ← 출전표
          </Link>
        }
      />

      {races.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">이 날짜에 편성된 경주가 없습니다.</p>
          {result.hint && <p className="mt-2 text-sm text-muted">{result.hint}</p>}
          <Link href="/races" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 다른 날짜 보기
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {races.map(({ card, entries }) => (
            <li key={card.rcNo}>
              <Link
                href={`/races/${date}/${card.rcNo}`}
                className="block h-full rounded-lg border border-border bg-surface p-4 hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">
                    {card.rcNo}경주
                    {card.rcName && <span className="ml-2 text-sm font-normal">{card.rcName}</span>}
                  </p>
                  <p className="shrink-0 text-sm text-muted">{formatStartTime(card.stTime)}</p>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">거리</dt>
                    <dd className="mt-0.5 font-medium">{card.rcDist}m</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">등급</dt>
                    <dd className="mt-0.5 font-medium">{card.rank || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">출전</dt>
                    <dd className="mt-0.5 font-medium">
                      {entries.length}두
                      {card.dusu > 0 && card.dusu !== entries.length && (
                        <span className="text-muted"> / 편성 {card.dusu}</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {card.prizes[0] > 0 && (
                  <p className="mt-3 text-xs text-muted">1착 상금 {formatPrize(card.prizes[0])}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
