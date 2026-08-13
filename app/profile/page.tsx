"use client";

// 마이 — 최종 와이어프레임 "프로필" 섹션(Figma 2160:2502).
// 메인화면(/home) 히어로의 프로필 버튼에서 들어온다. 값은 URL 쿼리에 실려 온 걸 그대로 되읽을 뿐
// 여기서 고치지 않는다 — 고치는 곳은 온보딩 하나고, "재설정"이 거기로 되돌린다 (lib/profile.ts).
//
// 좌표는 와이어프레임의 390x844 를 옮겼지만 절대배치는 쓰지 않는다 (app/page.tsx 와 같은 이유 —
// .phone 높이가 노트북에서 844 보다 낮아질 수 있다). 세로로 넘치면 .phone 이 스크롤한다.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { CONCERNS, LABELS, characterOf, parseProfile, parseConcerns } from "@/lib/profile";

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}

/**
 * 서비스 정보 네 줄. 와이어프레임에 대응 화면이 아직 없다.
 * ponytail: 화면이 생기면 여기 href 를 채우고 div → Link 로 바꾼다.
 */
const MENU = [
  { title: "부담점수 계산 기준", desc: "길 근거와 가중치 보기" },
  { title: "데이터 출처 6종", desc: "출처와 갱신일 보기" },
  { title: "개인정보 처리방침", desc: "수집 항목 확인" },
  { title: "이용약관", desc: "서비스 이용 기준" },
];

function Profile() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const profile = parseProfile(query);
  const me = characterOf(profile.experienceYears);
  const concerns = parseConcerns(query);

  return (
    <div className="flex flex-1 flex-col bg-[#f7fafd]">
      <StatusBar tone="text-[#525252]" />

      {/*
        와이어프레임은 여기서 나가는 길이 하단 탭바인데 /home 에 탭바가 없어서 이 화면만 달면 어긋난다.
        AppBar 뒤로가기는 온보딩(app/onboarding)이 이미 쓰는 골격이라 그대로 가져왔다.
        ponytail: 하단 탭바(Figma 2153:1985)를 만들면 /home 과 같이 달고 이 버튼을 뺀다.
      */}
      <div className="mx-4 flex h-11 shrink-0 items-center">
        {/* back() 이 아니라 /home 으로 밀어 넣는다 — 이 URL 을 직접 열거나 새로고침하면 back() 은 앱 밖으로 나간다 */}
        <button
          onClick={() => router.push(`/home?${searchParams}`)}
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center -ml-[10px]"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
      </div>

      <h1 className="shrink-0 px-4 text-[22px] leading-[30px] font-bold text-[#1f1f1f]">마이</h1>

      {/* driver-profile — 온보딩이 받아간 값을 사람 말로 되돌려 준다 */}
      <div className="mt-[18px] shrink-0 rounded-[12px] border border-[#e5e5e5] bg-white px-5 py-[29px] mx-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] leading-[18px] text-[#525252]">내 운전 설정</p>
            <p className="mt-[10px] text-[18px] leading-[26px] font-bold whitespace-nowrap text-[#1f1f1f]">
              초보 운전자 ·{" "}
              <span className="text-[#00b816]">{LABELS.vehicleSize[profile.vehicleSize]}</span>
            </p>
            {/*
              상세 3줄. 왼쪽 맞춤이 아니라 자기들끼리 가운데 맞춤이다 — 와이어프레임이 이 블록만
              중심 x=95.5 에 놓았는데, 가장 긴 줄(151px)의 왼쪽 끝이 마침 제목과 같은 자리라
              inline-block + text-center 로 같은 그림이 나온다. 줄 길이가 바뀌어도 유지된다.
            */}
            <div className="mt-[10px] inline-block text-center text-[14px] leading-[22px] whitespace-nowrap text-[#525252]">
              <p>
                운전 {me.tier} · {LABELS.drivingFrequency[profile.drivingFrequency]}
              </p>
              <p>제주 운전 경험 {profile.jejuExperience ? "있음" : "없음"}</p>
              {/* 안 고르고 넘어갈 수 있는 단계라 없으면 줄째 뺀다 — "어려움: " 만 남으면 빈칸으로 보인다 */}
              {concerns.length > 0 && <p>어려움: {concerns.map((i) => CONCERNS[i].short).join(" · ")}</p>}
            </div>
          </div>

          {/* 아바타는 운전 경력에 따라 자란다 (씨앗 → 새싹 → 감귤). 배경 지운 PNG라 원 안에 담는다 */}
          <div className="flex shrink-0 flex-col items-center gap-[7px]">
            <img src={me.src} alt={me.alt} className="size-[100px] rounded-full bg-[#e2f1fe] object-contain" />
            <button
              onClick={() => router.push("/onboarding")}
              className="h-[23px] w-[82px] rounded-[8px] bg-[#fc7f35] text-[11px] leading-4 font-medium text-white transition active:scale-95"
            >
              재설정
            </button>
          </div>
        </div>
      </div>

      <h2 className="mt-[38px] shrink-0 px-4 text-[14px] leading-[22px] font-medium text-[#1f1f1f]">
        서비스 정보
      </h2>

      <div className="mt-2 flex shrink-0 flex-col gap-2 px-4">
        {MENU.map((m) => (
          <div
            key={m.title}
            className="flex h-[74px] items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white pl-[13px] pr-[15px]"
          >
            <div>
              <p className="text-[14px] leading-[22px] font-medium text-[#1f1f1f]">{m.title}</p>
              <p className="mt-[5px] text-[12px] leading-[18px] text-[#525252]">{m.desc}</p>
            </div>
            <span aria-hidden className="text-[18px] leading-[26px] font-bold text-[#9e9e9e]">
              ›
            </span>
          </div>
        ))}
      </div>

      <p className="mt-[17px] shrink-0 px-4 text-center text-[12px] leading-[18px] text-[#525252]">
        내 설정은 추천 순위를 만드는 데 쓰지 않고,
        <br />
        부담 설명을 나에게 맞추는 데만 사용해요.
      </p>

      <p className="mt-[35px] shrink-0 pb-8 text-center text-[11px] leading-4 font-medium text-[#9e9e9e]">
        길 안심 제주 · 앱 버전 1.0.0
      </p>
    </div>
  );
}
