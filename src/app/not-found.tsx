import Link from "next/link";

/**
 * 존재하지 않는 경주마·데이터셋 등을 요청했을 때 표시된다.
 *
 * 특히 /horses/[hrNo] 는 응답에서 요청한 마번을 찾지 못하면 여기로 온다.
 * 다른 말의 데이터를 대신 보여주는 것보다 이 화면이 낫다.
 */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h1 className="font-semibold">찾을 수 없습니다.</h1>
      <p className="mt-2 text-sm text-muted">
        요청하신 항목이 없습니다. 마번이나 주소를 다시 확인해 주세요.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link href="/horses" className="text-accent hover:underline">
          경주마 목록
        </Link>
        <Link href="/diagnostics" className="text-muted hover:text-foreground">
          API 진단
        </Link>
        <Link href="/" className="text-muted hover:text-foreground">
          홈
        </Link>
      </div>
    </div>
  );
}
