import { LoadingAnnounce, TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnounce label="출전마 정보를 불러오는 중입니다." />
      <div className="mb-6 h-12 w-64 animate-pulse rounded bg-surface-muted" aria-hidden />
      <div className="mb-6 h-20 animate-pulse rounded-lg border border-border bg-surface" aria-hidden />
      <TableSkeleton rows={12} />
    </>
  );
}
