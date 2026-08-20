// 소개 화면(ONB-01 시작2)과 두 화면이 함께 쓰는 약관 줄.
//
// 스플래시(app/page.tsx)와 /intro 두 곳에서 쓰려고 뺐다. 전에는 "뒤로 왔음"을 ?intro 쿼리로
// 알렸는데, 쿼리를 읽으려면 useSearchParams 가 필요하고 그러면 페이지가 통째로 Suspense 안에
// 들어가 **정적 HTML 이 빈 화면이 됐다** — 첫 페인트가 스플래시가 아니라 흰 화면이었다.
// 소개 화면에 자기 주소를 주면 양쪽 다 정적으로 남고 깜빡임이 없다.

import Link from "next/link";
import StatusBar from "./StatusBar";

/**
 * 이용약관·개인정보 처리방침. 두 화면 모두 하단 28px 자리에 같은 문구가 앉는다 (글자색만 다르다).
 *
 * **글자가 아니라 링크다.** 두 글은 이미 다 쓰여 있고 화면도 있는데(lib/serviceinfo.ts,
 * /profile/terms · /profile/privacy) 정작 그 이름을 적어둔 여기서는 안 열렸다 —
 * 접근성 트리에도 링크가 하나도 안 잡혔다.
 *
 * back=intro 를 달아 보낸다. 안 달면 그 화면의 ← 가 마이 화면으로 가는데(app/profile/[topic]),
 * 여기는 아직 프로필을 만들기도 전이라 온보딩을 통째로 건너뛴 자리에 떨어진다.
 */
export function Legal({ tone }: { tone: string }) {
  return (
    <p className={`shrink-0 pb-7 text-center text-[11px] leading-4 font-medium ${tone}`}>
      <Link href="/profile/terms?back=intro" className="underline-offset-2 hover:underline">
        이용약관
      </Link>
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <Link href="/profile/privacy?back=intro" className="underline-offset-2 hover:underline">
        개인정보 처리방침
      </Link>
    </p>
  );
}

/** ONB-01 | 시작2 — 제목·설명은 위쪽에 붙고, 버튼은 아래에 붙는다. 사이는 flex-1 이 먹는다. */
export default function Intro({ covered = false }: { covered?: boolean }) {
  return (
    <div
      inert={covered || undefined}
      aria-hidden={covered || undefined}
      className="flex flex-1 flex-col bg-white"
    >
      <StatusBar tone="text-[#525252]" />

      {/* 상태바(24px) 아래로 102px → 와이어프레임의 제목 top:126px */}
      <div className="mt-[102px] shrink-0 px-[31px]">
        <h1 className="text-[22px] leading-[30px] font-bold text-[#1f1f1f]">
          제주 운전
          <br />
          오늘은 <span className="text-[#fc7f35]">덜 무섭게</span>
        </h1>
        <p className="mt-4 text-[14px] leading-[22px] text-[#525252]">
          제주를 찾는 초보 운전자에게 부담이 적은 길과
          <br />
          도착 뒤 필요한 정보까지 이어서 보여드려요.
        </p>
      </div>

      <div className="flex-1" />

      <Link
        href="/onboarding"
        className="mx-4 flex h-[52px] shrink-0 items-center justify-center rounded-lg bg-[#1f1f1f] text-[14px] font-medium text-white transition active:scale-[0.98]"
      >
        프로필 만들기
      </Link>

      <div className="mt-5">
        <Legal tone="text-[#9e9e9e]" />
      </div>
    </div>
  );
}
