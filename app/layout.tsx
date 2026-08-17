import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

/*
 * 서체는 Noto Sans KR 하나다 (로고만 Jalnan2, globals.css).
 *
 * create-next-app 이 깔아준 Geist·Geist_Mono 를 지웠다. font-sans·font-mono 를 쓰는 곳이
 * 한 군데도 없었는데도 next/font 가 기본으로 preload 를 켜서, **첫 방문마다 안 쓰는 폰트
 * 두 개를 미리 받고 있었다** (브라우저에서 재보니 Geist 1개 + Geist Mono 1개가 실제로 받아졌다).
 */

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

// 표기는 스플래시 로고(app/page.tsx "미리 안심")와 같아야 한다 — 탭 제목만 옛 이름이면 갈린다
export const metadata: Metadata = {
  title: "미리 안심",
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
      className={`${notoSansKr.variable} h-full antialiased`}
    >
      {/* 세로 배치는 .phone 이 쥔다 (globals.css) — 노트북에서는 그게 폰 프레임이 된다 */}
      <body className="min-h-full">
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
