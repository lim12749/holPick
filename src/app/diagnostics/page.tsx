import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { probeDataset } from "@/lib/kra/client";
import { DATASETS } from "@/lib/kra/datasets";
import { fieldLabel } from "@/lib/kra/field-labels";
import type { KraResult } from "@/lib/kra/types";

// 진단은 항상 지금 상태를 봐야 하므로 캐시하지 않는다.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "API 진단 — holPick",
};

function ResultCard({
  label,
  description,
  portalUrl,
  datasetId,
  result,
}: {
  label: string;
  description: string;
  portalUrl: string;
  datasetId: string;
  result: KraResult;
}) {
  const fields = result.rows[0] ? Object.keys(result.rows[0]) : [];

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{label}</h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        <StatusBadge status={result.status} />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">응답시간</dt>
          <dd className="mt-0.5 font-medium">
            {result.elapsedMs > 0 ? `${result.elapsedMs}ms` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">HTTP</dt>
          <dd className="mt-0.5 font-medium">{result.httpCode ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">전체 건수</dt>
          <dd className="mt-0.5 font-medium">
            {result.totalCount != null ? result.totalCount.toLocaleString("ko-KR") : "—"}
          </dd>
        </div>
      </dl>

      {result.status !== "ok" && (
        <div className="rounded-md bg-surface-muted px-3 py-2 text-xs">
          <p className="font-medium">{result.message}</p>
          {result.hint && <p className="mt-1 text-muted">{result.hint}</p>}
          {result.code && (
            <p className="mt-1 font-mono text-[11px] text-muted">코드: {result.code}</p>
          )}
        </div>
      )}

      {fields.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-foreground">
            응답 필드 {fields.length}개 보기
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <li
                key={f}
                className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px]"
                title={f}
              >
                {fieldLabel(f)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.maskedUrl && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-foreground">요청 URL</summary>
          <p className="mt-2 break-all rounded bg-surface-muted p-2 font-mono text-[11px]">
            {result.maskedUrl}
          </p>
        </details>
      )}

      <div className="mt-auto flex items-center gap-3 pt-1 text-xs">
        {result.status === "ok" || result.status === "no_data" ? (
          <Link href={`/datasets/${datasetId}`} className="text-accent hover:underline">
            데이터 보기 →
          </Link>
        ) : null}
        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-foreground"
        >
          포털 페이지
        </a>
      </div>
    </article>
  );
}

export default async function DiagnosticsPage() {
  // 데이터셋당 1건만 조회한다 (일일 한도 절약).
  const results = await Promise.all(
    DATASETS.map(async (dataset) => ({ dataset, result: await probeDataset(dataset) })),
  );

  const okCount = results.filter((r) => r.result.status === "ok").length;
  const unsetCount = results.filter((r) => r.result.status === "unset").length;

  return (
    <>
      <PageHeader
        title="API 연결 진단"
        description="9개 데이터셋에 실제로 요청을 보내 응답 상태를 확인합니다."
      />

      <div className="mb-6 flex flex-wrap items-center gap-6 rounded-lg border border-border bg-surface px-4 py-3">
        <div>
          <p className="text-xs text-muted">정상</p>
          <p className="text-lg font-semibold">
            {okCount}
            <span className="text-sm font-normal text-muted"> / {DATASETS.length}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">엔드포인트 미설정</p>
          <p className="text-lg font-semibold">{unsetCount}</p>
        </div>
        {unsetCount > 0 && (
          <p className="max-w-xl text-xs text-muted">
            미설정 데이터셋은 오류가 아닙니다. 공공데이터포털 마이페이지 → 데이터활용 → Open API →
            개발계정에서 각 API의 <strong className="font-medium">상세기능 요청주소</strong>를 확인해
            <code className="mx-1 rounded bg-surface-muted px-1 py-0.5 font-mono">.env.local</code>
            에 넣으면 코드 수정 없이 바로 동작합니다.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map(({ dataset, result }) => (
          <ResultCard
            key={dataset.id}
            label={dataset.label}
            description={dataset.description}
            portalUrl={dataset.portalUrl}
            datasetId={dataset.id}
            result={result}
          />
        ))}
      </div>
    </>
  );
}
