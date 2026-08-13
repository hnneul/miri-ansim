"use client";

// 목적지 입력 — 최종 와이어프레임 "목적지 입력" 섹션(Figma 2147:2005).
// 한 화면의 세 상태를 그린다: 지도만(HOME-01) → 검색 중(HOME-01 a) → 목적지 고름(HOME-01 b).
// 세 장을 따로 그린 건 프로토타입 연결을 보여주려는 것이고, 실제로는 같은 화면이 상태만 바뀐다.
//
// 메인화면(/home)에서 목적지를 적고 들어오면 ?dest= 를 물고 오므로 곧장 세 번째 상태로 연다.
// 출발지(?originLat/originLng)는 거리 표시("25km")에만 쓴다 — 없으면 그 줄만 빠진다.
//
// 지오코딩은 서버 액션(./actions.ts)을 거친다. 카카오 REST 키가 서버 전용이라 여기서 직접 못 부른다.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng } from "../RouteMap";
import { characterOf, parseProfile } from "@/lib/profile";
import { meters } from "@/lib/parking";
import { findPlace } from "./actions";

/** 목적지를 못 골랐을 때 지도가 보고 있을 곳 — 제주 한가운데(한라산)라 섬이 통째로 담긴다. */
const JEJU_CENTER: LatLng = [33.38, 126.55];

/** 와이어프레임의 주황 핀(image 16, 50x56). 뾰족한 끝이 좌표에 앉아야 한다 — 가운데로 두면 핀이 아래로 밀린다. */
const PIN = { src: "/icon-pin.png", size: [50, 56] as [number, number], anchor: [25, 56] as [number, number] };

/** 최근 검색어. 저장소가 없어 브라우저에 둔다 — 새로고침에 살아남으면 되고, 기기 간 동기화는 필요 없다. */
const RECENT_KEY = "gilansim:recent";
const RECENT_MAX = 5;

type Place = { coord: LatLng; label: string; region: string };

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function DestinationPage() {
  return (
    <Suspense>
      <Destination />
    </Suspense>
  );
}

function Destination() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const me = characterOf(parseProfile(query).experienceYears);

  // 출발지는 메인화면이 현재 위치를 잡아 넘겨준다. 직접 들어오면 없고, 그때는 거리 줄을 안 그린다.
  const origin: LatLng | null =
    query.originLat && query.originLng ? [Number(query.originLat), Number(query.originLng)] : null;

  const [text, setText] = useState(query.dest ?? "");
  const [place, setPlace] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false); // 검색 패널(두 번째 상태)이 떠 있는가
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // localStorage 는 서버에 없다. 망가진 값이 들어 있어도 화면이 죽지는 않게 감싼다.
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(saved)) setRecent(saved.filter((s) => typeof s === "string").slice(0, RECENT_MAX));
    } catch {
      /* 값이 깨졌으면 빈 목록으로 시작한다 */
    }
  }, []);

  const search = useCallback(
    async (q: string) => {
      setPending(true);
      setError(null);
      const found = await findPlace(q);
      setPending(false);
      if ("error" in found) return setError(found.error);

      setPlace(found);
      setText(found.label);
      setSearching(false);
      // 찾은 이름으로 저장한다 — 다시 눌렀을 때 같은 곳이 나오는 게 오타 그대로 남기는 것보다 낫다
      setRecent((prev) => {
        const next = [found.label, ...prev.filter((r) => r !== found.label)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        return next;
      });
      // 새로고침해도 같은 목적지로 열리게 URL 을 맞춰둔다 (히스토리는 안 늘린다)
      const next = new URLSearchParams(searchParams);
      next.set("dest", found.label);
      router.replace(`/destination?${next}`);
    },
    [router, searchParams],
  );

  // ?dest= 를 물고 들어온 경우 한 번만 자동으로 찾는다. 이후 검색은 사용자가 시킨다.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !query.dest) return;
    auto.current = true;
    search(query.dest);
  }, [query.dest, search]);

  function openSearch() {
    setSearching(true);
    setError(null);
    // 다시 검색하려고 눌렀으니 이전 값은 지운다 — 지우고 시작하는 게 커서를 끝으로 옮기는 것보다 빠르다
    setText("");
    requestAnimationFrame(() => input.current?.focus());
  }

  return (
    <div className="relative flex flex-1 flex-col">
      {/*
        지도는 화면 전체를 깔고, 나머지는 그 위에 뜬다 (와이어프레임의 Map/Placeholder 자리).
        z-0 은 장식이 아니라 필수다 — 카카오가 지도 안쪽 요소에 z-index:1 을 직접 박는데,
        여기가 z-auto 면 그것들이 부모 문맥으로 새어 나와 아래 흰 덮개와 검색 패널 위에 그려진다.
        z-0 하나로 쌓임 문맥이 생겨 지도의 z-index 가 이 상자 안에 갇힌다.
      */}
      <div className="absolute inset-0 z-0">
        <RouteMap
          className=""
          center={place?.coord ?? JEJU_CENTER}
          level={place ? 5 : 10}
          routes={[]}
          markers={place ? [{ coord: place.coord, label: place.label, icon: PIN }] : []}
        />
      </div>

      {/* 검색 중에는 지도를 흰 종이로 덮는다 — 와이어프레임 HOME-01 a 가 흰 바탕이다 */}
      {searching && <div className="absolute inset-0 z-[5] bg-white" />}

      <div className="relative z-10 flex flex-1 flex-col">
        <StatusBar tone="text-[#525252]" />

        {/* 검색바 + 프로필. 와이어프레임 기준 입력 284px, 아바타 63px, 사이 16px */}
        <div className="flex shrink-0 items-center gap-4 px-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(text);
            }}
            className="flex h-16 flex-1 items-center gap-3 rounded-[12px] border border-[#fc7f35] bg-[#fc7f35]/15 px-4"
          >
            <span aria-hidden className="size-3 shrink-0 rounded-full bg-[#fc7f35]" />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setSearching(true)}
              placeholder="장소를 검색해 주세요"
              aria-label="목적지"
              className="min-w-0 flex-1 bg-transparent text-[14px] leading-[22px] font-medium text-[#1f1f1f] outline-none placeholder:text-[#1f1f1f]"
            />
            {/* 값이 있을 때만 지우기. 와이어프레임 HOME-01 b 의 X 자리다 */}
            {text && (
              <button type="button" onClick={openSearch} aria-label="지우기" className="shrink-0 text-[18px] leading-none text-[#525252]">
                ✕
              </button>
            )}
            {/*
              와이어프레임에 검색 버튼이 없어서 엔터(암묵적 제출)에만 기대고 있었는데, 폼에 submit
              컨트롤이 하나도 없으면 그 동작이 브라우저마다 갈린다. 눈에 안 보이는 제출 버튼 하나로
              모바일 키보드의 "이동"까지 같은 길로 모은다 — 화면은 그대로다.
            */}
            <button type="submit" className="sr-only">
              검색
            </button>
          </form>

          <button
            onClick={() => router.push(`/profile?${searchParams}`)}
            aria-label="마이"
            className="size-[63px] shrink-0 rounded-full border border-[#fc7f35] bg-[#e2f1fe] transition active:scale-95"
          >
            <img src={me.src} alt="" className="size-full rounded-full object-contain" />
          </button>
        </div>

        {(pending || error) && (
          <p className={`mt-3 shrink-0 px-6 text-[12px] leading-[18px] ${error ? "text-rose-600" : "text-[#525252]"}`}>
            {error ?? "장소를 찾는 중…"}
          </p>
        )}

        {/* HOME-01 a — 최근 검색어. 없으면 목록째 빠진다 (빈 제목만 남으면 고장 난 것처럼 보인다) */}
        {searching && recent.length > 0 && (
          <div className="mt-5 shrink-0 px-6">
            <h2 className="text-[14px] leading-[22px] font-bold text-[#1f1f1f]">최근 검색어</h2>
            <ul className="mt-2">
              {recent.map((r) => (
                <li key={r}>
                  <button
                    onClick={() => {
                      setText(r);
                      search(r);
                    }}
                    className="flex w-full items-center gap-3 py-2 text-left"
                  >
                    <span aria-hidden className="w-6 shrink-0 text-center text-[18px] leading-none text-[#525252]">
                      ⌕
                    </span>
                    <span className="text-[14px] leading-[22px] text-[#1f1f1f]">{r}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* HOME-01 b — 목적지를 고르면 아래에서 올라오는 시트 */}
        {place && !searching && <PlaceSheet place={place} origin={origin} onClose={() => setPlace(null)} />}
      </div>
    </div>
  );
}

/**
 * 고른 목적지 시트. 와이어프레임(search-panel 2153:2981)은 높이 515 로 그려졌지만 그 아래가 비어 있다 —
 * 채울 내용이 정해지면 늘어날 자리이고, 지금 515 를 박으면 지도만 가린다. 내용 높이로 둔다.
 */
function PlaceSheet({ place, origin, onClose }: { place: Place; origin: LatLng | null; onClose: () => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const km = origin ? Math.round(meters(origin, place.coord) / 1000) : null;

  return (
    <div className="mt-auto shrink-0 rounded-t-[24px] bg-white pb-8">
      {/* grab — 끌어올릴 수 있어 보이게 하는 표시다. 실제로 끌리지는 않는다 (와이어프레임도 장식이다) */}
      <div aria-hidden className="mx-auto mt-[10px] h-1 w-12 rounded-[2px] bg-[#d6d6d6]" />

      <div className="mt-6 flex items-start justify-between gap-3 pr-[15px] pl-[30px]">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] leading-[26px] font-bold text-[#1f1f1f]">{place.label}</h2>
          <p className="mt-[6px] text-[14px] leading-[22px] font-medium text-[#9e9e9e]">
            {/* 출발지를 모르면 거리 없이 지역만 — 모르는 값을 0km 로 적으면 거짓말이 된다 */}
            {km !== null && <span className="mr-[11px]">{km}km</span>}
            {place.region}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="grid size-[30px] shrink-0 place-items-center rounded-full border border-[#d6d6d6] bg-[#e5e5e5] text-[15px] leading-none text-[#525252]"
        >
          ✕
        </button>
      </div>

      {/*
        출발 / 근처 주차장 보기. 갈 화면이 아직 없다 —
        ponytail: "목적지 -> 출발 선택"(Figma 2173:1932)과 "목적지 -> 근처 주차장 보기"(2160:2167)를
        만들면 여기 onClick 을 router.push 로 바꾼다. 목적지 좌표는 이미 손에 있다.
      */}
      <div className="mt-[11px] flex gap-1 px-4">
        <button
          onClick={() => setNotice("출발 선택 화면은 아직 준비 중입니다")}
          className="h-10 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-4 text-[14px] leading-[22px] font-medium text-[#1f1f1f]"
        >
          출발
        </button>
        <button
          onClick={() => setNotice("주차장 화면은 아직 준비 중입니다")}
          className="flex h-10 flex-1 items-center justify-center gap-[15px] rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-medium text-white"
        >
          <span aria-hidden className="text-[17px] leading-none font-bold">
            P
          </span>
          근처 주차장 보기
        </button>
      </div>

      {notice && <p className="mt-3 px-6 text-[12px] leading-[18px] text-[#525252]">{notice}</p>}

      {/*
        와이어프레임은 여기에 "길의 부담 설명 카드" 두 장(175x132)을 두는데 안이 비어 있다 —
        무엇을 적을지 정해지지 않은 자리다. 빈 테두리만 옮기면 화면이 고장 난 것처럼 보여서 뺐다.
        ponytail: 문구가 정해지면 여기에 되살린다 (lib/briefing.ts 에 규칙 기반 문장이 이미 있다).
      */}
    </div>
  );
}
