"use client";

// 주차장 찾기 — 최종 와이어프레임 PARK-HOME-02A / 02B (Figma 2129:3599).
// 두 프레임은 화면 두 장이 아니라 한 화면의 두 상태다: 핀만 있는 지도(02A) → 핀을 고르면
// 하단 시트가 올라온다(02B). 목적지 입력(/destination)이 세 상태를 한 파일에 둔 것과 같다.
//
// 메인화면(/home)의 "주차장 찾기" 카드로 들어온다. 목적지 흐름과 달리 **목적지가 없다** —
// 그래서 반경 안 전부가 아니라 지금 보고 있는 곳에서 가까운 40곳을 찍고, 지도를 움직이면 다시 찍는다.
//
// 주차장은 두 군데서 온다: 굳혀둔 공공데이터(data/parking-data.json)와 카카오 카테고리 검색.
// 공공데이터는 전부 공영이라 관광지 부설주차장이 통째로 빠져 있어서 카카오로 덧붙인다 (lib/poi.ts).
//
// 24시간은 칩으로도 정보로도 쓰지 않는다. 원본 CSV 1,657곳이 전부 평일+토요일+공휴일
// 00:00~23:59 인데 유료 117곳도 그렇다 — 유료 주차장이 24시간 개방일 리 없으니 그 컬럼은
// 운영시간이 아니라 미입력 기본값이다. 걸러낼 것도 없고, 말할 수 있는 사실도 아니다.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { loadSdk, type LatLng } from "../RouteMap";
import { findPlace } from "../destination/actions";
import { findParkingNear } from "./actions";
import {
  spotsAround,
  mergeSpots,
  walkMinutes,
  isEasyParking,
  parkingKind,
  onStreetBlind,
  feeText,
  feeDetail,
  meters,
  navigateTo,
  REACH_M,
  type Lot,
  type ParkingSpot,
} from "@/lib/parking";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

/**
 * 요금·구획수 밑에 붙는 출처. 날짜를 문자열로 박지 않고 데이터에서 꺼낸다 —
 * 데이터를 새로 받으면 화면 날짜도 같이 움직여야 한다.
 */
const SOURCE = `출처: ${PARKING.source} · 요금은 그 뒤로 바뀌었을 수 있습니다`;

/**
 * 처음 보고 있을 곳 — 제주시청.
 *
 * /destination 처럼 섬 한가운데(한라산)를 잡으면 안 된다. 거기는 주차장이 없어서,
 * 화면을 열면 가까운 40곳이 죄다 산 아래 10km 밖으로 흩어진 채 빈 지도가 뜬다.
 * 시청 반경 1km 안에만 177곳이라 여기서 열면 첫 화면에 핀이 찬다. 현위치 버튼이 그 다음이다.
 */
const START: LatLng = [33.4996, 126.5312];

/** 시작 축척. 섬 전체가 아니라 동네가 보여야 핀 40개가 뭉치지 않는다. */
const START_LEVEL = 5;

/** 현위치·검색으로 옮겨갈 때 축척. 도보 10분 반경(WALK10_M)이 대체로 화면에 담기는 정도다. */
const FOCUS_LEVEL = 5;

/** 지도를 이만큼 움직이면 카카오에 다시 물어본다. 받아오는 반경(2km)보다 훨씬 작게 잡는다. */
const REFETCH_M = 300;

/** 카카오에서 받은 것 중 지도에 얹을 최대 개수. 받아오는 건 한 페이지(15곳)뿐이다. */
const POI_CAP = 15;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function ParkingPage() {
  return (
    <Suspense>
      <Parking />
    </Suspense>
  );
}

/**
 * 주차장이 0곳일 때 할 말.
 *
 * 칩 때문에 비었는지, 원래 그 동네에 없는지를 갈라서 말한다 — 칩이 다 꺼져 있는데
 * "칩을 꺼보세요"라고 하면 사용자가 할 수 있는 일이 없는 안내가 된다.
 * 실제로 성판악(와이어프레임의 예시 목적지)이 그렇다: 국립공원이 직접 운영하는 주차장이라
 * 시·군 공공데이터에도, 카카오 주차장 카테고리에도 안 잡혀 두 출처 모두 0곳이 나온다.
 */
function emptyText(filtered: boolean, anchored: boolean) {
  if (filtered) return "조건에 맞는 주차장이 없습니다. 칩을 꺼보세요.";
  return anchored
    ? `목적지에서 걸어갈 만한 거리(${REACH_M / 1000}km) 안에 등록된 주차장이 없습니다.`
    : "이 근처에 등록된 주차장이 없습니다. 지도를 옮겨보세요.";
}

/**
 * 상세 화면(/parking/detail)으로 넘길 쿼리.
 *
 * 주차장을 좌표로 가리킨다 — 이름은 겹치는 곳이 있어 그것만으로는 한 곳을 못 집는다.
 * 상세 화면은 이 좌표로 공공데이터에서 원본을 되찾고, 못 찾으면(카카오 POI) 이름·주소만 쓴다.
 * 목적지 쿼리(dest*)는 그대로 얹어 보낸다 — 거기서도 "목적지까지 도보 N분"을 쓰고, 뒤로가기가 여기로 돌아온다.
 */
function detailQuery(spot: ParkingSpot, sp: URLSearchParams) {
  const q = new URLSearchParams(sp);
  q.set("name", spot.name);
  q.set("lat", String(spot.at[0]));
  q.set("lng", String(spot.at[1]));
  if (spot.addr) q.set("addr", spot.addr);
  return String(q);
}

/**
 * 길 비교 화면(/route)으로 넘길 쿼리.
 *
 * 길의 **도착지는 주차장**이다 — 쿼리의 dest* 는 관광지라 그대로 두고 to* 를 따로 싣는다.
 * 차를 대는 자리까지 재야 "몇 분 걸리나"가 실제로 운전하는 시간이 된다.
 * (상세 화면의 "이 주차장으로 갈게요"도 같은 쿼리를 만든다 — app/parking/detail/GoButton.tsx)
 */
function routeQuery(spot: ParkingSpot, sp: URLSearchParams) {
  const q = new URLSearchParams(sp);
  q.set("to", spot.name);
  q.set("toLat", String(spot.at[0]));
  q.set("toLng", String(spot.at[1]));
  return String(q);
}

/** 같은 주차장인가. 이름이 겹치는 곳("금능리 1428" 류)이 있어 좌표까지 본다. */
const same = (a: ParkingSpot | null, b: ParkingSpot) =>
  !!a && a.name === b.name && a.at[0] === b.at[0] && a.at[1] === b.at[1];

function Parking() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * 목적지를 물고 들어왔는가 (/destination 의 "근처 주차장 보기").
   * 좌표까지 받는 이유는 거기 onParking 주석에 있다. URL 은 사용자가 고칠 수 있는 입력이라
   * 숫자가 아니면 없는 셈 친다 — 그때는 목적지 없는 원래 화면(메인의 "주차장 찾기")으로 돈다.
   */
  const destName = searchParams.get("dest");
  const destLat = searchParams.get("destLat");
  const destLng = searchParams.get("destLng");
  const dest = useMemo<LatLng | null>(() => {
    const la = Number(destLat);
    const ln = Number(destLng);
    return Number.isFinite(la) && Number.isFinite(ln) && destLat && destLng ? [la, ln] : null;
  }, [destLat, destLng]);

  // 지도가 알려주는 값이다 — 여기서 지도로 되돌려 주지 않는다. 되돌리면 핀이 갱신될 때마다
  // 중심이 다시 잡혀서 사용자가 지도를 움직일 수 없다 (RouteMap 이 경로에 맞춰 하는 일).
  const [center, setCenter] = useState<LatLng>(dest ?? START);
  const [walk10, setWalk10] = useState(false);
  const [free, setFree] = useState(false);
  const [selected, setSelected] = useState<ParkingSpot | null>(null);
  /*
   * 목록이 펴져 있는가. 어느 흐름이든 접힌 채로 연다.
   *
   * 와이어프레임 PARK-01 은 목록을 펴둔 채로 그렸는데, 그러면 첫 화면의 절반 이상을 목록이 덮어서
   * **목적지 핀과 그 주변 P 핀의 관계**가 안 보인다. 이 화면이 답하는 질문은 "목적지 옆 어디에 대나"고,
   * 그건 지도라야 한 눈에 보인다. 목록은 핀이 겹칠 때 필요한 것이라 손잡이 하나 뒤에 있어도 늦지 않다.
   */
  const [list, setList] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = useRef<((at: LatLng, level?: number) => void) | null>(null);

  // 카카오에서 받아온 주변 주차장. 굳혀두지 않고 화면에서만 들고 있는다 (lib/poi.ts 첫 주석).
  const [pois, setPois] = useState<Lot[]>([]);
  const fetched = useRef<LatLng | null>(null);

  /*
   * 거리·목록의 기준점. 목적지가 있으면 거기에 못 박고, 없으면 예전처럼 지도 가운데를 따라간다.
   *
   * 목적지가 있을 때 지도를 따라가면 안 된다 — 카드에 적히는 "목적지까지 도보 N분"이 지도를
   * 밀 때마다 바뀌어 버려서, 목적지까지의 거리가 아니라 지금 보고 있는 자리까지의 거리가 된다.
   * 그러면 이 화면이 답하려는 질문("목적지 옆에 뭐가 있나")에 답을 못 한다.
   */
  const anchor = dest ?? center;

  // 지도를 조금 움직일 때마다 부르면 팬 한 번에 요청이 여러 개 나간다. 반경 2km 로 받아오므로
  // REFETCH_M 만큼 움직이기 전에는 받아둔 걸 그대로 쓴다. (목적지가 있으면 기준이 안 움직여 한 번만 돈다.)
  useEffect(() => {
    if (fetched.current && meters(fetched.current, anchor) < REFETCH_M) return;
    fetched.current = anchor;
    // 실패해도 화면엔 알리지 않는다 — 공공데이터 40곳은 그대로 떠 있어서 화면이 비지 않고,
    // 여기서 오류 문구를 띄우면 사용자가 할 수 있는 일이 없는 경고만 하나 더 얹는 셈이다.
    findParkingNear(anchor).then((r) => !("error" in r) && setPois(r.spots));
  }, [anchor]);

  // 두 출처를 같은 기준으로 잰다 — 카카오 쪽 거리도 기준점에서 다시 계산한다.
  // "무료" 칩을 켜면 카카오 쪽은 통째로 빠진다. 요금을 모르는 곳을 무료라고 보여줄 수는 없다.
  const spots = useMemo(
    () =>
      mergeSpots(
        spotsAround(anchor, LOTS, { walk10, free }),
        spotsAround(anchor, pois, { walk10, free }, POI_CAP),
      ),
    [anchor, walk10, free, pois],
  );

  /**
   * 초보에게 권할 한 곳 — 평행주차가 아닌 곳 중 목적지에서 가장 가깝다.
   * spots 가 이미 가까운 순이라 find 하나면 끝이다. 직각인 곳이 하나도 없으면 그냥 가장 가까운 곳.
   *
   * 이걸 두는 이유는 버튼을 줄이려는 게 아니라 **기본 답을 주려는 것**이다. 목록 15~40곳을
   * 늘어놓고 고르라는 건 정보는 맞지만 결정은 통째로 초보에게 떠넘긴다. 여기가 답하려는 질문은
   * "어디 대면 돼?"고, 대부분의 사람에게 그 답은 "칸에 맞춰 대는 곳 중 제일 가까운 데"다.
   * 다른 데를 보고 싶으면 손잡이를 올리면 된다 — 답을 주되 막지는 않는다.
   */
  const recommended = useMemo(() => spots.find(isEasyParking) ?? spots[0] ?? null, [spots]);

  /**
   * 시트에 띄울 한 곳. 사용자가 고른 게 있으면 그것, 없으면 추천이다.
   * 목적지 흐름에서만 추천이 붙는다 — 목적지가 없으면 "무엇에서 가까운지"가 지도를 미는 대로
   * 바뀌어서, 추천이 화면을 밀 때마다 갈아치워지는 값이 된다.
   */
  const shown = dest ? (selected ?? recommended) : selected;

  // 고른 주차장이 화면을 옮기다 40곳 밖으로 밀려도 핀은 남긴다 —
  // 시트에는 그 주차장이 떠 있는데 지도에 핀만 없으면 어디를 가리키는 건지 알 수 없다.
  const pins = useMemo(
    () => (shown && !spots.some((s) => same(shown, s)) ? [...spots, shown] : spots),
    [spots, shown],
  );

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    const found = await findPlace(q);
    setBusy(false);
    if ("error" in found) return setError(found.error);
    setSelected(null);
    setList(false);
    move.current?.(found.coord, FOCUS_LEVEL);
  }

  /*
   * 지도 위 동그란 버튼 하나. 시트마다 자리가 같아서(시트 오른쪽 위 바깥) 한 번 만들어 내려보낸다.
   *
   * 뜻이 흐름마다 다르다. 목적지 흐름에서 "현위치"는 쓸 데가 없다 — 목록도 거리도 목적지에
   * 못 박혀 있어서 내 위치로 옮겨봐야 지도만 딴 데를 본다. 거기서 필요한 건 **목적지로 돌아가는**
   * 길이다. 목적지가 없는 흐름에서는 원래대로 현위치다 (메인의 "주차장 찾기"로 들어온 사람은
   * 내 주변을 보러 온 거다).
   */
  const mapButton = dest
    ? { label: "목적지로", onClick: () => move.current?.(dest, FOCUS_LEVEL) }
    : { label: "현재 위치", onClick: locate };

  function locate() {
    if (!("geolocation" in navigator)) return setError("이 브라우저는 위치 확인을 지원하지 않습니다");
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setBusy(false);
        move.current?.([coords.latitude, coords.longitude], FOCUS_LEVEL);
      },
      (err) => {
        setBusy(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요."
            : "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /*
   * 주차장을 골랐다. 지도 핀이든 목록이든 여기로 모인다.
   *
   * 고른 즉시 화면을 넘기지 않는다 — 핀 하나 눌렀을 뿐인데 다른 화면으로 튀면 지도로 돌아오는
   * 데 뒤로가기를 써야 하고, 옆 핀과 비교하려던 사람은 그 비교를 못 한다.
   * /around 가 하는 것과 같은 규칙이다: 고른 한 곳을 시트에 띄우고, 넘어갈지는 거기서 정한다.
   *
   * 지도를 그 핀으로 옮기지는 않는다 — 옮기면 지도 가운데가 곧 그 주차장이 돼서
   * 시트의 "도보 N분"이 고르는 순간 0분이 된다.
   */
  function pick(spot: ParkingSpot) {
    setSelected(spot);
    setList(false);
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f2f5f0]">
      {/* 핀도 목록과 같은 문으로 보낸다 — setSelected 를 직접 주면 목적지 흐름에서 핀만 상세로 안 간다 */}
      <Map
        pins={pins}
        selected={shown}
        onPick={pick}
        onIdle={setCenter}
        onBlank={() => setSelected(null)}
        move={move}
        start={dest ?? START}
        dest={dest}
      />

      {/* 지도가 화면을 꽉 채우고 나머지는 그 위에 뜬다 (와이어프레임의 full-map) */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <div className="pointer-events-auto px-4 text-[#1f1f1f] drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)]">
          <StatusBar tone="" />
        </div>

        {/*
          와이어프레임은 ⌕ 를 왼쪽에 두고 뒤로가기가 아예 없다 (프로토타입은 링크로 돌아간다).
          실제로는 나갈 길이 있어야 해서 ←를 왼쪽에 넣고 ⌕ 를 오른쪽으로 옮겼다 — 지도를 덮는
          동그란 버튼을 따로 띄우면 검색바와 겹치고, 지도를 그만큼 더 가린다.
          프로필 쿼리를 그대로 돌려줘야 메인화면이 프로필을 되읽는다 (lib/profile.ts).
        */}
        {/*
          목적지를 물고 왔으면 검색칸 대신 그 이름을 보여준다 (와이어프레임 PARK-01 의 destination 칩).
          여기서 검색을 열어두면 지도만 움직이고 목록은 목적지에 붙어 있어 둘이 어긋난다 —
          기준을 바꾸고 싶으면 목적지 화면에서 다시 고르는 게 맞는 길이다.
        */}
        {dest ? (
          <div className="pointer-events-auto mx-[18px] flex h-[58px] shrink-0 items-center gap-2 rounded-[29px] bg-white pr-[18px] pl-3 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)]">
            <button
              onClick={() => router.push(`/destination?${searchParams}`)}
              aria-label="뒤로"
              className="grid size-9 shrink-0 place-items-center rounded-full text-[18px] text-[#1f1f1f] active:bg-black/5"
            >
              ←
            </button>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#1f1f1f]">
              {destName ?? "목적지"}
            </span>
            <span className="shrink-0 text-[12px] text-[#9e9e9e]">주변 주차장</span>
          </div>
        ) : (
          <form
            onSubmit={search}
            className="pointer-events-auto mx-[18px] flex h-[58px] shrink-0 items-center gap-2 rounded-[29px] bg-white pr-[18px] pl-3 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)]"
          >
            <button
              type="button"
              onClick={() => router.push(`/home?${searchParams}`)}
              aria-label="뒤로"
              className="grid size-9 shrink-0 place-items-center rounded-full text-[18px] text-[#1f1f1f] active:bg-black/5"
            >
              ←
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="목적지 또는 주소 검색"
              aria-label="목적지 또는 주소"
              className="min-w-0 flex-1 text-[14px] text-[#1f1f1f] outline-none placeholder:text-[#a6a6a6]"
            />
            <button type="submit" aria-label="검색" disabled={busy} className="shrink-0 text-[17px] leading-none text-[#1f1f1f] disabled:opacity-40">
              ⌕
            </button>
          </form>
        )}

        {/*
          필터 칩. 켠 값은 spotsAround 가 그대로 받는다 — 칩 이름과 기준이 어긋나지 않게
          도보 10분의 반경(WALK10_M)은 lib/parking.check.ts 가 분수 표시와 묶어 검증한다.

          와이어프레임 ChipRow 에 있던 "공영"은 뺐다. 공영이냐 민영이냐는 초보가 어디에 댈지를
          안 바꾼다 — 요금과 주차 형태가 바꾸고, 그건 "무료" 칩과 카드 배지가 이미 말한다.
          (기능상으로는 카카오에서 온 곳을 통째로 빼는 스위치였는데, 그건 칩 이름이 뜻하는 일도 아니었다.)
        */}
        <div className="pointer-events-auto mt-3.5 flex shrink-0 gap-2 px-[18px]">
          <Chip on={walk10} onClick={() => setWalk10((v) => !v)}>
            도보 10분
          </Chip>
          <Chip on={free} onClick={() => setFree((v) => !v)}>
            무료
          </Chip>
        </div>

        {/* 핀이 0곳일 때 말해주지 않으면 빈 지도만 남는다 — 칩을 켠 채 한적한 곳을 검색하면
            실제로 그렇게 된다 (성산일출봉 1km 안 주차장은 한 곳뿐이다). */}
        {(error || busy || !spots.length) && (
          <p className="pointer-events-auto mx-[18px] mt-2 shrink-0 rounded-lg bg-white/95 px-3 py-2 text-[12px] leading-relaxed shadow">
            <span className={error ? "text-rose-600" : "text-[#616161]"}>
              {error ?? (busy ? "찾는 중…" : emptyText(walk10 || free, !!dest))}
            </span>
          </p>
        )}

        {/*
          줌 +/− 는 뺐다. 핀치와 더블탭으로 이미 되는 일을 버튼으로 한 벌 더 준 것이라,
          지도 오른쪽을 두 칸 차지하면서 새로 할 수 있게 해주는 건 없었다.
          현위치(또는 목적지로) 버튼은 시트 위에 붙어 있다 — 시트가 화면 아래를 덮어서
          여기 두면 가려진다 (/around 가 같은 이유로 시트에 붙여뒀다).

          "목록으로 보기" 버튼도 없앴다. 시트가 늘 떠 있고, 목록으로 가는 문은 그 손잡이다.
        */}
      </div>

      {/*
        고른 주차장. 거리는 고를 때 재둔 값이 아니라 기준점에서 다시 잰다
        (목적지가 있으면 목적지에서, 없으면 지도 중심에서).

        두 흐름에서 시트가 다르다.
        · 목적지가 있으면 짧은 시트 하나 — 다음 화면(PARK-02 상세)이 요금·규모·주차형태를 다 펴므로
          여기서 같은 걸 또 늘어놓으면 같은 정보에 버튼만 두 벌이 된다.
        · 없으면 PARK-HOME-02B 정보 시트. 이 흐름에는 상세로 꼭 가야 할 이유가 없어 여기가 끝이다.
      */}
      {shown &&
        !list &&
        (dest ? (
          <PickedSpot
            spot={shown}
            walkM={Math.round(meters(anchor, shown.at))}
            /* 아직 아무것도 안 고른 상태면 이건 우리가 고른 곳이다 — 라벨과 이유 줄이 그때만 붙는다 */
            recommended={!selected}
            onList={() => setList(true)}
            onDetail={() => router.push(`/parking/detail?${detailQuery(shown, searchParams)}`)}
            /*
             * 카카오맵을 바로 열지 않는다 — 어느 길로 갈지가 아직 안 정해졌다.
             * 길 비교(HOME-02) → 근거(HOME-03)를 거쳐 거기서 안내로 나간다.
             */
            onGo={() => router.push(`/route?${routeQuery(shown, searchParams)}`)}
            mapButton={mapButton}
          />
        ) : (
          <SpotSheet
            spot={shown}
            walkM={Math.round(meters(anchor, shown.at))}
            anchored={false}
            onClose={() => setSelected(null)}
            onDetail={() => router.push(`/parking/detail?${detailQuery(shown, searchParams)}`)}
            mapButton={mapButton}
          />
        ))}

      {/*
        목록. 목적지 흐름에서는 손잡이로 열고 닫는 한 장이고, 목적지가 없으면 **늘 떠 있다** —
        접혀 있을 때는 "이 근처 주차장 N곳" 한 줄만 보이고 손잡이를 올리면 편다 (/around 와 같다).
        떠 있는 버튼 하나가 사라지는 것 말고도, 목록이 있다는 걸 버튼 이름이 아니라 화면이 말한다.
      */}
      {(list || (!dest && !shown)) && (
        <SpotList
          spots={spots}
          anchored={!!dest}
          empty={emptyText(walk10 || free, !!dest)}
          open={list}
          onPick={pick}
          onToggle={() => setList((v) => !v)}
          mapButton={mapButton}
        />
      )}
    </div>
  );
}

/** 시트마다 붙는 지도 버튼(현위치 / 목적지로). 뜻은 부르는 쪽이 정한다 (Parking 의 mapButton). */
type MapButton = { label: string; onClick: () => void };

/**
 * 시트 오른쪽 위 바깥에 뜨는 동그란 버튼.
 *
 * 지도 위 흐름에 두면 시트가 덮는다 — 시트 높이가 내용마다 달라(추천 한 곳 ↔ 목록 ↔ 정보 시트)
 * 밖에서 그 높이를 피하려면 매번 재야 한다. 시트에 붙이면 시트를 따라 저절로 움직인다.
 */
function SheetButton({ button }: { button: MapButton }) {
  return (
    <button
      onClick={button.onClick}
      aria-label={button.label}
      className="absolute -top-[58px] right-5 grid size-[46px] place-items-center rounded-full bg-white text-[20px] text-[#2e9c85] shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:bg-black/5"
    >
      ◎
    </button>
  );
}

/** 필터 칩 — 켜면 초록(#2e9c85), 끄면 흰 바탕 (와이어프레임 색 그대로) */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-[31px] rounded-[15.5px] px-3.5 text-[12px] font-bold shadow-[0_2px_6px_rgba(0,0,0,0.1)] transition ${
        on ? "bg-[#2e9c85] text-white" : "bg-white text-[#404040]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 목적지 흐름의 하단 시트 (/around 의 "선택한 가맹점" 시트와 같은 골격).
 *
 * 화면에 들어오자마자 **추천 한 곳을 물고** 떠 있는다. 그래서 아무것도 안 누른 사람도
 * "여기로 갈게요" 한 번이면 끝난다 — 예전에는 목록으로 보기 → 카드 → 상세 → 갈게요 →
 * 확인까지 다섯 번이었다. 다른 데를 보려면 손잡이를 올려 목록을 편다.
 *
 * 짧게 둔다. 여기서 답할 건 "이거 맞아?" 하나고, 요금 상세·주차 4단계는 "자세히"가 맡는다.
 */
function PickedSpot({
  spot,
  walkM,
  recommended,
  onList,
  onDetail,
  onGo,
  mapButton,
}: {
  spot: ParkingSpot;
  walkM: number;
  /** 사용자가 고른 게 아니라 우리가 고른 곳인가. 라벨과 이유 줄이 갈린다. */
  recommended: boolean;
  onList: () => void;
  onDetail: () => void;
  onGo: () => void;
  mapButton: MapButton;
}) {
  const kind = parkingKind(spot);
  // 추정 평행은 배지를 안 낸다 — 간접 추론으로 겁을 주면 절반은 헛경고다 (SpotSheet 와 같은 규칙)
  const badge = kind && (kind.parallel ? kind.confirmed : true) ? (kind.parallel ? "평행주차" : "주차 쉬움") : null;
  const info = [`목적지에서 도보 ${walkMinutes(walkM)}분`, feeText(spot), spot.spaces != null ? `${spot.spaces}면` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <aside className="absolute inset-x-0 bottom-0 z-20 rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)]">
      <SheetButton button={mapButton} />
      {/* 손잡이가 목록으로 가는 문이다 — 지도 위에 뜬 "목록으로 보기" 버튼을 이게 대신한다 */}
      <button onClick={onList} aria-label="다른 주차장 보기" className="mx-auto block h-1 w-[38px] rounded-full bg-[#bfbfbf]" />

      <div className="px-5 pt-4 pb-6">
        <p className="text-[12px] font-bold text-[#ff6114]">{recommended ? "추천 주차장" : "선택한 주차장"}</p>
        <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-[#1f1f1f]">{spot.name}</h2>
        <p className="mt-2 text-[13px] text-[#525252]">{info}</p>
        {badge && (
          <span
            className={`mt-3 inline-block rounded-md px-2 py-1 text-[11px] font-bold ${
              kind!.parallel ? "bg-[#eeeeee] text-[#525252]" : "bg-[#ffebd6] text-[#ff6114]"
            }`}
          >
            {badge}
          </span>
        )}

        {/*
          왜 이게 떴는지 밝힌다. 안 밝히면 추천이 근거 없는 지목으로 보이고, 초보는 그걸 못 따진다.
          직각인 곳이 하나도 없어 그냥 가까운 곳을 집었을 때는 그렇다고 말한다 — 없는 근거를 지어내지 않는다.
        */}
        {recommended && (
          <p className="mt-2 text-[12px] leading-relaxed text-[#9e9e9e]">
            {isEasyParking(spot)
              ? "칸에 맞춰 대는 곳 중 목적지에서 가장 가까워요."
              : "목적지에서 가장 가까워요."}
          </p>
        )}

        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onDetail}
            className="h-[52px] shrink-0 rounded-xl bg-[#f2f2f2] px-6 text-[14px] font-bold text-[#1f1f1f] transition active:scale-[0.98]"
          >
            자세히
          </button>
          <button
            onClick={onGo}
            className="h-[52px] flex-1 rounded-xl bg-[#ff6114] text-[14px] font-bold text-white transition active:scale-[0.98]"
          >
            여기로 갈게요
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * PARK-HOME-02B — 고른 주차장 한 곳.
 *
 * "도보 N분"이 어디서 잰 값인지 문구로 밝힌다. 목적지를 물고 왔으면(anchored) 목적지까지고,
 * 아니면 지도 가운데까지다 — 기준을 안 밝히면 어디서 잰 값인지 알 수 없는 숫자가 된다.
 */
function SpotSheet({
  spot,
  walkM,
  anchored,
  onClose,
  onDetail,
  mapButton,
}: {
  spot: ParkingSpot;
  walkM: number;
  anchored: boolean;
  onClose: () => void;
  onDetail: () => void;
  mapButton: MapButton;
}) {
  // 와이어프레임의 "무료 · 24시간 · 120면"에서 24시간을 뺐다 — 예시로 적힌 값이고, 데이터로
  // 뒷받침되지 않는다. 원본 CSV 는 1,657곳이 전부 00:00~23:59 인데 유료 117곳도 그렇다.
  // 유료 주차장이 24시간 개방일 리 없으니 그 컬럼은 운영시간이 아니라 미입력 기본값이다.
  const info = [feeText(spot), spot.spaces != null ? `${spot.spaces}면` : null].filter(Boolean).join(" · ");
  const kind = parkingKind(spot);
  return (
    <aside className="absolute inset-x-0 bottom-0 z-20 rounded-t-[20px] bg-white px-5 pt-2.5 pb-6 shadow-[0_-4px_20px_rgba(0,0,0,0.14)]">
      <SheetButton button={mapButton} />
      <button onClick={onClose} aria-label="닫기" className="mx-auto block h-1 w-[38px] rounded-full bg-[#bfbfbf]" />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-[#ff6114]">선택한 주차장</p>
          <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-[#1f1f1f]">{spot.name}</h2>
          {/* 이름이 번지뿐인 곳이 91%다 — 시·읍면동을 붙여야 어디인지 보인다 */}
          {spot.addr && <p className="mt-1 text-[12px] text-[#9e9e9e]">{spot.addr}</p>}
          <p className="mt-2 text-[13px] text-[#525252]">
            {anchored ? "목적지까지" : "지도 가운데에서"} 도보 {walkMinutes(walkM)}분
          </p>
          <p className="mt-1.5 text-[13px] text-[#525252]">{info}</p>
          {feeDetail(spot) && <p className="mt-1 text-[12px] text-[#9e9e9e]">{feeDetail(spot)}</p>}
          {/* 어디서 온 정보인지 밝힌다 — 구획수·요금이 왜 비어 있는지가 여기서 설명된다 */}
          {spot.source === "카카오" && (
            <p className="mt-1 text-[12px] text-[#9e9e9e]">카카오맵에서 찾은 곳 · 구획수·요금은 알 수 없습니다</p>
          )}
          {/*
            출처와 기준일. 요금·구획수를 사실로 내놓으면서 언제 기준인지 안 밝히면,
            넉 달 전 요금을 오늘 값인 것처럼 보여주는 셈이 된다 (착한가격업소 패널이 선정
            시점을 적는 것과 같은 이유다). 지워진 result 화면에도 이 줄이 있었다.
          */}
          {spot.source !== "카카오" && <p className="mt-2 text-[11px] text-[#bdbdbd]">{SOURCE}</p>}
        </div>
        {/*
          확인된 평행주차는 초보에게 경고할 값어치가 있어 배지를 낸다. 추정 평행(노상 643곳)은
          배지를 안 낸다 — 간접 추론으로 겁을 주면 절반은 헛경고가 되고, 경고가 흔해지면 안 읽힌다.
        */}
        {kind && (kind.parallel ? kind.confirmed : true) && (
          <span
            className={`mt-6 shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold ${
              kind.parallel ? "bg-[#eeeeee] text-[#525252]" : "bg-[#ffebd6] text-[#ff6114]"
            }`}
          >
            {kind.parallel ? "평행주차" : "주차 쉬움"}
          </span>
        )}
      </div>

      {/*
        배지는 단정적으로 읽힌다. 그러니 그 값이 어디서 왔는지를 바로 밑에 적는다 —
        위성으로 사람이 본 곳은 사실이고, 아닌 곳은 주차장유형으로 추정한 확률이다.
        화면 문구에 "노상·노외"는 쓰지 않는다 — 주차장법 제2조 법령 용어다.
      */}
      {kind && (kind.parallel ? kind.confirmed : true) && (
        <p className="mt-3 text-[11px] leading-relaxed text-[#9e9e9e]">
          {kind.confirmed
            ? kind.parallel
              ? "위성사진으로 확인한 결과 연석 옆에 칸을 그린 평행주차 구획입니다."
              : "위성사진으로 확인한 결과 칸에 맞춰 대는 직각주차 구획입니다."
            : "도로 밖에 따로 만든 주차장이라 칸에 맞춰 대는 직각주차일 확률이 높습니다. 공개 데이터로 추정한 값입니다."}
        </p>
      )}

      {/* 상세는 PARK-02(/parking/detail), 안내는 카카오맵으로 나간다 (navigateTo 주석) */}
      <div className="mt-5 flex gap-2.5">
        <button
          onClick={onDetail}
          className="h-[52px] shrink-0 rounded-xl bg-[#f2f2f2] px-6 text-[14px] font-bold text-[#1f1f1f] transition active:scale-[0.98]"
        >
          상세 보기
        </button>
        <button
          onClick={() => navigateTo(spot)}
          className="h-[52px] flex-1 rounded-xl bg-[#ff6114] text-[14px] font-bold text-white transition active:scale-[0.98]"
        >
          이 주차장으로 바로 안내
        </button>
      </div>
    </aside>
  );
}

/**
 * "목록으로 보기" — 지도에 찍힌 그 40곳을 그대로 글로 본다.
 * 핀은 겹치면 서로를 가리지만 목록은 안 가린다. 새 데이터도 새 화면도 필요 없다.
 */
function SpotList({
  spots,
  anchored,
  empty,
  open,
  onPick,
  onToggle,
  mapButton,
}: {
  spots: ParkingSpot[];
  anchored: boolean;
  /** 0곳일 때 할 말. 부르는 쪽이 만든다 — 지도 위 알림줄과 문구가 갈리면 안 된다 (emptyText) */
  empty: string;
  /** 펴져 있는가. 접히면 머리글 한 줄과 첫 칸 귀퉁이만 보인다 — 그 귀퉁이가 "더 있다"는 표시다. */
  open: boolean;
  onPick: (s: ParkingSpot) => void;
  onToggle: () => void;
  mapButton: MapButton;
}) {
  return (
    <aside
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)] ${
        open ? "max-h-[62%]" : "max-h-[122px]"
      }`}
    >
      <SheetButton button={mapButton} />
      <button
        onClick={onToggle}
        aria-label={open ? "목록 접기" : "목록 펼치기"}
        aria-expanded={open}
        className="mx-auto block h-1 w-[38px] shrink-0 rounded-full bg-[#bfbfbf]"
      />
      {/* 머리글도 같은 문이다 — 접힌 시트에서 4px 짜리 손잡이만 노리게 하면 열 방법을 못 찾는다 */}
      <button onClick={onToggle} className="shrink-0 px-5 pt-4 pb-3 text-left text-[15px] font-bold text-[#1f1f1f]">
        {anchored ? "목적지 주변" : "이 근처"} 주차장 {spots.length}곳
      </button>
      {/*
        지역 한계. 판정을 지우는 대신 못 보는 게 뭔지 말한다 (lib/parking.ts onStreetBlind).
        여기가 목록 맨 위인 이유 — 카드마다 붙이면 같은 말을 40번 하게 되고, 시트에만 두면
        목록을 훑는 사람은 못 본다.
      */}
      {onStreetBlind(spots) && (
        <p className="mx-5 mb-3 shrink-0 rounded-lg bg-[#fff5eb] px-3 py-2 text-[11px] leading-relaxed text-[#8a6d3b]">
          서귀포시는 공개 데이터에 도로변 주차장이 없습니다. 실제보다 적게 나오고, 평행주차 안내도 뜨지 않습니다.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {spots.length === 0 && <p className="py-6 text-center text-[13px] leading-relaxed text-[#616161]">{empty}</p>}
        {/* key 가 순번인 이유 — 원본 데이터에 이름도 좌표도 똑같은 행이 15쌍 있다
            ("이도이동 1053" 3면/2면처럼 구획수만 다른 별개 등록건이라 합칠 수도 없다).
            목록은 매번 통째로 다시 만들고 행이 스스로 들고 있는 상태도 없어 순번으로 충분하다. */}
        {spots.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s)}
            className="flex w-full items-center justify-between gap-3 border-b border-[#f0f0f0] py-3.5 text-left active:bg-black/[0.03]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold text-[#1f1f1f]">{s.name}</span>
              {s.addr && <span className="mt-0.5 block truncate text-[11px] text-[#9e9e9e]">{s.addr}</span>}
              <span className="mt-1 block text-[12px] text-[#616161]">
                {[feeText(s), s.spaces != null ? `${s.spaces}면` : null].filter(Boolean).join(" · ")}
                {isEasyParking(s) && <span className="ml-1.5 font-bold text-[#ff6114]">주차 쉬움</span>}
                {s.source === "카카오" && <span className="ml-1.5 text-[#9e9e9e]">카카오맵</span>}
              </span>
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[#525252]">도보 {walkMinutes(s.walkM)}분</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

/** 주차장 핀. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다 (RouteMap 과 같은 방식). */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="34" viewBox="0 0 44 34">
     <rect x="1.5" y="1.5" width="41" height="31" rx="15.5" fill="#fff" stroke="#1f1f1f" stroke-width="2"/>
     <text x="22" y="23" font-family="system-ui,sans-serif" font-size="15" font-weight="700"
           fill="#1f1f1f" text-anchor="middle">P</text>
   </svg>`,
);

const PIN_ON = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="42" viewBox="0 0 54 42">
     <rect x="2" y="2" width="50" height="38" rx="19" fill="#ff6114" stroke="#1f1f1f" stroke-width="2"/>
     <text x="27" y="28" font-family="system-ui,sans-serif" font-size="18" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
);

/** 목적지 핀 — 주차장 P 핀과 안 헷갈리게 파란 점으로 둔다 (와이어프레임 지도의 destination 색). */
const DEST_PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
     <circle cx="13" cy="13" r="9" fill="#2f6fed" stroke="#fff" stroke-width="4"/>
   </svg>`,
);

type MapProps = {
  pins: ParkingSpot[];
  selected: ParkingSpot | null;
  onPick: (s: ParkingSpot) => void;
  onIdle: (at: LatLng) => void;
  /** 핀이 아닌 빈 지도를 눌렀을 때. 골라둔 주차장을 푼다. */
  onBlank: () => void;
  /** 지도를 밖에서 움직이는 손잡이. level 이 ±1 이면 그만큼 축척을 바꾼다(줌 버튼). */
  move: React.RefObject<((at: LatLng, level?: number) => void) | null>;
  /** 처음 보고 있을 곳. 목적지를 물고 오면 거기서 연다. */
  start: LatLng;
  /** 목적지 핀. 없으면 안 찍는다 — 주차장만 있으면 어디 옆인지 알 수 없다. */
  dest: LatLng | null;
};

/**
 * 주차장 지도. RouteMap 을 쓰지 않는 이유 — 거기는 경로·마커가 다 담기도록 매번 setBounds 를
 * 다시 건다. 여기서는 핀이 지도를 움직일 때마다 바뀌므로, 그 규칙이면 사용자가 지도를
 * 움직이는 족족 화면이 되돌아온다. 공통인 건 SDK 로더뿐이라 그것만 가져다 쓴다.
 */
function Map({ pins, selected, onPick, onIdle, onBlank, move, start, dest }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 핸들러가 지도 생성 effect 안에 갇히므로(한 번만 돈다) 최신 값을 ref 로 넘긴다
  const pick = useRef(onPick);
  pick.current = onPick;
  const idle = useRef(onIdle);
  idle.current = onIdle;
  const blank = useRef(onBlank);
  blank.current = onBlank;
  /** 마지막으로 마커를 누른 시각. 지도 click 이 마커 click 뒤에 따라 올라오는지 가리는 데 쓴다. */
  const pickedAt = useRef(0);

  useEffect(() => {
    loadSdk().then(
      () => setSdk("ready"),
      () => setSdk("error"),
    );
  }, []);

  useEffect(() => {
    if (sdk !== "ready" || !box.current) return;
    const { kakao } = window;
    const pt = ([lat, lng]: LatLng) => new kakao.maps.LatLng(lat, lng);

    // start 는 첫 프레임에 한 번만 쓴다 — 의존성에 넣으면 값이 바뀔 때마다 지도를 새로 만든다
    const m = new kakao.maps.Map(box.current, { center: pt(start), level: START_LEVEL });
    map.current = m;

    // 팬·줌이 멎은 뒤에 한 번 온다. 그리는 도중마다 다시 계산하지 않아도 되는 지점이다.
    kakao.maps.event.addListener(m, "idle", () => {
      const c = m.getCenter();
      idle.current([c.getLat(), c.getLng()]);
    });

    // 빈 지도를 누르면 골라둔 주차장을 푼다 (/around 와 같은 규칙).
    //
    // 마커를 눌러도 이 이벤트가 **따라 올라온다** — 그대로 두면 핀을 고르는 즉시 풀려서
    // 아무것도 선택되지 않는다. 방금 마커를 누른 직후면 무시한다.
    kakao.maps.event.addListener(m, "click", () => {
      if (Date.now() - pickedAt.current < 300) return;
      blank.current();
    });

    move.current = (at, level) => {
      if (level === 1 || level === -1) m.setLevel(m.getLevel() + level, { animate: true });
      else {
        if (level) m.setLevel(level);
        m.panTo(pt(at));
      }
    };

    // 컨테이너가 0폭인 동안 만들어지면 축척이 터진다 (RouteMap 과 같은 이유)
    const ro = new ResizeObserver(() => m.relayout());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, move]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h] = on ? [54, 42] : [44, 34];
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h)),
      });
      kakao.maps.event.addListener(marker, "click", () => {
        pickedAt.current = Date.now();
        pick.current(s);
      });
      marker.setMap(map.current);
      return marker;
    });

    // 목적지는 맨 위에 둔다. offset 을 안 주면 이미지 아래 끝이 좌표에 맞아 점이 위로 뜬다 —
    // 꼬리 없는 동그라미라 가운데가 좌표에 앉아야 맞다.
    if (dest) {
      const mark = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(dest[0], dest[1]),
        zIndex: 3,
        image: new kakao.maps.MarkerImage(DEST_PIN, new kakao.maps.Size(26, 26), {
          offset: new kakao.maps.Point(13, 13),
        }),
      });
      mark.setMap(map.current);
      drawn.current.push(mark);
    }
  }, [sdk, pins, selected, dest]);

  const notice =
    !process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
      ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
      : sdk === "loading"
        ? "지도를 불러오는 중…"
        : sdk === "error"
          ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
          : null;

  return (
    <>
      <div ref={box} className="absolute inset-0" />
      {notice && (
        <p className="absolute inset-x-0 top-1/2 z-0 px-8 text-center text-[13px] text-[#616161]">{notice}</p>
      )}
    </>
  );
}
