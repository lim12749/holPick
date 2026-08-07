import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { probeDataset } from "@/lib/kra/client";
import { DATASETS } from "@/lib/kra/datasets";

/**
 * 홈은 상태 "요약"이라 실시간일 필요가 없다.
 * 매 방문마다 9개 데이터셋을 조회하면 일일 한도(KRA_DAILY_QUOTA)가 새로고침만으로
 * 고갈되므로 5분간 재사용한다. 지금 상태를 그대로 봐야 할 때는 /diagnostics 로 간다.
 */
export const revalidate = 300;

export default async function HomePage() {
  const results = await Promise.all(
    DATASETS.map(async (dataset) => ({ dataset, result: await probeDataset(dataset, 300) })),
  );
  const okCount = results.filter((r) => r.result.status === "ok").length;

  return (
    <>
      <section className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">서울 경마 정보 분석</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          한국마사회 공공데이터를 수집·정규화해 경주 결과 예측의 근거를 제시합니다. 현재는 데이터
          연결을 확인하고 원본을 탐색하는 단계입니다.
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-border bg-surface p-4">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-medium">API 연결 상태</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-muted">
              <strong className="text-base font-semibold text-foreground">{okCount}</strong> /{" "}
              {DATASETS.length} 정상
            </span>
            <Link href="/diagnostics" className="text-sm text-accent hover:underline">
              진단 상세 →
            </Link>
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {results.map(({ dataset, result }) => {
            // empty_page 는 여기서 나올 수 없다 — probeDataset 은 pageNo 를 넘기지 않아
            // 항상 1페이지이고, empty_page 판정에는 pageNo > 1 이 필요하다.
            const browsable = result.status === "ok" || result.status === "no_data";
            const content = (
              <div className="flex h-full items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{dataset.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {result.totalCount != null
                      ? `${result.totalCount.toLocaleString("ko-KR")}건`
                      : result.message}
                  </p>
                </div>
                <StatusBadge status={result.status} />
              </div>
            );
            return (
              <li key={dataset.id}>
                {browsable ? (
                  <Link href={`/datasets/${dataset.id}`} className="block h-full">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 font-medium">다음 단계</h2>
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-muted">
          <li>미설정 엔드포인트를 마이페이지에서 확인해 .env.local 에 채우기</li>
          <li>과거 경주기록 적재 배치 구축 (시점 기준 분리 필수)</li>
          <li>거리별·주로상태별 성적 분해와 구간기록 기반 각질 판정</li>
          <li>조건부 로짓 베이스라인과 배당률 대비 기대값 평가</li>
        </ol>
      </section>
    </>
  );
}
