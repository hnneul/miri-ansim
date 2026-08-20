"use client";

// 차 없는 길 · 연습 구간 — 메인화면 "차 없는 길" 칸으로 들어온다.
//
// **이 화면이 답하는 것:** "지금 나가면 어디서 연습하는 게 제일 편한가."
// 초보가 무서운 건 막히는 게 아니라 옆에 붙는 차라서, 이 앱에서 가장 직접적인 답이다.
// 차 없는 길 목록에서 시작해, 급커브·신호·차로수를 붙여 **단계**로 나눈다 (lib/practice.ts).
//
// **코스가 도로 하나인 이유**도 거기 적어 뒀다 — 왕복하면 출발지로 돌아오고, 초보가
// 길을 잃지 않으며, 연습에 필요한 건 예쁜 동그라미가 아니라 같은 길의 반복이라서다.
//
// **지도가 목록보다 위에 있는 이유.** "노연로 왕복 2.2km" 만 적어 두면 그 길이 어디인지
// 모른다 — 초보에게는 도로명이 지명이 아니라 처음 듣는 단어다. 고른 구간을 지도에 그려야
// "아, 저기" 가 된다. 선은 링크마다 한 줄씩 그린다 (lib/practice.ts paths 주석).
//
// **왜 속도를 그대로 줄세우지 않나.** 애월로는 비어도 22km/h 고 번영로는 비면 57km/h 다.
// km/h 로 줄세우면 간선이 늘 이기는데, 간선은 차가 없어서가 아니라 원래 빠른 길이다.
// 그래서 **여유율 = 지금 속도 ÷ 그 길이 빌 때의 속도**로 매긴다 (lib/flow.ts calmRoads).
// 굳혀둔 자유속도는 평일 7일 중앙값이다 (scripts/build-road-baseline.mjs).
//
// **점수에는 안 들어간다.** 길 비교(/route)의 부담점수는 급커브·차로수처럼 굳혀둔 값만 쓴다 —
// 실시간이 섞이면 같은 프로필로 두 번 열었을 때 점수가 달라진다 (lib/traffic.ts 첫 주석).
// 그리고 애초에 차 많고 곧은 길(평화로)이 차 적고 굽은 길(516로)보다 초보에게 쉽다.
// 차 대수는 길을 고르는 기준이 아니라 그 자체로 궁금한 값이라, 이렇게 따로 선다.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import DemoNotice from "../DemoNotice";
import RouteMap, { type LatLng, type MapRoute } from "../RouteMap";
import { calmNear, type CalmNear } from "./actions";
import { LEVEL_HINT, LEVEL_LABEL, type Segment } from "@/lib/practice";

/** 위치를 못 받았을 때 볼 곳 — 제주시청. /home·/parking 과 같은 이유로 한라산을 잡지 않는다. */
const JEJU_CITY_HALL: LatLng = [33.4996, 126.5312];

/** 고른 구간 선 색 — 이 앱의 강조색이다 (검색바·제목과 같은 주황). */
const 선색 = "#ff7d32";

/** 출발점 표시 — 메인화면 지도와 같은 점을 쓴다 (app/home/page.tsx MY_LOCATION). */
const MY_LOCATION = { src: "/home/my-location.svg", size: [44, 44] as [number, number] };

export default function CalmPage() {
  return (
    <Suspense>
      <Calm />
    </Suspense>
  );
}

function Calm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [near, setNear] = useState<CalmNear | null>(null);
  /** 지도에 그릴 구간. 처음에는 1등(단계가 가장 낮고 가장 한산한 길)이다. */
  const [picked, setPicked] = useState(0);
  const [here, setHere] = useState<LatLng>(JEJU_CITY_HALL);
  /** 내 위치로 본 것인지. 거부당하면 제주시청 기준이라고 화면이 밝혀야 한다 — 안 그러면 거짓말이 된다. */
  const [내위치, set내위치] = useState(true);

  const 고른구간 = near?.segments[picked];

  useEffect(() => {
    let alive = true;
    const 조회 = (p: LatLng, 내것: boolean) =>
      calmNear(...p).then((r) => {
        if (!alive) return;
        set내위치(내것);
        setHere(p);
        setNear(r);
      });

    if (!navigator.geolocation) {
      조회(JEJU_CITY_HALL, false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => 조회([pos.coords.latitude, pos.coords.longitude], true),
      // 거부당해도 빈 화면을 보여주지 않는다 — 제주시청 기준으로라도 답이 있는 편이 낫다
      () => 조회(JEJU_CITY_HALL, false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <DemoNotice />

      <div className="flex shrink-0 items-center px-[13px]">
        <button
          // 쿼리를 그대로 실어야 /home 이 프로필을 되읽는다 (/destination 의 ← 와 같은 방식)
          onClick={() => router.push(`/home?${searchParams}`)}
          aria-label="뒤로"
          className="flex size-11 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
      </div>

      <div className="shrink-0 px-[23px]">
        <h2 className="text-[23px] leading-8 font-bold text-[#262626]">
          지금 <span className="text-[#ff7d32]">연습하기 좋은</span> 길
        </h2>
        <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">
          {near?.at
            ? `${내위치 ? "내 주변" : "제주시청 주변"} 5km · ${near.at} 기준`
            : "지금 도로 상황을 확인하고 있어요."}
        </p>
      </div>

      {/*
        높이는 이 상자가 정한다 — RouteMap 이 h-full 이라 자기한테 높이를 주면 안 먹는다
        (app/trip/course/page.tsx 와 같은 이유·같은 모양).
        축척은 RouteMap 이 넘긴 선 전체에 맞춘다. 여기서 level 을 고르지 않는다.
      */}
      {고른구간 && (
        <div className="mt-4 h-[212px] shrink-0 px-[23px]">
          <RouteMap
            center={here}
            routes={고른구간.paths.map<MapRoute>((path) => ({ path, color: 선색, weight: 6, opacity: 0.9 }))}
            markers={[{ coord: here, label: "지금 내 위치", icon: MY_LOCATION }]}
            className="relative size-full overflow-hidden rounded-[18px]"
          />
        </div>
      )}

      {/* 내가 선 길 — 목록의 숫자와 견줄 기준점이다. 이게 없으면 "38km/h"가 좋은 건지 모른다 */}
      {near?.here && (
        <div className="mt-3 shrink-0 px-[23px]">
          <div className="flex items-baseline gap-2 rounded-[14px] bg-[#fff0e6] px-3.5 py-2.5">
            <span className="text-[12px] leading-[17px] text-[#a5673f]">지금 내가 있는 곳</span>
            <span className="text-[14px] leading-[20px] font-medium text-[#1f1f1f]">
              {near.here.road} {near.here.kmh}km/h
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[23px] pb-8">
        {near == null ? (
          <Skeleton />
        ) : near.segments.length ? (
          near.segments.map((seg, i) => (
            <Course
              key={seg.road}
              seg={seg}
              단계머리={seg.level !== near.segments[i - 1]?.level}
              고름={i === picked}
              onPick={() => setPicked(i)}
            />
          ))
        ) : (
          <Empty 실시간={!!near.at} />
        )}
      </div>
    </div>
  );
}

/**
 * 여유율을 %로 그대로 적지 않는다 — "104%"는 사람이 읽고 뭘 해야 할지 모르는 숫자다.
 * 대신 세 마디로 접는다.
 */
function 한산함(ease: number): { 말: string; 색: string } {
  if (ease >= 1) return { 말: "텅 비었어요", 색: "bg-[#e8f5e9] text-[#2e7d32]" };
  if (ease >= 0.9) return { 말: "한산해요", 색: "bg-[#f1f8e9] text-[#558b2f]" };
  return { 말: "조금 있어요", 색: "bg-[#fff8e1] text-[#a16207]" };
}

/**
 * 연습 코스 한 장.
 *
 * 거리는 **왕복**으로 적는다 — 이 코스는 끝까지 갔다 돌아오는 것이고, 사람이 궁금한 건
 * 실제로 운전하는 거리다. lib/practice.ts 는 편도로 들고 있다.
 *
 * 급커브·신호를 숫자로 그대로 보여준다. "쉬움/보통" 같은 말로 접으면 초보가 무엇을
 * 연습하게 되는지 모른다 — 신호 11개짜리 길은 신호를 열한 번 만난다는 뜻이고, 그게 정보다.
 */
function Course({
  seg,
  단계머리,
  고름,
  onPick,
}: {
  seg: Segment;
  단계머리: boolean;
  고름: boolean;
  onPick: () => void;
}) {
  const { 말, 색 } = 한산함(seg.ease);
  return (
    <>
      {단계머리 && (
        <div className="mt-1 flex shrink-0 items-baseline gap-2 first:mt-0">
          <span className="text-[15px] leading-[21px] font-bold text-[#1f1f1f]">
            {seg.level}단계 · {LEVEL_LABEL[seg.level]}
          </span>
          <span className="text-[12px] leading-[17px] text-[#a5a5a5]">{LEVEL_HINT[seg.level]}</span>
        </div>
      )}
      {/*
        고른 칸은 테두리 주황 + 옅은 주황 바탕이다. 지도에 그려진 선이 어느 칸인지 한눈에
        이어져야 해서, 선 색과 같은 색을 쓴다.
      */}
      <button
        type="button"
        onClick={onPick}
        aria-pressed={고름}
        className={`flex shrink-0 flex-col gap-2 rounded-[16px] border px-4 py-3.5 text-left transition active:scale-[0.99] ${
          고름 ? "border-[#ff7d32] bg-[#fff0e6]" : "border-[#e5e0db] bg-white"
        }`}
      >
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[16px] leading-[22px] font-medium text-[#1f1f1f]">
            {seg.road}
          </p>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-[17px] font-medium ${색}`}>{말}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-[17px] text-[#8a8a8a]">
          <span>왕복 {(seg.km * 2).toFixed(1)}km</span>
          <span>급커브 {seg.curves}</span>
          <span>신호 {seg.signals}</span>
          <span>{seg.lanes}차로</span>
          {/* 지금 속도만 적으면 비교가 안 된다 — 이 길이 빌 때 몇 km/h 인지 옆에 붙여야 뜻이 산다 */}
          <span>
            지금 {seg.kmh}km/h · 빌 때 {seg.free}km/h
          </span>
        </div>
      </button>
    </>
  );
}

/** 기다리는 동안. 개수를 목록과 맞춰야 값이 들어올 때 화면이 안 튄다. */
function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[68px] shrink-0 animate-pulse rounded-[16px] bg-[#f4f2f0]" />
      ))}
    </>
  );
}

/**
 * 빈손일 때. 두 경우를 갈라 말한다 — 사유가 다르면 사용자가 할 일도 다르다.
 * 실시간을 받았는데 목록이 비었다는 건 주변이 전부 평소보다 붐빈다는 뜻이라, 그것 자체가 답이다.
 */
function Empty({ 실시간 }: { 실시간: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[15px] leading-[22px] text-[#7d7d7d]">
        {실시간 ? (
          <>
            주변 5km 안에 지금 연습할 만한 길이 없어요.
            <br />
            조금 뒤에 다시 보면 달라질 수 있어요.
          </>
        ) : (
          <>
            도로 상황을 받아오지 못했어요.
            <br />
            잠시 뒤에 다시 시도해 주세요.
          </>
        )}
      </p>
    </div>
  );
}
