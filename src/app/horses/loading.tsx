import { PageHeader } from "@/components/PageHeader";
import { LoadingAnnounce, TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="경주마"
        description="서울 경마장 현역 경주마. 통산 성적과 레이팅을 함께 봅니다."
      />
      <LoadingAnnounce label="경주마 목록을 불러오는 중입니다." />
      <div className="mb-4 h-10 animate-pulse rounded-md bg-surface-muted" aria-hidden />
      <TableSkeleton rows={10} />
    </>
  );
}
