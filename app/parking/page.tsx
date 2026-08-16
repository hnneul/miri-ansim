"use client";

// 목적지 주변 주차장 — 최종 와이어프레임 수정 PARK-01 (Figma 2153:1771).
// 목적지 화면(/destination)의 "근처 주차장 보기"로 들어오는 유일한 문이다.
//
// 지도는 위 364px 띠만 쓰고 **그 아래로 카드 목록이 그대로 펼쳐진다.** 예전에는 지도가 화면을
// 꽉 채우고 하단 시트가 추천 한 곳을 물고 있었는데(PARK-HOME-02A/02B), 그 화면은 목적지 없이
// 내 주변을 훑는 흐름의 것이었고 지금은 들어오는 문이 없다.
//
// 목적지가 기준점이라 **지도를 밀어도 목록과 거리는 안 움직인다.** 이 화면이 답하는 질문은
// "목적지 옆 어디에 대나"고, 기준이 지도를 따라가면 "도보 N분"이 목적지까지가 아니라
// 지금 보고 있는 자리까지의 거리가 된다.
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
import { findParkingNear } from "./actions";
import {
  spotsAround,
  mergeSpots,
  walkMinutes,
  parkingKind,
  REACH_M,
  type Lot,
  type ParkingSpot,
} from "@/lib/parking";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

/**
 * 목록 밑에 붙는 출처. 날짜를 문자열로 박지 않고 데이터에서 꺼낸다 —
 * 데이터를 새로 받으면 화면 날짜도 같이 움직여야 한다.
 */
const SOURCE = `출처: ${PARKING.source} · 요금은 그 뒤로 바뀌었을 수 있습니다`;

/** 목적지 없이 URL 로 들어왔을 때 지도가 볼 곳 — 제주시청. 그때는 목록 대신 안내만 뜬다. */
const START: LatLng = [33.4996, 126.5312];

/** 축척. 섬 전체가 아니라 동네가 보여야 핀이 뭉치지 않는다. */
const START_LEVEL = 5;

/** 카카오에서 받은 것 중 지도에 얹을 최대 개수. 받아오는 건 한 페이지(15곳)뿐이다. */
const POI_CAP = 15;

/** 같은 주차장인가. 이름이 겹치는 곳("금능리 1428" 류)이 있어 좌표까지 본다. */
const same = (a: ParkingSpot | null, b: ParkingSpot) =>
  !!a && a.name === b.name && a.at[0] === b.at[0] && a.at[1] === b.at[1];

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
function emptyText(filtered: boolean) {
  return filtered
    ? "조건에 맞는 주차장이 없습니다. 칩을 꺼보세요."
    : `목적지에서 걸어갈 만한 거리(${REACH_M / 1000}km) 안에 등록된 주차장이 없습니다.`;
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

function Parking() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * 목적지 (/destination 의 "근처 주차장 보기"가 실어 보낸다).
   * 좌표까지 받는 이유는 거기 onParking 주석에 있다. URL 은 사용자가 고칠 수 있는 입력이라
   * 숫자가 아니면 없는 셈 친다 — 그때는 목록 자리에 목적지를 고르러 가는 안내만 뜬다.
   */
  const destName = searchParams.get("dest");
  const destLat = searchParams.get("destLat");
  const destLng = searchParams.get("destLng");
  const dest = useMemo<LatLng | null>(() => {
    const la = Number(destLat);
    const ln = Number(destLng);
    return Number.isFinite(la) && Number.isFinite(ln) && destLat && destLng ? [la, ln] : null;
  }, [destLat, destLng]);

  /**
   * 정렬. 거리 하나만 두면 칩이 눌린 채로 안 꺼져 고장처럼 보인다 — 누를 때마다 갈아탄다.
   *
   * "칸 많은 순"이 초보에게 값을 하는 이유: 칸이 많은 주차장은 빈자리를 만날 확률도, 옆 차와
   * 간격을 둘 여지도 크다. 구획수를 모르는 곳(카카오)은 뒤로 밀린다 — 0으로 치면 "칸이 없다"가
   * 되고, 앞으로 올리면 모르는 곳이 제일 좋은 곳 자리에 앉는다.
   */
  const [sort, setSort] = useState<"distance" | "spaces">("distance");
  /** 요금 무료만. 카카오 쪽은 요금을 몰라 통째로 빠진다 — 모르는 곳을 무료라고 보여줄 수는 없다. */
  const [free, setFree] = useState(false);
  /**
   * 공영만. 공공데이터 1,657곳이 전부 공영이라, 이 칩은 곧 **카카오에서 온 곳을 빼는 것**이다.
   * lib 의 필터에 넣지 않고 여기서 목록을 안 섞는 걸로 끝낸다 — 출처를 가르는 일이지 조건이 아니다.
   */
  const [publicOnly, setPublicOnly] = useState(false);
  /** 지도에서 고른 한 곳. 카드가 이걸로 물들고, 핀도 이것만 커진다. */
  const [selected, setSelected] = useState<ParkingSpot | null>(null);
  /** 목록이 지도를 덮고 있는가 ("목록 보기"). 지도는 뒤에 그대로 살아 있다. */
  const [listOpen, setListOpen] = useState(false);

  // 카카오에서 받아온 주변 주차장. 굳혀두지 않고 화면에서만 들고 있는다 (lib/poi.ts 첫 주석).
  // 기준점이 목적지에 못 박혀 있어 한 번만 부르면 된다.
  const [pois, setPois] = useState<Lot[]>([]);
  useEffect(() => {
    if (!dest) return;
    // 실패해도 화면엔 알리지 않는다 — 공공데이터는 그대로 떠 있어서 목록이 비지 않고,
    // 여기서 오류 문구를 띄우면 사용자가 할 수 있는 일이 없는 경고만 하나 더 얹는 셈이다.
    findParkingNear(dest).then((r) => !("error" in r) && setPois(r.spots));
  }, [dest]);

  // 두 출처를 같은 기준(목적지)으로 잰다 — 카카오 쪽 거리도 여기서 다시 계산된다.
  // mergeSpots 가 돌려주는 건 이미 가까운 순이라, 거리 정렬은 따로 할 일이 없다.
  const spots = useMemo(() => {
    if (!dest) return [];
    const merged = mergeSpots(
      spotsAround(dest, LOTS, { free }),
      publicOnly ? [] : spotsAround(dest, pois, { free }, POI_CAP),
    );
    return sort === "spaces"
      ? [...merged].sort((a, b) => (b.spaces ?? -1) - (a.spaces ?? -1))
      : merged;
  }, [dest, free, publicOnly, pois, sort]);

  /*
   * 지도 핀을 눌렀다. 여기서 화면을 넘기지 않는다 — 핀 하나 눌렀을 뿐인데 다른 화면으로 튀면
   * 옆 주차장과 비교하려던 사람은 그 비교를 못 한다. 고른 곳을 목록에서 짚어주고, 갈지 말지는
   * 그 카드에서 정한다 (/around 와 같은 규칙).
   */
  function highlight(spot: ParkingSpot) {
    setSelected(spot);
    setListOpen(false);
  }

  /** 카드를 눌렀다 — 상세(PARK-02)로. 와이어프레임이 카드에 매어둔 동선이다. */
  function open(spot: ParkingSpot) {
    router.push(`/parking/detail?${detailQuery(spot, searchParams)}`);
  }

  /*
   * 고른 카드를 목록에 보이게 끌어온다. 지도 아래 남는 자리가 카드 서너 장이라, 안 끌어오면
   * 핀을 눌러도 물든 카드가 화면 밖에 있어 아무 일도 안 일어난 것처럼 보인다.
   * ref 를 카드마다 달지 않고 표시 하나로 찾는다 — 목록이 40장이라 ref 를 40개 들 이유가 없다.
   *
   * behavior 를 안 준다(즉시). smooth 로 뒀더니 애니메이션이 도는 300ms 사이에 카카오 POI 가
   * 도착해 목록이 다시 그려지면서 스크롤이 중간에 끊겼다 — 핀은 커졌는데 카드는 화면 밖에 남았다.
   */
  const listBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    listBox.current?.querySelector('[data-picked="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, spots]);

  return (
    /*
      앱바·지도·칩은 제자리에 붙어 있고 **목록만 스크롤된다** (아래 overflow-y-auto).
      페이지째 스크롤하게 뒀더니 카드를 넘길 때 지도와 앱바가 같이 밀려 올라가, 지도가
      다이내믹 아일랜드 밑으로 파고들고 "여기가 어디 주변인지"를 알려주는 알약이 사라졌다.
      지도를 보면서 목록을 훑는 화면이라 위쪽이 움직이면 안 된다.

      overflow-hidden 이 있어야 이 상자가 목록 높이만큼 늘어나지 않는다 — 그래야 flex-1 이
      프레임 높이를 받고, 남은 자리를 목록이 min-h-0 으로 나눠 갖는다 (/route 와 같은 구성).
    */
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <StatusBar tone="text-[#525252]" />

      {/* AppBar/Back — 44px 터치 영역 + 24px 화살표 (공통 앱바 규격) */}
      <div className="mx-4 flex h-14 shrink-0 items-center gap-3">
        <button
          onClick={() => router.push(`/destination?${searchParams}`)}
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
        <h1 className="min-w-0 truncate text-[18px] leading-[26px] font-bold text-[#1f1f1f]">
          목적지 주변 주차장
        </h1>
      </div>

      {/*
        지도 띠. 와이어프레임은 364px 고정이고 그 아래는 목록 차지다 —
        지도를 더 키우면 첫 화면에 카드가 한 장도 안 들어온다.

        목적지 알약은 지도 위에 얹힌다. z 를 매기는 건 장식이 아니라 필수다 — 카카오가 지도
        안쪽에 z-index 를 박아서, 지도 상자에 쌓임 맥락이 없으면 그것들이 알약 위로 올라온다
        (/destination 이 같은 이유로 지도를 z-0 에 가둬 뒀다).
      */}
      <div className="relative min-h-0 flex-1">
        {/* z-0 이 지도 몫의 쌓임 맥락을 만든다 — 안쪽 알약의 z-10 이 여기 갇혀야 목록이 덮을 수 있다 */}
        <div className="absolute inset-x-0 top-0 z-0 h-[364px] bg-[#f7f7f7]">
          <Map
            pins={spots}
            selected={selected}
            onPick={highlight}
            onBlank={() => setSelected(null)}
            start={dest ?? START}
            dest={dest}
          />
          <div className="pointer-events-none absolute inset-x-7 top-3 z-10 flex h-[54px] items-center rounded-[50px] border border-[#e5e5e5] bg-white px-[21px]">
            <span className="truncate text-[15px] leading-[22px] text-[#1f1f1f]">
              {destName ?? "목적지"}
            </span>
          </div>
        </div>

        {/*
          칩과 목록. 평소에는 지도(364) 밑에서 시작하고, "목록 보기"를 누르면 top 이 0 으로 올라가
          **지도를 덮는다.** 지도를 접거나 지우지 않는 이유 — display:none 으로 감추면 카카오 지도가
          0 크기로 접혔다가 다시 펴지면서 축척을 다시 잡는다. 뒤에 그대로 살려두면 그럴 일이 없다.
        */}
        <div
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col bg-white transition-[top] duration-200 ${
            listOpen ? "top-0" : "top-[364px]"
          }`}
        >
          {/*
            칩 (와이어프레임 ChipRow 2153:1782) + 목록 보기.

            "가까운 순"은 누르면 "칸 많은 순"으로 갈아탄다. 정렬이 하나뿐일 때는 켜진 채 안 꺼지는
            칩이었는데, 옆의 필터 칩과 똑같이 생겨서 고장 난 버튼으로 읽혔다.

            켜짐 색은 주황이다. 와이어프레임의 Chip/Selected 와 Chip/Default 는 테두리 색만
            #e6e6e6 / #e5e5e5 로 달라 눈으로는 구분되지 않는데, 켜고 끄는 칩이 그러면 안 된다.
            같은 화면의 배지와 같은 주황을 쓴다.
          */}
          <div className="flex shrink-0 items-center gap-2 px-[15px] pt-[11px] pb-1">
            <Chip
              on
              onClick={() => setSort((s) => (s === "distance" ? "spaces" : "distance"))}
            >
              {sort === "distance" ? "가까운 순" : "칸 많은 순"}
            </Chip>
            <Chip on={free} onClick={() => setFree((v) => !v)}>
              무료
            </Chip>
            <Chip on={publicOnly} onClick={() => setPublicOnly((v) => !v)}>
              공영
            </Chip>
            {/*
              지도 아래 남는 자리가 카드 서너 장이라, 많이 보려면 목록이 지도를 덮어야 한다.
              칩 줄 오른쪽 끝에 둔다 — 목록 위에 따로 띠를 만들면 보이는 카드가 한 장 더 줄어든다.
            */}
            <button
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              className="ml-auto shrink-0 px-1 text-[13px] leading-[22px] font-medium text-[#525252]"
            >
              {listOpen ? "지도 보기" : "목록 보기"}
            </button>
          </div>

          <div ref={listBox} className="min-h-0 flex-1 overflow-y-auto">
        {!dest ? (
          <div className="mx-4 mt-5">
            <p className="text-[13px] leading-relaxed text-[#616161]">
              어디 주변을 찾을지 몰라 목록을 만들지 못했습니다. 목적지를 먼저 골라주세요.
            </p>
            <button
              onClick={() => router.push(`/destination?${searchParams}`)}
              className="mt-4 h-[52px] w-full rounded-[8px] bg-[#fc7f35] text-[14px] leading-[22px] font-medium text-white transition active:scale-[0.98]"
            >
              목적지 고르러 가기
            </button>
          </div>
        ) : (
          <>
          {/*
            서귀포 지역 한계 안내(lib/parking.ts onStreetBlind)는 뺐다 — 와이어프레임에 없는 줄이고,
            목록 맨 위 자리를 늘 차지하고 있었다.

            **없어진 사실이 아니라 안 보이게 된 사실이다.** 서귀포시 몫 113곳은 공개 데이터에
            전부 노외로 들어 있어(제주시는 노외 901 + 노상 643) 프록시가 거기서는 "직각"만 답한다.
            그래서 서귀포에서 평행주차 칸을 만나는 사람은 미리 알 길이 없다.
            되살리려면 onStreetBlind(spots) 로 이 자리에 한 줄 도로 넣으면 된다 (판정은 그대로 있다).
          */}
            {spots.length === 0 ? (
              <p className="mx-4 mt-5 text-[13px] leading-relaxed text-[#616161]">
                {emptyText(free || publicOnly)}
              </p>
            ) : (
              /* key 가 순번인 이유 — 원본 데이터에 이름도 좌표도 똑같은 행이 15쌍 있다
                 ("이도이동 1053" 3면/2면처럼 구획수만 다른 별개 등록건이라 합칠 수도 없다). */
              <div className="mx-4 mt-[10px] space-y-[5px]">
                {spots.map((s, i) => (
                  <SpotCard
                    key={i}
                    spot={s}
                    picked={same(selected, s)}
                    onClick={() => open(s)}
                  />
                ))}
              </div>
            )}

            {/*
              출처와 기준일. 요금·구획수를 사실로 내놓으면서 언제 기준인지 안 밝히면,
              넉 달 전 요금을 오늘 값인 것처럼 보여주는 셈이 된다.
              목록 끝에 붙어 같이 스크롤된다 — 늘 보일 값어치는 없고, 끝까지 본 사람에게는 답이 된다.
            */}
              <p className="mx-4 mt-3 mb-6 text-[11px] leading-[16px] text-[#bdbdbd]">{SOURCE}</p>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 필터 칩. onClick 이 없으면 누를 수 없는 표시가 된다 ("가까운 순").
 * 와이어프레임 규격: h40 · 좌우 16 · 완전 둥근 모서리 · 14/22 medium.
 */
function Chip({ on, onClick, children }: { on: boolean; onClick?: () => void; children: string }) {
  const cls = `flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-[14px] leading-[22px] font-medium transition ${
    on ? "bg-[#fc7f35] text-white" : "border border-[#e5e5e5] bg-white text-[#1f1f1f]"
  }`;
  return onClick ? (
    <button onClick={onClick} aria-pressed={on} className={cls}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/**
 * Card/Parking (와이어프레임 7:34) — 이름·도보시간 한 줄, 그 아래 배지.
 *
 * 요금·구획수는 안 적는다. 와이어프레임이 이 카드에 안 뒀고, 다음 화면(PARK-02)이 그걸
 * 통째로 펴 보인다 — 목록에서 같은 걸 또 늘어놓으면 카드가 두 줄에서 네 줄이 된다.
 */
function SpotCard({
  spot,
  picked,
  onClick,
}: {
  spot: ParkingSpot;
  /** 지도에서 고른 그 곳인가. 테두리 굵기는 그대로 두고 색만 바꾼다 — 굵어지면 목록이 덜컹인다. */
  picked: boolean;
  onClick: () => void;
}) {
  const type = typeBadge(spot);
  const kakao = spot.source === "카카오";

  return (
    <button
      onClick={onClick}
      data-picked={picked}
      className={`block w-full rounded-[12px] border px-[15px] pt-[11px] pb-[14px] text-left transition active:bg-black/[0.03] ${
        picked ? "border-[#fc7f35] bg-[#fff6f0]" : "border-[#e6e6e6] bg-white"
      }`}
    >
      <span className="flex h-[26px] items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] leading-[22px] font-medium text-[#1f1f1f]">
          {spot.name}
        </span>
        <span className="shrink-0 text-[14px] leading-[22px] font-medium tabular-nums text-[#525252]">
          도보 {walkMinutes(spot.walkM)}분
        </span>
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        {type && <Badge>{type}</Badge>}
        {/* 공공데이터는 1,657곳이 전부 공영이라 출처가 곧 이 배지다 */}
        {!kakao && <Badge>공영</Badge>}
        {/*
          카카오에서 온 곳은 유형도 공영 여부도 몰라 위 둘이 다 빠진다. 그러면 배지가 하나도
          없는 카드가 되는데, 그건 "정보가 없다"가 아니라 "출처가 다르다"라서 그렇다고 적는다.
        */}
        {kakao && <Badge muted>카카오맵</Badge>}
      </span>
    </button>
  );
}

/**
 * 주차 형태 배지 문구. 모르면(카카오) 아무 말도 안 한다 — 이 프로젝트가 데이터 없는 자리에서
 * 쓰는 규칙이다 (lib/parking.ts parkingKind).
 *
 * 와이어프레임 문구가 "직각 주차(추정)"인데, **위성으로 사람이 확인한 곳에는 (추정)을 안 붙인다.**
 * 확인한 사실을 추정이라고 적으면 상세 화면의 "위성사진으로 확인한 결과"와 어긋난다.
 */
function typeBadge(spot: ParkingSpot): string | null {
  const kind = parkingKind(spot);
  if (!kind) return null;
  const name = kind.parallel ? "평행 주차" : "직각 주차";
  return kind.confirmed ? name : `${name}(추정)`;
}

function Badge({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <span
      className={`flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] leading-4 font-medium ${
        muted ? "border border-[#d6d6d6] text-[#9e9e9e]" : "bg-[#fc7f35] text-white"
      }`}
    >
      {children}
    </span>
  );
}

/** 주차장 핀. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다 (RouteMap 과 같은 방식). */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/*
 * 안 고른 주차장은 작은 점, 고른 한 곳만 크게 (/around 의 탐나는전 핀과 같은 규칙).
 *
 * 전에는 40곳이 전부 44×34 흰 말풍선이라 서귀포 도심에서 스무 개가 서로를 가려 지도가 안 읽혔다.
 * 점으로 줄이면 어디에 몰려 있는지가 먼저 보이고, 어느 하나를 짚었을 때만 그게 도드라진다.
 *
 * 둘 다 **가운데를 좌표에 앉힌다**(anchor). 하나는 가운데, 하나는 아래끝으로 두면 고르는 순간
 * 핀이 위로 뛴다 — 같은 자리에서 커지기만 해야 같은 곳을 가리키는 걸로 읽힌다.
 */
const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
     <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
       <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="0.28"/>
     </filter>
     <circle cx="13" cy="13" r="9.5" fill="#fc7f35" filter="url(#s)"/>
     <text x="13" y="17.5" font-family="system-ui,sans-serif" font-size="12" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
);

const PIN_ON = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
     <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
       <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.32"/>
     </filter>
     <circle cx="22" cy="22" r="16.5" fill="#fc7f35" stroke="#fff" stroke-width="3" filter="url(#s)"/>
     <text x="22" y="28.5" font-family="system-ui,sans-serif" font-size="18" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
);

/** [폭, 높이] — 앵커는 그 절반(가운데)이다. */
const PIN_SIZE = [26, 26] as const;
const PIN_ON_SIZE = [44, 44] as const;

/** 목적지 핀 — 주차장 P 핀과 안 헷갈리게 파란 점으로 둔다 (와이어프레임 지도의 destination 색). */
const DEST_PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
     <circle cx="13" cy="13" r="9" fill="#2f6fed" stroke="#fff" stroke-width="4"/>
   </svg>`,
);

type MapProps = {
  pins: ParkingSpot[];
  /** 고른 한 곳. 이것만 큰 핀이 된다. */
  selected: ParkingSpot | null;
  /** 핀을 누르면. 화면을 넘기지 않고 목록에서 그 카드를 짚어준다. */
  onPick: (s: ParkingSpot) => void;
  /** 핀이 아닌 빈 지도를 눌렀을 때. 골라둔 주차장을 푼다. */
  onBlank: () => void;
  /** 처음 보고 있을 곳. 목적지를 물고 오면 거기서 연다. */
  start: LatLng;
  /** 목적지 핀. 없으면 안 찍는다 — 주차장만 있으면 어디 옆인지 알 수 없다. */
  dest: LatLng | null;
};

/**
 * 주차장 지도. RouteMap 을 쓰지 않는 이유 — 거기는 경로·마커가 다 담기도록 매번 setBounds 를
 * 다시 건다. 여기서는 핀이 목적지 주변 40곳이라 그 규칙이면 축척이 데이터에 끌려다닌다.
 * 공통인 건 SDK 로더뿐이라 그것만 가져다 쓴다.
 */
function Map({ pins, selected, onPick, onBlank, start, dest }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 핸들러가 지도 생성 effect 안에 갇히므로(한 번만 돈다) 최신 값을 ref 로 넘긴다
  const pick = useRef(onPick);
  pick.current = onPick;
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

    // start 는 첫 프레임에 한 번만 쓴다 — 의존성에 넣으면 값이 바뀔 때마다 지도를 새로 만든다
    const m = new kakao.maps.Map(box.current, {
      center: new kakao.maps.LatLng(start[0], start[1]),
      level: START_LEVEL,
    });
    map.current = m;

    // 빈 지도를 누르면 골라둔 주차장을 푼다. 마커를 눌러도 이 이벤트가 **따라 올라오므로**,
    // 방금 마커를 누른 직후면 무시한다 — 안 그러면 고르는 즉시 풀려서 아무것도 안 골라진다.
    kakao.maps.event.addListener(m, "click", () => {
      if (Date.now() - pickedAt.current < 300) return;
      blank.current();
    });

    // 컨테이너가 0폭인 동안 만들어지면 축척이 터진다 (RouteMap 과 같은 이유)
    const ro = new ResizeObserver(() => m.relayout());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, start]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h] = on ? PIN_ON_SIZE : PIN_SIZE;
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h), {
          offset: new kakao.maps.Point(w / 2, h / 2),
        }),
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

  const notice = !process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
    ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
    : sdk === "loading"
      ? "지도를 불러오는 중…"
      : sdk === "error"
        ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
        : null;

  return (
    <>
      {/* z-0 이 쌓임 맥락을 만든다 — 카카오가 지도 안에 박는 z-index 가 이 상자 안에 갇힌다 */}
      <div ref={box} className="absolute inset-0 z-0" />
      {notice && (
        <p className="absolute inset-x-0 top-1/2 z-0 px-8 text-center text-[13px] text-[#616161]">
          {notice}
        </p>
      )}
    </>
  );
}
