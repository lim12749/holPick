import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadRecentResults } from "@/lib/kra/history";
import { buildStatsBundle, type RateEntry } from "@/lib/kra/stats";
import { buildSectionalHistory, MIN_RUNS } from "@/lib/kra/sectional";
import { buildStyleHistory, RUNNING_STYLES } from "@/lib/kra/style";

export const dynamic = "force-dynamic";

export const metadata = { title: "분석 — holPick" };


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
              {["항목", "출주", "1착", "2착", "3착", "복승", "원시", "축소추정"].map((h, i) => (
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
                {/* 표본이 작으면 비율이 요동친다. 눈으로 바로 걸러낼 수 있게 표시한다. */}
                <td
                  className={`px-2 py-1.5 text-right ${e.starts < 200 ? "text-warn" : ""}`}
                  title={e.starts < 200 ? "표본 200 미만 — 우연일 수 있습니다" : undefined}
                >
                  {e.starts}
                  {e.starts < 200 && <span className="ml-0.5 text-xs">!</span>}
                </td>
                <td className="px-2 py-1.5 text-right">{e.first}</td>
                <td className="px-2 py-1.5 text-right">{e.second}</td>
                <td className="px-2 py-1.5 text-right">{e.third}</td>
                <td className="px-2 py-1.5 text-right font-medium">{e.top2}</td>
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
  const history = await loadRecentResults();
  // 각질은 경주일 순 누적 스냅샷이라 이력을 먼저 만들고 집계에 넘긴다.
  const styleHistory = buildStyleHistory(history.rows);
  // 구간 지표도 같은 규칙 — 경주별로 그 경주 이전 기록만 반영한 스냅샷이다.
  const sectionalHistory = buildSectionalHistory(history.rows);
  const stats = buildStatsBundle(history.rows, styleHistory, sectionalHistory);

  /** z 구간표는 빠른 쪽이 위로 오게 정렬한다. 사전순으로 두면 읽히지 않는다. */
  const bandOrder = [
    "매우 빠름 (+0.7σ↑)",
    "빠름 (+0.25~0.7σ)",
    "보통 (±0.25σ)",
    "느림 (−0.25~−0.7σ)",
    "매우 느림 (−0.7σ↓)",
  ];
  const bySpeedBand = (entries: RateEntry[]) =>
    [...entries].sort((a, b) => bandOrder.indexOf(a.key) - bandOrder.indexOf(b.key));

  // 사전순으로 두면 "최연소"가 맨 아래로 가서 단조 흐름이 안 보인다.
  const ageOrder = ["최연소", "+1세", "+2세", "+3세 이상"];
  const byAgeBand = (entries: RateEntry[]) =>
    [...entries].sort((a, b) => ageOrder.indexOf(a.key) - ageOrder.indexOf(b.key));

  return (
    <>
      <PageHeader
        title="6개월 분석"
        description="서울 경마장 최근 6개월 시행 기록. 모든 비율은 복승(2착 이내) 기준입니다."
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
          ["복승 기저율", pct(stats.base)],
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
          title="출발 스퍼트 (초반 200m)"
          note={`구간 실측 시간을 경주 안에서 z점수로 정규화했습니다 — 같은 경주는 거리·주로·날씨·등급을 공유하므로 그 조건들이 자동으로 상쇄됩니다. 해당 경주 이전 ${MIN_RUNS}전 이상의 평균만 씁니다. 지표가 매겨진 행 ${stats.sectionalCovered.toLocaleString("ko-KR")}개 / 전체 ${stats.totalRows.toLocaleString("ko-KR")}개. 단독 신호는 각질(4분류)보다 뚜렷하지만, 배당을 함께 쓰는 모델에서는 가중치가 0으로 떨어졌습니다 — 시장이 이미 아는 정보라는 뜻입니다.`}
          entries={bySpeedBand(stats.earlySpeed)}
          base={stats.base}
        />
        <RateTable
          title="막판 여력 (마지막 200m)"
          note="총 주파기록에서 결승 1F 전 누적을 뺀 값입니다. 초반 스퍼트와 상관이 −0.29 로, 빠른 출발마는 막판이 약한 경향이 있습니다. 서로 다른 축이라 둘을 함께 봐야 합니다. 배당이 없는 발매 초반 모델에서는 이 지표만 살아남았습니다(가중치 0.122)."
          entries={bySpeedBand(stats.lateSpeed)}
          base={stats.base}
        />
        <RateTable
          title="중반 가속 (초반 200m → 결승 3F 전)"
          entries={bySpeedBand(stats.accel)}
          base={stats.base}
        />
        <RateTable
          title="경주 내 상대 연령"
          note="절대 연령을 쓰면 편성 효과를 학습합니다 — 3세 전용 경주가 따로 있어서 '3세가 잘한다'에 그 구성이 섞입니다. 같은 경주 최연소 대비로 바꾸면 나이 우위만 남습니다."
          entries={byAgeBand(stats.relativeAge)}
          base={stats.base}
        />
        <RateTable title="성별" entries={stats.sex} base={stats.base} />
        <RateTable title="산지" entries={stats.origin} base={stats.base} />
        <RateTable
          title="마체중 증감"
          note="예측에는 쓰지 않습니다. 마체중은 경주 당일 계측이라 경주 전에는 값이 비어 옵니다. 모델에 넣으면 백테스트에서만 값이 있고 실전에는 없는 학습–서빙 불일치가 되어 검증 점수만 부풀립니다. 참고용으로만 싣습니다."
          entries={[...stats.bodyWeightDelta].sort((a, b) => a.key.localeCompare(b.key, "ko"))}
          base={stats.base}
        />
        <RateTable
          title="각질(주행 스타일)별"
          note={`해당 경주 이전 이력으로만 판정했으므로 예측에 그대로 쓸 수 있습니다. 성향이 매겨진 행 ${stats.styleCovered.toLocaleString("ko-KR")}개 / 전체 ${stats.totalRows.toLocaleString("ko-KR")}개 (첫 출전 말은 성향이 없습니다).`}
          entries={[...stats.runningStyle].sort(
            (a, b) => RUNNING_STYLES.indexOf(a.key as never) - RUNNING_STYLES.indexOf(b.key as never),
          )}
          base={stats.base}
        />
        <RateTable
          title="각질 × 페이스"
          note="선행마가 몰리면 초반이 과열된다는 통념을 검증합니다. 6개월 기준으로 확인된 것은 절반뿐입니다 — 선행형이 몰릴수록 선행형 자신의 성적은 35.2%→23.2%로 떨어지고 이 차이는 통계적으로 유의합니다(z=2.29). 반면 추입형이 반사이익을 얻는다는 부분은 11.7%→13.0%로 표본 69개에 신뢰구간이 5~21%라 우연과 구분되지 않습니다(z=0.31). 표본이 200 미만인 행은 근거로 쓰지 마세요."
          entries={[...stats.stylePace].sort((a, b) => a.key.localeCompare(b.key, "ko"))}
          limit={16}
          base={stats.base}
        />
        <RateTable
          title="확정배당 인기순위별 적중률"
          note="시장이 실제로 얼마나 맞히는지. 확정배당은 발매 마감 시점의 시장 컨센서스라 경주 전에 알 수 있으므로, 비교 기준이자 예측 입력으로도 씁니다 — 실제로 단일 최강 요인입니다."
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
