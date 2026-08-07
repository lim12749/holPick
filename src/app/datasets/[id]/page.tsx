import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { callDataset } from "@/lib/kra/client";
import { DATASETS, DEFAULT_MEET, getDataset } from "@/lib/kra/datasets";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return DATASETS.map((d) => ({ id: d.id }));
}

export default async function DatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; meet?: string }>;
}) {
  const { id } = await params;
  const { page, meet } = await searchParams;

  const dataset = getDataset(id);
  if (!dataset) notFound();

  const pageNo = Math.max(1, Number(page ?? "1") || 1);
  const meetCode = meet && dataset.meetCodes[meet] ? meet : DEFAULT_MEET;
  const numOfRows = 50;

  const result = await callDataset(dataset, { pageNo, numOfRows, meet: meetCode });

  const totalPages =
    result.totalCount != null ? Math.max(1, Math.ceil(result.totalCount / numOfRows)) : null;

  const linkTo = (p: number) => `/datasets/${dataset.id}?page=${p}&meet=${meetCode}`;

  return (
    <>
      <PageHeader
        title={dataset.label}
        description={dataset.description}
        actions={<StatusBadge status={result.status} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted">경마장</span>
          {Object.entries(dataset.meetCodes).map(([code, name]) => (
            <Link
              key={code}
              href={`/datasets/${dataset.id}?page=1&meet=${code}`}
              className={`rounded-md px-2 py-1 ${
                code === meetCode
                  ? "bg-accent text-white"
                  : "bg-surface-muted text-muted hover:text-foreground"
              }`}
            >
              {name}
            </Link>
          ))}
        </div>
        {result.totalCount != null && (
          <span className="text-muted">
            전체 {result.totalCount.toLocaleString("ko-KR")}건
          </span>
        )}
        <Link href="/diagnostics" className="ml-auto text-accent hover:underline">
          진단으로
        </Link>
      </div>

      {result.status === "ok" ? (
        <>
          <DataTable
            rows={result.rows}
            preferredColumns={dataset.preferredColumns}
            caption={`${dataset.label} ${pageNo}페이지`}
          />

          <Pagination pageNo={pageNo} totalPages={totalPages} hrefFor={linkTo} />
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">{result.message}</p>
          {result.hint && <p className="mt-2 text-sm text-muted">{result.hint}</p>}
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <a
              href={dataset.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              공공데이터포털에서 이 데이터셋 보기
            </a>
            <span className="text-muted">
              환경변수:{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
                {dataset.envKey}
              </code>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
