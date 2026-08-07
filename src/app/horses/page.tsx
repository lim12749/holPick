import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { callKra } from "@/lib/kra/client";
import { MAX_QUERY_LENGTH, parsePageNo, truncateQuery } from "@/lib/kra/datasets";
import { formatPrize, formatRate, parseHorse } from "@/lib/kra/horse";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "경주마 — holPick",
};

const PER_PAGE = 50;

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page, q } = await searchParams;
  const pageNo = parsePageNo(page);
  const query = truncateQuery(q);

  const result = await callKra("horse-detail", {
    pageNo,
    numOfRows: PER_PAGE,
    // 마명 검색은 API 파라미터로 넘긴다. 빈 값이면 전체 조회.
    extra: query ? { hr_name: query } : undefined,
  });

  const horses = result.rows.map(parseHorse);
  const totalPages =
    result.totalCount != null ? Math.max(1, Math.ceil(result.totalCount / PER_PAGE)) : null;

  const linkTo = (p: number) =>
    `/horses?page=${p}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <>
      <PageHeader
        title="경주마"
        description="서울 경마장 현역 경주마. 통산 성적과 레이팅을 함께 봅니다."
        actions={<StatusBadge status={result.status} />}
      />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="마명으로 검색"
          aria-label="마명 검색"
          maxLength={MAX_QUERY_LENGTH}
          className="min-w-56 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          검색
        </button>
        {query && (
          <Link href="/horses" className="text-sm text-muted hover:text-foreground">
            초기화
          </Link>
        )}
        {result.totalCount != null && (
          <span className="ml-auto text-sm text-muted">
            {result.totalCount.toLocaleString("ko-KR")}두
          </span>
        )}
      </form>

      {/* 검색 결과 없음은 오류가 아니다. 조회는 성공했으므로 가벼운 빈 상태로 보여준다. */}
      {result.status === "no_data" ? (
        <p className="rounded-lg border border-border bg-surface-muted px-4 py-10 text-center text-sm text-muted">
          {query ? (
            <>
              &ldquo;{query}&rdquo; 와 일치하는 경주마가 없습니다.{" "}
              <Link href="/horses" className="text-accent hover:underline">
                전체 보기
              </Link>
            </>
          ) : (
            "표시할 경주마가 없습니다."
          )}
        </p>
      ) : result.status !== "ok" && result.status !== "empty_page" ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">{result.message}</p>
          {result.hint && <p className="mt-2 text-sm text-muted">{result.hint}</p>}
          <Link href="/diagnostics" className="mt-4 inline-block text-sm text-accent hover:underline">
            API 진단 보기 →
          </Link>
        </div>
      ) : (
        <>
          {result.status === "empty_page" && (
            <p className="mb-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted">
              {result.message}
            </p>
          )}
          {/* sticky 헤더가 동작하도록 세로 스크롤도 이 컨테이너가 맡는다. DataTable 과 동일. */}
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-muted">
                  {[
                    ["마명", "left"],
                    ["등급", "left"],
                    ["성별", "left"],
                    ["산지", "left"],
                    ["조교사", "left"],
                    ["출주", "right"],
                    ["1착", "right"],
                    ["승률", "right"],
                    ["연승률", "right"],
                    ["레이팅", "right"],
                    ["통산 상금", "right"],
                  ].map(([label, align]) => (
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
                {horses.map((h) => (
                  <tr
                    key={h.hrNo}
                    className="border-b border-border last:border-0 hover:bg-surface-muted"
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/horses/${h.hrNo}`} className="font-medium text-accent hover:underline">
                        {h.hrName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{h.rank || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{h.sex || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{h.origin || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{h.trName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{h.career.starts}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{h.career.first}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatRate(h.career.winRate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatRate(h.career.showRate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {h.rating > 0 ? h.rating : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatPrize(h.prizeTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination pageNo={pageNo} totalPages={totalPages} hrefFor={linkTo} />
        </>
      )}
    </>
  );
}
