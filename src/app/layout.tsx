import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "holPick — 서울 경마 정보 분석",
  description: "한국마사회 공공데이터를 분석해 경주 결과 예측 근거를 제공합니다.",
};

const NAV = [
  { href: "/", label: "홈" },
  // 출전표가 예측의 주 진입점이라 가장 앞에 둔다.
  { href: "/races", label: "출전표" },
  { href: "/horses", label: "경주마" },
  { href: "/diagnostics", label: "API 진단" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * suppressHydrationWarning: 브라우저 확장이 <html>·<body> 에 속성을 주입해
     * (예: data-hwp-extension) 서버 HTML 과 어긋나면서 하이드레이션 오류가 난다.
     * 우리 코드가 만든 차이가 아니고 사용자가 어떤 확장을 쓸지 통제할 수 없다.
     * 이 속성은 해당 엘리먼트 한 겹에만 적용되므로 내부의 진짜 불일치는 그대로 잡힌다.
     */
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              holPick
            </Link>
            <ul className="flex items-center gap-4 text-sm text-muted">
              {NAV.slice(1).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-foreground">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted">
          데이터 출처: 공공데이터포털 한국마사회 오픈API · 분석 결과는 참고용이며 경주 결과를
          보장하지 않습니다.
        </footer>
      </body>
    </html>
  );
}
