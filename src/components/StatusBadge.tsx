import type { KraStatus } from "@/lib/kra/types";

const STYLES: Record<KraStatus, { label: string; className: string }> = {
  ok: { label: "정상", className: "bg-ok-bg text-ok" },
  no_data: { label: "데이터 없음", className: "bg-warn-bg text-warn" },
  unset: { label: "미설정", className: "bg-neutral-bg text-neutral" },
  auth_error: { label: "인증 오류", className: "bg-danger-bg text-danger" },
  not_found: { label: "경로 없음", className: "bg-danger-bg text-danger" },
  quota: { label: "한도 초과", className: "bg-warn-bg text-warn" },
  network: { label: "네트워크 오류", className: "bg-danger-bg text-danger" },
  parse_error: { label: "응답 해석 실패", className: "bg-warn-bg text-warn" },
  api_error: { label: "API 오류", className: "bg-danger-bg text-danger" },
};

/** 상태를 색과 한글 라벨로 함께 표시한다. 색만으로 구분하지 않는다. */
export function StatusBadge({ status }: { status: KraStatus }) {
  const { label, className } = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
