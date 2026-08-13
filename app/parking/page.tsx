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
  feeText,
  feeDetail,
  meters,
  type Lot,
  type ParkingSpot,
} from "@/lib/parking";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

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

/** 같은 주차장인가. 이름이 겹치는 곳("금능리 1428" 류)이 있어 좌표까지 본다. */
const same = (a: ParkingSpot | null, b: ParkingSpot) =>
  !!a && a.name === b.name && a.at[0] === b.at[0] && a.at[1] === b.at[1];

function Parking() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 지도가 알려주는 값이다 — 여기서 지도로 되돌려 주지 않는다. 되돌리면 핀이 갱신될 때마다
  // 중심이 다시 잡혀서 사용자가 지도를 움직일 수 없다 (RouteMap 이 경로에 맞춰 하는 일).
  const [center, setCenter] = useState<LatLng>(START);
  const [walk10, setWalk10] = useState(false);
  const [free, setFree] = useState(false);
  const [selected, setSelected] = useState<ParkingSpot | null>(null);
  const [list, setList] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = useRef<((at: LatLng, level?: number) => void) | null>(null);

  // 카카오에서 받아온 주변 주차장. 굳혀두지 않고 화면에서만 들고 있는다 (lib/poi.ts 첫 주석).
  const [pois, setPois] = useState<Lot[]>([]);
  const fetched = useRef<LatLng | null>(null);

  // 지도를 조금 움직일 때마다 부르면 팬 한 번에 요청이 여러 개 나간다. 반경 2km 로 받아오므로
  // REFETCH_M 만큼 움직이기 전에는 받아둔 걸 그대로 쓴다.
  useEffect(() => {
    if (fetched.current && meters(fetched.current, center) < REFETCH_M) return;
    fetched.current = center;
    // 실패해도 화면엔 알리지 않는다 — 공공데이터 40곳은 그대로 떠 있어서 화면이 비지 않고,
    // 여기서 오류 문구를 띄우면 사용자가 할 수 있는 일이 없는 경고만 하나 더 얹는 셈이다.
    findParkingNear(center).then((r) => !("error" in r) && setPois(r.spots));
  }, [center]);

  // 두 출처를 같은 기준으로 잰다 — 카카오 쪽 거리도 지금 지도 중심에서 다시 계산한다.
  // "무료" 칩을 켜면 카카오 쪽은 통째로 빠진다. 요금을 모르는 곳을 무료라고 보여줄 수는 없다.
  const spots = useMemo(
    () =>
      mergeSpots(
        spotsAround(center, LOTS, { walk10, free }),
        spotsAround(center, pois, { walk10, free }, POI_CAP),
      ),
    [center, walk10, free, pois],
  );

  // 고른 주차장이 화면을 옮기다 40곳 밖으로 밀려도 핀은 남긴다 —
  // 시트에는 "선택한 주차장"이 떠 있는데 지도에 그 핀만 없으면 어디를 고른 건지 알 수 없다.
  const pins = useMemo(
    () => (selected && !spots.some((s) => same(selected, s)) ? [...spots, selected] : spots),
    [spots, selected],
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

  // 목록에서 골라도 지도를 그 핀으로 옮기지 않는다 — 옮기면 지도 가운데가 곧 그 주차장이 돼서
  // 시트의 "도보 N분"이 고르는 순간 0분이 된다. 고른 곳을 보여주려다 숫자를 거짓말로 만드는 셈이다.
  function pick(spot: ParkingSpot) {
    setSelected(spot);
    setList(false);
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f2f5f0]">
      <Map pins={pins} selected={selected} onPick={setSelected} onIdle={setCenter} move={move} />

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

        {/* 필터 칩. 켠 값은 spotsAround 가 그대로 받는다 — 칩 이름과 기준이 어긋나지 않게
            도보 10분의 반경(WALK10_M)은 lib/parking.check.ts 가 분수 표시와 묶어 검증한다. */}
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
              {error ?? (busy ? "찾는 중…" : "조건에 맞는 주차장이 없습니다. 칩을 끄거나 지도를 옮겨보세요.")}
            </span>
          </p>
        )}

        <div className="flex-1" />

        {/* 줌·현위치 — 지도 오른쪽에 세로로 (와이어프레임 x:326/324) */}
        <div className="pointer-events-auto mr-5 flex shrink-0 flex-col items-end gap-3 self-end">
          <div className="flex w-11 flex-col overflow-hidden rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
            <button onClick={() => move.current?.(center, -1)} aria-label="확대" className="h-[45px] text-[20px] text-[#1f1f1f] active:bg-black/5">
              +
            </button>
            <span className="mx-2 border-t border-[#ececec]" />
            <button onClick={() => move.current?.(center, +1)} aria-label="축소" className="h-[45px] text-[20px] text-[#1f1f1f] active:bg-black/5">
              −
            </button>
          </div>
          <button
            onClick={locate}
            aria-label="현재 위치"
            className="grid size-[46px] place-items-center rounded-full bg-white text-[20px] text-[#2e9c85] shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:bg-black/5"
          >
            ◎
          </button>
        </div>

        {/* 하단 시트가 떠 있으면 목록 버튼을 감춘다 — 둘이 같은 자리를 쓴다 */}
        {!selected && !list && (
          <button
            onClick={() => setList(true)}
            className="pointer-events-auto mx-auto mt-7 mb-7 h-11 shrink-0 rounded-[22px] bg-[#1f1f1f] px-8 text-[14px] font-bold text-white shadow-lg active:scale-[0.98]"
          >
            목록으로 보기
          </button>
        )}
      </div>

      {/* 거리는 고를 때 재둔 값이 아니라 지금 지도 중심에서 다시 잰다 — 지도를 옮기면 같이 바뀐다 */}
      {selected && (
        <SpotSheet
          spot={selected}
          walkM={Math.round(meters(center, selected.at))}
          onClose={() => setSelected(null)}
        />
      )}

      {list && (
        <SpotList spots={spots} onPick={pick} onClose={() => setList(false)} />
      )}
    </div>
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
 * PARK-HOME-02B — 고른 주차장 한 곳.
 *
 * "도보 N분"의 기준은 목적지가 아니라 **지도 가운데**다. 이 화면에는 목적지가 없어서
 * 와이어프레임의 "목적지까지 도보 4분"을 그대로 쓸 수 없다 — 기준을 안 밝히면 어디서
 * 잰 값인지 알 수 없는 숫자가 된다.
 */
function SpotSheet({ spot, walkM, onClose }: { spot: ParkingSpot; walkM: number; onClose: () => void }) {
  // 와이어프레임의 "무료 · 24시간 · 120면"에서 24시간을 뺐다 — 예시로 적힌 값이고, 데이터로
  // 뒷받침되지 않는다. 원본 CSV 는 1,657곳이 전부 00:00~23:59 인데 유료 117곳도 그렇다.
  // 유료 주차장이 24시간 개방일 리 없으니 그 컬럼은 운영시간이 아니라 미입력 기본값이다.
  const info = [feeText(spot), spot.spaces != null ? `${spot.spaces}면` : null].filter(Boolean).join(" · ");
  const kind = parkingKind(spot);
  return (
    <aside className="absolute inset-x-0 bottom-0 z-20 rounded-t-[20px] bg-white px-5 pt-2.5 pb-6 shadow-[0_-4px_20px_rgba(0,0,0,0.14)]">
      <button onClick={onClose} aria-label="닫기" className="mx-auto block h-1 w-[38px] rounded-full bg-[#bfbfbf]" />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-[#ff6114]">선택한 주차장</p>
          <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-[#1f1f1f]">{spot.name}</h2>
          {/* 이름이 번지뿐인 곳이 91%다 — 시·읍면동을 붙여야 어디인지 보인다 */}
          {spot.addr && <p className="mt-1 text-[12px] text-[#9e9e9e]">{spot.addr}</p>}
          <p className="mt-2 text-[13px] text-[#525252]">지도 가운데에서 도보 {walkMinutes(walkM)}분</p>
          <p className="mt-1.5 text-[13px] text-[#525252]">{info}</p>
          {feeDetail(spot) && <p className="mt-1 text-[12px] text-[#9e9e9e]">{feeDetail(spot)}</p>}
          {/* 어디서 온 정보인지 밝힌다 — 구획수·요금이 왜 비어 있는지가 여기서 설명된다 */}
          {spot.source === "카카오" && (
            <p className="mt-1 text-[12px] text-[#9e9e9e]">카카오맵에서 찾은 곳 · 구획수·요금은 알 수 없습니다</p>
          )}
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

      {/*
        두 버튼 다 아직 갈 곳이 없어 비활성이다.
        · 상세 보기 → PARK-02(Figma 2153:3136) 화면이 아직 없다
        · 바로 안내 → 이 앱에 길 안내가 없다
        ponytail: 그 화면·경로가 생기면 disabled 를 떼고 onClick 을 붙인다.
      */}
      <div className="mt-5 flex gap-2.5">
        <button
          disabled
          className="h-[52px] shrink-0 rounded-xl bg-[#f2f2f2] px-6 text-[14px] font-bold text-[#1f1f1f] disabled:opacity-45"
        >
          상세 보기
        </button>
        <button
          disabled
          className="h-[52px] flex-1 rounded-xl bg-[#ff6114] text-[14px] font-bold text-white disabled:opacity-45"
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
function SpotList({ spots, onPick, onClose }: { spots: ParkingSpot[]; onPick: (s: ParkingSpot) => void; onClose: () => void }) {
  return (
    <aside className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)]">
      <button onClick={onClose} aria-label="닫기" className="mx-auto block h-1 w-[38px] shrink-0 rounded-full bg-[#bfbfbf]" />
      <p className="shrink-0 px-5 pt-4 pb-3 text-[15px] font-bold text-[#1f1f1f]">
        이 근처 주차장 {spots.length}곳
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {spots.length === 0 && (
          <p className="py-6 text-center text-[13px] text-[#616161]">조건에 맞는 주차장이 없습니다. 칩을 끄거나 지도를 옮겨보세요.</p>
        )}
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

type MapProps = {
  pins: ParkingSpot[];
  selected: ParkingSpot | null;
  onPick: (s: ParkingSpot) => void;
  onIdle: (at: LatLng) => void;
  /** 지도를 밖에서 움직이는 손잡이. level 이 ±1 이면 그만큼 축척을 바꾼다(줌 버튼). */
  move: React.RefObject<((at: LatLng, level?: number) => void) | null>;
};

/**
 * 주차장 지도. RouteMap 을 쓰지 않는 이유 — 거기는 경로·마커가 다 담기도록 매번 setBounds 를
 * 다시 건다. 여기서는 핀이 지도를 움직일 때마다 바뀌므로, 그 규칙이면 사용자가 지도를
 * 움직이는 족족 화면이 되돌아온다. 공통인 건 SDK 로더뿐이라 그것만 가져다 쓴다.
 */
function Map({ pins, selected, onPick, onIdle, move }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 핸들러가 지도 생성 effect 안에 갇히므로(한 번만 돈다) 최신 값을 ref 로 넘긴다
  const pick = useRef(onPick);
  pick.current = onPick;
  const idle = useRef(onIdle);
  idle.current = onIdle;

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

    const m = new kakao.maps.Map(box.current, { center: pt(START), level: START_LEVEL });
    map.current = m;

    // 팬·줌이 멎은 뒤에 한 번 온다. 그리는 도중마다 다시 계산하지 않아도 되는 지점이다.
    kakao.maps.event.addListener(m, "idle", () => {
      const c = m.getCenter();
      idle.current([c.getLat(), c.getLng()]);
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
      kakao.maps.event.addListener(marker, "click", () => pick.current(s));
      marker.setMap(map.current);
      return marker;
    });
  }, [sdk, pins, selected]);

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
