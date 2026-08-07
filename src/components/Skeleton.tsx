/**
 * 로딩 자리표시자.
 *
 * KRA API 는 응답에 1초 안팎이 걸리고 모든 화면이 서버 렌더링이라, 없으면
 * 그동안 빈 화면이 보인다. 실제 레이아웃과 비슷한 모양을 미리 그려
 * 화면이 뒤늦게 튀는 것을 줄인다.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-muted ${className}`} />;
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border" aria-hidden>
      <div className="flex gap-3 border-b border-border bg-surface-muted px-3 py-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3 border-b border-border px-3 py-2.5 last:border-0">
          {Array.from({ length: 6 }, (_, c) => (
            <Bar key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Bar className="h-5 w-2/3" />
          <Bar className="h-3 w-full" />
          <div className="flex gap-2">
            <Bar className="h-8 flex-1" />
            <Bar className="h-8 flex-1" />
            <Bar className="h-8 flex-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 화면 낭독기에는 진행 상황을 알린다. 시각적 자리표시자는 aria-hidden 이다. */
export function LoadingAnnounce({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {label}
    </p>
  );
}
