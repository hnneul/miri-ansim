"use client";

// AI 코스 결과 — 와이어프레임 TRIP-05(생성 중) · TRIP-06(코스 추천) · TRIP-07(외부 내비).
// /trip 에서 "AI 코스 만들기"를 누르면 여기로 온다 (쿼리에 취향·기간·출발지 등이 실려 온다).
//
// 세 장이지만 화면은 하나다 — 상태(loading → result, 그리고 result 위에 뜨는 navi 시트)로만 바뀐다.
// 온보딩·목적지·여행 입력이 다 그렇듯, 한 덩이를 라우트로 쪼개면 카카오를 다시 부르게 되고
// 실시간 후보가 그 사이에 달라진다.
//
// 코스 계산은 서버(./actions.ts planCourses)가 한다 — 후보 수집이 서버 전용 키를 쓴다.
// 출발지 이름·좌표는 parseTrip(순수 함수)으로 화면에서도 되읽어 지도와 내비 전달에 쓴다.
//
// 색은 /trip 과 같은 토큰이다 (accent #ff7d32). 코스 이름·"운전 부담" 태그는 아직 규칙으로 채운다 —
// AI 코스 네이밍(모델 미정)이 붙으면 nameOf·taglineOf 만 그 값으로 갈아끼우면 된다.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";
import { navigateTo } from "@/lib/parking";
import { parseTrip } from "@/lib/trip";
import type { Course } from "@/lib/course";
import { planCourses } from "./actions";

/** 로딩 화면을 최소 이만큼은 보여준다 — 후보 수집이 0.2초쯤이라 안 두면 화면이 깜빡이고 지나간다. */
const MIN_LOADING_MS = 1800;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function TripCoursePage() {
  return (
    <Suspense>
      <TripCourse />
    </Suspense>
  );
}

function TripCourse() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  // 출발지·좌표는 순수 파서로 화면에서 되읽는다 (지도 시작점·내비 출발지에 쓴다)
  const plan = parseTrip(Object.fromEntries(searchParams));

  const [phase, setPhase] = useState<"loading" | "result" | "error">("loading");
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(0);
  const [naviOpen, setNaviOpen] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // 쿼리는 안 바뀌므로 한 번만 부른다 (StrictMode 이중 실행 방지)
    ran.current = true;

    const started = Date.now();
    planCourses(query)
      .then(async ({ courses }) => {
        const wait = MIN_LOADING_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (!courses.length) {
          setError("조건에 맞는 코스를 만들지 못했어요. 관심 장소나 기간을 바꿔 다시 시도해 주세요.");
          setPhase("error");
          return;
        }
        setCourses(courses);
        setPhase("result");
      })
      .catch(() => {
        setError("코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
        setPhase("error");
      });
  }, [query]);

  if (phase === "loading") return <Loading />;
  if (phase === "error") return <Failure message={error} onBack={() => router.back()} />;

  const course = courses[picked];
  const origin = { name: plan.origin || "출발지", at: plan.originAt };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[23px] pb-6">
        <div className="mt-2 shrink-0">
          <h1 className="text-[23px] leading-[32px] font-bold text-[#262626]">
            귤이가 <span className="text-[#ff7d32]">추천</span>하는
            <br />
            제주 여행 코스로 달려볼까요?
          </h1>
          <p className="mt-2.5 text-[14px] leading-[21px] text-[#7d7d7d]">취향·운전 부담을 모두 반영했어요.</p>
        </div>

        {/* 코스 지도 — 실제 좌표를 카드 안에 정규화해 그린 스타일 지도(카카오 클라이언트 지도 미사용) */}
        <div className="mt-5 shrink-0">
          <CourseMap origin={origin} course={course} />
        </div>

        {/* 추천 카드 두 장(하나뿐이면 한 장). 고른 카드가 주황 테두리 */}
        <div className="mt-5 flex shrink-0 flex-col gap-3">
          {courses.map((c, i) => (
            <CourseCard key={i} index={i} course={c} picked={i === picked} onPick={() => setPicked(i)} />
          ))}
        </div>
      </div>

      <button
        onClick={() => setNaviOpen(true)}
        className="mx-[23px] mt-2 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-bold text-white transition active:scale-[0.98]"
      >
        이 코스로 여행하기
      </button>
      <div className="h-[34px] shrink-0" />

      {naviOpen && <NaviSheet origin={origin} course={course} onClose={() => setNaviOpen(false)} />}
    </div>
  );
}

/* ─────────────────────────── TRIP-05 생성 중 ─────────────────────────── */

/** 코스를 짜는 동안. 실제 작업은 한 번의 await 라, 진행바와 체크리스트는 기다리는 동안의 연출이다. */
function Loading() {
  const [prog, setProg] = useState(8);
  useEffect(() => {
    // 92%까지만 천천히 차오른다 — 100%는 결과가 왔다는 뜻이라 여기서 채우지 않는다
    const id = setInterval(() => setProg((p) => (p < 92 ? p + Math.max(1, Math.round((92 - p) / 9)) : p)), 240);
    return () => clearInterval(id);
  }, []);

  const steps = [
    { label: "취향과 장소 조합 완료", at: 28 },
    { label: "이동 부담 확인 완료", at: 60 },
    { label: "날씨에 맞는 순서 정리 중", at: 100 },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <div className="flex flex-1 flex-col items-center px-[34px]">
        <div className="mt-[110px] text-center">
          <h1 className="text-[24px] leading-[34px] font-bold text-[#262626]">
            귤이가 여행을
            <br />
            차곡차곡 잇고 있어요
          </h1>
          <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">
            장소 사이 이동 시간과 쉬운 길을
            <br />
            함께 살펴보는 중이에요.
          </p>
        </div>

        <div className="mt-auto w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#eae7e2]">
            <div className="h-full rounded-full bg-[#ff7d32] transition-[width] duration-300" style={{ width: `${prog}%` }} />
          </div>
          <p className="mt-3 text-center text-[16px] font-bold text-[#262626]">{prog}%</p>
        </div>

        <ul className="mt-8 mb-[90px] flex w-full flex-col gap-4">
          {steps.map((s) => {
            const done = prog >= s.at;
            const active = !done && prog >= (steps[steps.indexOf(s) - 1]?.at ?? 0);
            return (
              <li key={s.label} className="flex items-center gap-3">
                <span className={`w-5 text-center text-[15px] ${done ? "text-[#3aa76d]" : "text-[#262626]"}`}>
                  {done ? "✓" : "…"}
                </span>
                <span className={`text-[14px] leading-[21px] ${done ? "text-[#9a958d]" : active ? "font-medium text-[#262626]" : "text-[#b8b2aa]"}`}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────── 코스 지도 (스타일) ─────────────────────────── */

/**
 * 코스 경로를 카드 안에 그린다. 실제 좌표를 카드 폭·높이에 정규화해 핀과 선을 얹는다 —
 * 카카오 클라이언트 지도는 키·도메인 등록이 필요하고 홈·목적지에서 그 이슈가 있어, 결과 화면은
 * 좌표만으로 그리는 스타일 지도를 쓴다. 첫째 날 동선을 그린다(하루치가 한 번의 드라이브다).
 */
function CourseMap({ origin, course }: { origin: { name: string; at: [number, number] | null }; course: Course }) {
  const day = course.days.find((d) => d.stops.length) ?? course.days[0];
  const stops = day?.stops ?? [];
  const start = origin.at;

  // 좌표가 없거나(직접 입력 등) 그릴 자리가 없으면 지도 대신 순서만 보여준다
  if (!start || stops.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center rounded-2xl bg-[#f6f4f1] px-6 text-center text-[13px] leading-relaxed text-[#7d7d7d]">
        {origin.name}에서 출발하는 코스예요.
      </div>
    );
  }

  const pts = [{ name: origin.name, at: start }, ...stops.map((s) => ({ name: s.name, at: s.at }))];
  const W = 320;
  const H = 190;
  const pad = 40;
  const lats = pts.map((p) => p.at[0]);
  const lngs = pts.map((p) => p.at[1]);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const nx = (lng: number) => (maxLng === minLng ? 0.5 : (lng - minLng) / (maxLng - minLng));
  const ny = (lat: number) => (maxLat === minLat ? 0.5 : (lat - minLat) / (maxLat - minLat));
  const X = (lng: number) => pad + nx(lng) * (W - 2 * pad);
  const Y = (lat: number) => H - pad - ny(lat) * (H - 2 * pad); // 북쪽이 위로

  const total = course.totalMin;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#eaf2f6]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[190px] w-full" preserveAspectRatio="xMidYMid slice">
        {/* 흐릿한 길 몇 줄 — 지도라는 신호만 준다 */}
        <g stroke="#d6e3ea" strokeWidth="8" strokeLinecap="round">
          <line x1="-10" y1="55" x2="330" y2="120" />
          <line x1="60" y1="-10" x2="150" y2="200" />
          <line x1="-10" y1="150" x2="200" y2="70" />
        </g>
        {/* 코스 선 */}
        <polyline
          points={pts.map((p) => `${X(p.at[1])},${Y(p.at[0])}`).join(" ")}
          fill="none"
          stroke="#ff7d32"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 구간 시간 라벨 (앞 세 구간까지 — 더 붙이면 서로 겹친다) */}
        {stops.slice(0, 3).map((s, i) => {
          const a = pts[i];
          const b = pts[i + 1];
          const mx = (X(a.at[1]) + X(b.at[1])) / 2;
          const my = (Y(a.at[0]) + Y(b.at[0])) / 2;
          return (
            <g key={i} transform={`translate(${mx}, ${my})`}>
              <rect x="-20" y="-10" width="40" height="20" rx="10" fill="#fff" />
              <text x="0" y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#262626">
                {s.legMin}분
              </text>
            </g>
          );
        })}
        {/* 핀 — 출발(초록) · 중간(주황 점) · 도착(빨강) */}
        {pts.map((p, i) => {
          const cx = X(p.at[1]);
          const cy = Y(p.at[0]);
          const isStart = i === 0;
          const isEnd = i === pts.length - 1;
          return (
            <g key={i}>
              {isStart || isEnd ? (
                <Pin x={cx} y={cy} color={isStart ? "#2ea36a" : "#e5484d"} />
              ) : (
                <circle cx={cx} cy={cy} r="6" fill="#ff7d32" stroke="#fff" strokeWidth="2.5" />
              )}
            </g>
          );
        })}
      </svg>

      {/* 총 이동 시간 칩 */}
      <div className="absolute top-3 right-3 rounded-full bg-[#eaf2f6]/95 px-3 py-1 text-[12px] font-bold text-[#2f77a6] shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
        총 {hm(total)}
      </div>
      {/* 출발·도착 이름 */}
      <span className="absolute bottom-2 left-3 rounded bg-white/85 px-1.5 text-[10px] font-medium text-[#525252]">{origin.name}</span>
      <span className="absolute right-3 bottom-2 rounded bg-white/85 px-1.5 text-[10px] font-medium text-[#525252]">
        {stops[stops.length - 1].name}
      </span>
    </div>
  );
}

/** 물방울 핀 — 끝점이 (x, y)에 앉는다 */
function Pin({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x - 9}, ${y - 24})`}>
      <path d="M9 24C9 24 18 13.5 18 9A9 9 0 1 0 0 9C0 13.5 9 24 9 24Z" fill={color} />
      <circle cx="9" cy="9" r="3.4" fill="#fff" />
    </g>
  );
}

/* ─────────────────────────── TRIP-06 코스 카드 ─────────────────────────── */

function CourseCard({ index, course, picked, onPick }: { index: number; course: Course; picked: boolean; onPick: () => void }) {
  const stops = course.days.reduce((n, d) => n + d.stops.length, 0);
  return (
    <button
      onClick={onPick}
      aria-pressed={picked}
      className={`rounded-2xl px-4 py-4 text-left transition ${
        picked ? "border-2 border-[#ff7d32] bg-[#fff5ee]" : "border border-[#eae7e2] bg-white"
      }`}
    >
      <p className="text-[12px] leading-[18px] text-[#7d7d7d]">추천 {index + 1}</p>
      <p className="mt-1 text-[18px] leading-[26px] font-bold text-[#262626]">{nameOf(course.theme)}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-[13px] leading-[19px] text-[#7d7d7d]">
          {stops}곳 · 이동 {hm(course.totalMin)}
        </p>
        <p className="text-[13px] leading-[19px] font-medium text-[#262626]">{taglineOf(course)}</p>
      </div>
    </button>
  );
}

/* ─────────────────────────── TRIP-07 외부 내비 ─────────────────────────── */

/**
 * 고른 코스를 외부 내비로 넘긴다. 카카오맵 웹 링크는 출발·경유 하나·도착만 받으므로
 * (lib/parking.ts navigateTo) 첫째 날 동선을 넘긴다 — 출발지 · 가운데 한 곳 · 마지막 곳.
 * 여러 날 코스를 한 번에 안내하는 건 뜻이 없다 (하루씩 도는 여행이다).
 */
function NaviSheet({ origin, course, onClose }: { origin: { name: string; at: [number, number] | null }; course: Course; onClose: () => void }) {
  const day = course.days.find((d) => d.stops.length) ?? course.days[0];
  const stops = day?.stops ?? [];
  const chain = [origin.name, ...stops.map((s) => s.name)];

  function go() {
    const at = origin.at;
    const last = stops[stops.length - 1];
    if (!at || !last) return;
    const dest = { name: last.name, at: last.at };
    const from = { name: origin.name, at };
    // 가운데 한 곳을 경유지로 (링크가 경유지 하나만 받는다). 두 곳뿐이면 경유 없이 출발→도착
    const mid = stops.length >= 2 ? stops[Math.floor((stops.length - 1) / 2)] : null;
    navigateTo(dest, mid && mid !== last ? { from, via: { name: mid.name, at: mid.at } } : { from });
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[23px]">
        <div className="mt-6 shrink-0">
          <p className="text-[13px] leading-[19px] text-[#7d7d7d]">코스 준비 완료</p>
          <h1 className="mt-1 text-[23px] leading-[32px] font-bold text-[#262626]">
            <span className="text-[#ff7d32]">외부 내비 앱</span>으로
            <br />
            길 안내를 시작할까요?
          </h1>
          <p className="mt-2.5 text-[14px] leading-[21px] text-[#7d7d7d]">앱을 선택하면 경유지와 목적지를 함께 전달해요.</p>
        </div>

        {/* 선택한 코스 요약 */}
        <div className="mt-7 shrink-0 rounded-2xl border-2 border-[#ff7d32] bg-[#fff5ee] px-5 py-5">
          <p className="text-[12px] leading-[18px] text-[#7d7d7d]">선택한 코스</p>
          <p className="mt-1.5 text-[20px] leading-[28px] font-bold text-[#262626]">{nameOf(course.theme)}</p>
          <p className="mt-2.5 text-[14px] leading-[22px] font-medium text-[#525252]">{chain.join(" → ")}</p>
          <p className="mt-3 text-[12px] leading-[18px] text-[#7d7d7d]">
            {course.days.reduce((n, d) => n + d.stops.length, 0)}곳 · 이동 {hm(course.totalMin)} · {taglineOf(course)}
          </p>
        </div>

        <p className="mt-8 shrink-0 text-[16px] leading-6 font-bold text-[#262626]">길안내를 실행할 앱을 선택해 주세요</p>
        <button
          onClick={go}
          className="mt-3 flex shrink-0 items-center gap-3.5 rounded-2xl border border-[#eae7e2] bg-white px-4 py-3.5 text-left transition active:scale-[0.99]"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#ffe600] text-[20px] font-black text-[#3a1d1d]">K</span>
          <span className="min-w-0">
            <span className="block text-[16px] leading-6 font-bold text-[#262626]">카카오내비</span>
            <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">카카오내비로 경로 전달</span>
          </span>
        </button>
      </div>

      <button
        onClick={onClose}
        className="mx-[23px] mt-2 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-bold text-white transition active:scale-[0.98]"
      >
        닫기
      </button>
      <div className="h-[34px] shrink-0" />
    </div>
  );
}

/* ─────────────────────────── 실패 ─────────────────────────── */

function Failure({ message, onBack }: { message: string | null; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <div className="flex flex-1 flex-col items-center justify-center px-[34px] text-center">
        <p className="text-[15px] leading-[24px] text-[#525252]">{message}</p>
        <button
          onClick={onBack}
          className="mt-6 h-12 rounded-2xl bg-[#ff7d32] px-8 text-[15px] font-bold text-white transition active:scale-[0.98]"
        >
          다시 고르기
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── 규칙 기반 이름·태그 (AI 네이밍 붙기 전 임시) ─────────────────────────── */

/**
 * 코스 이름 — 테마(관심 장소)별로 미리 지어둔 편집용 이름. 와이어프레임의 "바다와 노을을 따라" 톤이다.
 * 규칙이라 같은 테마면 늘 같은 이름이 나온다. AI 네이밍(lib/ai.ts, 모델 미정)이 붙으면 여기를 그 값으로 바꾼다.
 */
const COURSE_NAMES = [
  "바다와 노을을 따라", // 0 바다·해변
  "숲과 오름 사이로", // 1 오름·숲
  "실내에서 만나는 제주", // 2 전시·박물관
  "제주 맛을 찾아서", // 3 시장·맛집
  "사진 남기기 좋은 길", // 4 카페·사진
  "함께 즐기는 하루", // 5 체험·동물
];
const nameOf = (theme: number | null) => (theme === null ? "가볍게 도는 코스" : (COURSE_NAMES[theme] ?? "제주 한 바퀴"));

/** 태그라인 — 실내 테마는 "비 오는 날도 좋아요", 나머지는 하루 총 운전 시간으로 부담을 말한다. */
function taglineOf(course: Course): string {
  if (course.theme === 2) return "비 오는 날도 좋아요"; // 전시·박물관
  const perDay = course.totalMin / Math.max(1, course.days.length);
  return perDay <= 90 ? "운전 부담 낮음" : perDay <= 150 ? "운전 부담 보통" : "운전 부담 있음";
}

/** 분 → "1시간 45분" · "50분" */
function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
}
