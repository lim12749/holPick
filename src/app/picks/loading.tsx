import { LoadingAnnounce, TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnounce label="지난 픽 성적을 계산하는 중입니다." />
      <div className="mb-6 h-12 w-56 animate-pulse rounded bg-surface-muted" aria-hidden />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface px-4 py-3">
            <div className="h-3 w-16 animate-pulse rounded bg-surface-muted" />
            <div className="mt-2 h-6 w-24 animate-pulse rounded bg-surface-muted" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded bg-surface-muted" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={10} />
    </>
  );
}
