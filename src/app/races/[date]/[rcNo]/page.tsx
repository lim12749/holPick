import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import {
  budamDelta,
  formatRaceDate,
  formatStartTime,
  groupByRace,
  type Entry,
} from "@/lib/kra/entry";
import { formatPrize, formatRate } from "@/lib/kra/horse";
import {
  formatRaceTime,
  groupResultsByRace,
  ordClassName,
  type RaceResult,
} from "@/lib/kra/result";

export const dynamic = "force-dynamic";

const CALL_OPTS = { numOfRows: 200, timeoutMs: 30_000, revalidateSeconds: 300 } as const;

function Condition({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

/** 출전마와 경주 결과를 마번으로 짝지은 한 줄. 어느 한쪽만 있을 수도 있다. */
interface Runner {
  hrNo: string;
  hrName: string;
  chulNo: number;
  entry: Entry | null;
  result: RaceResult | null;
}

export default async function RaceEntryPage({
  params,
}: {
  params: Promise<{ date: string; rcNo: string }>;
}) {
  const { date, rcNo } = await params;
  if (!/^\d{8}$/.test(date) || !/^\d{1,2}$/.test(rcNo)) notFound();
  const raceNo = Number(rcNo);

  const [entryResult, resultResult] = await Promise.all([
    callKra("entry-list", { ...CALL_OPTS, extra: { rc_date: date } }),
    callKra("race-result", { ...CALL_OPTS, extra: { rc_date: date } }),
  ]);

  const race = groupByRace(entryResult.rows).find((r) => r.card.rcNo === raceNo) ?? null;
  const resultGroup = groupResultsByRace(resultResult.rows).find((g) => g.info.rcNo === raceNo) ?? null;
  if (!race && !resultGroup) notFound();

  const finished = resultGroup?.finished ?? false;

  // 마번으로 병합한다. 지난 경주일은 출전표가 비므로 결과만으로도 표가 채워져야 한다.
  const entryByHr = new Map((race?.entries ?? []).map((e) => [e.hrNo, e]));
  const resultByHr = new Map((resultGroup?.results ?? []).map((r) => [r.hrNo, r]));
  const allHrNos = [...new Set([...entryByHr.keys(), ...resultByHr.keys()])];

  const runners: Runner[] = allHrNos
    .map((hrNo) => {
      const entry = entryByHr.get(hrNo) ?? null;
      const result = resultByHr.get(hrNo) ?? null;
      return {
        hrNo,
        hrName: entry?.hrName || result?.hrName || "",
        chulNo: entry?.chulNo || result?.chulNo || 0,
        entry,
        result,
      };
    })
    .sort((a, b) =>
      finished
        ? // 실격·미출전으로 착순이 없는 말은 뒤로.
          (a.result?.ord || Number.MAX_SAFE_INTEGER) - (b.result?.ord || Number.MAX_SAFE_INTEGER)
        : a.chulNo - b.chulNo,
    );

  const entries = race?.entries ?? [];
  const card = race?.card ?? null;
  const info = resultGroup?.info ?? null;

  const title = `${formatRaceDate(date)} ${raceNo}경주`;
  const description = [
    card?.meet || info?.meet,
    card?.rcDay || info?.rcDay,
    card?.rcName || info?.rcName,
    finished ? "시행 완료" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const columns: [string, "left" | "right"][] = [
    ...(finished ? ([["착순", "right"]] as [string, "left" | "right"][]) : []),
    ["번호", "right"],
    ["마명", "left"],
    ["성/연령", "left"],
    ["부담중량", "right"],
    ["레이팅", "right"],
    ["기수", "left"],
    ["조교사", "left"],
    ...(finished
      ? ([
          ["기록", "right"],
          ["착차", "right"],
          ["단승", "right"],
        ] as [string, "left" | "right"][])
      : []),
    ["통산", "right"],
    ["승률", "right"],
  ];

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Link href={`/races/${date}`} className="text-sm text-accent hover:underline">
            ← 그날 경주 목록
          </Link>
        }
      />

      <section className="mb-6 rounded-lg border border-border bg-surface p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Condition label="거리" value={`${card?.rcDist || info?.rcDist || 0}m`} />
          <Condition label="등급" value={card?.rank || info?.rank || ""} />
          <Condition label="출전 두수" value={`${runners.length}두`} />
          {card && <Condition label="발주시각" value={formatStartTime(card.stTime)} />}
          {info?.track && <Condition label="주로상태" value={info.track} />}
          {info?.weather && <Condition label="날씨" value={info.weather} />}
          {card && <Condition label="연령조건" value={card.ageCond} />}
          {card && <Condition label="1착 상금" value={formatPrize(card.prizes[0])} />}
        </dl>
      </section>

      {/* sticky 헤더가 동작하도록 세로 스크롤도 이 컨테이너가 맡는다. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {title} {finished ? "경주 결과" : "출전마"}
          </caption>
          <thead>
            <tr className="bg-surface-muted">
              {columns.map(([label, align]) => (
                <th
                  key={label}
                  scope="col"
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2.5 font-medium ${
                    align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.map((r) => {
              const e = r.entry;
              const res = r.result;
              const ord = res?.ord ?? 0;
              return (
                <tr
                  key={r.hrNo || r.chulNo}
                  className="border-b border-border last:border-0 hover:bg-surface-muted"
                >
                  {finished && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {ord > 0 ? (
                        <span
                          className={`inline-block min-w-7 rounded px-1.5 py-0.5 text-center font-semibold ${ordClassName(ord)}`}
                        >
                          {ord}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {r.chulNo || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      href={`/horses/${r.hrNo}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {r.hrName || "—"}
                    </Link>
                    {e?.rank && <span className="ml-2 text-xs text-muted">{e.rank}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {e ? (
                      <>
                        {e.sex}
                        {e.age > 0 && <span className="text-muted"> {e.age}세</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e && e.wgBudam > 0 ? (
                      <>
                        {e.wgBudam}
                        {budamDelta(entries, e) > 0 && (
                          <span className="ml-1 text-xs text-muted">+{budamDelta(entries, e)}</span>
                        )}
                      </>
                    ) : res && res.wgBudam > 0 ? (
                      res.wgBudam
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {(e?.rating ?? res?.rating ?? 0) > 0 ? (e?.rating ?? res?.rating) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{e?.jkName || res?.jkName || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{e?.trName || res?.trName || "—"}</td>

                  {finished && (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        {formatRaceTime(res?.rcTime ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {res?.diffUnit || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {res && res.winOdds > 0 ? res.winOdds.toFixed(1) : "—"}
                      </td>
                    </>
                  )}

                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e ? `${e.career.starts}전 ${e.career.first}승` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e ? formatRate(e.career.winRate) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        {finished
          ? "착순 순으로 정렬했습니다. 단승은 확정 배당률이며, 착차는 앞 말과의 거리입니다."
          : "출전번호 순입니다. 부담중량 옆 +숫자는 이 경주 최저 부담중량 대비 편차입니다."}{" "}
        레이팅 0은 미산정을 뜻하므로 결측으로 다뤄야 합니다.
      </p>
    </>
  );
}
