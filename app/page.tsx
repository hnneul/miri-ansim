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

/**
 * 스플래시가 완전히 사라지기까지 (ms). 와이어프레임에 시간 표기가 없어 정한 값이다.
 * globals.css 의 .splash-layer 딜레이(1700) + 길이(500) 와 같아야 한다 — 자세한 건 거기 주석에.
 */
const SPLASH_MS = 2200;

export default function Onboarding() {
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  /*
   * 소개 화면을 처음부터 깔아두고 스플래시를 그 위에 덮는다 — 예전처럼 둘을 갈아끼우면
   * 겹치는 순간이 없어 페이드할 대상이 없다. 주황 레이어가 투명해지는 동안 이미 아래에 있는
   * 흰 화면이 그대로 드러난다.
   *
   * 상태바와 하단 약관 줄은 두 화면에서 위치가 같아 페이드 내내 제자리에 머문다.
   * 덕분에 화면이 통째로 바뀌는 게 아니라 주황만 걷히는 것처럼 보인다.
   */
  return (
    <div className="relative flex flex-1 flex-col">
      <Intro />
      {splash && <Splash />}
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
 *
 * 소개 화면 위에 덮이는 레이어라 flex-1 대신 absolute 다.
 * z-40 인 이유 — Dynamic Island(globals.css .phone::before)가 z-50 이라 그보다 낮아야 안 가린다.
 * 애니메이션은 globals.css 의 .splash-char(캐릭터 통통) / .splash-layer(레이어째 페이드)가 쥔다.
 */
function Splash() {
  return (
    <div className="splash-layer absolute inset-0 z-40 flex flex-col bg-[#fc7f35]">
      <StatusBar tone="text-[#525252]" />
      <div className="flex flex-1 flex-col items-center justify-center pb-[88px]">
        <img src="/character/splash.png" alt="" className="splash-char size-[248px] shrink-0 object-cover" />
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
