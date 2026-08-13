"use client";

// 온보딩 진입 — 최종 와이어프레임 ONB-01 시작1(스플래시) → 시작2(소개) 두 장이다.
// 프로필 다섯 줄을 묻기 전에 이게 뭘 해주는 앱인지 한 문장으로 먼저 말한다.
//
// 좌표는 와이어프레임의 390x844 를 그대로 옮겼지만 절대배치는 쓰지 않는다 —
// .phone 이 노트북에서 height: min(844px, 100dvh - 2.5rem) 이라 844 보다 낮아질 수 있고,
// 그때 absolute top-[728px] 버튼은 프레임 밖으로 밀려난다. 가운데를 flex-1 이 먹는 구조라
// 프레임이 줄면 여백부터 줄어든다.

import { useEffect, useState } from "react";
import Link from "next/link";

/** 스플래시가 소개 화면으로 넘어가기까지 (ms). 와이어프레임에 시간 표기가 없어 정한 값이다. */
const SPLASH_MS = 1600;

export default function Onboarding() {
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return splash ? <Splash /> : <Intro />;
}

/**
 * 상태바. 와이어프레임에 그려진 목업이라 실제 시각이 아니라 9:41 로 고정한다 —
 * 시연 화면에서 폰처럼 보이게 하는 장식이고, 진짜 시계를 넣으면 리허설 스크린샷마다 값이 달라진다.
 */
function StatusBar({ tone }: { tone: string }) {
  return (
    <div className={`flex shrink-0 justify-between px-4 pt-2 text-[11px] leading-4 font-medium ${tone}`}>
      <span>9:41</span>
      {/* 배터리·신호 아이콘 자리 — 와이어프레임이 문자로 그려둔 것을 그대로 쓴다 */}
      <span aria-hidden>●&nbsp;&nbsp;◒&nbsp;&nbsp;▮</span>
    </div>
  );
}

/** 이용약관·개인정보 처리방침. 두 화면 모두 하단 28px 자리에 같은 문구가 앉는다 (글자색만 다르다). */
function Legal({ tone }: { tone: string }) {
  return (
    <p className={`shrink-0 pb-7 text-center text-[11px] leading-4 font-medium ${tone}`}>
      이용약관&nbsp;&nbsp;·&nbsp;&nbsp;개인정보 처리방침
    </p>
  );
}

/** ONB-01 | 시작 1 — 주황 전면에 로고만. 로고는 프레임 정중앙이다 (390x844 기준 194.5, 422.5). */
function Splash() {
  return (
    <div className="flex flex-1 flex-col bg-[#fc7f35]">
      <StatusBar tone="text-[#525252]" />
      <div className="flex flex-1 items-center justify-center">
        <h1 className="font-logo text-[43.267px] leading-[59px] text-white">길 안심 제주</h1>
      </div>
      <Legal tone="text-[#1f1f1f]" />
    </div>
  );
}

/** ONB-01 | 시작2 — 제목·설명은 위쪽에 붙고, 버튼은 아래에 붙는다. 사이는 flex-1 이 먹는다. */
function Intro() {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <StatusBar tone="text-[#525252]" />

      {/* 상태바(24px) 아래로 102px → 와이어프레임의 제목 top:126px */}
      <div className="mt-[102px] shrink-0 px-[31px]">
        <h1 className="text-[22px] leading-[30px] font-bold text-[#1f1f1f]">
          제주 운전,
          <br />
          오늘은 <span className="text-[#fc7f35]">덜 무섭게</span>.
        </h1>
        <p className="mt-4 text-[14px] leading-[22px] text-[#525252]">
          제주를 찾는 초보 운전자에게 부담이 적은 길과
          <br />
          도착 뒤 필요한 정보까지 이어서 보여드려요.
        </p>
      </div>

      <div className="flex-1" />

      <Link
        href="/profile"
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
