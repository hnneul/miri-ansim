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
 *
 * subsets 에 "korean" 은 못 쓴다 — next/font 가 받는 값이 cyrillic·latin·latin-ext·vietnamese 뿐이고
 * 넣으면 타입 에러가 난다. 한글 글리프는 구글이 서브셋 이름 없이 번호로 쪼갠 파일로 내려주므로
 * latin 만 적어도 같이 딸려온다 (computed font 가 "Noto Sans KR" 로 잡히는 것으로 확인).
 * 굵기는 디자인이 쓰는 셋(400/500/700)만 받는다.
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  subsets: ["latin"],
  // 600 은 상태바 시각 전용이다 — 실제 아이폰이 SF Pro Semibold 라 500 은 얇고 700 은 두껍다
  weight: ["400", "500", "600", "700"],
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
