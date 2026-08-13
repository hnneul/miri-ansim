"use client";

// 프로필 온보딩 — 최종 와이어프레임 ONB 섹션에 그려진 네 장(운전 빈도·제주 경험·차량 크기·부담 유형)이 전부다.
// 나머지 프로필 값(운전 경력·주행 시간대)은 여기서 묻지 않고 /profile 의 칩으로 고른다 —
// 그려지지 않은 화면을 지어내면 와이어프레임과 앱이 갈라진다.
//
// 고른 값은 URL 쿼리로 /profile 에 넘긴다(lib/profile.ts toProfileQuery). 저장소가 따로 없어서
// 새로고침하면 처음부터지만, 네 탭짜리 플로우라 다시 하는 비용이 저장 코드보다 싸다.
//
// 좌표는 390x844 절대배치를 flex 로 옮겼다 (app/page.tsx 와 같은 이유 — .phone 높이가
// 노트북에서 844 보다 낮아질 수 있고, 그때 여백(flex-1)부터 줄어야 버튼이 안 잘린다).

import { useState } from "react";
import { useRouter } from "next/navigation";
import StatusBar from "../StatusBar";
import type { DriverProfile } from "@/lib/score";
import { DEFAULT_PROFILE, toProfileQuery } from "@/lib/profile";

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
    title: ["일주일에 며칠 정도", "운전하시나요?"],
    subtitle: "최근 한 달을 떠올려 가장 가까운 횟수를 골라주세요.",
    hint: "최근 한 달의 평균 운전 일수를 숫자로 골라주세요.",
    // 점수의 빈도 값은 low/medium/high 셋뿐이라 네 선택지를 접는다.
    // 경계(1~2일)는 낮은 쪽으로 — 빈도를 높게 잡으면 부담 가중치가 빠져 위험이 과소 계상된다.
    options: [
      { label: "0일", desc: "거의 운전하지 않아요", patch: { drivingFrequency: "low" } },
      { label: "1~2일", desc: "주말이나 필요할 때만 해요", patch: { drivingFrequency: "low" } },
      { label: "3~4일", desc: "일주일의 절반 정도 해요", patch: { drivingFrequency: "medium" } },
      { label: "5~7일", desc: "거의 매일 운전해요", patch: { drivingFrequency: "high" } },
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
    hint: "선택 내용은 길 설명에만 사용하며 언제든 바꿀 수 있어요.",
    multi: true,
    // ponytail: 부담 유형은 아직 점수·브리핑에 안 들어간다 — 화면(ONB-06)만 먼저 옮겼다.
    // 점수에 반영하려면 lib/score.ts 의 가중치와 URL 쿼리(lib/profile.ts)에 값을 뚫어야 한다.
    options: [
      { label: "좁은 골목길", desc: "차가 마주 오면 불안해요" },
      { label: "복잡한 교차로", desc: "차선 선택이 어려워요" },
      { label: "급경사·굽은 길", desc: "오르막·커브가 부담돼요" },
      { label: "어두운 길", desc: "가로등이 적으면 긴장돼요" },
      { label: "주차 어려운 곳", desc: "공간이 좁으면 부담돼요" },
      { label: "해당 없음", desc: "특별히 부담 없어요" },
    ],
  },
];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // 단계별 선택된 옵션 인덱스. 단일 선택 단계는 길이 0 또는 1, multi 단계만 여러 개.
  const [picks, setPicks] = useState<number[][]>(STEPS.map(() => []));
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
    const profile = STEPS.reduce<DriverProfile>(
      (acc, s, idx) => ({ ...acc, ...s.options[picks[idx][0]]?.patch }),
      DEFAULT_PROFILE,
    );
    router.push(`/profile${toProfileQuery(profile)}`);
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-white from-[41.5%] to-[#d2eafe]">
      <StatusBar tone="text-[#525252]" />

      {/* AppBar/Back — 44px 터치 영역 + 24px 화살표 (피그마 컴포넌트 설명 그대로) */}
      <div className="mx-4 flex h-14 shrink-0 items-center gap-3">
        <button
          onClick={() => (step === 0 ? router.push("/") : setStep(step - 1))}
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center"
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
                  {on && "✓ "}
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
