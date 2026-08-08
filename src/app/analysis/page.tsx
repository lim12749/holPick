import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadRecentResults } from "@/lib/kra/history";
import { buildStatsBundle, type RateEntry } from "@/lib/kra/stats";

export const dynamic = "force-dynamic";

export const metadata = { title: "분석 — holPick" };

const MONTHS = 3;

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function RateTable({
  title,
  note,
  entries,
  minStarts = 0,
  limit = 12,
  base,
}: {
  title: string;
  note?: string;
  entries: RateEntry[];
  minStarts?: number;
  limit?: number;
  base: number;
}) {
  const shown = entries.filter((e) => e.starts >= minStarts).slice(0, limit);
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="font-medium">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted">
              {["항목", "출주", "1착", "2착", "3착", "3착이내", "원시", "축소추정"].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`whitespace-nowrap border-b border-border px-2 py-2 font-medium ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.key} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-2 py-1.5">{e.key}</td>
                <td className="px-2 py-1.5 text-right">{e.starts}</td>
                <td className="px-2 py-1.5 text-right">{e.first}</td>
                <td className="px-2 py-1.5 text-right">{e.second}</td>
                <td className="px-2 py-1.5 text-right">{e.third}</td>
                <td className="px-2 py-1.5 text-right font-medium">{e.top3}</td>
                <td className="px-2 py-1.5 text-right text-muted">{pct(e.raw)}</td>
                <td
                  className={`px-2 py-1.5 text-right font-semibold ${
                    e.adjusted > base ? "text-ok" : ""
                  }`}
                >
                  {pct(e.adjusted)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AnalysisPage() {
  const history = await loadRecentResults(MONTHS);
  const stats = buildStatsBundle(history.rows);

  return (
    <>
      <PageHeader
        title="3개월 분석"
        description="서울 경마장 최근 3개월 시행 기록. 모든 비율은 3착 이내 기준입니다."
        actions={
          <Link href="/analysis/backtest" className="text-sm text-accent hover:underline">
            검증 결과 →
          </Link>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["대상 월", history.months.join(" · ")],
          ["경주 수", `${stats.totalRaces.toLocaleString("ko-KR")}경주`],
          ["출주 행", `${stats.totalRows.toLocaleString("ko-KR")}두`],
          ["기저율", pct(stats.base)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <p className="mb-6 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted">
        <strong className="font-medium text-foreground">축소추정</strong>은 표본이 적은 항목을
        기저율 쪽으로 당긴 값입니다. 3전 1착인 기수를 33%로 믿으면 예측이 그 기수에 끌려가므로,
        가상의 평균 출주 20회를 섞어 보정합니다. 예측에는 원시 비율이 아니라 이 값을 씁니다.
      </p>

      <div className="grid gap-4">
        <RateTable
          title="확정배당 인기순위별 적중률"
          note="시장이 실제로 얼마나 맞히는지. 배당은 경주가 끝나야 확정되므로 예측 입력이 아니라 비교 기준입니다."
          entries={[...stats.favouriteRank].sort((a, b) => a.key.localeCompare(b.key, "ko"))}
          limit={8}
          base={stats.base}
        />
        <RateTable
          title="기수별"
          note="출주 20회 이상만 표시. 축소추정 내림차순."
          entries={stats.jockey}
          minStarts={20}
          base={stats.base}
        />
        <RateTable
          title="조교사별"
          note="출주 20회 이상만 표시."
          entries={stats.trainer}
          minStarts={20}
          base={stats.base}
        />
        <RateTable
          title="경주 내 레이팅 순위별"
          note="레이팅 0(미산정)은 순위에서 제외했습니다."
          entries={[...stats.ratingRank].sort((a, b) => a.key.localeCompare(b.key, "ko"))}
          limit={10}
          base={stats.base}
        />
        <RateTable
          title="부담중량 편차별"
          note="경주 내 최저 부담중량 대비."
          entries={stats.budamBand}
          base={stats.base}
        />
        <RateTable
          title="휴양일수별"
          note="직전 출전으로부터 경과일."
          entries={stats.restBand}
          base={stats.base}
        />
        <RateTable
          title="게이트 × 거리구간"
          note="출주 20회 이상. 단거리일수록 안쪽 게이트가 유리하다는 통념을 확인합니다."
          entries={stats.gateByBand}
          minStarts={20}
          limit={15}
          base={stats.base}
        />
      </div>

      <p className="mt-6 text-xs text-muted">
        수집: {history.detail.map((d) => `${d.month} ${d.rows}행${d.fromCache ? "(캐시)" : ""}`).join(" · ")}
      </p>
    </>
  );
}
