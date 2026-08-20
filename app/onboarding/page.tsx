"use client";

// 프로필 온보딩 — 와이어프레임 ONB 섹션의 네 장(익숙함·제주 경험·차량 크기·부담 유형)이 전부다.
// 그려지지 않은 화면을 지어내면 와이어프레임과 앱이 갈라진다.
//
// 첫 장은 원래 "일주일에 며칠 운전하나요"였다. 그걸로는 왕초보/초보/익숙이 안 갈려서 —
// 매일 모는 사람도 낯선 길은 무섭다 — 자기 인식을 직접 묻는 것으로 바꿨다. 첫 장 주석 참고.
//
// 여기서 묻지 않는 주행 시간대는 DEFAULT_PROFILE 의 "day" 로 남는다. 부담이 큰 쪽은
// 야간(×1.15)이므로 이건 보수적인 기본값이 아니다 — 관광객이 대부분 낮에 움직인다고 보고
// 문항을 안 늘린 판단이고, 그래서 야간 가중치는 앱에서 켜지지 않는다. 계산 기준 화면도
// 그 줄을 안 적는다 (lib/serviceinfo.ts). 묻게 되면 둘을 같이 되살린다.
//
// 고른 값은 URL 쿼리로 메인화면(/home)에 넘기고, 거기서 목적지를 붙여 /result 까지 그대로 흘러간다
// (lib/profile.ts). 저장소가 따로 없어서 새로고침하면 처음부터지만, 네 탭짜리 플로우라
// 다시 하는 비용이 저장 코드보다 싸다.
//
// 좌표는 390x844 절대배치를 flex 로 옮겼다 (app/page.tsx 와 같은 이유 — .phone 높이가
// 노트북에서 844 보다 낮아질 수 있고, 그때 여백(flex-1)부터 줄어야 버튼이 안 잘린다).

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import type { DriverProfile } from "@/lib/score";
import { CONCERNS, DEFAULT_PROFILE, parseConcerns, parseProfile, toProfileQuery } from "@/lib/profile";

type Step = {
  /** "N / 4" 옆에 붙는 부가 문구 (마지막 단계 "여러 개 선택 가능") */
  note?: string;
  /** 제목. 와이어프레임이 두 줄로 그려서 줄 단위로 받는다. */
  title: [string, string];
  subtitle: string;
  /** 하단 버튼 아래 11px 안내 문구 */
  hint: string;
  /**
   * patch: 이 옵션이 프로필에 반영하는 값. 선택지 수가 프로필 값 수보다 많아
   * 여러 옵션이 같은 값으로 접히기도 한다 — 각 자리의 주석 참고.
   * multi 단계(부담 유형)는 프로필에 없는 값이라 patch 가 비어 있다.
   */
  options: { label: string; desc: string; patch?: Partial<DriverProfile> }[];
  /** 여러 개 선택 가능 + 마지막 옵션("해당 없음")은 배타 */
  multi?: boolean;
};

const STEPS: Step[] = [
  {
    title: ["운전이 얼마나", "익숙하신가요?"],
    subtitle: "지금 내 느낌과 가장 가까운 쪽을 골라주세요.",
    hint: "익숙한 정도는 부담 계산과 길 설명에 함께 쓰여요.",
    // 전에는 이 자리가 "일주일에 며칠 운전하나요"였다. 빈도는 익숙함의 대리 지표라서 자주 어긋난다 —
    // 매일 출퇴근만 하는 사람도 낯선 길은 무섭고, 반대도 있다. 그래서 대리 지표 대신 직접 묻는다.
    //
    // 한 문항이 두 값을 정한다: 점수용 티어(experienceYears → lib/score.ts EXP_WEIGHT)와
    // 브리핑 말투용 빈도(drivingFrequency → lib/briefing.ts 조건말). 빈도는 점수에 안 들어간다 —
    // 같은 대답 하나를 두 번 곱하면 초보만 부풀기 때문이다 (lib/score.ts weight 주석).
    options: [
      {
        label: "왕초보",
        desc: "아직 운전이 무서워요",
        patch: { experienceYears: 1, drivingFrequency: "low" },
      },
      {
        label: "초보",
        desc: "낯선 길은 긴장돼요",
        patch: { experienceYears: 3, drivingFrequency: "medium" },
      },
      {
        label: "익숙",
        desc: "처음 가는 길도 괜찮아요",
        patch: { experienceYears: 10, drivingFrequency: "high" },
      },
    ],
  },
  {
    title: ["제주에서 운전한 경험이", "몇 번 정도 있나요?"],
    subtitle: "렌터카·자차 모두 포함해 가장 가까운 횟수를 골라주세요.",
    hint: "제주에서 운전한 횟수만 알려주세요.",
    // 점수의 제주 경험은 불리언이다. 1회는 "있음"이 아니라 "없음"으로 접는다 —
    // 한 번 와봤다고 가중치를 빼면 첫 방문과 다름없는 부담이 과소 계상된다.
    options: [
      { label: "아직 없음", desc: "이번이 첫 제주 운전이에요", patch: { jejuExperience: false } },
      { label: "1회", desc: "한 번 운전해봤어요", patch: { jejuExperience: false } },
      { label: "2~3회", desc: "몇 번 경험해봤어요", patch: { jejuExperience: true } },
      { label: "4회 이상", desc: "제주 도로가 익숙한 편이에요", patch: { jejuExperience: true } },
    ],
  },
  {
    title: ["운전할 차량의 크기는", "어느 정도인가요?"],
    subtitle: "제주에서 이용할 차와 가장 가까운 크기를 골라주세요.",
    hint: "차량 크기는 좁은 길·주차 공간의 부담 계산에 반영돼요.",
    // 점수의 차량 크기는 차폭 3구간(compact/sedan/suv)이다. 소형(아반떼 1.83m)과
    // 중형(쏘나타 1.86m)은 폭이 거의 같아 한 구간(sedan)으로 접는다 — lib/score.ts 주석 참고.
    options: [
      { label: "경차", desc: "모닝·레이처럼 작은 차예요", patch: { vehicleSize: "compact" } },
      { label: "소형차", desc: "아반떼급 승용차예요", patch: { vehicleSize: "sedan" } },
      { label: "중형차", desc: "쏘나타·투싼급 차량이에요", patch: { vehicleSize: "sedan" } },
      { label: "대형·SUV", desc: "차체가 크거나 긴 차량이에요", patch: { vehicleSize: "suv" } },
    ],
  },
  {
    note: " · 여러 개 선택 가능",
    title: ["어떤 길에서 특히", "긴장되시나요?"],
    subtitle: "피하고 싶거나, 안내를 더 자세히 받고 싶은 상황을 골라주세요.",
    hint: "선택 내용은 경로 추천과 길 설명에 반영되며 언제든 바꿀 수 있어요.",
    multi: true,
    // 선택지는 마이 화면과 공유한다 (lib/profile.ts CONCERNS) — 거기서 되보여 주므로 문구가 갈리면 안 된다.
    // 고른 인덱스는 hard= 로 실려 점수 가중치와 AI 길 설명에 함께 쓰인다.
    options: CONCERNS,
  },
];

/**
 * 이미 있는 프로필 → 단계별 선택 인덱스. 마이 화면의 "프로필 수정"으로 들어오면 네 문항을
 * 처음부터 다시 답하게 하지 않는다.
 *
 * **접힌 선택지는 첫 자리로 편다.** patch 가 값 하나로 접히는 자리가 둘 있다 —
 * 제주 경험 "아직 없음"·"1회"가 둘 다 false, 차량 "소형차"·"중형차"가 둘 다 sedan.
 * 되돌릴 때 어느 쪽을 골랐는지는 URL 에 남아 있지 않으므로 앞의 것을 짚는다. 점수는 같고,
 * 사용자가 다르게 골랐다면 그 자리에서 다시 누르면 된다.
 * ponytail: 고른 자리를 그대로 되살리려면 쿼리에 인덱스를 따로 실어야 한다 — 점수가 안 갈려서 안 했다.
 */
function picksOf(sp: URLSearchParams): number[][] {
  const query = Object.fromEntries(sp);
  const profile = parseProfile(query);
  return STEPS.map((s) =>
    s.multi
      ? parseConcerns(query)
      : // patch 의 모든 값이 프로필과 같은 첫 선택지. 없으면 빈 배열이라 다음 버튼이 잠긴 채로 남는다
        [
          s.options.findIndex((o) =>
            Object.entries(o.patch ?? {}).every(([k, v]) => profile[k as keyof DriverProfile] === v),
          ),
        ].filter((i) => i >= 0),
  );
}

export default function OnboardingPage() {
  // useSearchParams 는 경계를 요구한다 (/nearby · /calm 과 같은 모양)
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

function Onboarding() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * 고치러 들어온 것인가. 프로필 쿼리를 달고 온 경우다 (app/profile 의 "프로필 수정").
   * 처음 만드는 사람은 쿼리가 없어 선택이 비어 있고, 그래서 다음 버튼도 잠긴 채 시작한다.
   */
  const 고치는중 = searchParams.has("exp");
  const [step, setStep] = useState(0);
  // 단계별 선택된 옵션 인덱스. 단일 선택 단계는 길이 0 또는 1, multi 단계만 여러 개.
  const [picks, setPicks] = useState<number[][]>(() =>
    고치는중 ? picksOf(searchParams) : STEPS.map(() => []),
  );
  const cur = STEPS[step];
  const picked = picks[step];

  function select(i: number) {
    const none = cur.options.length - 1; // multi 의 "해당 없음" — 다른 선택과 공존하지 않는다
    const next = !cur.multi
      ? [i]
      : i === none
        ? [i]
        : picked.includes(i)
          ? picked.filter((p) => p !== i)
          : [...picked.filter((p) => p !== none), i];
    setPicks(picks.map((p, s) => (s === step ? next : p)));
  }

  function goNext() {
    if (step < STEPS.length - 1) return setStep(step + 1);
    // 각 단계의 patch 를 겹쳐 프로필 완성. 다음 버튼이 선택 전엔 잠겨 있어 빠진 단계는 없다.
    // 여기서 안 묻는 시간대는 DEFAULT_PROFILE 값 그대로 나간다 (파일 첫 주석 참고).
    const profile = STEPS.reduce<DriverProfile>(
      (acc, s, idx) => ({ ...acc, ...s.options[picks[idx][0]]?.patch }),
      DEFAULT_PROFILE,
    );
    // 부담 유형(마지막 단계)은 patch 가 없어 프로필에 안 접힌다 — 고른 인덱스를 따로 넘긴다
    router.push(`/home${toProfileQuery(profile, picks[STEPS.length - 1])}`);
  }

  return (
    <div className="flex flex-1 flex-col bg-white">
      <StatusBar tone="text-[#525252]" />

      {/* AppBar/Back — 44px 터치 영역 + 24px 화살표 (피그마 컴포넌트 설명 그대로) */}
      <div className="mx-4 flex h-14 shrink-0 items-center gap-3">
        <button
          /*
            1단계의 뒤로가 어디로 가느냐는 **어디서 왔느냐**에 달렸다. 처음 만드는 사람은
            소개 화면으로 돌아가고(스플래시 없는 주소 — app/intro/page.tsx), 고치러 온 사람은
            들고 온 프로필 그대로 마이 화면으로 되돌아간다. 전에는 둘 다 /intro 로 나가서,
            잘못 눌러 들어온 사람이 프로필을 통째로 잃고 온보딩을 다시 통과해야 했다.
          */
          onClick={() =>
            step > 0
              ? setStep(step - 1)
              : router.push(고치는중 ? `/profile?${searchParams}` : "/intro")
          }
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center transition hover:opacity-40 active:scale-90"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
        <h1 className="text-[18px] leading-[26px] font-bold text-[#1f1f1f]">내 운전 알려주기</h1>
      </div>

      <div className="shrink-0 px-4 pt-2">
        <p className="text-[12px] leading-[18px] font-medium text-[#525252]">
          {step + 1} / {STEPS.length}
          {cur.note}
        </p>
        <div className="mt-1.5 flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-[5px] flex-1 rounded-[3px] ${i <= step ? "bg-[#fc7f35]" : "bg-[#e5e5e5]"}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 shrink-0 px-4">
        <h2 className="text-[24px] leading-[34px] font-bold text-[#1f1f1f]">
          {cur.title[0]}
          <br />
          {cur.title[1]}
        </h2>
        <p className="mt-2.5 text-[14px] leading-[22px] text-[#525252]">{cur.subtitle}</p>
      </div>

      {cur.multi ? (
        <div className="mt-8 grid shrink-0 grid-cols-2 gap-4 px-4">
          {cur.options.map((o, i) => {
            const on = picked.includes(i);
            return (
              <button
                key={o.label}
                onClick={() => select(i)}
                aria-pressed={on}
                className={`flex h-[72px] flex-col items-start justify-center gap-[3px] rounded-[14px] border-[1.5px] px-[13px] text-left transition ${
                  on ? "border-[#ff7b33] bg-[#ff7b33] text-white" : "border-[#e5e5e5] bg-white"
                }`}
              >
                <span className={`text-[14px] leading-[22px] font-bold ${on ? "" : "text-[#1f1f1f]"}`}>
                  {o.label}
                </span>
                <span className={`text-[11px] leading-[17px] ${on ? "" : "text-[#525252]"}`}>{o.desc}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-8 flex shrink-0 flex-col gap-4 px-4">
          {cur.options.map((o, i) => {
            const on = picked.includes(i);
            return (
              <button
                key={o.label}
                onClick={() => select(i)}
                aria-pressed={on}
                className={`flex h-[62px] items-center gap-3 rounded-[14px] border-[1.5px] px-4 text-left transition ${
                  on ? "border-[#ff7b33] bg-[#ff7b33] text-white" : "border-[#e5e5e5] bg-white"
                }`}
              >
                <span className={`w-[76px] shrink-0 text-[16px] leading-6 font-bold ${on ? "" : "text-[#1f1f1f]"}`}>
                  {o.label}
                </span>
                <span className={`text-[13px] leading-5 ${on ? "" : "text-[#525252]"}`}>{o.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={goNext}
        disabled={picked.length === 0}
        className="mx-4 h-[52px] shrink-0 rounded-lg bg-[#1f1f1f] text-[14px] font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
      >
        {step === STEPS.length - 1 ? "다 골랐어요" : "다음"}
      </button>
      <p className="mt-4 shrink-0 pb-7 text-center text-[11px] leading-4 font-medium text-[#9e9e9e]">{cur.hint}</p>
    </div>
  );
}
