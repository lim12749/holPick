import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { runBacktest, type BacktestMetrics } from "@/lib/kra/backtest";
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
      <td className="px-3 py-2 text-right font-semibold">{m.top3HitAvg.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">{pct(m.topPickHitRate)}</td>
    </tr>
  );
}

export default async function BacktestPage() {
  const history = await loadRecentResults(3);
  const report = runBacktest(history.rows);

  if (!report) {
    return (
      <>
        <PageHeader title="예측 검증" />
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">검증할 데이터가 부족합니다.</p>
          <p className="mt-2 text-sm text-muted">
            학습·검증 기간을 나누려면 최소 2개월치 시행 기록이 필요합니다.
          </p>
          <Link href="/analysis" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 분석으로
          </Link>
        </div>
      </>
    );
  }

  const beatsRandom = report.model.top3HitAvg > report.randomTop3HitAvg;
  const beatsRating = report.model.top3HitAvg > report.ratingOnly.top3HitAvg;
  const beatsMarket = report.model.top3HitAvg > report.favourite.top3HitAvg;

  return (
    <>
      <PageHeader
        title="예측 검증"
        description={`경주일 일로 통계를 만들고 이후 일을 맞혀봤습니다 ( → ).`}
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
          ["기저율", pct(report.base)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="mb-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">예측 방식별 검증 지표</caption>
          <thead>
            <tr className="bg-surface-muted">
              <th scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium">
                방식
              </th>
              <th scope="col" className="border-b border-border px-3 py-2.5 text-right font-medium">
                상위 3두 적중
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
                <span className="ml-2 text-xs text-muted">기저율 × 3</span>
              </td>
              <td className="px-3 py-2 text-right font-semibold">
                {report.randomTop3HitAvg.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right">{pct(report.base)}</td>
            </tr>
            <Row label="레이팅 단독" note="레이팅 높은 순" m={report.ratingOnly} />
            <Row label="이 모델" note="7개 요인 가중합" m={report.model} highlight />
            <Row
              label="확정배당 인기순"
              note="사후 정보 · 사실상 상한선"
              m={report.favourite}
            />
          </tbody>
        </table>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
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
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">연승 ROI (1순위 베팅)</p>
          <p className="mt-1 font-semibold">
            {report.roiTopPick == null ? "—" : `${report.roiTopPick.toFixed(2)}배`}
          </p>
          <p className="mt-1 text-xs text-muted">1.00 이면 본전</p>
        </div>
      </section>

      {/* 성적이 나쁘면 나쁘다고 그대로 쓴다. 검증의 목적은 자랑이 아니다. */}
      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="font-medium">해석</h2>
        <ul className="mt-2 space-y-1.5 text-muted">
          <li>
            무작위 대비:{" "}
            <strong className={beatsRandom ? "text-ok" : "text-danger"}>
              {beatsRandom ? "이김" : "못 이김"}
            </strong>{" "}
            ({report.model.top3HitAvg.toFixed(2)} vs {report.randomTop3HitAvg.toFixed(2)})
          </li>
          <li>
            레이팅 단독 대비:{" "}
            <strong className={beatsRating ? "text-ok" : "text-danger"}>
              {beatsRating ? "이김" : "못 이김"}
            </strong>{" "}
            ({report.model.top3HitAvg.toFixed(2)} vs {report.ratingOnly.top3HitAvg.toFixed(2)}) —
            여러 요인을 섞은 것이 레이팅 하나보다 나은지가 이 모델의 존재 이유입니다.
          </li>
          <li>
            시장(확정배당) 대비:{" "}
            <strong className={beatsMarket ? "text-ok" : "text-warn"}>
              {beatsMarket ? "이김" : "못 이김"}
            </strong>{" "}
            ({report.model.top3HitAvg.toFixed(2)} vs {report.favourite.top3HitAvg.toFixed(2)}) —
            배당은 경주가 끝나야 확정되므로 예측에 쓸 수 없습니다. 도달 가능한 상한선으로만 보세요.
          </li>
          {report.roiTopPick != null && report.roiTopPick < 1 && (
            <li className="text-warn">
              연승 ROI가 1.00 미만입니다. 적중률과 무관하게 이 방식으로 베팅하면 장기적으로 손실입니다.
            </li>
          )}
        </ul>
      </section>

      <p className="mt-4 text-xs text-muted">
        시간 순으로 분할했고(무작위 분할 금지), 예측 입력에는 착순·배당·주파기록처럼 경주가
        끝나야 알 수 있는 값을 넣지 않았습니다. 검증 기간의 통계도 학습에 쓰지 않았습니다.
      </p>
    </>
  );
}
