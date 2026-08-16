"use client";

// AI 여행 코스 — 와이어프레임 "메인화면 → 여행 코스" 섹션의 입력부 (TRIP-01·02·04, 04-A~E).
//
// 여덟 장이지만 화면은 하나다. 전부 같은 TripPlan 한 덩이를 고쳐 쓰고, 다 고른 값을 마지막에
// 한 번 URL 로 넘기기 때문에 — 페이지를 여덟 개로 나누면 그 덩이를 라우트마다 다시 실어 날라야 한다.
// 온보딩(/onboarding)이 네 단계를 한 파일에 둔 것과 같은 이유다.
//
// 04-A~E 는 "적용하기"를 눌러야 반영된다. 그래서 각자 초안(draft)을 들고 있다가 그때 한 번
// 올려 보낸다 — 뒤로 나가면 고치던 값이 없던 일이 되는 게 와이어프레임의 동작이다.
//
// 색은 이 플로우 전용 토큰이다 (피그마 NEW AI Travel — accent #ff7d32, 나머지 화면의 #fc7f35 와 다르다).
//
// 좌표는 390x844 를 옮기되 절대배치는 쓰지 않는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어서
// 가운데(flex-1)부터 줄어야 하단 버튼이 안 잘린다 (app/onboarding/page.tsx 와 같은 이유).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { suggestPlaces } from "../destination/actions";
import { hereNow } from "../home/actions";
import type { LatLng } from "../RouteMap";
import type { Place } from "@/lib/geocode";
import {
  COMPANIONS,
  DEFAULT_TRIP,
  DRIVE_HOURS,
  INTERESTS,
  MAX_MUSTS,
  MAX_PER_PEOPLE,
  MOODS,
  PEOPLE,
  companionLabel,
  driveLabel,
  isReady,
  keywordLine,
  mustLabel,
  periodLabel,
  toTripQuery,
  type Companion,
  type TripPlan,
} from "@/lib/trip";

/** 타이핑이 멎고 나서 후보를 부르기까지 (app/destination/page.tsx 와 같은 값·같은 이유) */
const TYPING_MS = 250;

/**
 * TRIP-04-E 의 "제주 추천 장소". 와이어프레임에 그려진 세 곳을 그대로 둔다.
 * ponytail: 2단계에서 카카오 카테고리 검색(lib/poi.ts)으로 바꾼다 — 관광지 데이터셋이 아직 없다.
 */
const SUGGESTED = [
  { emoji: "🌿", name: "비자림", where: "제주시 · 숲길" },
  { emoji: "🌅", name: "금오름", where: "애월 · 노을" },
  { emoji: "🍊", name: "동문시장", where: "제주시 · 로컬 맛집" },
];

type View = "intro" | "taste" | "fields" | "period" | "companion" | "origin" | "drive" | "must";

/** 04 목록으로 되돌아가는 상세 화면들 — 뒤로가기 목적지가 같다 */
const DETAILS: View[] = ["period", "companion", "origin", "drive", "must"];

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function TripPage() {
  return (
    <Suspense>
      <Trip />
    </Suspense>
  );
}

function Trip() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("intro");
  const [plan, setPlan] = useState<TripPlan>(DEFAULT_TRIP);

  /** 프로필 쿼리(exp·freq…)를 물고 다닌다 — 다음 화면들이 같은 운전자로 계산해야 한다 */
  const carry = searchParams.toString();

  function back() {
    if (DETAILS.includes(view)) return setView("fields");
    if (view === "fields") return setView("taste");
    if (view === "taste") return setView("intro");
    router.push(`/home${carry ? `?${carry}` : ""}`);
  }

  function makeCourse() {
    // 여행 조건이 먼저, 프로필은 빈 자리에만 — 같은 키가 겹칠 일은 없지만 조건이 이기는 게 맞다
    const q = new URLSearchParams(toTripQuery(plan).slice(1));
    for (const [k, v] of searchParams) if (!q.has(k)) q.append(k, v);
    router.push(`/trip/course?${q}`);
  }

  if (view === "intro") return <Intro onStart={() => setView("taste")} onBack={back} />;

  if (view === "taste")
    return <TasteView plan={plan} setPlan={setPlan} onBack={back} onNext={() => setView("fields")} />;

  if (view === "fields")
    return (
      <Shell label="AI 코스 만들기" onNext={makeCourse} disabled={!isReady(plan)}>
        <Back onClick={back} />
        <div className="mt-2 shrink-0">
          <Title lines={["여행의 기본 정보를", "알려주세요"]} subtitle="이동 시간과 쉬는 간격까지 계산할게요." />
        </div>
        <div className="mt-6 flex flex-col gap-4 px-[23px]">
          <Field icon="📅" name="여행 기간" value={periodLabel(plan)} empty="날짜를 골라주세요" go={() => setView("period")} />
          <Field icon="👥" name="누구와 가나요?" value={companionLabel(plan)} empty="동행을 골라주세요" go={() => setView("companion")} />
          <Field icon="✈️" name="출발 위치" value={plan.origin || null} empty="위치를 골라주세요" go={() => setView("origin")} />
          <Field icon="🚗" name="하루 운전" value={driveLabel(plan)} empty="운전 시간을 골라주세요" go={() => setView("drive")} />
          <Field icon="📍" name="꼭 가고 싶은 곳" value={mustLabel(plan)} empty="선택 안 함" go={() => setView("must")} />
        </div>
      </Shell>
    );

  const commit = (patch: Partial<TripPlan>) => {
    setPlan({ ...plan, ...patch });
    setView("fields");
  };

  if (view === "period") return <PeriodView plan={plan} onBack={back} onApply={commit} />;
  if (view === "companion") return <CompanionView plan={plan} onBack={back} onApply={commit} />;
  if (view === "origin") return <OriginView onBack={back} onApply={commit} />;
  if (view === "drive") return <DriveView plan={plan} onBack={back} onApply={commit} />;
  return <MustView plan={plan} onBack={back} onApply={commit} />;
}

/** 골라 있으면 빼고 없으면 넣는다. 화면 순서로 정렬해 두면 URL 도 같은 순서가 된다. */
const toggle = (picked: number[], i: number) =>
  picked.includes(i) ? picked.filter((p) => p !== i) : [...picked, i].sort((a, b) => a - b);

/* ─────────────────────────────── 공통 뼈대 ─────────────────────────────── */

/**
 * 모든 화면이 같은 모양이다 — 상태바 · 머리 · 본문 · 바닥 버튼.
 * 본문만 스크롤한다: 인원 카운터(04-B)나 추천 장소(04-E)는 844 안에 안 들어간다.
 * 버튼 아래 67px 은 와이어프레임 값이다 (버튼 top 729 + 높이 48 = 777, 844 - 777).
 */
function Shell({
  children,
  label,
  onNext,
  disabled,
  note,
}: {
  children: React.ReactNode;
  label: string;
  onNext: () => void;
  disabled?: boolean;
  /** 버튼 아래 작은 안내. 없으면 그 자리는 여백이다 (통합 화면만 쓴다) */
  note?: string;
}) {
  return (
    // min-h-0 이 있어야 아래 스크롤 영역이 .phone 높이 안에 갇힌다 — flex 자식의 기본 min-height 는
    // auto 라, 없으면 내용이 길 때(장소 검색 결과) 이 상자째 늘어나 버튼이 프레임 밖으로 밀린다.
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {/* 본문과 버튼 사이 20 · 버튼 아래 안내까지 15 — 피그마 세로 좌표(710 → 730 → 793) 그대로 */}
      <button
        onClick={onNext}
        disabled={disabled}
        className="mx-6 mt-5 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
      >
        {label}
      </button>
      {/*
        안내 아래 여백만 피그마(33)보다 얇다. 우리 상태바가 59 인데 와이어프레임의 자리표시자는
        26 이라 세로로 33 이 모자란데(StatusBar.tsx — 다이내믹 아일랜드를 실측으로 피한다),
        글자 사이 간격을 조금씩 줄여 메우면 화면 전체가 원본과 어긋난다. 아무것도 없는 맨 아래에서 뺀다.
      */}
      {note ? (
        <p className="mt-[15px] shrink-0 pb-2 text-center text-[9px] leading-[18px] text-[#7d7d7d]">{note}</p>
      ) : (
        <div className="h-[67px] shrink-0" />
      )}
    </div>
  );
}

/** 뒤로 화살표 — 온보딩과 같은 아이콘·같은 44px 터치 영역을 쓴다 */
function Back({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 pl-[15px]">
      <button onClick={onClick} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center">
        <img src="/icon-arrow-left.svg" alt="" className="size-6" />
      </button>
      {title && <h1 className="text-[16px] leading-6 font-medium text-[#262626]">{title}</h1>}
    </div>
  );
}

/** 큰 제목 두 줄 + 부제. 와이어프레임이 줄을 나눠 그려서 줄 단위로 받는다. */
function Title({ lines, subtitle }: { lines: [string] | [string, string]; subtitle: string }) {
  return (
    <div className="shrink-0 px-[23px]">
      <h2 className="text-[23px] leading-9 font-bold text-[#262626]">
        {lines[0]}
        {lines[1] && (
          <>
            <br />
            {lines[1]}
          </>
        )}
      </h2>
      <p className="mt-2.5 text-[14px] leading-[21px] text-[#7d7d7d]">{subtitle}</p>
    </div>
  );
}

/**
 * TRIP-02 | 여행 취향 · 관심 장소 (통합).
 *
 * 원래 두 화면이었는데 와이어프레임에서 하나로 합쳐졌다 ("TRIP-02 + TRIP-03 통합 제안").
 * 진행 표시("1 / 3"과 막대)도 같이 없어졌다 — 단계가 둘뿐이면 셀 것도 없다.
 *
 * 배치·문구는 새로 그린 화면을 따르되 색은 플로우의 기존 값을 쓴다. 디자인 파일에서는 이 화면만
 * 다른 주황(#ff5914)으로 다시 그려졌는데, 한 플로우 안에서 주황이 두 개로 갈리는 쪽이 더 나쁘다.
 */
function TasteView({
  plan,
  setPlan,
  onBack,
  onNext,
}: {
  plan: TripPlan;
  setPlan: (p: TripPlan) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const keywords = keywordLine(plan);

  return (
    <Shell
      label="일정·동행 입력하기"
      onNext={onNext}
      disabled={plan.moods.length === 0 || plan.interests.length === 0}
      note="선택 내용은 언제든 다시 바꿀 수 있어요."
    >
      <Back onClick={onBack} />

      <div className="flex shrink-0 items-start justify-between gap-4 px-6">
        <div className="min-w-0">
          {/* 렌더를 픽셀로 재서 맞춘 값 — 제목 두 줄이 82~135(줄 간격 28), 부제 잉크가 145 에서 시작한다 */}
          <h2 className="text-[25px] leading-[28px] font-bold text-[#262626]">
            어떤 제주 여행을
            <br />
            원하시나요?
          </h2>
          <p className="mt-[10px] text-[11px] leading-[18px] text-[#7d7d7d]">여행 분위기와 관심 장소를 함께 골라주세요.</p>
        </div>
        <img src="/character/trip-taste.png" alt="" className="size-[62px] shrink-0 object-contain" />
      </div>

      <SectionLabel n={1} title="좋아하는 여행 분위기" hint="복수 선택 가능" />
      {/* 164x64 두 칸, 칸 사이 14 / 줄 사이 12 (피그마 left 24·202, top 222·298) */}
      <div className="mt-2.5 grid shrink-0 grid-cols-2 gap-x-[14px] gap-y-3 px-6">
        {MOODS.map((m, i) => {
          const on = plan.moods.includes(i);
          return (
            <button
              key={m.label}
              onClick={() => setPlan({ ...plan, moods: toggle(plan.moods, i) })}
              aria-pressed={on}
              className={`flex h-16 gap-1.5 rounded-2xl border px-[13px] pt-[11px] text-left transition ${
                on ? "border-[#ff7d32] bg-[#fff0e6]" : "border-[#eae7e2] bg-white"
              }`}
            >
              <span className="w-7 shrink-0 text-[20px] leading-[31px]">{m.emoji}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[12px] leading-[19px] font-bold ${on ? "text-[#ff7d32]" : "text-[#262626]"}`}
                >
                  {m.label}
                </span>
                <span className="mt-[3px] block truncate text-[9px] leading-[18px] text-[#7d7d7d]">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <SectionLabel n={2} title="관심 있는 장소" hint="여러 개 선택" />
      {/*
        104x58 세 칸. 피그마는 left 24·137·250 이라 오른쪽 여백만 36 으로 남는데(왼쪽은 24),
        좌우 여백을 24 로 맞추고 칸 너비를 108 로 늘린다 — 한쪽만 뜬 여백은 옮길 값이 아니라 흘린 값이다.
      */}
      <div className="mt-2.5 grid shrink-0 grid-cols-3 gap-x-[9px] gap-y-3 px-6">
        {INTERESTS.map((it, i) => {
          const on = plan.interests.includes(i);
          return (
            <button
              key={it.label}
              onClick={() => setPlan({ ...plan, interests: toggle(plan.interests, i) })}
              aria-pressed={on}
              className={`h-[58px] rounded-[14px] border pt-[7px] text-center transition ${
                on ? "border-[#ff7d32] bg-[#fff0e6]" : "border-[#eae7e2] bg-white"
              }`}
            >
              <span className="block text-[18px] leading-[26px]">{it.emoji}</span>
              <span
                className={`block truncate px-1 text-[10px] leading-[18px] ${on ? "font-bold text-[#ff7d32]" : "font-medium text-[#7d7d7d]"}`}
              >
                {it.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 고른 것을 한 줄로 되읽어 준다. "수정"은 갈 데가 따로 없어(같은 화면이다) 첫 선택지로 올려보낸다 */}
      <div className="mt-7 mx-6 flex h-[74px] shrink-0 items-start rounded-2xl bg-[#f6f4f1] px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] leading-[18px] font-bold text-[#7d7d7d]">선택한 여행 키워드</p>
          <p className="mt-1 truncate text-[13px] leading-[20px] font-bold text-[#262626]">
            {keywords ?? "아직 고른 게 없어요"}
          </p>
        </div>
        <a href="#taste-top" className="mt-[19px] shrink-0 text-[10px] leading-[18px] font-medium text-[#ff7d32]">
          수정 ›
        </a>
      </div>

      <div className="mt-3.5 mx-6 flex h-[42px] shrink-0 items-start gap-1.5 rounded-[14px] bg-[#fff0e6] px-3.5 pt-2.5">
        <span className="text-[13px] leading-[20px] font-bold text-[#ff7d32]">✦</span>
        <span className="text-[10px] leading-[18px] font-medium text-[#7d7d7d]">
          선택한 취향을 바탕으로 제주 코스를 추천해요.
        </span>
      </div>
    </Shell>
  );
}

/**
 * "1. 좋아하는 여행 분위기" + 오른쪽 끝 "복수 선택 가능" (14px Bold / 9px Medium).
 * 위 여백이 둘이 다르다 — 1번은 부제 아래 28, 2번은 카드 아래 30 (피그마 190·392 좌표 그대로).
 */
function SectionLabel({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div
      id={n === 1 ? "taste-top" : undefined}
      className={`flex shrink-0 items-baseline justify-between px-6 ${n === 1 ? "mt-7" : "mt-[30px]"}`}
    >
      <h3 className="text-[14px] leading-[22px] font-bold text-[#262626]">
        {n}. {title}
      </h3>
      <span className="text-[9px] leading-[18px] font-medium text-[#ff7d32]">{hint}</span>
    </div>
  );
}

/** 상세 화면(04-A~E)의 머리 — 뒤로 + 화면 이름, 그 아래 큰 제목 */
function Detail({
  name,
  title,
  subtitle,
  children,
  onBack,
  label,
  onApply,
  disabled,
}: {
  name: string;
  title: [string] | [string, string];
  subtitle: string;
  children: React.ReactNode;
  onBack: () => void;
  label: string;
  onApply: () => void;
  disabled?: boolean;
}) {
  return (
    <Shell label={label} onNext={onApply} disabled={disabled}>
      <Back onClick={onBack} title={name} />
      <div className="mt-2 shrink-0">
        <Title lines={title} subtitle={subtitle} />
      </div>
      <div className="mt-6">{children}</div>
    </Shell>
  );
}

/* ─────────────────────────────── 선택 조각 ─────────────────────────────── */

/** TRIP-02 · 04-D 의 가로 줄. 고르면 주황 테두리 + 연한 주황 바탕이 된다. */
function Row({
  emoji,
  label,
  desc,
  on,
  onClick,
  radio,
}: {
  emoji?: string;
  label: string;
  desc: string;
  on: boolean;
  onClick: () => void;
  radio?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-[76px] items-center gap-3.5 rounded-2xl px-4 text-left transition ${
        on ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
      }`}
    >
      <span className="w-[26px] shrink-0 text-center text-[16px] leading-6">
        {radio ? (
          <span className={on ? "text-[#ff7d32]" : "text-[#7d7d7d]"}>{on ? "●" : "○"}</span>
        ) : (
          emoji
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{label}</span>
        <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{desc}</span>
      </span>
      {on && !radio && <span className="shrink-0 text-[16px] leading-6 text-[#262626]">✓</span>}
    </button>
  );
}

/** TRIP-03 · 04-B 의 2열 타일 */
function Tile({
  emoji,
  label,
  desc,
  on,
  onClick,
  center,
}: {
  emoji: string;
  label: string;
  desc?: string;
  on: boolean;
  onClick: () => void;
  center?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`relative flex h-28 flex-col justify-center gap-1 rounded-[18px] px-4 transition ${
        center ? "items-center" : "items-start text-left"
      } ${on ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"}`}
    >
      <span className={center ? "text-[22px] leading-[30px]" : "text-[16px] leading-6"}>{emoji}</span>
      <span className="max-w-full truncate text-[16px] leading-6 font-medium text-[#262626]">{label}</span>
      {desc && <span className="max-w-full truncate text-[12px] leading-[18px] text-[#7d7d7d]">{desc}</span>}
      {on && <span className="absolute top-3.5 right-4 text-[16px] leading-6 text-[#262626]">✓</span>}
    </button>
  );
}

/** TRIP-04 의 한 줄. 아직 안 고른 값은 흐리게 둬서 무엇이 비었는지 한눈에 보이게 한다. */
function Field({
  icon,
  name,
  value,
  empty,
  go,
}: {
  icon: string;
  name: string;
  value: string | null;
  empty?: string;
  go: () => void;
}) {
  return (
    <button onClick={go} className="flex h-[70px] items-center gap-3 rounded-2xl border border-[#eae7e2] bg-white px-4 text-left transition active:scale-[0.99]">
      <span className="w-7 shrink-0 text-[16px] leading-6">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">{name}</span>
        <span className={`block truncate text-[16px] leading-6 font-medium ${value ? "text-[#262626]" : "text-[#b8b2aa]"}`}>
          {value ?? empty}
        </span>
      </span>
      <span className="shrink-0 text-[22px] leading-[30px] font-bold text-[#7d7d7d]">›</span>
    </button>
  );
}

/* ─────────────────────────────── TRIP-01 ─────────────────────────────── */

function Intro({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  return (
    <Shell label="내 여행 추천받기" onNext={onStart}>
      <Back onClick={onBack} />
      <div className="shrink-0 px-[23px]">
        <p className="text-[14px] leading-[21px] text-[#7d7d7d]">AI 제주 여행</p>
        <h2 className="mt-4 text-[23px] leading-[30px] font-bold text-[#262626]">
          여행을 떠나기 좋은 날이에요 !<br />
          오늘은 어디로 가볼까요?
        </h2>
        <p className="mt-5 text-[14px] leading-[21px] text-[#7d7d7d]">
          몇 가지만 알려주면 귤이가 나에게 맞는 장소와 이동 순서를 함께 짜드려요.
        </p>
      </div>

      {/*
        캐릭터와 말풍선. 와이어프레임은 이모지 다섯 개를 캐릭터 둘레에 흩어 놓았는데,
        절대좌표로 박으면 프레임이 낮아질 때 캐릭터를 덮는다 — 위·아래 두 줄로 나눠 세운다.
      */}
      <div className="flex flex-1 flex-col items-center justify-center px-[23px]">
        <div className="flex w-[263px] items-end justify-between text-[28px] leading-none">
          <span>🏝️</span>
          <span className="mb-4 text-[24px]">🌸</span>
          <span>🌿</span>
        </div>
        <img src="/character/trip-hero.png" alt="귤이 캐릭터" className="mt-1 h-[225px] w-[263px] object-contain" />
        <div className="mt-4 flex w-[300px] justify-center rounded-[20px] bg-[#fff0e6] px-6 py-6">
          <p className="text-[14px] leading-[21px] text-[#262626]">오늘의 제주를 가장 완벽하게 즐기는 법 !</p>
        </div>
      </div>
    </Shell>
  );
}

/* ─────────────────────────────── TRIP-04-A ─────────────────────────────── */

/**
 * 여행 기간. 와이어프레임은 달력을 직접 그렸지만 <input type="date"> 를 쓴다 —
 * 폰에서는 OS 기본 달력이 그대로 뜨고, 직접 그린 그리드가 못 하는 것(다른 달로 넘기기,
 * 키보드 입력, 스크린리더)을 공짜로 얻는다.
 * 도착일에 min 을 걸어 시작보다 앞선 날짜를 아예 못 고르게 한다 (parseTrip 도 같은 값을 막는다).
 */
function PeriodView({ plan, onBack, onApply }: DetailProps) {
  const [start, setStart] = useState(plan.start);
  const [end, setEnd] = useState(plan.end);
  const label = periodLabel({ ...plan, start, end });

  return (
    <Detail
      name="여행 기간"
      title={["언제 제주로 떠나시나요?"]}
      subtitle="시작일과 종료일을 차례로 선택해 주세요."
      onBack={onBack}
      label={label ? `${label} 적용하기` : "날짜를 골라주세요"}
      onApply={() => onApply({ start, end })}
      disabled={!label}
    >
      <div className="px-[23px]">
        <div className="flex items-center gap-3 rounded-2xl bg-[#fff0e6] px-5 py-4">
          <DateBox name="출발" value={start} onChange={setStart} />
          <span className="shrink-0 text-[16px] text-[#7d7d7d]">→</span>
          <DateBox name="도착" value={end} min={start} onChange={setEnd} />
        </div>
        <p className="mt-6 rounded-2xl bg-[#f6f4f1] px-5 py-4 text-[14px] leading-[21px] text-[#7d7d7d]">
          {label ? `선택한 여행 기간 · ${label}` : "두 날짜를 모두 고르면 기간이 나와요"}
        </p>
      </div>
    </Detail>
  );
}

function DateBox({
  name,
  value,
  min,
  onChange,
}: {
  name: string;
  value: string;
  min?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">{name}</span>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full bg-transparent text-[16px] leading-6 font-medium text-[#262626] outline-none"
      />
    </label>
  );
}

/* ─────────────────────────────── TRIP-04-B ─────────────────────────────── */

function CompanionView({ plan, onBack, onApply }: DetailProps) {
  const [companion, setCompanion] = useState<Companion | null>(plan.companion);
  const [people, setPeople] = useState(plan.people);
  const draft = { ...plan, companion, people };

  return (
    <Detail
      name="동행 선택"
      title={["누구와 함께 떠나나요?"]}
      subtitle="동행 유형과 인원을 알려주면 쉬는 장소도 맞출게요."
      onBack={onBack}
      label={companion ? `${companionLabel(draft)} 적용하기` : "동행을 골라주세요"}
      onApply={() => onApply({ companion, people })}
      disabled={!companion}
    >
      <div className="grid grid-cols-2 gap-3.5 px-[23px]">
        {COMPANIONS.map((c) => (
          <Tile key={c.id} emoji={c.emoji} label={c.label} on={companion === c.id} onClick={() => setCompanion(c.id)} center />
        ))}
      </div>

      <p className="mt-8 px-[28px] text-[16px] leading-6 font-medium text-[#262626]">인원</p>
      <div className="mt-3 flex flex-col gap-3 px-[23px]">
        {PEOPLE.map((p) => (
          <div key={p.key} className="flex h-[60px] items-center rounded-[18px] border border-[#eae7e2] bg-white px-[18px]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-6 font-medium text-[#262626]">{p.label}</span>
              {p.desc && <span className="block text-[11px] leading-4 text-[#7d7d7d]">{p.desc}</span>}
            </span>
            <Step sign="−" onClick={() => setPeople({ ...people, [p.key]: Math.max(0, people[p.key] - 1) })} disabled={people[p.key] === 0} />
            <span className="w-[34px] text-center text-[16px] leading-6 font-medium text-[#262626]">{people[p.key]}</span>
            <Step sign="+" onClick={() => setPeople({ ...people, [p.key]: Math.min(MAX_PER_PEOPLE, people[p.key] + 1) })} disabled={people[p.key] === MAX_PER_PEOPLE} />
          </div>
        ))}
      </div>
    </Detail>
  );
}

function Step({ sign, onClick, disabled }: { sign: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={sign === "+" ? "한 명 늘리기" : "한 명 줄이기"}
      className="size-11 shrink-0 text-[22px] leading-[30px] font-bold text-[#7d7d7d] transition disabled:opacity-30"
    >
      {sign}
    </button>
  );
}

/* ─────────────────────────────── TRIP-04-C ─────────────────────────────── */

/**
 * 출발 위치. 장소 검색은 목적지 화면의 서버 액션을 그대로 부른다 (카카오 키가 서버 전용이라
 * 브라우저에서 직접 못 부른다 — app/destination/actions.ts).
 *
 * ponytail: 와이어프레임의 지도는 안 그렸다. 위치는 "현재 위치" 아니면 검색으로 정해지고
 * 지도는 고른 결과를 보여줄 뿐이라, 지도를 붙이려면 RouteMap 을 여기 맞게 손봐야 한다.
 */
function OriginView({ onBack, onApply }: Omit<DetailProps, "plan">) {
  const [text, setText] = useState("");
  // here: 현재 위치로 잡은 값인지. 검색으로 고른 곳까지 "현재 위치 사용" 칸을 켜면 안 된다.
  const [picked, setPicked] = useState<{ name: string; at: LatLng | null; here: boolean } | null>(null);
  const [geo, setGeo] = useState<"idle" | "loading" | "error">("idle");
  const found = usePlaceSuggest(text);

  function useHere() {
    if (!navigator.geolocation) return setGeo("error");
    setGeo("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const at: LatLng = [coords.latitude, coords.longitude];
        const { area } = await hereNow(at[0], at[1]);
        // 동네 이름을 못 받아도 좌표는 성했다 — 이름만 "현재 위치"로 두고 그대로 쓴다
        setPicked({ name: area ?? "현재 위치", at, here: true });
        setGeo("idle");
      },
      () => setGeo("error"),
    );
  }

  return (
    <Detail
      name="출발 위치"
      title={["어디에서 출발하시나요?"]}
      subtitle="현재 위치를 사용하거나 장소를 검색해 주세요."
      onBack={onBack}
      label={picked ? "이 위치에서 출발" : "위치를 골라주세요"}
      onApply={() => picked && onApply({ origin: picked.name, originAt: picked.at })}
      disabled={!picked}
    >
      <div className="px-[23px]">
        <button
          onClick={useHere}
          className={`flex h-[62px] w-full items-center gap-3 rounded-2xl px-4 text-left transition ${
            picked?.here ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
          }`}
        >
          <span className="text-[16px]">📍</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-6 font-medium text-[#262626]">현재 위치 사용</span>
            <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">
              {geo === "loading"
                ? "위치 확인 중…"
                : geo === "error"
                  ? "위치를 확인할 수 없어요"
                  : picked?.here
                    ? `${picked.name}에서 위치 확인됨`
                    : "눌러서 지금 자리를 확인해요"}
            </span>
          </span>
        </button>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="주소 · 장소 검색"
          className="mt-3 h-[54px] w-full rounded-2xl border border-[#eae7e2] bg-white px-[18px] text-[14px] leading-[21px] text-[#262626] outline-none placeholder:text-[#7d7d7d] focus:border-[#ff7d32]"
        />

        <div className="mt-3 flex flex-col gap-2">
          {found.map((p) => (
            <button
              key={`${p.label}${p.road}`}
              onClick={() => {
                setPicked({ name: p.label, at: p.coord, here: false });
                setText("");
              }}
              className="rounded-2xl border border-[#eae7e2] bg-white px-4 py-3 text-left transition active:scale-[0.99]"
            >
              <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{p.label}</span>
              <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{p.road || p.jibun}</span>
            </button>
          ))}
        </div>

        {picked && (
          <p className="mt-6 rounded-2xl bg-[#fff0e6] px-5 py-4 text-[14px] leading-[21px] text-[#262626]">
            출발 · {picked.name}
          </p>
        )}
      </div>
    </Detail>
  );
}

/* ─────────────────────────────── TRIP-04-D ─────────────────────────────── */

function DriveView({ plan, onBack, onApply }: DetailProps) {
  const [hours, setHours] = useState<number | null>(plan.driveHours);

  return (
    <Detail
      name="하루 운전 시간"
      title={["하루에 얼마나", "운전할 수 있나요?"]}
      subtitle="선택한 시간 안에서 장소와 휴식 순서를 조정할게요."
      onBack={onBack}
      label={hours === null ? "운전 시간을 골라주세요" : `${driveLabel({ ...plan, driveHours: hours })} 적용하기`}
      onApply={() => onApply({ driveHours: hours })}
      disabled={hours === null}
    >
      <div className="flex flex-col gap-3.5 px-[23px]">
        {DRIVE_HOURS.map((d) => (
          <Row key={d.hours} label={d.label} desc={d.desc} on={hours === d.hours} onClick={() => setHours(d.hours)} radio />
        ))}
      </div>
    </Detail>
  );
}

/* ─────────────────────────────── TRIP-04-E ─────────────────────────────── */

function MustView({ plan, onBack, onApply }: DetailProps) {
  const [musts, setMusts] = useState(plan.musts);
  const [text, setText] = useState("");
  const found = usePlaceSuggest(text);
  const full = musts.length >= MAX_MUSTS;

  const add = (name: string) => {
    if (!musts.includes(name) && !full) setMusts([...musts, name]);
    setText("");
  };

  return (
    <Detail
      name="꼭 가고 싶은 곳"
      title={["놓치고 싶지 않은", "장소를 추가해 주세요"]}
      subtitle={full ? `한 번에 ${MAX_MUSTS}곳까지 담을 수 있어요.` : "여러 장소를 계속 추가할 수 있어요."}
      onBack={onBack}
      label={musts.length ? `선택한 ${musts.length}곳 적용하기` : "건너뛰기"}
      onApply={() => onApply({ musts })}
    >
      <div className="px-[23px]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="제주 장소를 검색해 보세요"
          className="h-[54px] w-full rounded-2xl border border-[#eae7e2] bg-white px-[18px] text-[14px] leading-[21px] text-[#262626] outline-none placeholder:text-[#7d7d7d] focus:border-[#ff7d32]"
        />

        {/* 검색 중에는 후보만 보여준다 — 아래 추천 목록까지 같이 있으면 무엇을 누르는지 헷갈린다 */}
        {text.trim() ? (
          <div className="mt-4 flex flex-col gap-2">
            {found.map((p) => (
              <PlaceRow key={`${p.label}${p.road}`} emoji="📍" name={p.label} where={p.region} onAdd={() => add(p.label)} added={musts.includes(p.label)} />
            ))}
          </div>
        ) : (
          <>
            <p className="mt-7 text-[16px] leading-6 font-medium text-[#262626]">추가한 장소 {musts.length}</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {musts.length === 0 && <p className="text-[12px] leading-[18px] text-[#7d7d7d]">아직 없어요. 검색해서 담아보세요.</p>}
              {musts.map((m) => (
                <button
                  key={m}
                  onClick={() => setMusts(musts.filter((x) => x !== m))}
                  className="flex h-[42px] items-center gap-2 rounded-[21px] bg-[#fff0e6] px-4 text-[12px] leading-[18px] text-[#262626]"
                >
                  {m}
                  <span aria-label={`${m} 빼기`} className="text-[#7d7d7d]">
                    ×
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-7 text-[16px] leading-6 font-medium text-[#262626]">제주 추천 장소</p>
            <div className="mt-3 flex flex-col gap-3">
              {SUGGESTED.map((s) => (
                <PlaceRow key={s.name} {...s} onAdd={() => add(s.name)} added={musts.includes(s.name)} />
              ))}
            </div>
          </>
        )}
      </div>
    </Detail>
  );
}

function PlaceRow({
  emoji,
  name,
  where,
  onAdd,
  added,
}: {
  emoji: string;
  name: string;
  where: string;
  onAdd: () => void;
  added: boolean;
}) {
  return (
    <div className="flex h-[70px] items-center gap-3 rounded-2xl border border-[#eae7e2] bg-white px-4">
      <span className="w-[30px] shrink-0 text-[16px] leading-6">{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{name}</span>
        <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{where}</span>
      </span>
      <button
        onClick={onAdd}
        disabled={added}
        className="h-[38px] w-[72px] shrink-0 rounded-[19px] bg-[#fff0e6] text-[12px] leading-[18px] text-[#262626] transition disabled:opacity-40"
      >
        {added ? "담음" : "+ 추가"}
      </button>
    </div>
  );
}

/* ─────────────────────────────── 공통 훅 ─────────────────────────────── */

/**
 * 타이핑이 멎으면 장소 후보를 받아온다 (출발 위치·꼭 가고 싶은 곳이 같이 쓴다).
 * 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때 먼저 보낸 긴 검색어의 결과가
 * 나중에 도착해 목록을 덮는다 (app/destination/page.tsx 와 같은 이유).
 */
function usePlaceSuggest(text: string): Place[] {
  const [found, setFound] = useState<Place[]>([]);

  useEffect(() => {
    if (!text.trim()) return setFound([]);

    let alive = true;
    const timer = setTimeout(() => {
      suggestPlaces(text).then((places) => alive && setFound(places));
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);

  return found;
}

type DetailProps = {
  plan: TripPlan;
  onBack: () => void;
  onApply: (patch: Partial<TripPlan>) => void;
};
