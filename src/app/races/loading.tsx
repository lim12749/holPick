import { PageHeader } from "@/components/PageHeader";
import { CardGridSkeleton, LoadingAnnounce } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="출전표"
        description="서울 경마장 편성. 경주일을 선택하면 그날의 경주 목록으로 이동합니다."
      />
      <LoadingAnnounce label="편성표를 불러오는 중입니다." />
      <div className="mb-6 h-12 animate-pulse rounded-lg border border-border bg-surface" aria-hidden />
      <CardGridSkeleton count={6} />
    </>
  );
}
