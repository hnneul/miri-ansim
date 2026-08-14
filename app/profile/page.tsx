"use client";

// 마이 — 최종 와이어프레임 MY-01 | 마이 · 운전 설정 (Figma 2371:384).
// 메인화면(/home) 히어로의 프로필 버튼에서 들어온다. 값은 URL 쿼리에 실려 온 걸 그대로 되읽을 뿐
// 여기서 고치지 않는다 — 고치는 곳은 온보딩 하나고, "프로필 수정"이 거기로 되돌린다 (lib/profile.ts).
//
// 좌표는 와이어프레임의 390x844 를 옮겼지만 절대배치는 쓰지 않는다 (app/page.tsx 와 같은 이유 —
// .phone 높이가 노트북에서 844 보다 낮아질 수 있다). 아래 두 줄(안내·버전)은 flex-1 로 바닥에 붙인다.

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
 * 마스코트 이름. 와이어프레임이 "귤이 · 소형"으로 적어둔 그 자리다.
 * 경력에 따라 씨앗 → 새싹 → 감귤로 자라지만 이름은 그대로다 — 자라는 건 같은 캐릭터다.
 */
const MASCOT = "귤이";

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
    <div className="flex flex-1 flex-col bg-white">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        AppBar — 뒤로가기는 왼쪽, 제목은 화면 가운데다. 제목을 flex 흐름에 두면 버튼 폭만큼 밀려
        가운데가 아니게 되므로 absolute 로 띄우고 클릭은 통과시킨다.
        back() 이 아니라 /home 으로 밀어 넣는다 — 이 URL 을 직접 열거나 새로고침하면 back() 은 앱 밖으로 나간다.
      */}
      <div className="relative mx-4 flex h-11 shrink-0 items-center">
        <button
          onClick={() => router.push(`/home?${searchParams}`)}
          aria-label="뒤로"
          className="-ml-2 flex size-11 shrink-0 items-center justify-center text-[22px] leading-none text-[#262626]"
        >
          ‹
        </button>
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-[13.6px] font-medium text-[#7b7b7b]">
          마이페이지
        </h1>
      </div>

      {/*
        driver-profile — 온보딩이 받아간 값을 사람 말로 되돌려 준다.
        아바타는 경력에 따라 자란다 (씨앗 → 새싹 → 감귤). 배경 지운 PNG 라 원 안에 담는다.
        ponytail: 와이어프레임은 여기에 공원 배경이 깔린 새 일러스트 한 장을 쓰는데, 그러면 세 단계가
        한 장으로 굳어 경력이 자라는 게 안 보인다. 그 그림을 쓰려면 단계별로 세 장이 있어야 한다.
      */}
      <div className="mt-3 flex shrink-0 items-start gap-6 px-7">
        <img
          src={me.src}
          alt={me.alt}
          className="size-[94px] shrink-0 rounded-full bg-[#e2f1fe] object-contain"
        />
        <div className="min-w-0 pt-1">
          <p className="text-[12px] leading-normal text-[#616161]">내 운전 설정</p>
          <p className="mt-1 text-[20px] leading-normal font-bold text-[#1f1f1f]">
            {MASCOT} · <span className="text-[18px]">{LABELS.vehicleSize[profile.vehicleSize]}</span>
          </p>
          <div className="mt-2 text-[11px] leading-[1.55] text-[#616161]">
            <p>
              운전 {me.tier} · {LABELS.drivingFrequency[profile.drivingFrequency]}
            </p>
            <p>제주 운전 경험 {profile.jejuExperience ? "있음" : "없음"}</p>
            {/* 안 고르고 넘어갈 수 있는 단계라 없으면 줄째 뺀다 — "어려움: " 만 남으면 빈칸으로 보인다 */}
            {concerns.length > 0 && <p>어려움: {concerns.map((i) => CONCERNS[i].short).join(" · ")}</p>}
          </div>
        </div>
      </div>

      {/*
        와이어프레임은 아바타 오른쪽 아래에 📷 배지를 얹는데 뺐다 — 사진을 올리는 기능이 없고,
        이 아바타는 올리는 그림이 아니라 운전 경력에서 나온 그림이다. 누를 수 있어 보이는데
        아무 일도 안 하면 시연에서 더 나쁘다 (/home 프로모 카드와 같은 판단).
      */}
      <button
        onClick={() => router.push("/onboarding")}
        className="mx-[34px] mt-[26px] h-[37px] shrink-0 rounded-[32px] bg-[#f5f5f5] text-[13px] text-[#1f1f1f] transition active:scale-[0.99]"
      >
        프로필 수정
      </button>

      <h2 className="mt-[52px] shrink-0 px-10 text-[18px] leading-normal font-bold text-[#1f1f1f]">서비스 정보</h2>

      <div className="mt-2 flex shrink-0 flex-col gap-2.5 px-9">
        {MENU.map((m) => (
          <div
            key={m.title}
            className="flex h-[68px] items-center justify-between rounded-[12px] border border-[#e6e6e6] bg-white pr-4 pl-[13px]"
          >
            <div className="min-w-0">
              <p className="text-[15px] leading-normal font-medium text-[#1f1f1f]">{m.title}</p>
              <p className="mt-[5px] text-[12px] leading-normal text-[#616161]">{m.desc}</p>
            </div>
            <span aria-hidden className="text-[22px] leading-none font-bold text-[#616161]">
              ›
            </span>
          </div>
        ))}
      </div>

      {/* 아래 두 줄은 바닥에 붙는다 — 프레임이 낮아지면 여기 여백부터 줄어든다 */}
      <div className="min-h-6 flex-1" />

      <p className="mx-4 shrink-0 rounded-[12px] bg-[#f5f7f7] px-4 py-[9px] text-center text-[12px] leading-normal text-[#616161]">
        내 설정은 추천 순위를 만드는 데 쓰지 않고,
        <br />
        부담 설명을 나에게 맞추는 데만 사용해요.
      </p>

      <p className="mt-[23px] shrink-0 pb-6 text-center text-[11px] leading-none font-medium text-[#616161]">
        미리 안심 · 앱 버전 1.0.0
      </p>
    </div>
  );
}
