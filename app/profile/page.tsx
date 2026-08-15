"use client";

// 마이 — 최종 와이어프레임 MY-01 | 마이 · 운전 설정 (Figma 2371:384).
// 메인화면(/home) 히어로의 프로필 버튼에서 들어온다. 값은 URL 쿼리에 실려 온 걸 되읽는다 (lib/profile.ts).
//
// **온보딩이 안 묻는 두 값을 여기서 고친다.** 온보딩은 와이어프레임에 그려진 네 장(빈도·제주경험·
// 차량·부담유형)뿐이라 운전 경력과 주행 시간대를 정할 곳이 없었고, 그래서 둘이 늘 기본값에
// 묶여 있었다 — 화면에 "운전 1년 이하"가 고정으로 뜨고, 점수의 isNovice(lib/score.ts)도 늘 참이었다.
// 온보딩에 화면을 더 지어내는 대신 여기에 칩을 놓는다. 나머지 세 값은 온보딩이 정한 대로 보여주기만 한다.
//
// 좌표는 와이어프레임의 390x844 를 옮겼지만 절대배치는 쓰지 않는다 (app/page.tsx 와 같은 이유 —
// .phone 높이가 노트북에서 844 보다 낮아질 수 있다). 아래 두 줄(안내·버전)은 flex-1 로 바닥에 붙인다.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { CONCERNS, LABELS, OPTIONS, characterOf, parseProfile, parseConcerns } from "@/lib/profile";

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

/** 경력 값 → 화면에 쓰는 말. lib/profile.ts 의 CHARACTERS.tier 와 같은 구간이다. */
const EXP_LABEL: Record<number, string> = { 1: "1년 이하", 3: "2~5년", 10: "5년 이상" };

/** 한 줄짜리 설정. 라벨 아래 칩이 깔린다 */
function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-[12px] leading-normal text-[#616161]">{label}</p>
      <div className="mt-2 flex gap-2">{children}</div>
    </div>
  );
}

/** 온보딩 선택지와 같은 생김새 — 켜면 주황이 차고 글자가 희어진다 */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-[38px] rounded-full border-[1.5px] px-4 text-[13px] font-medium transition active:scale-[0.98] ${
        on ? "border-[#ff7b33] bg-[#ff7b33] text-white" : "border-[#e5e5e5] bg-white text-[#1f1f1f]"
      }`}
    >
      {children}
    </button>
  );
}

function Profile() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const profile = parseProfile(query);
  const me = characterOf(profile.experienceYears);
  const concerns = parseConcerns(query);

  /*
   * 고른 값을 URL 에 얹는다. replace 라 뒤로가기 기록이 안 쌓인다 — 칩을 세 번 누르고 뒤로 가면
   * 세 번 되짚는 게 아니라 온 곳으로 나가야 맞다. 상태를 따로 안 두는 이유는 이 앱이 프로필을
   * 처음부터 URL 로 나르기 때문이다 (lib/profile.ts). 여기서만 useState 를 쓰면 뒤로가기·새로고침에
   * 값이 날아가고, /home 으로 돌아갈 때 옛 쿼리를 도로 들고 가게 된다.
   */
  function set(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    router.replace(`/profile?${next}`, { scroll: false });
  }

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

        프로필 사진은 와이어프레임 그대로 한 장이다(Figma 2371:392, 공원의 풋귤 캐릭터).
        배경이 그려진 그림이라 원을 꽉 채우게 object-cover 로 담는다 — 다른 화면의 아바타처럼
        배경을 지운 컷아웃이 아니라서 뒤에 색을 깔 필요가 없다.
        ponytail: 이 한 장이라 여기서는 경력이 자라는 게 안 보인다 (다른 화면 아바타는 여전히
        씨앗 → 새싹 → 감귤로 바뀐다, lib/profile.ts CHARACTERS). 여기서도 자라게 하려면
        같은 화풍으로 단계별 세 장이 있어야 한다.
      */}
      <div className="mt-3 flex shrink-0 items-start gap-6 px-7">
        <img
          src="/character/profile.png"
          alt="내 프로필 사진"
          className="size-[94px] shrink-0 rounded-full object-cover"
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
        이 사진은 올리는 그림이 아니다. 누를 수 있어 보이는데 아무 일도 안 하면 시연에서 더 나쁘다
        (/home 프로모 카드와 같은 판단).

        온보딩은 네 값(빈도·제주경험·차량·부담유형)을 처음부터 다시 고르는 자리다.
        여기서 고친 경력·시간대는 온보딩이 안 건드리므로 쿼리에 실어 보내 살려둔다 —
        안 실으면 온보딩을 한 번 돌 때마다 방금 고친 두 값이 기본값으로 되돌아간다.
      */}
      <button
        onClick={() => router.push(`/onboarding?${searchParams}`)}
        className="mx-[34px] mt-[26px] h-[37px] shrink-0 rounded-[32px] bg-[#f5f5f5] text-[13px] text-[#1f1f1f] transition active:scale-[0.99]"
      >
        프로필 수정
      </button>

      {/*
        온보딩이 안 묻는 두 값. 칩을 누르면 URL 이 바뀌고 위 카드의 문구가 곧바로 따라 움직인다 —
        "설정한 대로 안 바뀐다"는 게 원래 문제라, 바뀌는 걸 같은 화면에서 보여주는 게 중요하다.
      */}
      <div className="mt-8 shrink-0 px-9">
        <Setting label="운전 경력">
          {OPTIONS.experienceYears.map((v) => (
            <Chip key={v} on={profile.experienceYears === v} onClick={() => set("exp", String(v))}>
              {EXP_LABEL[v]}
            </Chip>
          ))}
        </Setting>
        <Setting label="주로 운전하는 때">
          {OPTIONS.timeOfDay.map((v) => (
            <Chip key={v} on={profile.timeOfDay === v} onClick={() => set("time", v)}>
              {LABELS.timeOfDay[v]}
            </Chip>
          ))}
        </Setting>
      </div>

      <h2 className="mt-8 shrink-0 px-10 text-[18px] leading-normal font-bold text-[#1f1f1f]">서비스 정보</h2>

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
