import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import { budamDelta, formatRaceDate, formatStartTime, groupByRace } from "@/lib/kra/entry";
import { formatPrize, formatRate } from "@/lib/kra/horse";

export const dynamic = "force-dynamic";

function Condition({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export default async function RaceEntryPage({
  params,
}: {
  params: Promise<{ date: string; rcNo: string }>;
}) {
  const { date, rcNo } = await params;
  if (!/^\d{8}$/.test(date) || !/^\d{1,2}$/.test(rcNo)) notFound();

  // 편성표는 확정된 자료라 실시간일 필요가 없다. 제공 측 응답이 느릴 때가 있어
  // 여유 있게 기다리되 결과는 5분간 재사용한다.
  const result = await callKra("entry-list", {
    numOfRows: 200,
    extra: { rc_date: date },
    timeoutMs: 30_000,
    revalidateSeconds: 300,
  });

  const race = groupByRace(result.rows).find((r) => r.card.rcNo === Number(rcNo));
  if (!race) notFound();

  const { card, entries } = race;

  return (
    <>
      <PageHeader
        title={`${formatRaceDate(date)} ${card.rcNo}경주`}
        description={[card.meet, card.rcDay, card.rcName].filter(Boolean).join(" · ")}
        actions={
          <Link href={`/races/${date}`} className="text-sm text-accent hover:underline">
            ← 그날 경주 목록
          </Link>
        }
      />

      <section className="mb-6 rounded-lg border border-border bg-surface p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Condition label="거리" value={`${card.rcDist}m`} />
          <Condition label="등급" value={card.rank} />
          <Condition label="출전 두수" value={`${entries.length}두`} />
          <Condition label="발주시각" value={formatStartTime(card.stTime)} />
          <Condition label="연령조건" value={card.ageCond} />
          <Condition label="성별조건" value={card.sexCond} />
          <Condition label="상금조건" value={card.prizeCond} />
          <Condition label="1착 상금" value={formatPrize(card.prizes[0])} />
        </dl>
      </section>

      {/* sticky 헤더가 동작하도록 세로 스크롤도 이 컨테이너가 맡는다. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {formatRaceDate(date)} {card.rcNo}경주 출전마
          </caption>
          <thead>
            <tr className="bg-surface-muted">
              {[
                ["번호", "right"],
                ["마명", "left"],
                ["성/연령", "left"],
                ["산지", "left"],
                ["부담중량", "right"],
                ["레이팅", "right"],
                ["기수", "left"],
                ["조교사", "left"],
                ["통산", "right"],
                ["승률", "right"],
                ["최근1년", "right"],
                ["휴양", "right"],
              ].map(([label, align]) => (
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
            {entries.map((e) => {
              const delta = budamDelta(entries, e);
              return (
                <tr
                  key={`${e.chulNo}-${e.hrNo}`}
                  className="border-b border-border last:border-0 hover:bg-surface-muted"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{e.chulNo}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      href={`/horses/${e.hrNo}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {e.hrName}
                    </Link>
                    {e.rank && <span className="ml-2 text-xs text-muted">{e.rank}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.sex}
                    {e.age > 0 && <span className="text-muted"> {e.age}세</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{e.origin || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e.wgBudam > 0 ? e.wgBudam : "—"}
                    {/* 경주 내 최저 부담중량 대비 편차 — 핸디캡 부담을 한눈에 본다. */}
                    {delta > 0 && <span className="ml-1 text-xs text-muted">+{delta}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e.rating > 0 ? e.rating : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{e.jkName || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{e.trName || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e.career.starts}전 {e.career.first}승
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatRate(e.career.winRate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e.lastYear.starts}전 {e.lastYear.first}승
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {e.restDays > 0 ? `${e.restDays}일` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        부담중량 옆 <span className="font-medium">+숫자</span> 는 이 경주 최저 부담중량 대비 편차,
        휴양은 직전 출전으로부터 경과일입니다. 레이팅 0은 미산정을 뜻하므로 결측으로 다뤄야 합니다.
      </p>
    </>
  );
}
