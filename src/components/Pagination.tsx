import Link from "next/link";

/**
 * 이전/다음 페이지 이동.
 *
 * totalPages 가 null 이면 전체 건수를 모른다는 뜻이므로 다음 페이지를 항상 열어둔다.
 * (일부 데이터셋은 totalCount 를 주지 않는다.)
 */
export function Pagination({
  pageNo,
  totalPages,
  hrefFor,
}: {
  pageNo: number;
  totalPages: number | null;
  hrefFor: (page: number) => string;
}) {
  const hasPrev = pageNo > 1;
  const hasNext = totalPages == null || pageNo < totalPages;

  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="페이지 이동">
      {hasPrev ? (
        <Link href={hrefFor(pageNo - 1)} rel="prev" className="text-accent hover:underline">
          ← 이전
        </Link>
      ) : (
        <span className="text-muted" aria-disabled="true">
          ← 이전
        </span>
      )}

      <span className="text-muted" aria-current="page">
        {pageNo}
        {totalPages ? ` / ${totalPages}` : ""} 페이지
      </span>

      {hasNext ? (
        <Link href={hrefFor(pageNo + 1)} rel="next" className="text-accent hover:underline">
          다음 →
        </Link>
      ) : (
        <span className="text-muted" aria-disabled="true">
          다음 →
        </span>
      )}
    </nav>
  );
}
