import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { runBacktest, type BacktestMetrics } from "@/lib/kra/backtest";
import { loadQuinellaDividends, type QuinellaDividend } from "@/lib/kra/dividend";
import { str } from "@/lib/kra/horse";
import { loadRecentResults } from "@/lib/kra/history";

export const dynamic = "force-dynamic";

export const metadata = { title: "검증 — holPick" };

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function Row({
  label,
  note,
  m,
  highlight,
}: {
  label: string;
  note: string;
  m: BacktestMetrics;
  highlight?: boolean;
}) {
  return (
    <tr className={`border-b border-border last:border-0 ${highlight ? "bg-surface-muted" : ""}`}>
      <td className="px-3 py-2">
        <span className="font-medium">{label}</span>
        <span className="ml-2 text-xs text-muted">{note}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-semibold">{m.top2HitAvg.toFixed(2)}</span>
        {m.top2HitSe > 0 && (
          <span className="ml-1 text-xs text-muted">± {m.top2HitSe.toFixed(2)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">{pct(m.topPickHitRate)}</td>
    </tr>
  );
}

export default async function BacktestPage() {
  const history = await loadRecentResults();

  // 검증 구간 경주일의 복승 확정배당만 받는다. 경주일당 1콜이고 캐시된다.
  const dates = [...new Set(history.rows.map((r) => str(r.rcDate)))].filter(Boolean).sort();
  const testDates = dates.slice(Math.max(1, Math.floor(dates.length * 0.7)));
  const dividendEntries = await Promise.all(
    testDates.map(async (d) => [d, await loadQuinellaDividends(d)] as const),
  );
  const dividends = new Map<string, Map<string, QuinellaDividend>>(dividendEntries);

  const report = runBacktest({ rows: history.rows, dividends });

  if (!report) {
    return (
      <>
        <PageHeader title="복승 예측 검증" />
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">검증할 데이터가 부족합니다.</p>
          <Link href="/analysis" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 분석으로
          </Link>
        </div>
      </>
    );
  }

  /**
   * 차이가 우연인지 판단한다. |z| ≥ 1.96 이 아니면 "이겼다"고 말할 수 없다.
   * 검증 경주가 100여 개뿐이라 이 구분이 결정적이다.
   */
  const verdict = (d: { diff: number; z: number }) => {
    if (Math.abs(d.z) < 1.96) return { label: "차이 불확실", cls: "text-warn" };
    return d.diff > 0 ? { label: "이김", cls: "text-ok" } : { label: "못 이김", cls: "text-danger" };
  };
  const vStyle = verdict(report.vsStyle);
  const vRating = verdict(report.vsRating);
  const vMarket = verdict(report.vsMarket);

  return (
    <>
      <PageHeader
        title="복승 예측 검증"
        description={`경주일 ${report.trainDays}일로 통계를 만들고 이후 ${report.testDays}일을 맞혀봤습니다 (${report.trainMonths.join("·")} → ${report.testMonths.join("·")}).`}
        actions={
          <Link href="/analysis" className="text-sm text-accent hover:underline">
            ← 분석
          </Link>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["학습", `${report.trainDays}일 · ${report.trainRows.toLocaleString("ko-KR")}행`],
          ["검증", `${report.testDays}일 · ${report.testRows.toLocaleString("ko-KR")}행`],
          ["검증 경주", `${report.model.races}경주`],
          ["복승 기저율", pct(report.base)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="mb-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">예측 방식별 복승 검증 지표</caption>
          <thead>
            <tr className="bg-surface-muted">
              <th scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium">
                방식
              </th>
              <th scope="col" className="border-b border-border px-3 py-2.5 text-right font-medium">
                상위 2두 적중
              </th>
              <th scope="col" className="border-b border-border px-3 py-2.5 text-right font-medium">
                1순위 적중률
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-3 py-2">
                <span className="font-medium">무작위</span>
                <span className="ml-2 text-xs text-muted">기저율 × 2</span>
              </td>
              <td className="px-3 py-2 text-right font-semibold">
                {report.randomTop2HitAvg.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right">{pct(report.base)}</td>
            </tr>
            <Row label="각질 단독" note="선행형 → 추입형 순" m={report.styleOnly} />
            <Row label="레이팅 단독" note="레이팅 높은 순" m={report.ratingOnly} />
            <Row label="이 모델" note="각질 포함 8개 요인" m={report.model} highlight />
            <Row label="확정배당 인기순" note="사후 정보 · 사실상 상한선" m={report.favourite} />
          </tbody>
        </table>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">복승 조합 적중률</p>
          <p className="mt-1 font-semibold">{pct(report.quinellaHitRate)}</p>
          <p className="mt-1 text-xs text-muted">추천 1순위 조합 · {report.quinellaRaces}경주</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">복승 ROI</p>
          <p
            className={`mt-1 font-semibold ${
              report.quinellaRoi != null && report.quinellaRoi < 1 ? "text-danger" : "text-ok"
            }`}
          >
            {report.quinellaRoi == null ? "—" : `${report.quinellaRoi.toFixed(2)}배`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {report.quinellaBets > 0 ? `${report.quinellaBets}회 베팅 · 1.00이 본전` : "배당 없음"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">Brier 점수</p>
          <p className="mt-1 font-semibold">{report.model.brier.toFixed(4)}</p>
          <p className="mt-1 text-xs text-muted">낮을수록 좋음</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">로그 손실</p>
          <p className="mt-1 font-semibold">{report.model.logLoss.toFixed(4)}</p>
          <p className="mt-1 text-xs text-muted">낮을수록 좋음</p>
        </div>
      </section>

      {/* 성적이 나쁘면 나쁘다고 그대로 쓴다. 검증의 목적은 자랑이 아니다. */}
      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="font-medium">해석</h2>
        <ul className="mt-2 space-y-1.5 text-muted">
          <li>
            <strong className="font-medium text-foreground">각질 단독</strong> 대비:{" "}
            <strong className={vStyle.cls}>{vStyle.label}</strong> (차이{" "}
            {report.vsStyle.diff.toFixed(2)} ± {report.vsStyle.se.toFixed(2)}, z=
            {report.vsStyle.z.toFixed(2)}) — 각질 하나로 충분하다면 나머지 7개 요인은
            군더더기입니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">레이팅 단독</strong> 대비:{" "}
            <strong className={vRating.cls}>{vRating.label}</strong> (차이{" "}
            {report.vsRating.diff.toFixed(2)} ± {report.vsRating.se.toFixed(2)}, z=
            {report.vsRating.z.toFixed(2)})
          </li>
          <li>
            <strong className="font-medium text-foreground">시장(확정배당)</strong> 대비:{" "}
            <strong className={vMarket.cls}>{vMarket.label}</strong> (차이{" "}
            {report.vsMarket.diff.toFixed(2)} ± {report.vsMarket.se.toFixed(2)}, z=
            {report.vsMarket.z.toFixed(2)}) — 배당은 경주가 끝나야 확정되므로 예측에 쓸 수 없습니다.
            상한선으로만 보세요.
          </li>
          <li className="text-foreground">
            <strong className="font-medium">z 값이 ±1.96 안이면 차이가 우연일 수 있습니다.</strong>{" "}
            검증 경주가 {report.model.races}개뿐이라, 숫자가 높다고 곧바로 더 낫다고 말할 수
            없습니다.
          </li>
          {report.quinellaRoi != null && report.quinellaRoi < 1 && (
            <li className="text-danger">
              <strong className="font-medium">복승 ROI가 {report.quinellaRoi.toFixed(2)}배로 본전 미만입니다.</strong>{" "}
              조합 적중률이 얼마든 이 방식으로 계속 베팅하면 장기적으로 잃습니다.
            </li>
          )}
        </ul>
      </section>

      <p className="mt-4 text-xs text-muted">
        시간 순으로 분할했고(무작위 분할 금지), 예측 입력에는 착순·배당·주파기록처럼 경주가 끝나야
        알 수 있는 값을 넣지 않았습니다. 각질도 해당 경주 이전 이력으로만 판정했습니다.
      </p>
    </>
  );
}
