import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { runBacktest, testSplitIndex, type BacktestMetrics } from "@/lib/kra/backtest";
import { loadDividends, poolPayback, type QuinellaDividend } from "@/lib/kra/dividend";
import { str } from "@/lib/kra/horse";
import { loadRecentResults } from "@/lib/kra/history";
import { groupRows } from "@/lib/kra/stats";

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
  // 경계를 백테스트와 공유한다. 따로 적으면 배당 구간과 검증 구간이 어긋난다.
  const testDates = dates.slice(testSplitIndex(dates.length));
  const dividendEntries = await Promise.all(
    testDates.map(async (d) => [d, await loadDividends(d)] as const),
  );
  const dividends = new Map<string, Map<string, QuinellaDividend>>(
    dividendEntries.map(([d, v]) => [d, v.quinella]),
  );

  const report = runBacktest({ rows: history.rows, dividends });

  /*
   * 승식별 환급률. 전 조합을 다 샀을 때 얼마가 돌아오는지를 실측한 값이고,
   * 어떤 전략이든 여기서 출발한다. 복연승으로 갈아탈 이유가 있는지 판단하는
   * 근거이기도 하다 — 적중률이 높아도 세금이 더 비싸면 소용없다.
   */
  const fieldSize = new Map<string, number>();
  for (const [key, race] of groupRows(history.rows)) fieldSize.set(key, race.length);
  const paybackInput = (pick: (v: (typeof dividendEntries)[number][1]) => Map<string, QuinellaDividend>) =>
    dividendEntries.flatMap(([date, v]) => {
      const byRace = new Map<number, number[]>();
      for (const d of pick(v).values()) {
        const list = byRace.get(d.rcNo);
        if (list) list.push(d.odds);
        else byRace.set(d.rcNo, [d.odds]);
      }
      return [...byRace.entries()].flatMap(([rcNo, payouts]) => {
        const n = fieldSize.get(`${date}-${rcNo}`) ?? 0;
        return n >= 2 ? [{ combos: (n * (n - 1)) / 2, payouts }] : [];
      });
    });
  const quinellaPayback = poolPayback(paybackInput((v) => v.quinella));
  const placePayback = poolPayback(paybackInput((v) => v.placeQuinella));

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
  const vNoMarket = verdict(report.vsNoMarket);
  const beatMarket = report.vsMarket.z >= 1.96;

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

      {/*
        이 화면의 1차 질문은 "돈을 벌었나"가 아니라 "시장을 이겼나"다.
        시장보다 못한 예측으로는 공제율(약 26%)을 넘을 방법이 원리적으로 없다.
      */}
      <section
        className={`mb-6 rounded-lg border p-4 ${
          beatMarket ? "border-ok bg-ok-bg" : "border-warn bg-warn-bg"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-medium">1차 목표 — 시장(확정배당 인기순)을 이겼는가</h2>
          <span className={`text-sm font-semibold ${beatMarket ? "text-ok" : "text-warn"}`}>
            {beatMarket ? "이김" : "아직 못 이김"}
          </span>
        </div>
        <p className="mt-1.5 text-sm">
          상위 2두 적중이 시장 {report.favourite.top2HitAvg.toFixed(2)} 대비{" "}
          <strong className="font-medium">
            {report.vsMarket.diff >= 0 ? "+" : ""}
            {report.vsMarket.diff.toFixed(3)} ± {report.vsMarket.se.toFixed(3)}
          </strong>{" "}
          (z={report.vsMarket.z.toFixed(2)}).{" "}
          {beatMarket
            ? "우연으로 보기 어려운 차이입니다."
            : "차이가 표준오차 안이라 아직 이겼다고 말할 수 없습니다. 방향은 맞지만 표본이 더 필요합니다."}
        </p>
      </section>

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
            <Row label="모델 (배당 제외)" note="배당 없이 같은 절차로 적합" m={report.modelNoMarket} />
            <Row label="시장 (확정배당 인기순)" note="넘어야 할 1차 목표선" m={report.favourite} />
            <Row label="모델 + 시장" note="배당을 요인으로 포함" m={report.model} highlight />
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

      {/*
        모든 전략의 출발점. 예측이 아무리 좋아도 이 공제율을 넘지 못하면 장기적으로 진다.
        복연승으로 갈아탈 이유가 있는지도 여기서 판단한다.
      */}
      {(quinellaPayback != null || placePayback != null) && (
        <section className="mb-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium">승식별 환급률 — 넘어야 할 세금</h2>
          <p className="mt-1 text-xs text-muted">
            그 경주의 <strong className="font-medium">전 조합을 다 샀을 때</strong> 돌아오는 비율을
            실측한 값입니다. 무작위로 사면 이 값이 곧 기대 회수율이고, 본전에 닿으려면 예측으로 그
            차이를 메워야 합니다.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              ["복승 (1·2착)", quinellaPayback, "지금 베팅 대상"],
              ["복연승 (2두 모두 3착 이내)", placePayback, "적중은 잦지만 세금이 더 비싸다"],
            ].map(([label, v, note]) => (
              <div key={label as string} className="rounded-lg border border-border px-4 py-3">
                <p className="text-xs text-muted">{label as string}</p>
                <p className="mt-1 font-semibold">
                  {v == null ? "—" : `환급률 ${pct(v as number)}`}
                  {v != null && (
                    <span className="ml-2 text-sm font-normal text-danger">
                      공제 {pct(1 - (v as number))}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">{note as string}</p>
              </div>
            ))}
          </div>
          {quinellaPayback != null && placePayback != null && placePayback < quinellaPayback && (
            <p className="mt-3 text-xs text-muted">
              복연승은 공제가 {pct(quinellaPayback - placePayback)} 더 비쌉니다. 적중률이 높다고
              갈아탈 이유가 되지 않습니다 — 다만 배당 분포가 좁아 분산이 작으므로,{" "}
              <strong className="font-medium text-foreground">우위를 더 빨리 재는 계측용</strong>
              으로는 쓸 만합니다.
            </p>
          )}
        </section>
      )}

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
            <strong className="font-medium text-foreground">시장(확정배당 인기순)</strong> 대비:{" "}
            <strong className={vMarket.cls}>{vMarket.label}</strong> (차이{" "}
            {report.vsMarket.diff.toFixed(3)} ± {report.vsMarket.se.toFixed(3)}, z=
            {report.vsMarket.z.toFixed(2)}) — 확정배당은 발매 마감 시점의 시장 컨센서스라 경주 전에
            알 수 있습니다. 넘을 수 없는 상한선이 아니라 <strong className="font-medium">넘어야 할 목표선</strong>입니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">배당을 넣은 효과</strong>:{" "}
            <strong className={vNoMarket.cls}>{vNoMarket.label}</strong> (차이{" "}
            {report.vsNoMarket.diff.toFixed(3)} ± {report.vsNoMarket.se.toFixed(3)}, z=
            {report.vsNoMarket.z.toFixed(2)}) — 같은 절차로 배당만 빼고 적합한 모델과의 비교입니다.
            {report.vsNoMarket.z >= 1.96 &&
              " 배당 하나가 나머지 요인을 다 합친 것보다 크게 기여합니다."}
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
        시간 순으로 분할했고(무작위 분할 금지), 예측 입력에는 착순·주파기록·착차처럼{" "}
        <strong className="font-medium text-foreground">결과를 알아야만 나오는 값</strong>을 넣지
        않았습니다. 각질도 해당 경주 이전 이력으로만 판정했습니다. 단승 배당은 넣었습니다 —
        파리뮤추얼 확정배당은 발매 마감 시점의 시장 컨센서스이고 마권을 사는 사람은 그걸 보고
        사므로, 결과 정보가 아닙니다. 실제로 경주기록 응답은 미시행 경주에도 배당을 실어 보냅니다.
        가중치와 온도는 학습 구간에서만 적합했습니다(<code className="font-mono">scripts/fit-weights.mjs</code>).
      </p>
    </>
  );
}
