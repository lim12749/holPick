"use client";

import Link from "next/link";

/**
 * 예상하지 못한 예외를 잡는 경계.
 *
 * KRA 호출 실패는 client.ts 가 KraResult 로 정규화해 화면에서 안내하므로 여기까지
 * 오지 않는다. 여기 걸리는 것은 렌더링 버그 같은 진짜 예외이므로, 사용자에게는
 * 복구 경로만 주고 원인은 감춘다.
 *
 * 보안 주의: 이 파일은 클라이언트 컴포넌트다. src/lib/kra/client.ts 를 비롯해
 * 인증키를 다루는 모듈을 여기서 import 하면 키가 브라우저 번들에 들어간다.
 * (client.ts 의 "server-only" 가 그런 시도를 빌드 타임에 막는다.)
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h1 className="font-semibold">화면을 표시하지 못했습니다.</h1>
      <p className="mt-2 text-sm text-muted">
        일시적인 문제일 수 있습니다. 다시 시도해도 같으면 API 진단에서 연결 상태를 확인해 보세요.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-4 py-2 font-medium text-white"
        >
          다시 시도
        </button>
        <Link href="/diagnostics" className="self-center text-accent hover:underline">
          API 진단으로
        </Link>
        <Link href="/" className="self-center text-muted hover:text-foreground">
          홈으로
        </Link>
      </div>
    </div>
  );
}
