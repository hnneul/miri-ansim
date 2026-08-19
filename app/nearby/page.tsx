"use client";

// 지금 가기 좋은 곳 — 제주 관광지를 "지금 가기 좋은 순"으로 보여준다.
//
// **이 화면이 답하는 것:** "지금 어디 가면 좋은가."
// 혼잡도로 관광지를 줄 세우는 건 지도 앱이 이미 한다. 여기서 더 하는 건 **초보에게 그 길이
// 얼마나 부담인가**라, 같은 시각·같은 자리에서도 프로필에 따라 순서가 바뀐다 (lib/spots.ts).
//
// **지도는 선이 아니라 핀이다.** /calm 은 도로 하나를 선으로 그렸지만 여기 후보는 제주 전역에
// 흩어진 열 곳이다. 등급 색 핀을 찍으면 화면 한 장에 "지금 제주가 어떤지"가 들어온다.
//
// **카드를 누르면 길 비교(/route)로 넘어간다.** 이 화면은 목적지를 고르는 자리고, 고른 뒤는
// 이미 만들어 둔 화면이 받는다 — ?to·toLat·toLng 만 넘기면 된다.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng, type MapMarker } from "../RouteMap";
import { nearbySpots } from "./actions";
import { parseProfile } from "@/lib/profile";
import { EXP_LABEL } from "@/lib/score";
import { GRADE_LABEL, type Ranked } from "@/lib/spots";

/** 위치를 못 받았을 때 볼 곳 — 제주공항. 관광객이 제주에서 처음 서는 자리다. */
const JEJU_AIRPORT: LatLng = [33.5070, 126.4930];

/** 등급 색. 지도 핀과 카드 배지가 **같은 색**이어야 둘이 이어져 보인다. */
const GRADE_COLOR = {
  easy: { pin: "#2e9e5b", chip: "bg-[#e8f5e9] text-[#2e7d32]" },
  ok: { pin: "#e2a63b", chip: "bg-[#fff8e1] text-[#a16207]" },
  hard: { pin: "#e4572e", chip: "bg-[#fdecea] text-[#c0392b]" },
} as const;

/**
 * 등급 핀 — 파일을 만들지 않고 SVG 를 그대로 data URI 로 넣는다.
 * 색만 다른 아이콘 셋을 public 에 세 장 두는 것보다 이쪽이 고치기 쉽다.
 */
const pin = (color: string) => ({
  src:
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">` +
        `<path d="M14 35C14 35 26 22.4 26 13.6 26 6.6 20.6 1 14 1S2 6.6 2 13.6C2 22.4 14 35 14 35Z" ` +
        `fill="${color}" stroke="white" stroke-width="2"/>` +
        `<circle cx="14" cy="13.5" r="4.5" fill="white"/></svg>`,
    ),
  size: [28, 36] as [number, number],
  // 핀은 뾰족한 끝이 좌표를 가리켜야 한다 — 가운데를 맞추면 실제 위치보다 위에 찍힌다
  anchor: [14, 36] as [number, number],
});

/** 내 위치 — 메인화면 지도와 같은 점을 쓴다 (app/home/page.tsx MY_LOCATION). */
const MY_LOCATION = { src: "/home/my-location.svg", size: [44, 44] as [number, number] };

export default function NearbyPage() {
  return (
    <Suspense>
      <Nearby />
    </Suspense>
  );
}

function Nearby() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const profile = parseProfile(query);

  const [list, setList] = useState<Ranked[] | null>(null);
  const [here, setHere] = useState<LatLng>(JEJU_AIRPORT);
  /** 내 위치로 본 것인지. 거부당하면 공항 기준이라고 화면이 밝혀야 한다 — 안 그러면 거짓말이 된다. */
  const [내위치, set내위치] = useState(true);

  useEffect(() => {
    let alive = true;
    const 조회 = (p: LatLng, 내것: boolean) =>
      nearbySpots(p[0], p[1], profile).then((r) => {
        if (!alive) return;
        set내위치(내것);
        setHere(p);
        setList(r);
      });

    if (!navigator.geolocation) {
      조회(JEJU_AIRPORT, false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => 조회([pos.coords.latitude, pos.coords.longitude], true),
      // 거부당해도 빈 화면을 보여주지 않는다 — 공항 기준으로라도 답이 있는 편이 낫다
      () => 조회(JEJU_AIRPORT, false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return () => {
      alive = false;
    };
    // 프로필은 URL 에 실려 오므로 화면이 사는 동안 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 고른 곳으로 가는 길을 이미 만들어 둔 화면에 넘긴다 (app/destination/page.tsx 와 같은 키) */
  const 길비교로 = (s: Ranked) => {
    const next = new URLSearchParams(searchParams);
    next.set("to", s.name);
    next.set("toLat", String(s.at[0]));
    next.set("toLng", String(s.at[1]));
    // 길 비교에서 X 를 누르면 이 목록으로 돌아온다 — 아직 어디 갈지 고르는 중이다
    next.set("back", "nearby");
    router.push(`/route?${next}`);
  };

  const markers: MapMarker[] = [
    { coord: here, label: "지금 내 위치", icon: MY_LOCATION },
    ...(list ?? []).map((s) => ({
      coord: s.at,
      label: `${s.name} · ${GRADE_LABEL[s.grade]}`,
      icon: pin(GRADE_COLOR[s.grade].pin),
    })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />

      <div className="flex shrink-0 items-center px-[13px]">
        <button
          // 쿼리를 그대로 실어야 /home 이 프로필을 되읽는다 (/destination 의 ← 와 같은 방식)
          onClick={() => router.push(`/home?${searchParams}`)}
          aria-label="뒤로"
          className="flex size-11 items-center justify-center"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
      </div>

      <div className="shrink-0 px-[23px]">
        <h2 className="text-[23px] leading-8 font-bold text-[#262626]">
          지금 <span className="text-[#ff7d32]">가기 좋은</span> 곳
        </h2>
        {/*
          순서가 왜 이런지 밝힌다 — 이게 빠지면 목록이 그냥 거리순처럼 읽힌다.
          제목은 "좋은"이고 여기는 "편한"인 게 맞다: 무엇을 보여주는지는 넓게 말하고,
          어떤 기준으로 세웠는지는 좁게 말한다 (홈 칸도 "대표 관광지 / 운전 편한 순"이다).
        */}
        <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">
          {내위치 ? "내 위치" : "제주공항"} 기준 · {EXP_LABEL[profile.experienceYears] ?? "초보"} 운전자에게 편한 순
        </p>
      </div>

      {/*
        높이는 이 상자가 정한다 — RouteMap 이 h-full 이라 자기한테 높이를 주면 안 먹는다.
        축척은 RouteMap 이 마커 전체에 맞춘다 (routes 가 없으면 markers 로 맞춘다).
      */}
      <div className="mt-4 h-[196px] shrink-0 px-[23px]">
        <RouteMap
          center={here}
          routes={[]}
          markers={markers}
          className="relative size-full overflow-hidden rounded-[18px]"
        />
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[23px] pb-8">
        {list == null ? <Skeleton /> : list.length ? list.map((s) => <Card key={s.name} spot={s} onGo={() => 길비교로(s)} />) : <Empty />}
      </div>
    </div>
  );
}

/**
 * 관광지 한 장.
 *
 * **사진 처리가 저작권을 탄다.** 관광공사 이미지는 Type1(출처표시)과 Type3(제1유형 + 변경금지)이
 * 섞여 온다. cover 로 채우면 잘리는데 그건 Type3 에서 "변경"으로 볼 소지가 있어,
 * Type3 은 contain 으로 원본 비율을 지킨다 (data/spots.json imageRights).
 */
function Card({ spot, onGo }: { spot: Ranked; onGo: () => void }) {
  const 자를수있나 = spot.imageRights !== "Type3";
  return (
    <button
      type="button"
      onClick={onGo}
      className="flex shrink-0 items-stretch gap-3 rounded-[16px] border border-[#e5e0db] bg-white p-3 text-left transition active:scale-[0.99]"
    >
      {/* 사진 없는 곳(17/122)은 자리를 비운다 — 회색 상자가 이름을 가리는 것보다 낫다 */}
      {spot.thumb && (
        <span className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#f4f2f0]">
          <img
            src={spot.thumb}
            alt=""
            loading="lazy"
            className={`size-full ${자를수있나 ? "object-cover" : "object-contain"}`}
          />
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[16px] leading-[22px] font-medium text-[#1f1f1f]">
            {spot.name}
          </span>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-[17px] font-medium ${GRADE_COLOR[spot.grade].chip}`}
          >
            {GRADE_LABEL[spot.grade]}
          </span>
        </span>

        <span className="text-[13px] leading-[19px] text-[#5f5f5f]">
          지금 {spot.min}분 · {spot.km}km
        </span>

        {/* 정체는 있을 때만 말한다 — 매번 "정체 없음"이 붙으면 있을 때 눈에 안 띈다 */}
        {spot.jamKm > 0 && (
          <span className="truncate text-[12px] leading-[17px] text-[#a16207]">
            {spot.jamRoad ? `${spot.jamRoad} ` : ""}
            {spot.jamKm}km 정체
          </span>
        )}
      </span>
    </button>
  );
}

/** 기다리는 동안. 개수를 목록과 맞춰야 값이 들어올 때 화면이 안 튄다. */
function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[96px] shrink-0 animate-pulse rounded-[16px] bg-[#f4f2f0]" />
      ))}
    </>
  );
}

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[15px] leading-[22px] text-[#7d7d7d]">
        지금 길 정보를 받지 못했어요.
        <br />
        잠시 뒤에 다시 시도해 주세요.
      </p>
    </div>
  );
}
