"use client";

// AI 여행 코스 결과 — 와이어프레임 TRIP-05(생성 중) · TRIP-06(코스 추천) · TRIP-07(외부 내비).
//
// 세 장이 한 화면인 이유는 셋이 한 흐름이라서다. 코스를 만드는 동안 05, 만들어지면 06,
// 고르고 나면 07 이 그 위에 덮인다 — 라우트를 나누면 만든 코스를 다시 실어 날라야 하는데
// 코스는 URL 에 담기에 너무 크다 (장소 수 × 좌표 × 날짜).
//
// 조건은 /trip 이 URL 로 넘겨준다 (lib/trip.ts toTripQuery). 그래서 이 링크만 있으면
// 같은 코스가 다시 나온다 — buildCourses 가 같은 입력에 같은 결과를 주기 때문이다.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";
import RouteMap, { type LatLng, type MapMarker, type MapRoute } from "../../RouteMap";
import { navigateTo } from "@/lib/parking";
import { courseMeta, driveNote, hourMin, stopCount, type Course } from "@/lib/course";
import { summaryOf, toRecordQuery } from "@/lib/record";
import { type TripPlan } from "@/lib/trip";
import { makeCourses, type Made } from "./actions";

/**
 * 날짜별 경로 색. 하루가 한 지역을 도므로 색이 곧 "며칠째"다 (lib/course.ts regionsOf).
 * 다섯 개인 이유는 그 이상은 색으로 못 가르기 때문이다 — 넘으면 돌려 쓰고, 지도 아래 범례가 짚어준다.
 */
const DAY_COLORS = ["#ff7d32", "#3d8bd4", "#6ba85b", "#a05fd0", "#d9534f"];

/**
 * 번호가 박힌 핀. 마커를 다 같은 모양으로 두면 어디부터 도는지, 어느 날 것인지를 못 읽는다 —
 * 처음엔 경로마다 "1일차 15분" 말풍선을 달았는데, 하루가 늘 출발지에서 시작하니 말풍선이
 * 죄다 섬 한가운데 겹쳐 지도를 덮었다. 순서는 번호로, 날짜는 색으로, 시간은 지도 밖 범례로 옮겼다.
 *
 * data: URI 라 파일도 외부 요청도 안 늘어난다 (RouteMap MarkerIcon 주석).
 */
const pin = (n: number, color: string): string =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="32" viewBox="0 0 26 32">` +
      `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.1 11.3 17.6 12.1 18.2a1.5 1.5 0 0 0 1.8 0C14.7 30.6 26 22.1 26 13 26 5.8 20.2 0 13 0z" fill="${color}"/>` +
      `<text x="13" y="18" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" font-family="sans-serif">${n}</text>` +
      `</svg>`,
  );

export default function CoursePage() {
  return (
    <Suspense>
      <CourseResult />
    </Suspense>
  );
}

function CourseResult() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [made, setMade] = useState<Made | null>(null);
  const [picked, setPicked] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const query = searchParams.toString();

  useEffect(() => {
    let alive = true;
    makeCourses(Object.fromEntries(new URLSearchParams(query))).then((m) => alive && setMade(m));
    return () => {
      alive = false;
    };
  }, [query]);

  if (!made) return <Making />;

  if ("error" in made)
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-[16px] leading-6 font-medium text-[#262626]">{made.error}</p>
        </div>
        <button
          onClick={() => router.back()}
          className="mx-6 mb-8 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition active:scale-[0.98]"
        >
          조건 다시 고르기
        </button>
      </Frame>
    );

  const course = made.courses[picked];

  // 07 은 06 위에 뜨는 시트가 아니라 갈아끼우는 화면이다 (와이어프레임도 별도 프레임이다).
  // 덮어 씌우려면 .phone 에 position 을 주고 겹쳐야 하는데, 그럴 이유가 없다.
  if (navOpen)
    return (
      <ExternalNav
        course={course}
        plan={made.plan}
        onClose={() => setNavOpen(false)}
        // 여행 기록(TRIP-08~09)으로 넘어가는 유일한 문이다. 코스 전체가 아니라 요약만 쿼리로 넘긴다
        // — 기록에 필요한 건 이름 몇 개와 거리뿐이다 (lib/record.ts 첫 주석).
        onDone={() =>
          router.push(`/trip/record?${toRecordQuery(summaryOf(course, made.plan.origin), searchParams)}`)
        }
      />
    );

  return (
    <Recommend
      made={made}
      picked={picked}
      onPick={setPicked}
      onBack={() => router.back()}
      onGo={() => setNavOpen(true)}
    />
  );
}

/** 상태바 + 흰 바탕. 세 화면이 같은 틀을 쓴다. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      {children}
    </div>
  );
}

/* ─────────────────────────────── TRIP-05 ─────────────────────────────── */

/**
 * 코스를 만드는 동안.
 *
 * 막대는 **진행률이 아니라 기다림의 표시**다. 서버 왕복 한 번이라 잴 눈금이 없다 —
 * 90% 까지 천천히 차오르다가 응답이 오면 화면이 넘어간다. 100% 를 찍고 멈춰 있는 것보다
 * 낫다: 다 됐다고 해놓고 안 넘어가면 멈춘 것처럼 보인다.
 *
 * 일부러 늦추지는 않는다. 후보 수집이 0.3초쯤이라 이 화면이 스칠 수도 있는데,
 * 보여주려고 기다리게 만드는 건 화면을 위해 사용자를 세우는 일이다.
 */
function Making() {
  const [pct, setPct] = useState(8);

  useEffect(() => {
    const timer = setInterval(() => setPct((p) => (p >= 90 ? p : p + Math.max(1, Math.round((90 - p) / 12)))), 120);
    return () => clearInterval(timer);
  }, []);

  const steps = [
    { label: "취향과 장소 조합 완료", at: 25 },
    { label: "이동 부담 확인 완료", at: 55 },
    { label: "날씨에 맞는 순서 정리 중", at: 100 },
  ];

  return (
    <Frame>
      <div className="mt-[94px] shrink-0 px-6 text-center">
        <h2 className="text-[28px] leading-9 font-bold text-[#262626]">
          귤이가 여행을
          <br />
          차곡차곡 잇고 있어요
        </h2>
        <p className="mt-4 text-[14px] leading-[21px] text-[#7d7d7d]">
          장소 사이 이동 시간과 쉬운 길을
          <br />
          함께 살펴보는 중이에요.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <img src="/character/trip-hero.png" alt="" className="h-[190px] w-[240px] object-contain" />
      </div>

      <div className="shrink-0 px-[44px]">
        <div className="h-3 overflow-hidden rounded-full bg-[#eae7e2]">
          <div className="h-full rounded-full bg-[#ff7d32] transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3.5 text-center text-[16px] leading-6 font-medium text-[#262626]">{pct}%</p>
      </div>

      <div className="mt-8 shrink-0 space-y-[18px] px-[52px] pb-[74px]">
        {steps.map((s) => {
          const done = pct >= s.at;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <span className={`w-6 text-center text-[16px] leading-6 font-medium ${done ? "text-[#6ba85b]" : "text-[#262626]"}`}>
                {done ? "✓" : "…"}
              </span>
              <span className={`text-[14px] leading-[21px] ${done ? "text-[#7d7d7d]" : "text-[#262626]"}`}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

/* ─────────────────────────────── TRIP-06 ─────────────────────────────── */

function Recommend({
  made,
  picked,
  onPick,
  onBack,
  onGo,
}: {
  made: Extract<Made, { courses: Course[] }>;
  picked: number;
  onPick: (i: number) => void;
  onBack: () => void;
  onGo: () => void;
}) {
  const { plan, courses, missing } = made;
  const course = courses[picked];
  const origin = plan.originAt as LatLng;

  // 하루가 한 줄. 출발지에서 나가 마지막 장소까지 — 돌아오는 길은 안 그린다(같은 선을 두 번 긋는다).
  // 말풍선(label)은 안 단다 — pin 주석 참고
  const days = course.days.filter((d) => d.stops.length);
  const routes: MapRoute[] = days.map((d, i) => ({
    path: [origin, ...d.stops.map((s) => s.at)],
    color: DAY_COLORS[i % DAY_COLORS.length],
    weight: 5,
  }));

  const markers: MapMarker[] = days.flatMap((d, i) =>
    d.stops.map((s, n) => ({
      coord: s.at,
      label: s.name,
      icon: { src: pin(n + 1, DAY_COLORS[i % DAY_COLORS.length]), size: [26, 32] as [number, number], anchor: [13, 32] as [number, number] },
    })),
  );

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-11 shrink-0 items-center pl-[15px]">
          <button onClick={onBack} aria-label="뒤로" className="flex size-11 items-center justify-center">
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
        </div>

        <div className="shrink-0 px-[23px]">
          <h2 className="text-[23px] leading-8 font-bold text-[#262626]">
            귤이가 <span className="text-[#ff7d32]">추천</span>하는
            <br />
            제주 여행 코스로 달려볼까요 ?
          </h2>
          <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">취향 · 날씨 · 운전 부담을 모두 반영했어요.</p>
        </div>

        {/* 높이는 이 상자가 정한다 — RouteMap 이 h-full 이라 자기한테 높이를 주면 안 먹는다 */}
        <div className="mt-5 h-[236px] shrink-0 px-[23px]">
          <RouteMap center={origin} routes={routes} markers={markers} className="relative size-full overflow-hidden rounded-[18px]" />
        </div>

        {/* 지도의 색이 무엇인지 짚어주고, 말풍선이 하던 말(하루 몇 곳·몇 분)을 여기서 한다 */}
        <div className="mt-3.5 flex shrink-0 flex-col gap-2 px-[23px]">
          {days.map((d, i) => (
            <div key={d.date} className="flex items-center gap-2.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }} />
              <span className="text-[13px] leading-5 font-medium text-[#262626]">{i + 1}일차</span>
              <span className="min-w-0 flex-1 truncate text-[12px] leading-[18px] text-[#7d7d7d]">
                {d.stops.map((s) => s.name).join(" · ")}
              </span>
              <span className="shrink-0 text-[12px] leading-[18px] text-[#7d7d7d]">{hourMin(d.driveMin)}</span>
            </div>
          ))}
        </div>

        {/* 좌표를 못 찾은 "꼭 가고 싶은 곳"은 조용히 빼지 않고 말한다 */}
        {missing.length > 0 && (
          <p className="mt-3 shrink-0 px-[23px] text-[12px] leading-[18px] text-[#7d7d7d]">
            {missing.join(" · ")} 은(는) 위치를 못 찾아 코스에 못 넣었어요.
          </p>
        )}

        <div className="mt-8 flex shrink-0 flex-col gap-4 px-[23px]">
          {courses.map((c, i) => (
            <CourseCard
              key={c.title + i}
              course={c}
              n={i + 1}
              driveHours={plan.driveHours}
              on={i === picked}
              onClick={() => onPick(i)}
            />
          ))}
        </div>
      </div>

      <button
        onClick={onGo}
        className="mx-6 mt-5 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition active:scale-[0.98]"
      >
        이 코스로 여행하기
      </button>
      <div className="h-[67px] shrink-0" />
    </Frame>
  );
}

function CourseCard({
  course,
  n,
  driveHours,
  on,
  onClick,
}: {
  course: Course;
  n: number;
  driveHours: number | null;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-[18px] px-[18px] pt-3.5 pb-3 text-left transition ${
        on ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
      }`}
    >
      <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">추천 {n}</span>
      <span className="mt-1 block truncate text-[18px] leading-[26px] font-bold text-[#262626]">{course.title}</span>
      <span className="mt-1.5 block text-[13px] leading-5 text-[#7d7d7d]">{courseMeta(course)}</span>
      <span className="mt-2 block text-right text-[12px] leading-[18px] text-[#7d7d7d]">
        {driveNote(course, driveHours)}
      </span>
    </button>
  );
}

/* ─────────────────────────────── TRIP-07 ─────────────────────────────── */

/**
 * 외부 내비로 넘기기.
 *
 * 하루치를 통째로 넘긴다 — 출발지에서 나가 그날 들르는 곳을 경유지로 달고 마지막 장소가 목적지다.
 * 카카오 링크가 경유지를 최대 다섯 개까지 받아서 되는 일이다 (lib/parking.ts navigateTo).
 * 그래서 "다음 목적지 하나씩" 이 아니라 그날 동선이 그대로 내비에 뜬다.
 *
 * 며칠짜리 코스라도 한 번에 한 날만 넘긴다 — 이틀치를 이어 붙이면 중간에 자는 밤이 경로에
 * 들어가고, 경유지 다섯 개 상한도 금방 넘긴다.
 *
 * 다녀온 뒤 돌아올 자리도 여기다 — 내비로 넘기고 나면 이 화면이 그 여행의 마지막 장이라,
 * "여행 다녀왔어요"가 기록(TRIP-08)으로 이어진다.
 */
function ExternalNav({
  course,
  plan,
  onClose,
  onDone,
}: {
  course: Course;
  plan: TripPlan;
  onClose: () => void;
  onDone: () => void;
}) {
  const days = course.days.filter((d) => d.stops.length);
  const [day, setDay] = useState(0);
  const target = days[day];

  function go() {
    if (!target || !plan.originAt) return;
    const stops = target.stops;
    navigateTo(
      { name: stops[stops.length - 1].name, at: stops[stops.length - 1].at },
      {
        from: { name: plan.origin, at: plan.originAt },
        via: stops.slice(0, -1).map((s) => ({ name: s.name, at: s.at })),
      },
    );
  }

  return (
    <Frame>
      <div className="mt-6 shrink-0 px-6">
        <p className="text-[12px] leading-[18px] text-[#7d7d7d]">코스 준비 완료</p>
        <h2 className="mt-2 text-[23px] leading-8 font-bold text-[#262626]">
          <span className="text-[#ff7d32]">외부 내비 앱</span>으로
          <br />
          길 안내를 시작할까요?
        </h2>
        <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">앱을 선택하면 경유지와 목적지를 함께 전달해요.</p>
      </div>

      <div className="mt-6 shrink-0 rounded-[18px] border-2 border-[#ff7d32] bg-[#fff0e6] px-[18px] py-4 mx-6">
        <p className="text-[12px] leading-[18px] text-[#7d7d7d]">선택한 코스</p>
        <p className="mt-1.5 truncate text-[20px] leading-7 font-bold text-[#262626]">{course.title}</p>
        <p className="mt-3 text-[13px] leading-5 text-[#7d7d7d]">
          {[plan.origin, ...(target?.stops.map((s) => s.name) ?? [])].join("  →  ")}
        </p>
        <p className="mt-3 text-[12px] leading-[18px] text-[#7d7d7d]">
          {stopCount(course)}곳 · 이동 {hourMin(course.totalMin)} · {driveNote(course, plan.driveHours)}
        </p>
      </div>

      {/* 며칠짜리면 어느 날을 넘길지 고른다 — 하루씩만 넘어간다 (위 주석) */}
      {days.length > 1 && (
        <div className="mt-4 flex shrink-0 gap-2 px-6">
          {days.map((d, i) => (
            <button
              key={d.date}
              onClick={() => setDay(i)}
              aria-pressed={i === day}
              className={`h-9 flex-1 rounded-[18px] text-[12px] font-medium transition ${
                i === day ? "bg-[#ff7d32] text-white" : "bg-[#f6f4f1] text-[#7d7d7d]"
              }`}
            >
              {i + 1}일차
            </button>
          ))}
        </div>
      )}

      <p className="mt-7 shrink-0 px-6 text-[14px] leading-[21px] font-bold text-[#262626]">
        길안내를 실행할 앱을 선택해 주세요
      </p>

      <button
        onClick={go}
        className="mt-3.5 flex h-[82px] shrink-0 items-center gap-4 rounded-[18px] border border-[#eae7e2] bg-white px-4 text-left transition active:scale-[0.99] mx-6"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#fee500] text-[20px] font-bold text-[#3c1e1e]">
          K
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] leading-6 font-medium text-[#262626]">카카오내비</span>
          <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">카카오내비로 경로 전달</span>
        </span>
      </button>

      <div className="flex-1" />

      {/* 주황이 앞으로 가는 자리다 — 코스를 고르고 내비까지 넘긴 다음의 다음 걸음은 기록이다 */}
      <button
        onClick={onDone}
        className="mx-6 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition active:scale-[0.98]"
      >
        여행 다녀왔어요
      </button>
      <button
        onClick={onClose}
        className="mx-6 mt-2.5 h-12 shrink-0 rounded-2xl bg-[#d6d6d6] text-[16px] font-medium text-[#262626] transition active:scale-[0.98]"
      >
        닫기
      </button>
      <div className="h-[57px] shrink-0" />
    </Frame>
  );
}
