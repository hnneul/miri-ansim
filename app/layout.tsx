import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import DemoLocation from "./DemoLocation";

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

/*
 * iOS 사파리는 **16px 미만인 입력칸에 포커스가 가면 페이지를 통째로 확대한다.**
 * 우리 입력칸은 12~15px 이라 전부 해당돼서, 목적지 검색을 누르는 순간 화면이 확대되고
 * 커서 쪽으로 밀려 왼쪽이 잘려 나갔다 ("제주에서 많이 찾는 곳"의 "제"가 화면 밖으로).
 * 시뮬레이터(iPhone 17 / iOS 26.5)에서 재현하고, 이 한 줄로 사라지는 것까지 확인했다.
 *
 * 입력칸 글자를 전부 16px 로 올리는 방법도 있지만 디자인 값(12~15px)을 죄다 건드려야 한다.
 * **사용자가 직접 하는 핀치 확대는 안 죽는다** — iOS 는 이 제한을 자동 확대에만 걸고
 * 손가락 제스처는 그대로 통과시킨다 (같은 시뮬레이터에서 두 손가락으로 확대되는 것 확인).
 * 다만 안드로이드 크롬은 이 값을 곧이곧대로 지켜 핀치 확대가 막힌다 — 거기서는
 * 자동 확대 문제가 원래 없으니, 안드로이드까지 신경 쓸 때가 오면 입력칸 16px 쪽으로 옮긴다.
 */
export const viewport: Viewport = { maximumScale: 1 };

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
        {/* 아무것도 안 그린다 — 시연용 현위치 고정을 켜는 자리다 (./DemoLocation.tsx) */}
        <DemoLocation />
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
