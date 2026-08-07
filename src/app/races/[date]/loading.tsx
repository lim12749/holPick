import { CardGridSkeleton, LoadingAnnounce } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnounce label="경주 목록을 불러오는 중입니다." />
      <div className="mb-6 h-12 w-56 animate-pulse rounded bg-surface-muted" aria-hidden />
      <CardGridSkeleton count={6} />
    </>
  );
}
