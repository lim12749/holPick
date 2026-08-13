import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadQuinellaDividends, type QuinellaDividend } from "@/lib/kra/dividend";
import { formatRaceDate } from "@/lib/kra/entry";
import { loadRecentResults } from "@/lib/kra/history";
import { BET_UNIT, buildPickLedger, ledgerDates, type PickRecord } from "@/lib/kra/ledger";

export const dynamic = "force-dynamic";

export const metadata = { title: "지난 픽 — holPick" };

/**
 * 확정배당을 받아올 최대 경주일 수.
 *
 * 경주일당 1콜이 동시에 나가므로 상한이 필요하다. 기록이 늘어 원장 구간이
 * 수십 일이 돼도 콜드 렌더가 그만큼 넓어지지 않게 막는다. 현재 원장 구간이
 * 20일 남짓이라 사실상 전부를 받아온다. 개별 호출 타임아웃은 `dividend.ts` 가
 * 짧게 잡고 있어서, 만성적으로 느린 날짜가 화면 전체를 붙잡지 않는다.
 */
const MAX_DIVIDEND_DAYS = 24;

/**
 * 한 달치 베팅 수. 서울은 주말만 시행해 실측 월 평균 78~104경주다.
 * "월 단위로는 판단할 수 없다"를 숫자로 말하기 위한 기준값이라 대략이면 된다.
 */
const MONTHLY_BETS = 90;

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function won(v: number): string {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

/** 손익은 부호가 정보다. 양수에 + 를 붙여 0과 헷갈리지 않게 한다. */
function signedWon(v: number): string {
  const n = Math.round(v);
  return `${n > 0 ? "+" : ""}${n.toLocaleString("ko-KR")}원`;
}

function moneyClass(v: number): string {
  if (v > 0) return "text-ok";
  if (v < 0) return "text-danger";
  return "";
}

function Tile({
  label,
  value,
  note,
  valueClass,
}: {
  label: string;
  value: string;
  note: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

/**
 * 누적 손익 곡선.
 *
 * 단일 계열이고 읽어야 하는 것은 "0선 위인가 아래인가"와 "언제 꺾였나" 둘뿐이라
 * 범례 없이 선 하나와 0 기준선만 둔다. 끝점만 직접 라벨링한다. 정확한 값은
 * 아래 표에 전부 있으므로 이 그림은 모양만 전달하면 된다.
 */
function ProfitCurve({ records, profit }: { records: PickRecord[]; profit: number }) {
  const W = 720;
  const H = 168;
  const PAD_Y = 14;
  const PAD_R = 76; // 끝점 라벨 자리
  const pts = records.map((r) => r.cum);
  if (pts.length < 2) return null;

  const maxY = Math.max(0, ...pts);
  const minY = Math.min(0, ...pts);
  const span = maxY - minY || 1;
  const sx = (i: number) => (i / (pts.length - 1)) * (W - PAD_R);
  const sy = (v: number) => PAD_Y + (1 - (v - minY) / span) * (H - 2 * PAD_Y);

  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const zeroY = sy(0);
  const endX = sx(pts.length - 1);
  const endY = sy(pts[pts.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`누적 손익 곡선. ${records.length}경주 후 ${signedWon(profit)}.`}
    >
      {/* 0선. 손익의 부호가 바뀌는 지점이라 유일하게 필요한 기준선이다. */}
      <line
        x1="0"
        x2={W - PAD_R}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <text x={W - PAD_R + 6} y={zeroY + 4} fontSize="11" fill="var(--muted)">
        0원
      </text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r="4" fill="var(--accent)" />
      <text
        x={endX + 8}
        y={endY + 4}
        fontSize="12"
        fontWeight="600"
        fill={profit >= 0 ? "var(--ok)" : "var(--danger)"}
      >
        {signedWon(profit)}
      </text>
    </svg>
  );
}

export default async function PicksPage() {
  const history = await loadRecentResults();

  // 원장 구간 중 최근 경주일의 확정배당만 받는다. 경주일당 1콜이고 길게 캐시된다.
  const dates = ledgerDates(history.rows).slice(-MAX_DIVIDEND_DAYS);
  const dividendEntries = await Promise.all(
    dates.map(async (d) => [d, await loadQuinellaDividends(d)] as const),
  );
  const dividends = new Map<string, Map<string, QuinellaDividend>>(dividendEntries);

  const ledger = buildPickLedger({ rows: history.rows, dividends });

  if (!ledger) {
    return (
      <>
        <PageHeader title="지난 픽" />
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">성적을 낼 만한 기록이 아직 없습니다.</p>
          <p className="mt-2 text-sm text-muted">
            경주일이 최소 4일은 쌓여야 통계를 만들고 픽을 재현할 수 있습니다.
          </p>
          <Link href="/races" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 출전표
          </Link>
        </div>
      </>
    );
  }

  const losing = ledger.roi != null && ledger.roi < 1;
  // 1순위 조합의 실측 적중률 ÷ 예측 확률. 1.0 이면 확률이 맞아떨어진다는 뜻.
  const rank1 = ledger.calibration.find((c) => c.rank === 1);
  const calibrationGap =
    rank1 && rank1.predicted > 0 ? rank1.actual / rank1.predicted : null;
  // 손익이 실제로 덮는 첫 경주일. 적중률 구간보다 짧다는 걸 밝히기 위해 쓴다.
  const settledFrom = ledger.records.find((r) => r.payoutOdds != null)?.rcDate ?? null;
  // 고배당 한 건을 빼면 부호가 뒤집히는지. 뒤집힌다면 그건 실력이 아니라 운이다.
  const flipsWithoutBest =
    ledger.profitExcludingBest != null && ledger.profit > 0 && ledger.profitExcludingBest < 0;

  return (
    <>
      <PageHeader
        title="지난 픽"
        description={`${formatRaceDate(ledger.fromDate)} ~ ${formatRaceDate(ledger.toDate)} · ${ledger.ledgerDays}경주일 ${ledger.races}경주. 매 경주 1순위 복승 조합 하나에 ${BET_UNIT.toLocaleString("ko-KR")}원씩 샀다고 가정했습니다.`}
        actions={
          <Link href="/analysis/backtest" className="text-sm text-accent hover:underline">
            모델 검증 →
          </Link>
        }
      />

      {/*
        헤드라인은 금액이 아니라 판정이다. 표본이 작을 때 점추정만 크게 띄우면
        노이즈를 실력으로 읽게 된다. 금액은 아래 보조 타일로 내린다.
      */}
      <section className="mb-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs text-muted">회수율</p>
          <p className="text-2xl font-semibold">
            {ledger.roi == null ? "—" : ledger.roi.toFixed(2)}
            {ledger.roiCi && (
              <span className="ml-2 text-base font-normal text-muted">
                ± {((ledger.roiCi.hi - ledger.roiCi.lo) / 2).toFixed(2)}
              </span>
            )}
          </p>
          <span
            className={`rounded px-2 py-0.5 text-sm font-medium ${
              ledger.verdict === "이김"
                ? "bg-ok-bg text-ok"
                : ledger.verdict === "짐"
                  ? "bg-danger-bg text-danger"
                  : "bg-warn-bg text-warn"
            }`}
          >
            {ledger.verdict}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {ledger.roiCi && (
            <>
              95% 신뢰구간 <strong className="font-medium text-foreground">
                {ledger.roiCi.lo.toFixed(2)} ~ {ledger.roiCi.hi.toFixed(2)}
              </strong>
              {" · "}
            </>
          )}
          1.00이 본전 · {ledger.settledBets}베팅
          {ledger.verdict === "판단 불가" &&
            " — 구간이 본전을 걸치고 있어 이겼는지 졌는지 아직 말할 수 없습니다."}
        </p>
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="조합 적중률"
          value={`${pct(ledger.hitRate)} ± ${pct(ledger.hitRateSe)}`}
          note={`${ledger.races}경주 중 ${ledger.hits}적중 · 무작위 ${pct(ledger.randomHitRate)}`}
        />
        <Tile
          label="손익"
          value={signedWon(ledger.profit)}
          valueClass={moneyClass(ledger.profit)}
          note={`투자 ${won(ledger.stake)} · 회수 ${won(ledger.returned)}`}
        />
        <Tile
          label="최고배당 1건 제외"
          value={
            ledger.roiExcludingBest == null ? "—" : `${ledger.roiExcludingBest.toFixed(2)}배`
          }
          valueClass={
            ledger.roiExcludingBest == null
              ? ""
              : ledger.roiExcludingBest < 1
                ? "text-danger"
                : "text-ok"
          }
          note={
            ledger.profitExcludingBest == null
              ? "적중이 없습니다"
              : `손익 ${signedWon(ledger.profitExcludingBest)}`
          }
        />
        <Tile
          label="판정까지 남은 베팅"
          value={
            ledger.betsNeeded > ledger.settledBets
              ? `${(ledger.betsNeeded - ledger.settledBets).toLocaleString("ko-KR")}회`
              : "충분"
          }
          note={`회수율을 ±0.10 안으로 좁히는 데 총 ${ledger.betsNeeded.toLocaleString("ko-KR")}회`}
        />
      </section>

      {/* 고배당 한 건에 성적이 통째로 실려 있으면 그걸 먼저 말한다. */}
      {ledger.bestPayout && ledger.profitExcludingBest != null && (
        <section
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            flipsWithoutBest ? "border-warn bg-warn-bg" : "border-border bg-surface"
          }`}
        >
          <p className={flipsWithoutBest ? "font-medium text-warn" : "font-medium"}>
            최고 배당 1건({formatRaceDate(ledger.bestPayout.rcDate)} {ledger.bestPayout.rcNo}경주 ·{" "}
            {ledger.bestPayout.odds.toFixed(1)}배)을 빼면 손익{" "}
            <strong>{signedWon(ledger.profitExcludingBest)}</strong>
            {ledger.roiExcludingBest != null && ` · 회수율 ${ledger.roiExcludingBest.toFixed(2)}배`}
            입니다.
          </p>
          {flipsWithoutBest && (
            <>
              <p className="mt-1.5 text-warn">
                단 한 경주가 전체 손익의 부호를 뒤집습니다. 복승 배당은 꼬리가 길어서 고배당 한
                번이 수십 번의 손실을 덮습니다. 지금 수익은 실력의 증거가 아니라 표본이 작다는
                증거로 읽는 편이 안전합니다.
              </p>
              {ledger.bestPayout.rcDate >= ledger.toDate && (
                <p className="mt-1.5 text-warn">
                  게다가 그 경주는 원장의 마지막 경주일이라 출전표가 아직 남아 있습니다. 원장은
                  경주기록만으로 재현하므로(아래 주석), 이 날만은{" "}
                  <Link
                    href={`/races/${ledger.bestPayout.rcDate}/${ledger.bestPayout.rcNo}`}
                    className="underline"
                  >
                    경주 화면
                  </Link>
                  의 픽과 다를 수 있습니다. 그 차이가 하필 이 고배당 한 건에 걸려 있으니, 수익 쪽
                  숫자는 더 깎아서 보세요.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section className="mb-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-medium">누적 손익</h2>
        <p className="mt-1 text-xs text-muted">
          경주 순서대로 쌓은 손익입니다. 확정배당을 구하지 못한 경주는 베팅하지 않은 것으로 보고
          값을 유지합니다.
        </p>
        <div className="mt-3">
          <ProfitCurve records={ledger.records} profit={ledger.profit} />
        </div>
      </section>

      {/* 화면이 내놓는 확률을 얼마나 할인해서 봐야 하는지. */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-medium">모델 확률 보정</h2>
        <p className="mt-1 text-xs text-muted">
          경주 화면에 뜨는 <strong className="font-medium">적중 확률</strong>이 실제로 맞은 비율과
          얼마나 맞아떨어지는지입니다. 두 값이 가까울수록 화면의{" "}
          <strong className="font-medium">본전 배당</strong>을 그대로 믿고 마권을 고를 수 있습니다.
          {calibrationGap != null && (
            <>
              {" "}
              1순위 기준 지금은{" "}
              <strong className="font-medium text-foreground">
                {calibrationGap < 1.15 && calibrationGap > 0.87
                  ? "예측과 실측이 거의 일치"
                  : calibrationGap >= 1.15
                    ? `모델이 ${calibrationGap.toFixed(1)}배 과소평가`
                    : `모델이 ${(1 / calibrationGap).toFixed(1)}배 과대평가`}
              </strong>
              합니다.
            </>
          )}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">복승 조합 순위별 예측 확률과 실측 적중률</caption>
            <thead>
              <tr className="bg-surface-muted">
                {["조합 순위", "경주", "예측 확률", "실측 적중률", "실측 본전 배당"].map(
                  (h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`whitespace-nowrap border-b border-border px-3 py-2 font-medium ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {ledger.calibration.map((c) => (
                <tr key={c.rank} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {c.rank}순위
                    {c.rank === 1 && <span className="ml-2 text-xs text-muted">베팅 대상</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">{c.races}</td>
                  <td className="px-3 py-2 text-right">{pct(c.predicted)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{pct(c.actual)}</td>
                  <td className="px-3 py-2 text-right">
                    {c.breakEvenOdds == null ? "—" : `${c.breakEvenOdds.toFixed(1)}배`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-6 max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">경주별 픽 내역과 손익</caption>
          <thead>
            <tr className="bg-surface-muted">
              {(
                [
                  ["날짜", "left"],
                  ["경주", "left"],
                  ["우리 픽", "left"],
                  ["실제 1·2착", "left"],
                  ["적중", "left"],
                  ["배당", "right"],
                  ["손익", "right"],
                  ["누적", "right"],
                ] as [string, "left" | "right"][]
              ).map(([label, align]) => (
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
            {[...ledger.records].reverse().map((r) => (
              <tr
                key={`${r.rcDate}-${r.rcNo}`}
                className="border-b border-border last:border-0 hover:bg-surface-muted"
              >
                <td className="whitespace-nowrap px-3 py-2 text-muted">
                  {formatRaceDate(r.rcDate).slice(5)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    href={`/races/${r.rcDate}/${r.rcNo}`}
                    className="text-accent hover:underline"
                  >
                    {r.rcNo}R
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="font-medium">
                    {r.pick.a}·{r.pick.b}
                  </span>
                  {/* 조합 뒤에 확률이 바로 붙으면 "8·11" "6.6%" 가 한 숫자로 읽힌다. */}
                  <span className="ml-2 text-xs text-muted">({pct(r.pick.prob)})</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {r.actual[0]}·{r.actual[1]}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.hit ? (
                    <span className="rounded bg-ok-bg px-1.5 py-0.5 text-xs font-medium text-ok">
                      적중
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {r.payoutOdds == null ? (
                    <span className="text-muted" title="확정배당을 구하지 못해 베팅에서 제외">
                      —
                    </span>
                  ) : (
                    `${r.payoutOdds.toFixed(1)}배`
                  )}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                    r.profit == null ? "text-muted" : moneyClass(r.profit)
                  }`}
                >
                  {r.profit == null ? "제외" : signedWon(r.profit)}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${moneyClass(r.cum)}`}>
                  {signedWon(r.cum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 성적이 나쁘면 나쁘다고 그대로 쓴다. 이 화면의 목적은 자랑이 아니다. */}
      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="font-medium">해석</h2>
        <ul className="mt-2 space-y-1.5 text-muted">
          <li>
            조합 적중률 <strong className="font-medium text-foreground">{pct(ledger.hitRate)}</strong>{" "}
            는 무작위로 한 조합을 찍었을 때의 {pct(ledger.randomHitRate)} 보다 뚜렷하게 높습니다.
            픽의 <strong className="font-medium text-foreground">순서를 매기는 능력</strong>은
            있다는 뜻입니다.
          </li>
          <li>
            다만 적중률이 높다고 돈이 되지는 않습니다. 배당이 낮은 조합만 맞히면 잃습니다. 판단
            기준은 회수율이고, 지금은{" "}
            <strong className={`font-medium ${losing ? "text-danger" : "text-ok"}`}>
              {ledger.roi == null ? "—" : `${ledger.roi.toFixed(2)}배`}
            </strong>
            입니다.
          </li>
          {losing && (
            <li className="text-danger">
              <strong className="font-medium">회수율이 본전(1.00) 미만입니다.</strong> 이 규칙대로
              계속 사면 장기적으로 잃습니다.
            </li>
          )}
          <li>
            <strong className="font-medium text-foreground">월간 회수율을 목표로 삼지 마세요.</strong>{" "}
            1베팅당 회수 배수의 표준편차가 {ledger.returnSd.toFixed(2)} 라, 한 달치
            {" "}({MONTHLY_BETS}베팅 남짓)로는 실력과 운이 구분되지 않습니다. 회수율을 ±0.10 안으로
            좁히려면 총 {ledger.betsNeeded.toLocaleString("ko-KR")}베팅
            {ledger.betsNeeded > MONTHLY_BETS && (
              <> — 월 {MONTHLY_BETS}경주 기준 약 {Math.ceil(ledger.betsNeeded / MONTHLY_BETS)}개월</>
            )}
            이 필요합니다. 한 달 성적이 좋거나 나쁜 건 대부분 배당 분포의 꼬리 때문입니다.
          </li>
          <li>
            그래서 지금 단계의 판단 기준은 수익이 아니라{" "}
            <Link href="/analysis/backtest" className="text-accent hover:underline">
              시장을 이겼는가
            </Link>
            입니다. 예측력은 훨씬 적은 표본으로도 잴 수 있고, 시장보다 못한 예측으로는 공제율을
            넘을 방법이 원리적으로 없습니다.
          </li>
          {ledger.skipped > 0 && (
            <li>
              출전 부족·착순 결측으로 {ledger.skipped}경주는 픽을 내지 못해 적중률 분모에서
              뺐습니다.
            </li>
          )}
          {ledger.races > ledger.settledBets && (
            <li>
              <strong className="font-medium text-foreground">적중률과 손익의 구간이 다릅니다.</strong>{" "}
              적중률은 {ledger.races}경주 전체지만, 손익은 확정배당을 확인한{" "}
              {ledger.settledBets}베팅
              {settledFrom && `(${formatRaceDate(settledFrom).slice(5)}부터)`}만 셉니다. 배당 조회는
              경주일당 1콜인데 오래된 날짜는 제공 측 응답이 느려 시간 안에 못 받는 날이 있습니다.
              못 받은 {ledger.races - ledger.settledBets}경주는 베팅하지 않은 것으로 처리했습니다 —
              적중을 손실로 세지 않기 위해서입니다. 다시 방문하면 재시도하므로 이 수는 점차
              줄어듭니다.
            </li>
          )}
        </ul>
      </section>

      <p className="mt-4 text-xs text-muted">
        각 경주의 픽은 그 경주일 <strong className="font-medium text-foreground">이전</strong> 기록만으로
        만든 통계로 다시 계산했습니다. 앞선 {ledger.warmupDays}경주일은 통계를 쌓는 데만 쓰고
        성적에는 넣지 않았습니다. 예측 입력에는 착순·배당·주파기록처럼 경주가 끝나야 알 수 있는
        값을 넣지 않았고, 각질도 해당 경주 이전 이력으로만 판정했습니다. 다만 출전표는 임박한
        경주만 조회되므로 이 원장은 <strong className="font-medium text-foreground">경주기록만으로</strong>{" "}
        재현합니다 — 출전표에만 있는 최근 1년 전적을 쓰지 못해, 출전표가 아직 살아 있는 최근
        경주일은 경주 화면의 픽과 조금 다를 수 있습니다.{" "}
        <Link href="/analysis/backtest" className="text-accent hover:underline">
          모델 검증
        </Link>
        은 같은 데이터를 한 번만 잘라 기준선과 비교한 화면입니다.
      </p>
    </>
  );
}
