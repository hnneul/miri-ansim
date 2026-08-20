"use client";

// AI 여행 코스 결과 — 와이어프레임 TRIP-05(생성 중) · TRIP-06(코스 추천) · TRIP-07(외부 내비).
//
// 세 장이 한 화면인 이유는 셋이 한 흐름이라서다. 코스를 만드는 동안 05, 만들어지면 06,
// 고르고 나면 07 이 그 위에 덮인다 — 라우트를 나누면 만든 코스를 다시 실어 날라야 하는데
// 코스는 URL 에 담기에 너무 크다 (장소 수 × 좌표 × 날짜).
//
// 조건은 /trip 이 URL 로 넘겨준다 (lib/trip.ts toTripQuery). 그래서 이 링크만 있으면
// 같은 코스가 다시 나온다 — buildCourses 가 같은 입력에 같은 결과를 주기 때문이다.
//
// **코스는 몇 박 며칠이든 하루치다** (lib/course.ts buildCourses 의 하루 주석). 그래서 날짜별
// 범례도 한 줄이고, 내비로 넘길 날을 고르는 칸도 안 뜬다 — 둘 다 여러 날일 때만 나오도록
// 남겨 뒀다. 여러 날로 되돌리면 화면은 손 안 대고 그대로 산다.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";
import RouteMap, { labeledPin, type LatLng, type MapMarker, type MapRoute } from "../../RouteMap";
import { navigateTo } from "@/lib/parking";
import { courseMeta, driveNote, hourMin, type Course } from "@/lib/course";
import type { Stop } from "@/lib/course";
import { summaryOf, toRecordQuery } from "@/lib/record";
import { nightsOf, queryRecord, TRIP_KEYS, type TripPlan } from "@/lib/trip";
import { makeCourses, type Made } from "./actions";

/**
 * 구간 선 색. 하루 코스라 한 색이면 되지만, 여러 날로 되돌릴 자리를 위해 배열로 둔다
 * (lib/course.ts buildCourses 의 하루 주석).
 *
 * 첫날이 초록(--color-safe, DESIGN.md)이다. 주황이었는데 핀·이름표·"총 2시간 29분" 뱃지까지
 * 죄다 주황이라 지도가 한 색으로 뭉갰다 — 선이 초록이면 그 위에 선 주황·먹 핀이 떨어져 보인다.
 * 파랑은 안 쓴다: /route 길 비교에서 "다른 길"을 뜻하는 색이라 여기서 쓰면 뜻이 흐려진다.
 */
const DAY_COLORS = ["#2FA97C", "#a05fd0", "#d98b2b", "#6ba85b", "#d9534f"];

/**
 * 코스의 세 자리. 길 비교 화면과 **같은 핀**이다 (RouteMap labeledPin) —
 * 같은 앱에서 지도가 둘인데 핀이 서로 다르면 다른 앱처럼 읽힌다.
 *
 * 출발·도착에는 글자를 굽는다. 핀 밑 이름표는 "어디"(제주공항·카멜리아힐)를 말하지만
 * **출발인지 도착인지**는 색만 알고 있었고, 색은 아무도 외우고 있지 않다.
 * 들르는 곳은 글자를 안 넣는다 — 이름표가 "금능해수욕장 · 53분"으로 이미 길다.
 *
 * 색은 셋 다 선(초록)과 다르다. 들르는 곳이 선과 같은 주황이던 때는 선 위에서 핀이 녹았다.
 */
const START = labeledPin("#fc7f35", "출발");
const VIA = labeledPin("#4A7DFF");
const END = labeledPin("#1f1f1f", "도착");

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
  /**
   * 고른 코스. **아직 안 골랐으면 null** 이다 (TRIP-06) — 고르면 그 카드가 펼쳐지고
   * 머리글과 아래 버튼이 함께 바뀐다 (TRIP-07). 0 으로 시작하면 안 고른 상태를 표현할 수 없다.
   */
  const [picked, setPicked] = useState<number | null>(null);

  const query = searchParams.toString();

  /**
   * 여행 조건을 걷어낸 쿼리. **코스 흐름 밖(홈·기록)으로 나갈 때** 쓴다 —
   * 조건은 여기까지가 쓸모고, 그대로 딸려 나가면 홈에서 새 여행을 시작할 때 되살아난다
   * (app/trip/page.tsx 의 같은 자리 주석).
   */
  const 나가는쿼리 = () => {
    const q = new URLSearchParams(searchParams);
    for (const k of TRIP_KEYS) q.delete(k);
    return q;
  };

  useEffect(() => {
    let alive = true;
    // queryRecord 다 — Object.fromEntries 는 같은 키가 여러 번이면 마지막만 남긴다
    // (테마 둘을 골라도 하나만, 꼭 가고 싶은 곳도 마지막 한 곳만 도착했다)
    makeCourses(queryRecord(query)).then((m) => alive && setMade(m));
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
          onClick={() => router.replace(`/trip?${searchParams}&resume=1`)}
          className="mx-6 mb-8 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition active:scale-[0.98]"
        >
          조건 다시 고르기
        </button>
      </Frame>
    );

  return (
    <Recommend
      made={made}
      picked={picked}
      /* 고른 카드를 다시 누르면 풀린다 — 취소하려고 뒤로 나갔다 들어오면 코스를 다시 짠다(makeCourses) */
      onPick={(i) => setPicked((before) => (before === i ? null : i))}
      /*
        **router.back() 이 아니다.** 히스토리의 이전 항목은 조건이 안 실린 `/trip?프로필` 이라,
        거기로 돌아가면 위저드가 처음부터(TRIP-01) 다시 시작한다 — 고른 걸 다 잃는다.
        지금 URL 에 조건이 전부 들어 있으니 그대로 실어 보낸다 (app/trip/page.tsx 가 되읽는다).

        replace 인 이유: push 면 히스토리에 /trip 이 하나 더 쌓여, 브라우저 뒤로가기가
        방금 나온 코스 화면으로 되돌아간다. 갈아끼우면 뒤로가기가 원래 자리로 간다.
      */
      onBack={() => router.replace(`/trip?${searchParams}&resume=1`)}
      onHome={() => router.push(`/home?${나가는쿼리()}`)}
      // 여행 기록(TRIP-08~09)으로 넘어가는 유일한 문이다. 코스 전체가 아니라 요약만 쿼리로 넘긴다
      // — 기록에 필요한 건 이름 몇 개와 거리뿐이다 (lib/record.ts 첫 주석).
      onDone={(c) => router.push(`/trip/record?${toRecordQuery(summaryOf(c, made.plan.origin), 나가는쿼리())}`)}
    />
  );
}

/** 상태바 + 흰 바탕. 세 화면이 같은 틀을 쓴다. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    // relative 다 — 기록 모달이 폰 프레임 안에서만 덮어야 한다 (바깥은 브라우저 여백이다)
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
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
    // "날씨"라고 적혀 있었는데 코스 계산에 날씨는 안 들어간다 — 실제로 보는 건 여행 시작일의
    // 계절이다 (lib/trip.ts SEASONS). 하지도 않은 일을 진행 표시로 말하지 않는다.
    { label: "취향과 장소 조합 완료", at: 25 },
    { label: "이동 부담 확인 완료", at: 55 },
    { label: "계절에 맞는 곳으로 정리 중", at: 100 },
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

/* ────────────────────── TRIP-06 (코스 추천) · TRIP-07 (코스 누르면) ────────────────────── */

/**
 * 두 와이어프레임이 **한 화면의 두 상태**다. 07 의 이름이 "코스 누르면"인 게 그 뜻이고,
 * 지도·카드 목록이 그대로 남은 채 셋만 바뀐다:
 *
 *   · 머리글  "귤이가 추천하는…"        → "선택한 코스로 / 길 안내를 시작할까요?" (+ 캐릭터·눈길 문구 교체)
 *   · 카드    둘 다 116                 → 고른 것 184(경유지·부담까지), 나머지 77(제목만)
 *   · 바닥    버튼 없음                  → "이 코스로 여행하기"
 *
 * 그래서 화면을 갈아끼우지 않는다. 예전에는 07 을 "외부 내비 앱 선택"이라는 별도 화면으로 뒀는데
 * 그건 지금 없는 디자인이다 — 고를 앱이 카카오 하나뿐이라 고르는 단계가 통째로 사라졌고,
 * 버튼을 누르면 바로 카카오내비로 넘어간다.
 */
function Recommend({
  made,
  picked,
  onPick,
  onBack,
  onHome,
  onDone,
}: {
  made: Extract<Made, { courses: Course[] }>;
  picked: number | null;
  onPick: (i: number) => void;
  onBack: () => void;
  onHome: () => void;
  onDone: (course: Course) => void;
}) {
  const { plan, courses, missing } = made;
  /**
   * 카카오내비로 넘겼는가. 넘긴 **뒤 이 화면으로 돌아왔을 때** 기록을 물으려고 든다 (아래 useEffect).
   * 넘긴 적 없는 사람에게는 아무 일도 안 일어난다 — 아직 출발도 안 했는데 다녀왔냐고 물을 수 없다.
   */
  const [넘김, set넘김] = useState(false);
  /**
   * 내비로 넘긴 적이 있는가. 넘김 과 달리 **안 꺼진다** — 기록으로 가는 문을 남겨두는 데 쓴다.
   * 넘김 하나로 물음창만 띄우던 때는 "나중에"를 누르는 순간 그 문이 통째로 사라졌다
   * ("나중에"는 안 하겠다가 아니라 이따가인데 이따가가 없었다). 팝업이 막혀 물음창이
   * 아예 안 뜬 사람도 같은 자리에 갇혔다.
   */
  const [다녀옴, set다녀옴] = useState(false);
  /** 가운데 뜨는 "여행을 기록하시겠습니까?" 창 */
  const [기록물음, set기록물음] = useState(false);
  /**
   * 지도에서 누른 핀. 이름표만으로는 "그래서 여기가 뭐야"를 못 말한다 —
   * 누르면 지도 **아래**에 한 장이 뜬다 (지도 위 말풍선은 경로·다른 핀을 덮는다).
   */
  const [누른곳, set누른곳] = useState<{ name: string; addr: string | null; kind: string; legMin: number | null } | null>(null);
  const origin = plan.originAt as LatLng;

  /*
    지도가 그리는 건 **고른 코스**다. 안 골랐으면 그 자리는 빈 판이다 (아래 지도 자리).

    한동안 안 골랐을 때 첫 코스를 미리 그려 뒀는데(와이어프레임 06 도 경로가 그려져 있다),
    아무것도 안 고른 채로 경로가 떠 있으니 "이게 뭘 그린 거지, 내가 뭘 고른 건가"가 됐다.
    routes·markers 는 그대로 계산해 둔다 — 고르는 순간 바로 그려야 해서다.
  */
  const course = courses[picked ?? 0];

  const days = course.days.filter((d) => d.stops.length);

  /*
    하루가 한 줄. 출발지에서 나가 마지막 장소까지 — 돌아오는 길은 안 그린다(같은 선을 두 번 긋는다).

    **말풍선은 안 단다.** 와이어프레임은 구간마다 "제주공항 → 애월 / 30분"을 지도 위에 붙였는데,
    저건 경로가 섬 전체에 넓게 퍼진 **그림**이라 되는 배치다. 실제 하루 코스는 한 지역에 몰려서
    (금능 → 판포는 9분 거리다) 말풍선 셋이 같은 자리에 쌓여 지도를 덮었다 — 실제로 그렇게 나왔다.
    구간 시간은 대신 **핀 이름표**에 붙였다 (markers 주석 — "금능해수욕장 · 53분").
  */
  const routes: MapRoute[] = days.map((d, i) => ({
    path: [origin, ...d.stops.map((s) => s.at)],
    color: DAY_COLORS[i % DAY_COLORS.length],
    weight: 5,
  }));


  /*
    출발 초록 · 마지막 빨강 · 그 사이는 점 (pin 주석). 출발지에도 핀이 선다 — 와이어프레임과 같다.

    **이름표(caption)에 구간 시간까지 접어 넣는다.** 안 주면 마우스를 얹어야 뜨는 툴팁뿐이라
    폰에서는 어느 핀이 어디인지 알 길이 없다.

    "금능해수욕장 · 53분"의 53분은 **직전 자리에서 여기까지** 걸리는 시간이다 (Stop.legMin).
    와이어프레임은 이걸 경로 한가운데 말풍선으로 달았는데, 실제 코스는 한 지역에 몰려서
    말풍선끼리 겹쳤다. 한동안 지도 **아래** 줄("A → B  53분")로 내려뒀더니 이번엔 장소 이름이
    지도와 목록에 두 번 나왔다 — 이름표에 붙이면 겹치지도, 두 번 말하지도 않는다.
    출발지에는 안 붙인다: 아직 아무 데도 안 갔으니 걸린 시간이 없다.
  */
  const 카드 = (s: Stop) => ({ name: s.name, addr: s.addr, kind: s.kind, legMin: s.legMin });
  const markers: MapMarker[] = [
    {
      coord: origin,
      label: plan.origin,
      caption: plan.origin,
      icon: START,
      // 출발지는 Stop 이 아니라 legMin 이 없다 — 아직 아무 데도 안 갔으니 걸린 시간도 없다
      onClick: () => set누른곳({ name: plan.origin, addr: null, kind: "출발지", legMin: null }),
    },
    ...days.flatMap((d) =>
      d.stops.map((s, n) => ({
        coord: s.at,
        label: s.name,
        caption: `${s.name} · ${hourMin(s.legMin)}`,
        icon: n === d.stops.length - 1 ? END : VIA,
        onClick: () => set누른곳(카드(s)),
      })),
    ),
  ];

  /*
    내비를 켜고 **돌아오면** 한 번 묻는다.

    카카오내비는 새 탭(앱)으로 열리므로 이 화면은 그대로 살아 있다. 돌아왔다는 신호가
    visibilitychange 다 — 다른 일로 탭을 옮겼다 와도 뜨지만, 내비를 실제로 켠 사람에게만
    켜지는 데다 한 번 묻고 끝이라(set넘김(false)) 성가시게 굴 자리가 없다.

    묻는 걸 버튼으로 두면 "이 코스로 여행하기" 밑에 회색 버튼이 늘 붙어 있어야 하는데,
    그건 아직 안 떠난 사람에게도 보이는 자리다.
  */
  useEffect(() => {
    if (!넘김) return;
    const 돌아옴 = () => {
      if (document.visibilityState !== "visible") return;
      set넘김(false);
      set기록물음(true);
    };
    document.addEventListener("visibilitychange", 돌아옴);
    // 팝업이 막혀 같은 탭에서 열렸으면(lib/parking.ts navigateTo) 이 문서가 떠났다 돌아온다 —
    // 그 복귀는 visibilitychange 가 아니라 pageshow 로 온다 (bfcache).
    window.addEventListener("pageshow", 돌아옴);
    return () => {
      document.removeEventListener("visibilitychange", 돌아옴);
      window.removeEventListener("pageshow", 돌아옴);
    };
  }, [넘김]);

  /** 고른 코스를 카카오내비로 넘긴다 — 하루치를 통째로(마지막이 목적지, 나머지가 경유지) */
  function go() {
    const stops = days[0]?.stops;
    if (!stops?.length || !plan.originAt) return;
    set넘김(true);
    set다녀옴(true);
    navigateTo(
      { name: stops[stops.length - 1].name, at: stops[stops.length - 1].at },
      {
        from: { name: plan.origin, at: plan.originAt },
        via: stops.slice(0, -1).map((s) => ({ name: s.name, at: s.at })),
      },
    );
  }

  const 골랐나 = picked !== null;

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-11 shrink-0 items-center justify-between pr-[19px] pl-[15px]">
          <button onClick={onBack} aria-label="뒤로" className="flex size-11 items-center justify-center transition hover:opacity-40 active:scale-90">
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          {/* 홈은 코스를 고른 뒤에만 (와이어프레임 07). 고르기 전에는 뒤로가 곧 나가는 길이다 */}
          {골랐나 && (
            <button onClick={onHome} aria-label="메인화면으로" className="flex size-11 items-center justify-center">
              <img src="/route/icon-home.svg" alt="" className="size-6" />
            </button>
          )}
        </div>

        {/*
          머리글은 상태에 따라 **글만** 갈린다 — 상자·여백·줄높이는 둘이 같다.
          예전엔 06 쪽에만 부제 자리가 더 있어서 코스를 고르는 순간 아래 지도와 카드가 18px 씩
          위로 튀었다. 누른 카드가 손가락 밑에서 움직이면 잘못 눌렀나 싶어진다.
        */}
        <div className="relative shrink-0 px-[23px]">
          <h2 className="mt-[7px] text-[23px] leading-9 font-bold text-[#262626]">
            {골랐나 ? (
              <>
                <span className="text-[#ff7d32]">선택한 코스</span>로
                <br />
                길 안내를 시작할까요?
              </>
            ) : (
              <>
                귤이가 <span className="text-[#ff7d32]">추천</span>하는
                <br />
                제주 여행 코스로 달려볼까요 ?
              </>
            )}
          </h2>
        </div>

        {/* 높이는 이 상자가 정한다 — RouteMap 이 h-full 이라 자기한테 높이를 주면 안 먹는다 */}
        <div className="relative mt-5 h-[236px] shrink-0 px-[23px]">
          {/*
            **고르기 전에는 빈 판이다.** 자리는 그대로 비워 둔다 — 상자를 통째로 빼면 코스를 고르는
            순간 카드가 236px 아래로 밀려 방금 누른 것이 손가락 밑에서 사라진다.
            빈 판에는 왜 비었는지 한 줄을 적는다. 아무 말 없이 회색 상자만 있으면 안 뜬 지도로 읽힌다.
          */}
          {picked === null ? (
            // 아이콘은 안 얹는다 — 위에 얹으면 그 높이만큼 글이 아래로 밀려 상자 한가운데가 아니게 된다
            <div className="flex size-full items-center justify-center rounded-[16px] border border-[#eae7e2] bg-[#faf8f5]">
              <p className="text-[13px] leading-5 text-[#a8a29b]">코스를 고르면 이동 경로를 볼 수 있어요</p>
            </div>
          ) : (
            <>
              <RouteMap
            center={origin}
            routes={routes}
            markers={markers}
            className="relative size-full overflow-hidden rounded-[16px]"
            /* 빈 곳을 누르면 카드를 접는다 — 지도를 보겠다는 뜻이다 (RouteMap onBlank 주석) */
            onBlank={() => set누른곳(null)}
          />
          {/*
            총 이동시간 배지 (와이어프레임 우상단). 파랑은 이 앱에서 여기만 쓰는데 디자인이 정한 색이고,
            지도 위 시간 표시는 내비들이 다 파랑이라 주황 코스선과 안 섞이는 이점도 있다.

            **왼쪽 위다** — 와이어프레임은 오른쪽 위인데, 거기는 그림이라 경로가 왼쪽에서 시작한다.
            우리 출발지는 대개 공항(섬 북쪽)이라 오른쪽 위에 두니 출발 핀을 그대로 덮었다.
            어느 구석도 늘 안전하진 않지만, 경로가 출발지에서 남/서로 뻗는 이 앱에서는 왼쪽 위가 제일 한가하다.

            z-10 이 필요하다 — 카카오 SDK 가 지도 안에 z-index 층을 여러 겹 깔아서, 안 주면
            지도 막에 덮여 흐릿해진다 (app/home/page.tsx 의 같은 자리 주석).
          */}
          <span className="pointer-events-none absolute top-[10px] left-[33px] z-10 rounded-[8px] bg-white px-[8px] py-[4px] text-[10px] leading-none font-bold text-[#1473e6] shadow-[0_1px_4px_0_rgba(0,0,0,0.12)]">
            총 {hourMin(course.totalMin)}
          </span>
          </>
          )}
        </div>

        {/*
          누른 핀 한 장. 지도 **아래**다 — 지도 위에 띄우면 경로와 다른 핀을 덮는다.
          주소가 없는 곳도 있어서(출발지, 좌표만 있는 곳) 없으면 그 줄만 빠진다.
        */}
        {누른곳 && (
          <div className="mt-3 flex shrink-0 items-start gap-3 rounded-[14px] border border-[#eae7e2] bg-white px-4 py-3 mx-[23px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-[22px] font-medium text-[#262626]">{누른곳.name}</span>
              <span className="mt-0.5 block truncate text-[12px] leading-[18px] text-[#7d7d7d]">
                {[누른곳.kind, 누른곳.addr].filter(Boolean).join(" · ") || "위치 정보 없음"}
              </span>
              <span className="mt-1 block text-[12px] leading-[18px] text-[#ff7d32]">
                {누른곳.legMin === null ? "여기서 출발해요" : `직전 자리에서 ${hourMin(누른곳.legMin)}`}
              </span>
            </span>
            <button
              onClick={() => set누른곳(null)}
              aria-label="닫기"
              className="-mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-[18px] text-[#b8b2aa] transition hover:bg-[#f6f4f1] hover:text-[#7d7d7d]"
            >
              ✕
            </button>
          </div>
        )}

        {/*
          핀 색이 무엇을 뜻하는지. 이름표는 "어디"를 말하지만 "출발인지 도착인지"는 색만 알고 있어서,
          한 줄로 풀어 준다.

          지도가 빈 판일 때는 **자리만 남기고 감춘다**(invisible) — 설명할 핀이 없는데 범례만 떠
          있으면 안 그려진 지도처럼 보이고, 통째로 빼면 고르는 순간 카드가 그만큼 밀린다.
        */}
        <div className={`mt-3 flex shrink-0 items-center gap-3.5 px-[23px] ${picked === null ? "invisible" : ""}`}>
          {[
            ["#fc7f35", "출발"],
            ["#4A7DFF", "들르는 곳"],
            ["#1f1f1f", "도착"],
          ].map(([color, 이름]) => (
            <span key={이름} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[11px] leading-4 text-[#7d7d7d]">{이름}</span>
            </span>
          ))}
        </div>

        {/* 좌표를 못 찾은 "꼭 가고 싶은 곳"은 조용히 빼지 않고 말한다 */}
        {missing.length > 0 && (
          <p className="mt-3 shrink-0 px-[23px] text-[12px] leading-[18px] text-[#7d7d7d]">
            {missing.join(" · ")} 은(는) 위치를 못 찾아 코스에 못 넣었어요.
          </p>
        )}

        {/*
          **몇 박이든 코스는 하루치다** (lib/course.ts buildCourses 의 하루 주석).
          설계로는 맞는 판단인데 화면이 그 말을 안 해서, "2박 3일"을 고르고 온 사람은
          나머지 이틀이 왜 없는지 알 수가 없었다. 여러 날 코스로 되돌리면 이 줄만 지우면 된다.

          하루짜리 여행에는 안 띄운다 — 당일치기에 "먼저 첫날"은 할 말이 아니다.
        */}
        {(nightsOf(plan.start, plan.end)?.nights ?? 0) > 0 && (
          <p className="mt-3 shrink-0 px-[23px] text-[12px] leading-[18px] text-[#7d7d7d]">
            먼저 첫날 코스를 짰어요. 나머지 날은 다녀와서 다시 받아보세요.
          </p>
        )}

        <div className="mt-6 flex shrink-0 flex-col gap-3 px-[23px] pb-2">
          {courses.map((c, i) => (
            <CourseCard
              key={c.title + i}
              course={c}
              n={i + 1}
              plan={plan}
              on={i === picked}
              /* 고르기 전에는 다 펼쳐 보이고, 고른 뒤에는 고른 것만 펼친다 (와이어프레임 06 → 07) */
              folded={골랐나 && i !== picked}
              onClick={() => onPick(i)}
            />
          ))}
        </div>
      </div>

      {/* 버튼은 고른 뒤에만. 와이어프레임 06 에는 바닥에 아무것도 없다 */}
      {골랐나 && (
        <>
          <button
            onClick={go}
            className="mx-[22px] mt-4 flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[#ff7d32] text-[16px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            <img src="/trip/icon-navigation.svg" alt="" aria-hidden className="size-5" />이 코스로 여행하기
          </button>
          {/*
            카카오 링크는 경유지를 5개까지만 받아서 그 뒤는 잘린다 (lib/parking.ts VIA_MAX).
            코스는 기본 3곳 + "꼭 가고 싶은 곳" 최대 10곳이라 13곳까지 나오는데, 화면에는 13곳이
            그려지고 내비에는 6곳만 간다 — 조용히 사라지면 어디를 빼먹었는지도 모른다.
            잘릴 때만 말한다 (VIA_MAX 5 + 도착지 1 = 6).
          */}
          {days[0] && days[0].stops.length > 6 && (
            <p className="mx-[22px] mt-2 shrink-0 text-center text-[11px] leading-[16px] text-[#9e9e9e]">
              내비에는 앞 6곳까지만 넘어가요. 나머지는 도착해서 다시 잡아주세요.
            </p>
          )}
          {/*
            물음창(아래)을 닫은 뒤에도 남는 기록 입구. 아래 주석이 "늘 붙어 있는 회색 버튼"을
            경계하는데, 그 경계는 **아직 안 떠난 사람**에게 보이는 걸 두고 한 말이다 —
            다녀옴 이 그 자리를 정확히 가른다. 위 주황 버튼은 그대로 둔다: 물음창을 닫자마자
            내비를 다시 켜려는 사람(팝업이 막혀 되돌아온 사람이 그렇다)이 있다.
          */}
          {다녀옴 && (
            <button
              onClick={() => onDone(course)}
              className="mx-[22px] mt-2 h-[46px] shrink-0 rounded-[10px] bg-[#f6f4f1] text-[15px] font-medium text-[#262626] transition hover:bg-[#eae7e2] active:scale-[0.98]"
            >
              여행 기록하기
            </button>
          )}
        </>
      )}
      <div className="h-[57px] shrink-0" />

      {/*
        여행 기록(TRIP-08)으로 가는 문. 와이어프레임에는 없지만 지우면 코스가 기록으로 이어지지 않는다.

        바닥 버튼이 아니라 **가운데 창**인 이유 — 버튼으로 두면 "이 코스로 여행하기" 아래 늘 붙어
        있어야 하고, 그건 아직 안 떠난 사람에게도 보이는 자리다. 물어야 할 때는 다녀온 뒤 한 번뿐이라
        그 한 번만 화면을 덮고 답을 받는 편이 맞다.
      */}
      {기록물음 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-8">
          <div role="dialog" aria-modal aria-labelledby="기록물음-제목" className="w-full rounded-[18px] bg-white px-6 pt-7 pb-5">
            <h2 id="기록물음-제목" className="text-center text-[17px] leading-[26px] font-bold text-[#262626]">
              여행을 기록하시겠습니까?
            </h2>
            <p className="mt-2 text-center text-[13px] leading-5 text-[#7d7d7d]">
              다녀온 코스와 사진을 남겨두면
              <br />
              다음 여행에서 다시 꺼내볼 수 있어요.
            </p>
            <div className="mt-6 flex gap-2.5">
              {/* 나중에가 왼쪽이다 — 오른쪽이 "다음으로 가는 자리"라는 이 앱의 규칙을 지킨다 */}
              <button
                onClick={() => set기록물음(false)}
                className="h-12 flex-1 rounded-[10px] bg-[#f6f4f1] text-[15px] font-medium text-[#262626] transition hover:bg-[#eae7e2] active:scale-[0.98]"
              >
                나중에
              </button>
              <button
                onClick={() => onDone(course)}
                className="h-12 flex-1 rounded-[10px] bg-[#ff7d32] text-[15px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
              >
                기록하기
              </button>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}

/**
 * 코스 카드 — 세 모양이다 (와이어프레임 06 · 07).
 *   · 기본(116)  추천 N / 제목 / 몇 곳·이동 / 오른쪽에 부담 한마디
 *   · 고름(184)  "선택한 코스" / 큰 제목 / 경유지 줄 / 곳·이동·부담 한 줄
 *   · 접힘(77)   추천 N / 제목만 — 고른 것 말고는 이만큼만 남는다
 */
function CourseCard({
  course,
  n,
  plan,
  on,
  folded,
  onClick,
}: {
  course: Course;
  n: number;
  plan: TripPlan;
  on: boolean;
  folded: boolean;
  onClick: () => void;
}) {
  if (folded)
    return (
      <button
        onClick={onClick}
        aria-pressed={false}
        className="h-[77px] rounded-[18px] border border-[#eae7e2] bg-white px-[18px] pt-3 text-left transition active:scale-[0.99]"
      >
        <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">추천 {n}</span>
        <span className="mt-1 block truncate text-[16px] leading-6 font-medium text-[#262626]">{course.title}</span>
      </button>
    );

  if (on) {
    const stops = course.days.flatMap((d) => d.stops);
    return (
      <button
        onClick={onClick}
        aria-pressed
        className="min-h-[184px] rounded-[20px] border-2 border-[#ff7d32] bg-[#fff0e6] px-[18px] py-[18px] text-left transition"
      >
        <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">선택한 코스</span>
        <span className="mt-2 block truncate text-[22px] leading-[30px] font-bold text-[#262626]">{course.title}</span>
        {/*
          들르는 순서. 두 줄로 넘어가도 **이름은 안 쪼갠다**(break-keep) — 그냥 두면
          "카 / 멜리아힐"처럼 한복판에서 잘린다.
          화살표는 앞 이름에 붙여 둔다(줄바꿈 없는 공백) — 줄이 "→"로 시작하면 어디서 온 화살표인지
          한 박자 늦게 읽힌다. 끊기는 자리는 늘 화살표 **뒤**다.
        */}
        <span className="mt-[13px] block break-keep text-[14px] leading-[21px] text-[#7d7d7d]">
          {[plan.origin, ...stops.map((s) => s.name)].join("\u00a0→ ")}
        </span>
        <span className="mt-[13px] block text-[12px] leading-[18px] text-[#7d7d7d]">
          {courseMeta(course)} · {driveNote(course, plan.driveHours)}
        </span>
      </button>
    );
  }

  /*
    테두리는 고를 때나 아닐 때나 2px 이다 (와이어프레임도 미선택 카드가 2px 다) —
    1px 로 두면 고르는 순간 테두리가 두꺼워지면서 카드 안 글자가 1px 씩 밀린다.
  */
  return (
    <button
      onClick={onClick}
      aria-pressed={false}
      className="h-[116px] rounded-[18px] border-2 border-[#eae7e2] bg-white px-[18px] pt-3.5 pb-3 text-left transition active:scale-[0.99]"
    >
      <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">추천 {n}</span>
      {/* 16px Medium 이다 — 18px Bold 로 키웠더니 카드가 제목 덩어리로 보여 아래 두 줄이 안 읽혔다 */}
      <span className="mt-1.5 block truncate text-[16px] leading-6 font-medium text-[#262626]">{course.title}</span>
      <span className="mt-1 block text-[12px] leading-[18px] text-[#7d7d7d]">{courseMeta(course)}</span>
      <span className="mt-1.5 block text-right text-[12px] leading-[18px] text-[#262626]">
        {driveNote(course, plan.driveHours)}
      </span>
    </button>
  );
}
