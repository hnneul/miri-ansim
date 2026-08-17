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
 * 정중앙보다 33px 위(top:255)에 두므로, 아래에만 그 두 배(66px)를 비워 그만큼 끌어올린다.
 * 시선이 가운데보다 살짝 위에 머무는 게 스플래시에서는 더 가운데처럼 보인다.
 *
 * 캐릭터 상자는 263x225 다. 원본(1358x1159)이 이 비율과 똑같아 object-cover 로도 잘리지 않고,
 * 표시 크기의 두 배가 넘어 700px 로 줄여 넣었다. 투명 PNG 라 주황 위에 바로 뜬다 —
 * 와이어프레임의 rounded-[19px] 는 투명 배경이라 보이지 않으므로 옮기지 않았다.
 *
 * 소개 화면 위에 덮이는 레이어라 flex-1 대신 absolute 다.
 * z-40 인 이유 — Dynamic Island(globals.css .phone::before)가 z-50 이라 그보다 낮아야 안 가린다.
 * 애니메이션은 globals.css 가 쥔다 — .splash-rise(아래에서 떠오르며 등장) / .splash-layer(레이어째 페이드).
 * 로고는 같은 등장 동작을 120ms 늦게 받아 캐릭터 뒤를 따라 올라온다.
 */
function Splash() {
  return (
    <div className="splash-layer absolute inset-0 z-40 flex flex-col bg-[#fc7f35]">
      <StatusBar tone="text-[#525252]" />
      <div className="flex flex-1 flex-col items-center justify-center pb-[66px]">
        <img
          src="/character/splash.png"
          alt=""
          className="splash-rise h-[225px] w-[263px] shrink-0 object-cover"
        />
        {/*
          로고는 글자가 아니라 **외곽선 한 벌**이다 (아래 LOGO_PATH).
          잘난체 파일(2.7MB)을 통째로 싣던 걸 이 1.9KB 패스로 바꿨다 — 다섯 글자 쓰자고 한글
          11,172자를 받아오던 셈이었다. 라이선스가 폰트 파일의 수정·재배포를 막아 서브셋도 못 했다.

          font-display: swap 이 만들던 깜빡임도 같이 없어졌다. 전에는 폰트가 늦게 오면 Noto 로
          먼저 그렸다가 바뀌었고, 스플래시가 1.6초뿐이라 첫 방문에서는 Noto 인 채로 지나갈 수 있었다.
          이제 패스가 페이지의 일부라 늦게 올 것이 없다.

          fill=currentColor 라 색은 그대로 text-white 가 준다. 글자가 그림이 됐으니 읽히는 이름은
          sr-only 로 따로 둔다 — h1 이 비면 화면 이름이 사라진다.
          ponytail: 로고 문구를 바꾸면 패스를 다시 떠야 한다 (scripts/build-logo.py).
        */}
        <h1 className="splash-rise splash-rise-late shrink-0 text-white">
          <span className="sr-only">미리 안심</span>
          <svg
            aria-hidden
            viewBox="0 0 185.2 51.1"
            className="h-[51.1px] w-[185.2px]"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d={LOGO_PATH} />
          </svg>
        </h1>
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

/**
 * 스플래시 로고 "미리 안심"의 외곽선. 잘난체 2 를 43.267px 로 조판한 결과를 그대로 뜬 것이다
 * (viewBox 185.2x51.1). 좌표는 소수 첫째 자리까지만 남겼다 — 그대로 두면 4.9KB 인데 51px 짜리
 * 그림에서 그 아래 자리는 화면에 나타나지 않는다.
 */
const LOGO_PATH =
  "M40.7 41.4V5C40.7 2.2 38.6 0.7 36.3 0.7C34.1 0.7 32 2.2 32 5V41.4ZM26.8 39.7V9.3C26.8 3.9 25.7 2.2 20.1 2.2H9.3C3.6 2.2 2.6 3.9 2.6 9.3V32.6C2.6 38 3.6 39.7 9.3 39.7ZM11 10.4C11 9.6 11.2 9 12.2 9H17.2C18.1 9 18.3 9.6 18.3 10.4V32.9H12.5C11.3 32.9 11 32.4 11 31.4Z M83.9 41.4V5C83.9 2.2 81.9 0.7 79.6 0.7C77.3 0.7 75.3 2.2 75.3 5V41.4ZM69.3 39.5C71.9 39.5 72.9 37.8 72.9 36C72.9 34.3 71.9 32.5 69.3 32.5H56.4C54.9 32.5 54.5 32.1 54.5 30.6V25.9C54.5 24.4 54.9 24.1 56.4 24.1H69.7V8.7C69.7 4 68.2 2.3 62.4 2.3H49.9C47.2 2.3 46.2 4.2 46.2 6C46.2 7.7 47.3 9.6 49.9 9.6H60C60.9 9.6 61.1 10.2 61.1 10.7V17H53.1C47.9 17 45.8 18.9 45.8 24.1V32.4C45.8 37.6 47.9 39.5 53.1 39.5Z M138.2 11.6V5C138.2 2.2 136.2 0.7 133.9 0.7C131.6 0.7 129.6 2.2 129.6 5V31.4H138.2V19.1H139.6C142.2 19.1 143 17.1 143 15.3C143 13.6 142.2 11.6 139.6 11.6ZM113.3 24.7C120.3 24.7 125.3 21.4 125.3 15V11.2C125.3 4.8 120.3 1.4 113.2 1.4C106.2 1.4 101.2 4.8 101.2 11.2V15C101.2 21.4 106.2 24.7 113.3 24.7ZM109.5 11.2C109.5 9.1 111.2 7.9 113.2 7.9C115.3 7.8 117 9.1 117 11.2V15C117 17.1 115.3 18.3 113.2 18.3C111.2 18.3 109.5 17.1 109.5 15ZM113.2 34.7C112.4 34.7 112.2 34.5 112.2 33.7V30.5C112.2 27.7 110.3 26.3 107.9 26.3C105.4 26.3 103.4 27.7 103.4 30.5V35C103.4 39.7 104.7 41.4 109.6 41.4H136C138.6 41.4 139.6 39.8 139.6 38C139.6 36.3 138.6 34.7 136 34.7Z M182.6 5C182.6 2.2 180.6 0.7 178.3 0.7C176 0.7 173.9 2.2 173.9 5V23.2H182.6ZM158.6 15.6C161.3 16.2 162.6 18.6 162.4 22.6H170.8C171.1 14.1 167.2 9.6 160.8 9C160.9 8.2 161 7.4 161 6.4V5.1C161 2.7 159.1 1.2 156.8 1.2C154.4 1.1 152.5 2.5 152.3 4.8L152.3 6.3C152.1 11.9 150 14.5 145.9 16C144.2 16.6 143.2 17.8 143.2 19.5C143.2 21.9 144.8 23.2 147.2 23.2C150.7 23.2 155.7 20.6 158.6 15.6ZM152.4 24.7C147.2 24.7 146.2 26.3 146.2 31.2V34.9C146.2 39.8 147.2 41.4 152.4 41.4H182.6V31.1C182.6 26.3 181.7 24.7 176.6 24.7ZM155.7 35.1C154.9 35.1 154.7 35 154.7 34.1V31.9C154.7 31.1 154.9 30.8 155.7 30.8H173.1C173.9 30.8 174.1 31.1 174.1 31.9V35.1Z";
