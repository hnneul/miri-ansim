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
import { meters } from "@/lib/parking";
import type { Place } from "@/lib/geocode";
import { findPlace, findPostal, suggestPlaces } from "./actions";

/** 목적지를 못 골랐을 때 지도가 보고 있을 곳 — 제주 한가운데(한라산)라 섬이 통째로 담긴다. */
const JEJU_CENTER: LatLng = [33.38, 126.55];

/**
 * 목적지 마커. 어느 쪽이든 **뾰족한 끝이 좌표에 앉아야 한다** — anchor 를 안 주면 이미지 가운데가
 * 좌표에 맞아 마커가 통째로 아래로 밀린다 (app/RouteMap.tsx MarkerIcon).
 *
 * MASCOT 을 쓴다. 캐릭터를 왜 핀에 앉혔는지는 scripts/build-marker.py 주석에 있다.
 * PIN 은 와이어프레임(image 16)이 그린 원본이다 — 피그마 에셋 URL 이 7일 뒤 만료돼 다시 못 받으므로
 * 파일째 남긴다. 되돌리려면 아래 markers 의 MASCOT 을 PIN 으로 바꾸면 된다.
 */
const PIN = { src: "/icon-pin.png", size: [50, 56] as [number, number], anchor: [25, 56] as [number, number] };
// 크기·앵커는 scripts/build-marker.py 가 실행 끝에 찍어 주는 값을 그대로 옮긴 것이다.
// 그림자 자리가 아래에 남아 있어 앵커 y 는 이미지 높이(106)가 아니라 꼬리 끝(97)이다.
const MASCOT = { src: "/icon-pin-character.png", size: [80, 106] as [number, number], anchor: [40, 97] as [number, number] };
void PIN; // 지금은 안 쓴다 — 위 주석의 되돌리기용이다

/** 최근 검색어. 저장소가 없어 브라우저에 둔다 — 새로고침에 살아남으면 되고, 기기 간 동기화는 필요 없다. */
const RECENT_KEY = "gilansim:recent";
const RECENT_MAX = 5;

/** 타이핑이 멎고 나서 후보를 부르기까지. 글자마다 부르면 카카오 호출이 입력 길이만큼 늘어난다. */
const TYPING_MS = 250;

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

  // 출발지는 메인화면이 현재 위치를 잡아 넘겨준다. 직접 들어오면 없고, 그때는 거리 줄을 안 그린다.
  const origin: LatLng | null =
    query.originLat && query.originLng ? [Number(query.originLat), Number(query.originLng)] : null;

  const [text, setText] = useState(query.dest ?? "");
  const [place, setPlace] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false); // 검색 패널(두 번째 상태)이 떠 있는가
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  /** 타이핑 중에 뜨는 후보 목록 (HOME-01 a). 비어 있으면 최근 검색어 자리가 그대로 남는다. */
  const [suggest, setSuggest] = useState<Place[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // 시트가 지도 아래쪽을 얼마나 덮는지. 지도가 그만큼 위로 잡아야 마커가 시트에 안 걸린다.
  // 상수로 박지 않는 이유 — 시트 높이는 내용(장소명 줄바꿈·거리 유무)에 따라 달라지고,
  // 나중에 부담 설명 카드가 들어오면 또 달라진다. 재는 쪽이 한 번 쓰고 안 썩는다.
  const [sheetH, setSheetH] = useState(0);
  const sheetBox = useCallback((el: HTMLDivElement | null) => {
    if (!el) return setSheetH(0);
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect(); // React 19 는 ref 콜백의 정리 함수를 받는다
  }, []);

  useEffect(() => {
    // localStorage 는 서버에 없다. 망가진 값이 들어 있어도 화면이 죽지는 않게 감싼다.
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(saved)) setRecent(saved.filter((s) => typeof s === "string").slice(0, RECENT_MAX));
    } catch {
      /* 값이 깨졌으면 빈 목록으로 시작한다 */
    }
  }, []);

  /** 목적지를 확정한다. 목록에서 고르든 엔터로 찾든 여기로 모인다. */
  const choose = useCallback(
    (found: Place) => {
      setPlace(found);
      setText(found.label);
      setSearching(false);
      setSuggest([]);
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

  const search = useCallback(
    async (q: string) => {
      setPending(true);
      setError(null);
      const found = await findPlace(q);
      setPending(false);
      if ("error" in found) return setError(found.error);
      choose(found);
    },
    [choose],
  );

  /*
    HOME-01 a — 적는 동안 후보를 불러온다. 예전에는 엔터를 눌러야 첫 번째 결과로 곧장 넘어갔는데,
    "제주 카페"처럼 같은 이름이 여럿인 검색어에서는 어디로 갈지 사용자가 고를 방법이 없었다.

    타이핑이 멎고 나서(TYPING_MS) 부르고, 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때
    먼저 보낸 긴 검색어의 결과가 나중에 도착해 목록을 덮는다.
  */
  useEffect(() => {
    if (!searching || !text.trim()) return setSuggest([]);

    let alive = true;
    const timer = setTimeout(() => {
      suggestPlaces(text).then((found) => alive && setSuggest(found));
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, searching]);

  /*
    검색 패널은 화면이 아니라 상태라 그냥 두면 히스토리에 안 남는다 — 검색 화면에서 폰(브라우저)
    뒤로가기를 누르면 목적지 화면을 건너뛰고 /home 으로 나가버린다. 패널을 열 때 항목을 하나
    밀어 넣어 그 뒤로가기가 패널만 닫게 한다.

    닫는 길은 하나로 모은다 — 바 안의 ← 도 history.back() 을 부르고, 실제로 닫는 건 popstate 다.
    버튼이 따로 setSearching(false) 를 하면 밀어 넣은 항목이 남아, 목적지 화면에서 아무 일도
    일어나지 않는 뒤로가기가 한 번 생긴다.

    이미 우리 항목이면 다시 안 민다 — 개발 모드(StrictMode)에서 이 효과가 두 번 도는데,
    그때 항목이 두 개 쌓이면 뒤로가기를 두 번 눌러야 나간다.
  */
  useEffect(() => {
    if (!searching) return;

    if (history.state?.search !== true) history.pushState({ search: true }, "");
    const close = () => setSearching(false);
    addEventListener("popstate", close);
    return () => removeEventListener("popstate", close);
  }, [searching]);

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
    <div className="flex flex-1 flex-col">
      {/*
        상태바는 지도 밖에 둔다 — 와이어프레임도 Map/Placeholder 가 상태바 아래(y:32)에서 시작한다.
        지도를 상태바 뒤까지 깔면 시각·배터리가 지도 상호명과 겹쳐 양쪽 다 안 읽힌다.
      */}
      <div className="relative z-20 shrink-0 bg-white">
        <StatusBar tone="text-[#525252]" />
      </div>

      <div className="relative flex-1">
        {/*
          지도는 상태바 아래를 전부 깔고, 나머지는 그 위에 뜬다 (와이어프레임의 Map/Placeholder 자리).
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
            markers={place ? [{ coord: place.coord, label: place.label, icon: MASCOT }] : []}
            padBottom={sheetH}
          />
        </div>

        {/* 검색 중에는 지도를 흰 종이로 덮는다 — 와이어프레임 HOME-01 a 가 흰 바탕이다 */}
        {searching && <div className="absolute inset-0 z-[5] bg-white" />}

        {/*
          지도 위에 뜨는 것들. pointer-events-none 이 없으면 지도가 끌리지도 확대되지도 않는다 —
          이 상자가 눈에 안 보일 뿐 지도를 통째로 덮고 있어서 클릭·드래그를 전부 가로챈다.
          실제로 눌러야 하는 것들만 pointer-events-auto 로 되살린다.
        */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
          {/* 검색바 + 프로필. 와이어프레임(2443:2433) 기준 바 289x54, 아바타 54, 사이 11 */}
          <div className="pointer-events-auto flex shrink-0 items-center gap-[11px] pt-[19px] pr-4 pl-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(text);
            }}
            /*
              흰 바탕 + 주황 테두리로 바뀌었다 (메인화면 검색바와 같은 모양이다).
              전에 쓰던 주황 15% 배경은 지도 위에서 상호명이 비쳐 글자가 묻혔는데, 흰 바탕이라 그 문제도 같이 없어진다.

              min-w-0 이 없으면 안쪽 내용 폭이 최소 폭이 돼서 폼이 안 줄고, 오른쪽 아바타가
              패딩 밖으로 밀려난다 (input 의 min-w-0 만으로는 폼 자신이 안 줄어든다).
            */
            className="flex h-[54px] min-w-0 flex-1 items-center gap-[10px] rounded-[16px] border border-[#fc7f35] bg-white px-[14px] shadow-[0_3px_5px_0_rgba(0,0,0,0.07)]"
          >
            {/*
              뒤로가기. 와이어프레임은 나가는 길을 하단 탭바로 두는데 아직 탭바가 없다.
              지도 위에 동그란 버튼을 따로 띄웠더니 저 혼자 튀어서, 검색바 안에 넣는 /parking·/around 와
              같은 모양으로 맞췄다 — 바가 이미 배경을 갖고 있어 아이콘에 원도 그림자도 필요 없다.
              검색 패널이 열려 있으면 그것부터 닫는다. 한 번에 나가면 적던 검색어가 날아간다.
              ponytail: 하단 탭바(Figma 2153:1985)를 만들면 이 버튼을 뺀다.
            */}
            <button
              type="button"
              onClick={() => (searching ? history.back() : router.push(`/home?${searchParams}`))}
              aria-label={searching ? "검색 닫기" : "뒤로"}
              className="shrink-0 transition active:scale-90"
            >
              <img src="/icon-arrow-left.svg" alt="" className="size-6" />
            </button>
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setSearching(true)}
              placeholder="장소를 검색해 주세요"
              aria-label="목적지"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[#1f1f1f] outline-none placeholder:text-[#7d7d7d]"
            />
            {/* 값이 있을 때만 지우기. 와이어프레임 HOME-01 b 의 X 자리다 */}
            {text && (
              <button type="button" onClick={openSearch} aria-label="지우기" className="shrink-0 transition active:scale-90">
                <img src="/home/icon-close.svg" alt="" className="size-6" />
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

          {/*
            아바타는 와이어프레임에 박힌 그림 한 장이다 (profile 2153:1643, 메인화면과 같은 avatar-my).
            경력에 따라 캐릭터가 갈리던 걸(lib/profile.ts characterOf) 여기서도 뗐다 — 메인화면과 이 화면이
            서로 다른 얼굴을 달고 있으면 같은 사람의 프로필로 안 읽힌다.
            되살리려면 src 를 characterOf(parseProfile(query).experienceYears).src 로 되돌리면 된다.
          */}
          <button
            onClick={() => router.push(`/profile?${searchParams}`)}
            aria-label="마이"
            className="size-[54px] shrink-0 overflow-hidden rounded-full border border-[#f8f8f8] transition active:scale-95"
          >
            <img src="/character/avatar-my.png" alt="" className="size-full rounded-full object-cover" />
          </button>
        </div>

          {(pending || error) && (
            <p
              className={`pointer-events-auto mt-3 shrink-0 rounded-[8px] bg-white/90 px-6 py-1 text-[12px] leading-[18px] ${error ? "text-rose-600" : "text-[#525252]"}`}
            >
              {error ?? "장소를 찾는 중…"}
            </p>
          )}

          {/*
            HOME-01 a — 검색 패널. 적기 시작하면 후보 목록으로, 비어 있으면 최근 검색어로 바뀐다.
            둘을 같이 띄우지 않는 이유는 자리가 아니라 뜻이다 — 후보가 떠 있는 동안 최근 검색어는
            지금 적고 있는 것과 상관없는 목록이라 손이 잘못 간다.
            목록이 길면 화면 밖으로 나가므로 여기만 따로 스크롤한다 (지도 위 오버레이라 바깥이 안 스크롤된다).
          */}
          {searching && (
            <div className="pointer-events-auto mt-5 min-h-0 flex-1 overflow-y-auto px-6 pb-4">
              {text.trim() ? (
                suggest.length > 0 ? (
                  <ul>
                    {suggest.map((p) => (
                      /* 같은 이름이 여럿이라 key 는 좌표까지 붙인다 ("스타벅스"가 제주에만 수십 곳이다) */
                      <li key={`${p.label}${p.coord}`}>
                        <button onClick={() => choose(p)} className="flex w-full items-start gap-3 py-[10px] text-left">
                          <img src="/home/icon-search.svg" alt="" aria-hidden className="mt-[5px] size-[15px] shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-baseline gap-[7px]">
                              <span className="truncate text-[14px] leading-[22px] text-[#1f1f1f]">{p.label}</span>
                              {p.type && <span className="shrink-0 text-[11px] text-[#9e9e9e]">{p.type}</span>}
                            </span>
                            {/*
                              주소가 있어야 같은 이름 중에 어느 지점인지 갈린다 — 없는 곳은 그 줄만 빠진다.
                              도로명이 있으면 그쪽이다: 길 이름이 들어가야 "스타벅스" 수십 곳이 서로 구분된다.
                            */}
                            {(p.road || p.jibun) && (
                              <span className="mt-[2px] block truncate text-[12px] text-[#9e9e9e]">
                                {p.road || p.jibun}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  /* 아직 안 왔거나(디바운스 중) 제주에 없는 이름이다. 둘을 가려 말할 방법이 없어 한 줄로 둔다 */
                  <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">검색 결과를 찾는 중…</p>
                )
              ) : (
                /* 최근 검색어. 없으면 목록째 빠진다 (빈 제목만 남으면 고장 난 것처럼 보인다) */
                recent.length > 0 && (
                  <>
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
                            <img src="/home/icon-search.svg" alt="" aria-hidden className="size-[15px] shrink-0 opacity-60" />
                            <span className="text-[14px] leading-[22px] text-[#1f1f1f]">{r}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              )}
            </div>
          )}

          {/* HOME-01 b — 목적지를 고르면 아래에서 올라오는 시트. 높이를 재서 지도에 넘긴다 */}
          {place && !searching && (
            <div ref={sheetBox} className="pointer-events-auto mt-auto">
              <PlaceSheet
                place={place}
                origin={origin}
                onClose={() => setPlace(null)}
                /*
                 * 목적지 좌표까지 넘긴다 — 이름만 넘기면 주차장 화면이 지오코딩을 한 번 더 해야 하고,
                 * 같은 이름이 여러 곳이면 여기서 고른 곳과 다른 데가 잡힐 수 있다.
                 */
                onParking={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("dest", place.label);
                  next.set("destLat", String(place.coord[0]));
                  next.set("destLng", String(place.coord[1]));
                  router.push(`/parking?${next}`);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 고른 목적지 시트. 와이어프레임(search-panel 2153:2981)은 높이 515 로 그려졌지만 그 아래가 비어 있다 —
 * 채울 내용이 정해지면 늘어날 자리이고, 지금 515 를 박으면 지도만 가린다. 내용 높이로 둔다.
 */
function PlaceSheet({
  place,
  origin,
  onClose,
  onParking,
}: {
  place: Place;
  origin: LatLng | null;
  onClose: () => void;
  onParking: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  /** 주소 카드를 펼쳤나 (Figma "목적지 주소 펼쳤을때" 2606:847). */
  const [openAddress, setOpenAddress] = useState(false);
  /**
   * 우편번호. 카드를 처음 펼칠 때 받아온다 (./actions.ts findPostal 주석에 미리 안 받는 이유가 있다).
   * "아직 안 받음"과 "받아봤는데 없음"을 갈라야 해서 undefined / null 을 둘 다 쓴다 —
   * null 로 뭉치면 도로명 없는 곳(우편번호가 원래 없는 곳)에서 펼칠 때마다 헛호출이 나간다.
   */
  const [postal, setPostal] = useState<string | null | undefined>(undefined);
  const km = origin ? Math.round(meters(origin, place.coord) / 1000) : null;

  // 목적지가 바뀌면 이전 장소의 우편번호가 남아 있으면 안 된다
  useEffect(() => {
    setOpenAddress(false);
    setPostal(undefined);
  }, [place]);

  function toggleAddress() {
    setOpenAddress((v) => !v);
    // 도로명이 없으면 우편번호도 없다 — 부르지 않는다 (lib/geocode.ts postalOf 주석)
    if (postal === undefined && place.road) findPostal(place.road).then(setPostal);
  }

  return (
    <div className="relative rounded-t-[24px] bg-white pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      {/* grab — 끌어올릴 수 있어 보이게 하는 표시다. 실제로 끌리지는 않는다 (와이어프레임도 장식이다) */}
      <div aria-hidden className="mx-auto mt-[10px] h-1 w-12 rounded-[2px] bg-[#d6d6d6]" />

      <div className="mt-6 flex items-start justify-between gap-3 pr-[15px] pl-[30px]">
        <div className="min-w-0">
          {/*
            유형 뱃지는 이름 뒤에 붙는다. 카테고리가 없는 곳이 있어 그때는 통째로 빠지고,
            **이름에 이미 그 말이 들어 있을 때도 뺀다** — "서귀포KAL호텔 호텔", "협재해수욕장 해수욕장",
            "제주국제공항 공항"처럼 같은 말이 두 번 적히기 때문이다. 실제 검색 결과 14곳 중 9곳이 그랬다.
            뱃지가 값을 하는 건 이름만 봐서는 뭔지 모르는 곳들이다 —
            "늘봄흑돼지 음식점", "스타벅스 제주용담DT점 카페", "우도 섬".

            와이어프레임은 서귀포칼호텔 옆에 "호텔"을 붙여 그렸지만 그건 예시 한 장이고, 실제 데이터에서는
            반복이 규칙이었다. 와이어프레임대로 늘 붙이려면 아래 !place.label.includes(...) 만 지우면 된다.
          */}
          <div className="flex min-w-0 items-baseline gap-[7px]">
            <h2 className="truncate text-[18px] leading-[26px] font-bold text-[#1f1f1f]">{place.label}</h2>
            {place.type && !place.label.includes(place.type) && (
              <span className="shrink-0 text-[13px] leading-[26px] font-medium text-[#9e9e9e]">{place.type}</span>
            )}
          </div>

          {/*
            거리 + 지역. 이 줄 자체는 안 바뀌고, ⌄ 를 누르면 주소 카드가 위에 떠오른다
            (와이어프레임과 카카오·네이버가 다 같은 모양이다 — 줄을 늘리면 아래 버튼들이 밀린다).
            주소가 아예 없는 장소에서는 누를 게 없으니 disabled 다.
          */}
          {/*
            주소 카드가 이 줄을 기준으로 위에 뜬다. 기준을 이 줄 하나로 좁게 잡는 게 중요하다 —
            바깥 상자(이름 + 이 줄)를 기준 삼으면 카드가 이름보다 더 위로 밀려난다. 와이어프레임은
            카드 바닥이 이 줄 바로 위, 즉 이름을 덮는 자리다.
          */}
          <div className="relative">
            <button
              type="button"
              onClick={toggleAddress}
              disabled={!place.road && !place.jibun}
              aria-expanded={openAddress}
              aria-label="주소 보기"
              className="mt-[6px] flex min-w-0 items-center gap-[6px] text-left text-[14px] leading-[22px] font-medium text-[#9e9e9e] disabled:cursor-default"
            >
              <span className="min-w-0 truncate">
                {/* 출발지를 모르면 거리 없이 지역만 — 모르는 값을 0km 로 적으면 거짓말이 된다 */}
                {km !== null && <span className="mr-[11px]">{km}km</span>}
                {place.region}
              </span>
              {(place.road || place.jibun) && (
                <Chevron className={`shrink-0 transition-transform ${openAddress ? "rotate-180" : ""}`} />
              )}
            </button>

            {openAddress && (
              <>
                {/*
                  바깥을 눌러 닫는 길. 카드보다 먼저 그려서 뒤에 깔린다.
                  fixed inset-0 이라 시트 밖(지도)까지 덮는다 — 지도를 끌어서 닫으려는 것도 여기서 잡힌다.
                */}
                <button
                  aria-label="주소 닫기"
                  onClick={() => setOpenAddress(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />

                {/*
                  카드. 와이어프레임은 320x89 를 x:17 에 두고 시트 위쪽 경계를 24px 넘겨 걸쳐 놓았다.
                  bottom-full 로 붙이면 줄 수가 둘이든 셋이든 알아서 위로 자란다 — 높이 89 를 박으면
                  우편번호 없는 곳(도로명이 없는 관광지)에서 빈 칸이 남는다.
                  -13px 은 시트의 pl-[30px] 을 상쇄해 와이어프레임의 x:17 로 맞추는 값이다.
                */}
                <div className="absolute bottom-full left-[-13px] z-20 mb-[3px] w-[320px] rounded-[10px] border border-[#ededed] bg-white px-[16px] py-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.14)]">
                  <AddressRow badge="도로명" value={place.road} />
                  <AddressRow badge="지번" value={place.jibun} />
                  {/* 아직 받는 중이면 줄이 없다. 다 받고도 없으면(도로명 없는 곳) 그대로 안 그린다 */}
                  <AddressRow badge="우편번호" value={postal ?? ""} filled />
                </div>
              </>
            )}
          </div>
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
        출발은 갈 화면이 아직 없다 —
        ponytail: "목적지 -> 출발 선택"(Figma 2173:1932)을 만들면 여기 onClick 을 router.push 로 바꾼다.
        근처 주차장 보기는 /parking 이 받는다 (Figma 2153:1771 "수정 PARK-01 | 목적지 주변 주차장").
      */}
      <div className="mt-[11px] flex gap-1 px-4">
        <button
          onClick={() => setNotice("출발 선택 화면은 아직 준비 중입니다")}
          className="h-10 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-4 text-[14px] leading-[22px] font-medium text-[#1f1f1f]"
        >
          출발
        </button>
        <button
          onClick={onParking}
          className="flex h-10 flex-1 items-center justify-center gap-[15px] rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-medium text-white transition active:scale-[0.98]"
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

/**
 * 주소 카드 한 줄 — 뱃지 + 주소 + 복사 (Figma 2606:847).
 *
 * 값이 없으면 줄째 사라진다. 도로명이 없는 장소(성산일출봉·협재해수욕장·우도)가 실제로 있고,
 * 그러면 우편번호도 없다 — 빈 줄로 남기면 못 받아온 것처럼 보이지만 원래 없는 것이다.
 *
 * 복사 자리는 오른쪽 정렬이 아니라 **값 바로 뒤**다. 와이어프레임에서 우편번호 줄의 복사만
 * x:137 로 앞에 와 있는데(다른 두 줄은 x:228), 값 길이를 따라간다는 뜻이다.
 */
function AddressRow({ badge, value, filled = false }: { badge: string; value: string; filled?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    // 보안 컨텍스트(https·localhost)가 아니면 clipboard 가 아예 없다. 그때는 조용히 넘어간다 —
    // 누른 사람에게 알릴 수 있는 게 "이 브라우저에서는 안 됩니다"뿐이라 알려도 할 수 있는 일이 없다.
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 무시 */
    }
  }

  return (
    <div className="flex items-center gap-[15px] py-[2px]">
      <span
        className={`grid h-[19px] w-[48px] shrink-0 place-items-center rounded-[4px] text-[10px] leading-none ${
          filled ? "bg-[#ff7b33] font-bold text-white" : "border border-[#ff7b33] text-[#1f1f1f]"
        }`}
      >
        {badge}
      </span>
      <span className="min-w-0 truncate text-[11px] leading-[19px] text-[#1f1f1f]">{value}</span>
      <button onClick={copy} className="shrink-0 text-[11px] leading-[19px] text-[#2f6fed]">
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

/** 주소 줄을 펼치는 ⌄. 와이어프레임의 Vector 15 자리인데 따로 뽑아둔 에셋이 없어 그려 넣는다. */
function Chevron({ className }: { className: string }) {
  return (
    <svg width="12" height="7" viewBox="0 0 12 7" fill="none" className={className} aria-hidden>
      <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
