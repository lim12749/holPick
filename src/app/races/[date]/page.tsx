import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import { formatRaceDate, formatStartTime, groupByRace } from "@/lib/kra/entry";
import { loadRecentResults } from "@/lib/kra/history";
import { formatPrize, str } from "@/lib/kra/horse";
import {
  actualPair,
  buildRacePick,
  isPickHit,
  mergeRunners,
  predictionRunners,
  toCandidates,
  type HorseTraits,
} from "@/lib/kra/pick";
import { buildSectionalHistory } from "@/lib/kra/sectional";
import type { QuinellaPick } from "@/lib/kra/quinella";
import { groupResultsByRace, podium, type ResultGroup } from "@/lib/kra/result";
import { buildStatsBundle } from "@/lib/kra/stats";
import { buildStyleHistory } from "@/lib/kra/style";

export const dynamic = "force-dynamic";

// 편성표·경주기록 모두 확정된 자료라 실시간일 필요가 없다.
// 제공 측 응답이 느릴 때가 있어 여유 있게 기다리되 결과는 5분간 재사용한다.
const CALL_OPTS = { numOfRows: 200, timeoutMs: 30_000, revalidateSeconds: 300 } as const;

export default async function RaceDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{8}$/.test(date)) notFound();

  // 출전표는 임박한 경주만, 경주기록은 시행 전후 모두 내려온다.
  // 지난 경주일은 출전표가 비므로 경주기록만으로 화면을 채울 수 있어야 한다.
  // 예측 통계는 6개월 기록에서 만든다. 디스크 캐시가 살아 있으면 추가 호출이 없다.
  const [entryResult, resultResult, history] = await Promise.all([
    callKra("entry-list", { ...CALL_OPTS, extra: { rc_date: date } }),
    callKra("race-result", { ...CALL_OPTS, extra: { rc_date: date } }),
    loadRecentResults(),
  ]);

  const races = groupByRace(entryResult.rows);
  const resultGroups = groupResultsByRace(resultResult.rows);
  const resultByRcNo = new Map<number, ResultGroup>(resultGroups.map((g) => [g.info.rcNo, g]));

  /*
   * 통계는 **이 경주일 이전** 기록만으로 만든다. 같은 날 또는 이후 결과가 섞이면
   * 자기 자신을 보고 맞히는 셈이라 화면의 확률이 실제보다 좋아 보인다.
   * 경주 상세 화면과 같은 규칙이어야 두 화면의 픽이 일치한다.
   */
  const priorRows = history.rows.filter((r) => str(r.rcDate) < date);
  const styleHistory = buildStyleHistory(priorRows);
  const sectionalHistory = buildSectionalHistory(priorRows);
  const stats =
    priorRows.length > 0 ? buildStatsBundle(priorRows, styleHistory, sectionalHistory) : null;
  // 이 경주일 이전 기록만으로 만든 이력이라 최종값을 그대로 써도 누수가 아니다.
  const traits: HorseTraits = {
    style: styleHistory.finalStyle,
    sectional: sectionalHistory.final,
  };

  /** 경주 하나의 복승 상위 3조합과, 시행이 끝났다면 1순위 적중 여부. */
  function pickFor(
    rcNo: number,
    rcDist: number,
  ): { picks: QuinellaPick[]; hit: boolean | null; marketUsed: boolean } {
    const group = resultByRcNo.get(rcNo) ?? null;
    const entries = races.find((r) => r.card.rcNo === rcNo)?.entries ?? [];
    const runners = mergeRunners(entries, group?.results ?? []);
    if (!stats || runners.length === 0) return { picks: [], hit: null, marketUsed: false };

    const candidates = toCandidates(predictionRunners(runners), traits);
    const { predictions, picks } = buildRacePick(candidates, stats, rcDist, 3);
    const actual = group?.finished
      ? actualPair(group.results.map((r) => ({ ord: r.ord, chulNo: r.chulNo })))
      : null;
    return {
      picks,
      hit: actual && picks[0] ? isPickHit(picks[0], actual) : null,
      marketUsed: predictions[0]?.marketUsed ?? false,
    };
  }

  // 출전표가 있으면 그것을, 없으면(지난 경주일) 경주기록을 목록의 근거로 삼는다.
  const bases = races.length
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

  const cards = bases.map((c) => ({ ...c, ...pickFor(c.rcNo, c.rcDist) }));

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

                  {c.picks.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-medium text-muted">
                          복승 픽
                          {/*
                            발매 초반에는 배당판이 얇아 반영하지 못한다. 그 상태의 픽은
                            발매가 진행되면 바뀌므로 그 사실을 밝혀야 한다.
                          */}
                          {!c.marketUsed && (
                            <span
                              className="ml-1.5 font-normal text-warn"
                              title="배당판이 아직 얇아 단승 배당을 반영하지 못했습니다. 발주가 가까워지면 픽이 바뀔 수 있습니다."
                            >
                              배당 반영 전
                            </span>
                          )}
                        </p>
                        {c.hit != null && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              c.hit ? "bg-ok-bg text-ok" : "text-muted"
                            }`}
                          >
                            {c.hit ? "1순위 적중" : "1순위 실패"}
                          </span>
                        )}
                      </div>
                      <ol className="mt-1.5 space-y-1 text-sm">
                        {c.picks.map((p, i) => (
                          <li
                            key={`${p.a.hrNo}-${p.b.hrNo}`}
                            className="flex items-baseline gap-2"
                          >
                            <span className="w-3 shrink-0 text-xs text-muted">{i + 1}</span>
                            <span
                              className={`shrink-0 font-medium ${i === 0 ? "text-accent" : ""}`}
                            >
                              {p.a.chulNo}·{p.b.chulNo}
                            </span>
                            <span className="truncate text-xs text-muted">
                              {p.a.hrName} — {p.b.hrName}
                            </span>
                            <span className="ml-auto shrink-0 font-medium">
                              {(p.prob * 100).toFixed(1)}%
                            </span>
                            <span className="w-14 shrink-0 text-right text-xs text-muted">
                              {p.fairOdds.toFixed(1)}배
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {top3.length > 0 ? (
                    <ol className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      {top3.map((r) => (
                        <li key={r.hrNo} className="flex items-baseline gap-2">
                          <span className="w-6 shrink-0 text-xs font-medium text-muted">
                            {r.ord}착
                          </span>
                          <span className="shrink-0 text-xs text-muted">{r.chulNo}번</span>
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

      {cards.some((c) => c.picks.length > 0) && (
        <p className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-xs text-muted">
          <strong className="font-medium text-foreground">복승 픽</strong>은 이 경주일{" "}
          <strong className="font-medium text-foreground">이전</strong> 기록과 단승 배당으로 계산한
          1·2착 조합 후보입니다. <strong className="font-medium text-foreground">본전 배당</strong>은
          확률의 역수로, 실제 복승 배당이 이보다 높아야 기대값이 양수입니다.{" "}
          <span className="text-warn">배당 반영 전</span> 표시가 붙은 경주는 발매 초반이라 배당판이
          아직 얇아 반영하지 못한 것이며, 발주가 가까워지면 픽이 바뀔 수 있습니다. 확률이 실제
          적중률과 맞아떨어지는지는{" "}
          <Link href="/picks" className="text-accent hover:underline">
            지난 픽
          </Link>
          의 보정 표에서 확인하세요.
        </p>
      )}
    </>
  );
}
