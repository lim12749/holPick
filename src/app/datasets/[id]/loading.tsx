import { LoadingAnnounce, TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnounce label="데이터를 불러오는 중입니다." />
      <div className="mb-6 h-12 w-64 animate-pulse rounded bg-surface-muted" aria-hidden />
      <div className="mb-4 h-8 animate-pulse rounded bg-surface-muted" aria-hidden />
      <TableSkeleton rows={10} />
    </>
  );
}
