import { PageHeader } from "@/components/PageHeader";
import { CardGridSkeleton, LoadingAnnounce } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="API 연결 진단"
        description="9개 데이터셋에 실제로 요청을 보내 응답 상태를 확인합니다."
      />
      <LoadingAnnounce label="9개 데이터셋 상태를 확인하는 중입니다." />
      <div className="mb-6 h-16 animate-pulse rounded-lg border border-border bg-surface" aria-hidden />
      <CardGridSkeleton />
    </>
  );
}
