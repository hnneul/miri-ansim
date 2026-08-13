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
import StatusBar from "./StatusBar";

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

/** 이용약관·개인정보 처리방침. 두 화면 모두 하단 28px 자리에 같은 문구가 앉는다 (글자색만 다르다). */
function Legal({ tone }: { tone: string }) {
  return (
    <p className={`shrink-0 pb-7 text-center text-[11px] leading-4 font-medium ${tone}`}>
      이용약관&nbsp;&nbsp;·&nbsp;&nbsp;개인정보 처리방침
    </p>
  );
}

/**
 * ONB-01 | 시작 1 — 주황 전면에 캐릭터와 로고.
 *
 * 와이어프레임은 캐릭터 상자(248x248)를 top:232 에, 로고를 top:480 에 둔다 — 둘이 딱 붙어 있고,
 * 눈에 보이는 사이 간격은 PNG 의 투명 여백이 만든다. 그래서 여기서도 gap 없이 그냥 쌓는다.
 *
 * 세로 위치는 좌표로 박지 않고 flex-1 로 가운데를 먹인다 — .phone 이 노트북에서 844 보다
 * 낮아질 수 있어 좌표를 박으면 그때 잘린다 (파일 첫 주석 참고). 다만 와이어프레임은 이 묶음을
 * 정중앙이 아니라 44px 위(top:232)에 두므로, 아래에만 그 두 배(88px)를 비워 그만큼 끌어올린다.
 * 시선이 가운데보다 살짝 위에 머무는 게 스플래시에서는 더 가운데처럼 보인다.
 *
 * 캐릭터는 원본이 1086x1448 이라 표시 크기(248)의 두 배가 넘어 900px 로 줄여 넣었다.
 * 투명 PNG 라 주황 위에 바로 뜬다 — 와이어프레임의 rounded-full 은 보이지 않으므로 옮기지 않았다.
 */
function Splash() {
  return (
    <div className="flex flex-1 flex-col bg-[#fc7f35]">
      <StatusBar tone="text-[#525252]" />
      <div className="flex flex-1 flex-col items-center justify-center pb-[88px]">
        <img src="/character/splash.png" alt="" className="size-[248px] shrink-0 object-cover" />
        <h1 className="font-logo shrink-0 text-[43.267px] leading-[59px] text-white">미리 안심</h1>
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
