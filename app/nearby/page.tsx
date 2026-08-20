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
// **핀을 누르면 이름이 뜨고 목록에서 그 카드를 짚어준다** (/parking 의 highlight 와 같은 규칙).
// 색만 다른 핀은 "저 빨간 곳이 어디냐"에 답을 못 하고, label 은 마우스를 얹어야 뜨는 툴팁이라
// 폰에서 안 보인다. 핀을 눌러도 화면은 안 넘긴다 — 어디 갈지는 카드에서 정한다.
//
// **이름표는 짚은 하나에만 붙인다.** 열 곳에 다 붙여 봤더니 제주시 북쪽에 후보가 몰려서
// 이름표끼리 겹쳐 되레 못 읽었다 (/trip/course 는 코스 한 줄이라 그 문제가 없다).
// 안 짚은 상태에서 "어디가 어딘지"는 바로 아래 목록이 순서대로 말한다.
//
// **카드를 누르면 길 비교(/route)로 넘어간다.** 이 화면은 목적지를 고르는 자리고, 고른 뒤는
// 이미 만들어 둔 화면이 받는다 — ?to·toLat·toLng 만 넘기면 된다.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import DemoNotice from "../DemoNotice";
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
  /**
   * 다시 불러오기 열쇠. 빈 화면이 "잠시 뒤에 다시 시도해 주세요"라고 하는데 조회는
   * 마운트 때 한 번뿐이라, 뒤로 나갔다 들어오는 것 말고 다시 걸 방법이 없었다.
   * 조회를 useCallback 으로 빼는 대신 이 값을 deps 에 두는 게 짧다 — alive 정리도 그대로 산다.
   */
  const [다시, 다시부르기] = useState(0);

  useEffect(() => {
    let alive = true;
    const 조회 = (p: LatLng, 내것: boolean) =>
      nearbySpots(p[0], p[1], profile)
        .then((r) => {
          if (!alive) return;
          set내위치(내것);
          setHere(p);
          setList(r);
        })
        /*
          **실패도 화면까지 와야 한다.** 전에는 catch 가 없어서, 조회가 넘어지면 list 가 null 로
          남아 스켈레톤이 영원히 뛰었다 — "지금 길 정보를 받지 못했어요"라고 말해야 할 바로 그
          상황에서 화면이 아무 말도 안 했다. 빈손으로 떨어뜨려 Empty 와 다시 불러오기로 잇는다.
          기준 위치는 실패해도 같이 옮긴다. 안 옮기면 위치를 거부당한 사람에게 공항 지도를
          띄워놓고 "내 위치 기준"이라고 적게 된다.
        */
        .catch(() => {
          if (!alive) return;
          set내위치(내것);
          setHere(p);
          setList([]);
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
  }, [다시]);

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

  /** 지도에서 짚은 곳의 이름. 같은 핀을 또 누르면 풀린다 (/parking highlight 와 같은 규칙). */
  const [짚은곳, set짚은곳] = useState<string | null>(null);
  const listBox = useRef<HTMLDivElement>(null);

  // 짚은 카드를 목록 안으로 끌어온다. behavior 를 안 준다(즉시) — 목록이 다시 그려지면
  // 애니메이션 도중에 스크롤이 끊긴다 (/parking 에서 겪은 것과 같은 이유).
  useEffect(() => {
    if (!짚은곳) return;
    listBox.current?.querySelector('[data-picked="true"]')?.scrollIntoView({ block: "nearest" });
  }, [짚은곳, list]);

  const markers: MapMarker[] = [
    { coord: here, label: "지금 내 위치", icon: MY_LOCATION },
    ...(list ?? []).map((s) => ({
      coord: s.at,
      label: `${s.name} · ${GRADE_LABEL[s.grade]}`,
      // 짚은 하나만 이름표를 단다 — 열 개를 다 달면 북쪽 무리에서 글자끼리 겹친다
      caption: s.name === 짚은곳 ? s.name : undefined,
      icon: pin(GRADE_COLOR[s.grade].pin),
      onClick: () => set짚은곳((v) => (v === s.name ? null : s.name)),
    })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <DemoNotice />

      <div className="flex shrink-0 items-center px-[13px]">
        <button
          // 쿼리를 그대로 실어야 /home 이 프로필을 되읽는다 (/destination 의 ← 와 같은 방식)
          onClick={() => router.push(`/home?${searchParams}`)}
          aria-label="뒤로"
          className="flex size-11 items-center justify-center transition hover:opacity-40 active:scale-90"
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

      <div ref={listBox} className="mt-4 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[23px] pb-8">
        {list == null ? (
          <Skeleton />
        ) : list.length ? (
          list.map((s) => <Card key={s.name} spot={s} picked={s.name === 짚은곳} onGo={() => 길비교로(s)} />)
        ) : (
          <Empty
            onRetry={() => {
              setList(null); // null 이어야 Skeleton 이 돌아온다 — 안 그러면 눌러도 화면이 그대로다
              다시부르기((n) => n + 1);
            }}
          />
        )}
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
function Card({ spot, picked, onGo }: { spot: Ranked; picked: boolean; onGo: () => void }) {
  const 자를수있나 = spot.imageRights !== "Type3";
  return (
    <button
      type="button"
      onClick={onGo}
      data-picked={picked}
      // 짚은 표시는 테두리 하나다 — 바탕을 깔면 그 위 등급 배지와 색이 섞인다 (/parking 과 같은 판단)
      className={`flex shrink-0 items-stretch gap-3 rounded-[16px] border bg-white p-3 text-left transition active:scale-[0.99] ${
        picked ? "border-[#fc7f35]" : "border-[#e5e0db]"
      }`}
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

function Empty({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[15px] leading-[22px] text-[#7d7d7d]">
        지금 길 정보를 받지 못했어요.
        <br />
        잠시 뒤에 다시 시도해 주세요.
      </p>
      {/*
        말로만 권하지 않는다. 테두리 버튼인 이유는 이게 실패 화면이라서다 —
        꽉 채운 주황은 "이걸 누르세요"인데, 여기서 권할 일은 다시 걸어보는 것 하나뿐이고
        그마저도 될지 모른다. 높이 44 는 이 앱이 누르는 것에 주는 최소값이다.
      */}
      <button
        onClick={onRetry}
        className="mt-4 h-11 rounded-full border border-[#eae7e2] bg-white px-5 text-[14px] leading-[21px] font-medium text-[#262626] transition active:scale-[0.98]"
      >
        다시 불러오기
      </button>
    </div>
  );
}
