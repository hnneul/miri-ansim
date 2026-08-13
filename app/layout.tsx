import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 와이어프레임의 본문 서체다 (WF/Label·Title·Body 전부 Noto Sans KR).
 * korean 서브셋을 명시해야 한글 글리프가 딸려온다 — latin 만 받으면 한글이 시스템 폰트로 떨어져
 * 자간·굵기가 디자인과 어긋난다. 굵기는 디자인이 쓰는 셋(400/500/700)만 받는다.
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  subsets: ["latin", "korean"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "길 안심 제주",
  description: "초보 운전자를 위한 제주 안전경로 추천",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansKr.variable} h-full antialiased`}
    >
      {/* 세로 배치는 .phone 이 쥔다 (globals.css) — 노트북에서는 그게 폰 프레임이 된다 */}
      <body className="min-h-full">
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
