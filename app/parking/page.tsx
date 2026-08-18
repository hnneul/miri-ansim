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
  isEasyParking,
  REACH_M,
  type Lot,
  type ParkingSpot,
} from "@/lib/parking";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

/**
 * "큰 주차장" 배지가 붙는 구획수.
 *
 * 공공데이터 1,572곳의 중앙값이 12칸이다 — 대부분은 골목에 붙은 열 칸 남짓짜리다.
 * 50칸으로 끊으면 127곳(8%)만 남아 배지가 드물게 붙고, 그래야 붙었을 때 뜻이 있다.
 *
 * **"빈자리 있음"이 아니다.** spaces 는 총 구획수라 지금 비었는지는 아무도 모른다.
 * 글자를 "큰 주차장"으로 둔 것도 그래서다 — 큰 곳은 옆 차와 간격을 둘 여지가 크다는
 * 사실까지만 말하고, 자리가 있다는 약속은 하지 않는다.
 */
const SPACIOUS = 50;

/**
 * 목록 밑에 붙는 출처. 날짜를 문자열로 박지 않고 데이터에서 꺼낸다 —
 * 데이터를 새로 받으면 화면 날짜도 같이 움직여야 한다.
 */
const SOURCE = `출처: ${PARKING.source} · 요금은 그 뒤로 바뀌었을 수 있습니다`;

/** 목적지 없이 URL 로 들어왔을 때 지도가 볼 곳 — 제주시청. 그때는 목록 대신 안내만 뜬다. */
const START: LatLng = [33.4996, 126.5312];

/**
 * 처음 축척 (카카오는 낮을수록 가깝다: 4=100m, 5=250m).
 *
 * 4 로 당겼다. 지도가 화면을 꽉 채우던 시절에는 5 가 맞았는데 지금은 364px 띠라, 같은 축척이면
 * 목적지 주변이 그 안에서 자잘하게 뭉친다. 목적지에서 걸어갈 자리를 고르는 화면이니
 * 도보 몇 분 거리가 화면에 담기면 된다 — 더 넓게 보고 싶으면 핀치·더블탭으로 물러날 수 있다.
 */
const START_LEVEL = 4;

/** 카카오에서 받은 것 중 지도에 얹을 최대 개수. 받아오는 건 한 페이지(15곳)뿐이다. */
const POI_CAP = 15;

/*
 * 이 화면의 값 묶음 (다른 화면으로 넓히기 전 시험판).
 *
 * 피그마에서 화면마다 눈에 보이는 값을 하나씩 옮겨 적다 보니 앱 전체에 모서리 25종·그림자 8종·
 * 회색 7종이 쌓였다. 화면 하나만 보면 멀쩡한데 넘길 때 카드 모서리가 12에서 13으로, 회색이
 * #616161 에서 #6e6e6e 로 미세하게 어긋난다 — 눈은 그걸 "정리 안 된 화면"으로 읽는다.
 * 아래로 모은다. 레이아웃은 하나도 안 바뀌고 값만 맞춘다.
 *
 * · 모서리 — 8px(버튼·배지) / 12px(카드) / 16px(시트) / full(알약·칩)
 * · 그림자 — 뜬 것 아래로 0 4 16 .12, 시트만 그 거울(위로). 얹힌 것(카드)은 테두리로 끝낸다.
 * · 회색 — 본문 #1f1f1f / 보조 #616161 / 흐림 #9e9e9e
 * · 주황 — 기본 #fc7f35 / 눌림 #ff6114 / 옅은 바탕 #fff0e6
 *
 * 남은 하나: StatusBar tone(#525252)은 모든 화면이 같이 쓰는 값이라 여기서만 못 바꾼다 —
 * 이 화면만 상태바 색이 달라지면 그게 더 어긋나 보인다. 화면 전체를 훑을 때 같이 옮긴다.
 */

/** 지도 띠 높이 (와이어프레임 PARK-01 의 Map/Placeholder 364). 목록을 내리면 그만큼 늘어난다. */
const MAP_H = 364;

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

  /** 요금 무료만. 카카오 쪽은 요금을 몰라 통째로 빠진다 — 모르는 곳을 무료라고 보여줄 수는 없다. */
  const [free, setFree] = useState(false);
  /**
   * 공영만. 공공데이터 1,657곳이 전부 공영이라, 이 칩은 곧 **카카오에서 온 곳을 빼는 것**이다.
   * lib 의 필터에 넣지 않고 여기서 목록을 안 섞는 걸로 끝낸다 — 출처를 가르는 일이지 조건이 아니다.
   */
  const [publicOnly, setPublicOnly] = useState(false);
  /** 지도에서 고른 한 곳. 카드가 이걸로 물들고, 핀도 이것만 커진다. */
  const [selected, setSelected] = useState<ParkingSpot | null>(null);
  /**
   * 목록을 아래로 내려 지도를 크게 보고 있는가.
   *
   * 기본 자리(지도 364px)가 와이어프레임이고, 손잡이는 거기서 **내려가는 쪽**으로만 움직인다.
   * 목록을 지도 위로 끌어올리게도 만들어 봤는데, 손잡이를 눌렀을 때 목록이 올라오는 건
   * 시트를 아는 사람의 예상과 반대였다 — 손잡이가 붙은 시트는 내리는 물건으로 읽힌다.
   * 목록을 더 보고 싶으면 목록 안에서 스크롤한다.
   */
  const [mapBig, setMapBig] = useState(false);

  // 카카오에서 받아온 주변 주차장. 굳혀두지 않고 화면에서만 들고 있는다 (lib/poi.ts 첫 주석).
  // 기준점이 목적지에 못 박혀 있어 한 번만 부르면 된다.
  const [pois, setPois] = useState<Lot[]>([]);
  useEffect(() => {
    if (!dest) return;
    // 실패해도 화면엔 알리지 않는다 — 공공데이터는 그대로 떠 있어서 목록이 비지 않고,
    // 여기서 오류 문구를 띄우면 사용자가 할 수 있는 일이 없는 경고만 하나 더 얹는 셈이다.
    findParkingNear(dest).then((r) => !("error" in r) && setPois(r.spots));
  }, [dest]);

  /**
   * 목록과 추천 한 곳.
   *
   * 두 출처를 같은 기준(목적지)으로 잰다 — 카카오 쪽 거리도 여기서 다시 계산된다.
   * mergeSpots 가 돌려주는 건 이미 가까운 순이라, 거리 정렬은 따로 할 일이 없다.
   *
   * **순서는 늘 가까운 순 하나다.** 전에는 "칸 많은 순" 칩이 있었는데 정렬이 아니라 몰래 필터였다 —
   * 카카오에서 온 곳은 spaces 가 null 이라(lib/poi.ts) 누르면 그쪽이 통째로 목록 바닥으로 가라앉았다.
   * 게다가 spaces 는 총 구획수지 지금 빈자리가 아니라, 순서로 쓰면 없는 약속을 하게 된다.
   * 칸이 넉넉하다는 정보는 순서를 흔들지 않고 카드 배지(SPACIOUS)로 준다.
   *
   * 고른 뒤에는 맨 위로 올린다. 45곳을 늘어놓고 고르라는 건 정보는 맞지만 결정을 통째로
   * 초보에게 떠넘긴다. 여기가 답하려는 질문은 "어디 대면 돼?"고, 대부분에게 그 답은
   * "칸에 맞춰 대는 곳 중 제일 가까운 데"다. 답을 주되 나머지 목록으로 막지는 않는다.
   */
  const { spots, recommended } = useMemo(() => {
    if (!dest) return { spots: [] as ParkingSpot[], recommended: null };
    const near = mergeSpots(
      spotsAround(dest, LOTS, { free }),
      publicOnly ? [] : spotsAround(dest, pois, { free }, POI_CAP),
    );
    /*
     * 직각주차로 판정된 곳이 하나도 없으면 **추천을 접는다.** 예전에는 그냥 가장 가까운 곳으로
     * 떨어뜨렸는데, 그러면 "추천"이 늘 붙어 있어 아무 뜻이 없어진다 — 카카오에서 온 곳만 있는
     * 동네(유형을 아예 모른다)나 전부 평행주차 추정인 동네가 실제로 있다.
     * 추천이 뜬다는 건 곧 이유가 있다는 뜻이어야 한다.
     */
    const rec = near.find(isEasyParking) ?? null;
    const rest = rec ? near.filter((s) => s !== rec) : near;
    return { spots: rec ? [rec, ...rest] : rest, recommended: rec };
  }, [dest, free, publicOnly, pois]);

  /*
   * 지도 핀을 눌렀다. 여기서 화면을 넘기지 않는다 — 핀 하나 눌렀을 뿐인데 다른 화면으로 튀면
   * 옆 주차장과 비교하려던 사람은 그 비교를 못 한다. 고른 곳을 목록에서 짚어주고, 갈지 말지는
   * 그 카드에서 정한다 (/around 와 같은 규칙).
   *
   * 지도는 안 옮긴다 — 눈에 보이는 핀을 눌렀는데 화면이 움직이면 방금 뭘 눌렀는지 놓친다.
   *
   * 대신 **목록을 기본 자리로 되올린다.** 지도를 크게 본 상태에서는 목록이 카드 한 장만 남기고
   * 내려가 있어서, 핀을 골라봐야 그 카드가 화면 밖이다 — 고른 결과를 볼 수 없으면 고른 게 아니다.
   * 올라온 뒤에는 아래 효과가 그 카드를 목록 안에서 끌어온다.
   *
   * **이미 고른 것을 또 누르면 풀린다.** 고른 카드는 펼쳐져서 자리를 크게 차지하는데, 전에는
   * 접는 길이 지도 빈 곳을 누르는 것(onBlank)뿐이라 목록만 보고 있던 사람에게는 길이 없었다.
   * 고르는 문과 접는 문이 같은 자리인 게 맞다 — 카드에서도 핀에서도 똑같이 동작한다.
   *
   * 돌려주는 값은 "골랐는가"다. 접은 것뿐이면 지도를 옮길 이유가 없어서 아래 focus 가 이걸 본다.
   */
  function highlight(spot: ParkingSpot) {
    const off = same(selected, spot);
    setSelected(off ? null : spot);
    // 접을 때는 지도 크기를 안 건드린다 — 크게 보던 사람이 카드 하나 접었다고 지도가 줄면 안 된다
    if (!off) setMapBig(false);
    return !off;
  }

  /*
   * 카드를 눌렀다 — **지도를 그 자리로 옮긴다.**
   *
   * 이름이 "이도이동 1053" 같은 번지인 곳이 공공데이터의 91%라, 카드만 봐서는 어딘지 알 수 없다.
   * 여기서 상세로 곧장 넘기면 "어딘지"를 확인할 기회가 아예 없어진다 — 지도에서 짚어주고,
   * 갈지 말지는 그 카드에 펼쳐지는 버튼으로 정한다.
   */
  const move = useRef<((at: LatLng) => void) | null>(null);
  function focus(spot: ParkingSpot) {
    // 고르는 규칙은 highlight 하나로 모은다 — 목록을 되올리는 일을 두 군데서 따로 하면 어긋난다
    if (highlight(spot)) move.current?.(spot.at);
  }

  /** 상세(PARK-02)로. 고른 카드에 펼쳐지는 버튼만 이 문을 연다. */
  /**
   * 상세를 건너뛰고 곧장 길 비교로. 상세 화면의 "이 주차장까지 경로보기"(detail/GoButton)와 같은 일을
   * 한 화면 앞에서 한다 — 대는 자리를 정한 사람에게 상세를 한 번 더 거치게 할 이유가 없다.
   * 길의 도착지는 관광지가 아니라 **차를 대는 자리**여야 소요시간이 실제로 운전하는 시간이 된다.
   */
  function go(spot: ParkingSpot) {
    const q = new URLSearchParams(searchParams);
    q.set("to", spot.name);
    q.set("toLat", String(spot.at[0]));
    q.set("toLng", String(spot.at[1]));
    router.push(`/route?${q}`);
  }

  function open(spot: ParkingSpot) {
    router.push(`/parking/detail?${detailQuery(spot, searchParams)}`);
  }

  /**
   * 시트가 시작하는 높이 = 지도 띠의 높이. 한 값을 둘이 나눠 써야 사이에 틈이 안 생긴다.
   *
   * 내리면 **화면 밖까지 통째로 내려간다** (100%). 전에는 손잡이·칩·카드 한 장을 남겼는데(PEEK),
   * 지도를 크게 보려고 내린 사람에게 그 남은 띠는 지도를 가리는 것 말고 하는 일이 없었다.
   * 되올리는 길은 지도 위에 뜨는 "목록 보기" 하나로 모은다 — 남은 띠가 그 문을 겸하던 자리다.
   */
  const sheetTop = mapBig ? "100%" : `${MAP_H}px`;

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

      {/*
        지도 띠. 와이어프레임은 364px 고정이고 그 아래는 목록 차지다 —
        지도를 더 키우면 첫 화면에 카드가 한 장도 안 들어온다.

        목적지 알약은 지도 위에 얹힌다. z 를 매기는 건 장식이 아니라 필수다 — 카카오가 지도
        안쪽에 z-index 를 박아서, 지도 상자에 쌓임 맥락이 없으면 그것들이 알약 위로 올라온다
        (/destination 이 같은 이유로 지도를 z-0 에 가둬 뒀다).
      */}
      <div className="relative min-h-0 flex-1">
        {/*
          지도 띠. **시트가 내려간 만큼 같이 늘어난다** — 높이를 364 로 못 박아 두면 시트만
          내려가고 그 사이가 흰 띠로 남는다 ("지도 크게"인데 지도가 안 커진다).
          늘어난 뒤 축척은 Map 안의 ResizeObserver 가 relayout 으로 다시 잡는다.

          z-0 이 지도 몫의 쌓임 맥락을 만든다 — 안쪽 알약의 z-10 이 여기 갇혀야 시트가 덮을 수 있다.
        */}
        <div
          style={{ height: sheetTop }}
          className="absolute inset-x-0 top-0 z-0 bg-[#f7f7f7] transition-[height] duration-200"
        >
          <Map
            pins={spots}
            selected={selected}
            onPick={highlight}
            /*
              지도 빈 곳을 눌렀다 = 지도를 보겠다는 뜻이다. 고른 것을 풀고 목록도 통째로 내린다 —
              전에는 선택만 풀려서, 지도를 보려고 누른 사람은 목록을 내리려고 손잡이를 또 찾아야 했다.
            */
            onBlank={() => {
              setSelected(null);
              setMapBig(true);
            }}
            move={move}
            start={dest ?? START}
            dest={dest}
          />
          {/*
            지도 위에 뜨는 알약 하나가 이 화면의 머리다 — 위에 있던 "목적지 주변 주차장" 앱바 줄을
            없앴다. 나가는 길(←)과 여기가 어디 주변인지(이름)와 무슨 화면인지(오른쪽 회색 글자)를
            한 줄이 다 말하는데, 그 위에 제목 줄을 또 두면 같은 말을 두 번 하면서 지도만 56px 잃는다.

            모양은 목적지 화면 검색바와 같다 (app/destination) — 높이 54 · 모서리 16 · 주황 테두리.
            같은 흐름에서 연달아 나오는 같은 자리라, 화면이 바뀌었다고 바 모양이 달라지면
            방금 보던 것과 지금 보는 것이 다른 물건처럼 보인다.
          */}
          <div className="absolute inset-x-4 top-3 z-10 flex h-[54px] items-center gap-[10px] rounded-[16px] border border-[#fc7f35] bg-white px-[14px] shadow-[0_3px_5px_0_rgba(0,0,0,0.07)]">
            <button
              onClick={() => router.push(`/destination?${searchParams}`)}
              aria-label="뒤로"
              className="-mx-1.5 shrink-0 rounded-full p-1.5 transition hover:bg-[#fff0e6] active:scale-90"
            >
              <img src="/icon-arrow-left.svg" alt="" className="size-6" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px] font-medium text-[#1f1f1f]">
              {destName ?? "목적지"}
            </span>
            <span className="shrink-0 text-[12px] leading-none text-[#9e9e9e]">주변 주차장</span>
          </div>

          {/*
            목록이 화면 밖으로 내려가 있을 때 되올리는 유일한 문이다 (손잡이가 같이 내려가서 없다).
            지도 아래 가운데에 둔다 — 시트가 올라오면 그 자리에서 시트가 시작하므로, 문과 문이
            열리는 자리가 같아 눌렀을 때 어디가 바뀌는지 눈으로 따라가진다.

            **검은 바탕이다.** 흰 알약이 더 예뻤지만 지도가 흰 바탕이라 흰 버튼이 묻혔다 —
            그림자만으로 버티는 버튼은 밝은 동네에서 사라진다.

            **글자만 있다.** 손잡이 바 한 줄도, 줄 세 개(☰)도 붙여봤는데 둘 다 뺐다 —
            "목록 보기" 네 글자가 이미 무슨 버튼인지 다 말하고 있어서, 아이콘은 같은 말을
            한 번 더 하면서 알약만 넓혔다.
          */}
          {mapBig && (
            <button
              onClick={() => setMapBig(false)}
              className="absolute bottom-5 left-1/2 z-10 flex h-[42px] -translate-x-1/2 items-center rounded-full bg-[#1f1f1f] px-6 text-[15px] leading-none font-medium text-white shadow-[0_4px_16px_0_rgba(0,0,0,0.28)] transition hover:bg-[#fc7f35] active:scale-95"
            >
              목록 보기
            </button>
          )}
        </div>

        {/*
          칩과 목록. 기본은 지도(364) 밑이고, 손잡이를 누르거나 지도 빈 곳을 누르면
          화면 밖까지 내려간다 (되올리는 문은 지도 위의 "목록 보기"다).

          overflow-hidden 이 있어야 내려갔을 때 안쪽이 안 삐져나온다 — top 이 100% 면 이 상자는
          높이가 0인데, 안의 칩·카드는 제 높이를 그대로 갖고 있어 그냥 두면 프레임 밖에 그려진다.

          top 을 style 로 주는 이유 — 값이 px 과 % 를 오가서 Tailwind 임의값으로는 한 클래스에 못 담는다.
          값은 위 sheetTop 하나이고 지도 띠가 같은 값을 높이로 쓴다.
        */}
        <div
          style={{ top: sheetTop }}
          className="absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-[16px] bg-white shadow-[0_-4px_16px_0_rgba(0,0,0,0.12)] transition-[top] duration-200"
        >
          {/*
            손잡이 (/destination·/route 시트와 같은 모양). 눌러서 목록을 내리고 다시 올린다 —
            실제로 끌리지는 않는다. 끌기까지 만들 값어치는 없고, 눌러서 되는 걸로 충분하다.

            보이는 막대는 4px 지만 누르는 자리는 18px 이다. 4px 짜리를 그대로 노리게 하면
            여는 방법을 못 찾는다 (지워진 SpotList 가 머리글을 두 번째 문으로 뒀던 이유와 같다).
          */}
          <button
            onClick={() => setMapBig((v) => !v)}
            aria-label={mapBig ? "목록 올리기" : "목록 내리고 지도 크게 보기"}
            aria-expanded={!mapBig}
            className="flex h-[18px] w-full shrink-0 items-center justify-center pt-2.5"
          >
            <span aria-hidden className="h-1 w-12 rounded-full bg-[#d6d6d6]" />
          </button>

          {/*
            칩 (와이어프레임 ChipRow 2153:1782) + 목록 보기.

            정렬 칩은 없앴다 (위 useMemo 주석). 목록은 늘 가까운 순이고, 여기 남은 둘은 켜고 끄는
            필터라 칩 모양과 뜻이 맞는다.

            켜짐 색은 주황이다. 와이어프레임의 Chip/Selected 와 Chip/Default 는 테두리 색만
            #e6e6e6 / #e5e5e5 로 달라 눈으로는 구분되지 않는데, 켜고 끄는 칩이 그러면 안 된다.
            같은 화면의 배지와 같은 주황을 쓴다.
          */}
          <div className="flex shrink-0 items-center gap-2 px-[15px] pt-[9px] pb-1">
            <Chip on={free} onClick={() => setFree((v) => !v)}>
              무료
            </Chip>
            <Chip on={publicOnly} onClick={() => setPublicOnly((v) => !v)}>
              공영
            </Chip>
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
                    recommended={s === recommended}
                    onSelect={() => focus(s)}
                    onOpen={() => open(s)}
                    onGo={() => go(s)}
                  />
                ))}
              </div>
            )}

            {/*
              출처와 기준일. 요금·구획수를 사실로 내놓으면서 언제 기준인지 안 밝히면,
              넉 달 전 요금을 오늘 값인 것처럼 보여주는 셈이 된다.
              목록 끝에 붙어 같이 스크롤된다 — 늘 보일 값어치는 없고, 끝까지 본 사람에게는 답이 된다.
            */}
              <p className="mx-4 mt-3 mb-6 text-[11px] leading-[16px] text-[#9e9e9e]">{SOURCE}</p>
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
  /*
    호버는 꺼진 칩에만 준다. 켜진 칩은 눌러도 지금 상태 그대로라 미리 보여줄 게 없고,
    주황을 한 톤 낮추면 빨강으로 읽혀 경고처럼 보인다.
  */
  const cls = `flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-[14px] leading-[22px] font-medium transition ${
    on ? "bg-[#fc7f35] text-white" : "border border-[#e5e5e5] bg-white text-[#1f1f1f] hover:bg-[#fff0e6]"
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
 *
 * 바깥이 div 인 이유 — 고른 카드에 상세 버튼이 하나 더 붙는데, 카드째 button 이면 버튼 안에
 * 버튼이 들어간다 (HTML 이 허용하지 않고, 안쪽 클릭이 바깥으로 샌다). 누르는 자리 둘을
 * 나란한 형제로 두면 클릭을 끊어줄 일도 없다.
 */
function SpotCard({
  spot,
  picked,
  recommended,
  onSelect,
  onOpen,
  onGo,
}: {
  spot: ParkingSpot;
  /** 지도에서 고른 그 곳인가. 테두리 굵기는 그대로 두고 색만 바꾼다 — 굵어지면 목록이 덜컹인다. */
  picked: boolean;
  /** 우리가 골라 맨 위에 올린 곳인가. "추천" 표시가 그때만 붙는다. */
  recommended: boolean;
  /** 카드 몸통 — 지도에서 그 자리를 보여준다. */
  onSelect: () => void;
  /** 고른 카드에만 펼쳐지는 버튼 — 상세로 간다. */
  onOpen: () => void;
  /** 상세를 건너뛰고 길 비교로 간다. */
  onGo: () => void;
}) {
  const type = typeBadge(spot);
  const kakao = spot.source === "카카오";

  return (
    <div
      data-picked={picked}
      /*
        고른 카드도 흰 바탕이다. 주황을 옅게 깔아 봤더니 그 위에 얹힌 주황 배지·주황 버튼이
        같은 색 위에 떠서 서로 안 갈렸다 — 고른 표시는 테두리 하나로 충분하다.
      */
      className={`overflow-hidden rounded-[12px] border bg-white transition ${
        picked ? "border-[#fc7f35]" : "border-[#e5e5e5]"
      }`}
    >
      <button
        onClick={onSelect}
        className={`block w-full text-left transition active:bg-black/[0.03] ${
          picked ? "px-[20px] pt-[20px] pb-[20px]" : "px-[15px] pt-[11px] pb-[14px]"
        }`}
      >
      {/*
        고른 카드는 펼쳐 놓는다. 목록에서는 한 줄에 이름·도보만 있으면 훑는 데 충분하지만,
        고르고 나면 그 한 곳을 정말 갈지 정하는 자리가 되므로 요금·규모까지 편다
        (다음 화면까지 가야 알 수 있던 값이다).
        접힌 카드는 그대로 한 줄이다 — 42장을 다 펴면 목록이 아니라 카드 더미가 된다.
      */}
      {picked ? (
        <>
          <span className="block text-[12px] leading-none font-bold text-[#ff6114]">
            {recommended ? "추천 주차장" : "선택한 주차장"}
          </span>
          <span className="mt-[9px] block text-[18px] leading-[26px] font-bold text-[#1f1f1f]">
            {spot.name}
          </span>
        </>
      ) : (
        <span className="flex h-[26px] items-center justify-between gap-3">
          {/* 추천 배지는 이름 앞이다 — 길 비교 카드(app/route)가 같은 자리에 같은 모양으로 둔다 */}
          <span className="flex min-w-0 items-center gap-1.5">
            {recommended && (
              <span className="shrink-0 rounded-[8px] bg-[#fff0e6] px-[6px] py-[3px] text-[11px] leading-none font-bold text-[#ff6114]">
                추천
              </span>
            )}
            <span className="min-w-0 truncate text-[14px] leading-[22px] font-medium text-[#1f1f1f]">
              {spot.name}
            </span>
          </span>
          <span className="shrink-0 text-[14px] leading-[22px] font-medium tabular-nums text-[#616161]">
            도보 {walkMinutes(spot.walkM)}분
          </span>
        </span>
      )}
      <span className={`flex items-center gap-1.5 ${picked ? "mt-[15px]" : "mt-1"}`}>
        {type && <Badge>{type}</Badge>}
        {/* 칸이 넉넉한 곳. 카카오는 spaces 를 모르니 애초에 안 붙는다 (SPACIOUS 주석) */}
        {(spot.spaces ?? 0) >= SPACIOUS && <Badge>큰 주차장</Badge>}
        {/* 공공데이터는 1,657곳이 전부 공영이라 출처가 곧 이 배지다 */}
        {!kakao && <Badge>공영</Badge>}
        {/*
          카카오에서 온 곳은 유형도 공영 여부도 몰라 위 둘이 다 빠진다. 그러면 배지가 하나도
          없는 카드가 되는데, 그건 "정보가 없다"가 아니라 "출처가 다르다"라서 그렇다고 적는다.
        */}
        {kakao && <Badge muted>카카오맵</Badge>}
      </span>
      </button>

      {/*
        고른 카드에만 펼쳐지는 다음 화면 문. 늘 붙여두면 45장에 같은 버튼이 45개라 목록이 아니라
        버튼 벽이 되고, 카드를 누르는 일(지도에서 짚기)과 자리를 다투게 된다.
      */}
      {picked && (
        /*
          둘로 갈랐다. 전에는 "이 주차장 자세히" 하나뿐이라, 여기 대기로 이미 정한 사람도 상세를
          거쳐야 길 비교로 갈 수 있었다 — 같은 뜻의 버튼을 두 번 누르는 길이었다.

          **값은 목적지 화면(app/destination)의 "출발 · 근처 주차장 보기" 짝을 그대로 따른다** —
          알약 모양 · 높이 40 · 사이 4 · medium · 흰 알약은 #e5e5e5 테두리, 주황 알약은 #ff7b33.
          같은 흐름에서 연달아 나오는 같은 성격의 버튼 짝이라, 화면이 바뀌었다고 모양이 달라지면
          방금 누른 것과 지금 누를 것이 다른 물건처럼 보인다.
        */
        <div className="mx-[20px] mb-[20px] flex gap-1">
          <button
            onClick={onOpen}
            className="h-10 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-4 text-[14px] leading-[22px] font-bold text-[#1f1f1f] transition hover:bg-[#fff0e6] active:scale-[0.98]"
          >
            자세히
          </button>
          <button
            onClick={onGo}
            className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            여기로 갈게요
          </button>
        </div>
      )}
    </div>
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

/*
  배지를 진한 주황 채움에서 **옅은 바탕 + 진한 글자**로 바꿨다.
  카드 한 장에 배지가 셋까지 붙는데(직각 주차·큰 주차장·공영) 전부 진한 주황이면 그 줄이
  카드에서 제일 센 것이 된다 — 정작 눌러야 할 주황 버튼과 무게가 같아진다.
  배지는 사실을 적는 자리지 누르는 자리가 아니라, 한 단계 물러나 있는 게 맞다.
*/
function Badge({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <span
      className={`flex h-6 shrink-0 items-center rounded-full px-[10px] text-[11px] leading-4 font-medium ${
        muted ? "bg-[#f2f2f2] text-[#9e9e9e]" : "bg-[#fff0e6] text-[#ff6114]"
      }`}
    >
      {children}
    </span>
  );
}

/** 주차장 핀. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다 (RouteMap 과 같은 방식). */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/*
 * 안 고른 주차장은 작고 흐리게, 고른 한 곳만 크고 진하게 (/around 의 탐나는전 핀과 같은 규칙).
 *
 * 전에는 40곳이 전부 44×34 흰 말풍선이라 서귀포 도심에서 스무 개가 서로를 가려 지도가 안 읽혔다.
 * 흐린 점으로 두면 어디에 몰려 있는지가 먼저 보이고, 짚은 하나만 앞으로 나온다.
 *
 * **안 고른 것은 납작하다.** 옅은 주황 채움 + 주황 테두리 + 주황 글자 — 색이 물러나 있어
 * 스무 개가 깔려도 지도를 안 덮는다. 여기에 입체를 주면 안 되는데, 스무 개가 다 볼록하면
 * 지도가 아니라 단추판이 된다.
 *
 * **고른 하나만 물방울 + 입체다.** 모양(동그라미 → 물방울)과 크기(26 → 40)만으로도 앞에 서는데,
 * 여기에 재질까지 얹어 확실히 갈라놓는다 — 앱의 다른 그림(귤이 캐릭터·마커)이 전부 점토 렌더라
 * 화면에서 겉돌지도 않는다. 입체는 세 겹이다:
 *   · 그러데이션 (위 #ffa96f → 아래 #e5601a) — 위에서 빛이 온다
 *   · 위쪽 흰 타원 (0.18) — 점토의 광택. 0.3 을 넘기면 빛이 아니라 흰 얼룩으로 읽힌다
 *   · 발밑 타원 — **접지 그림자**다. 도형 둘레를 흐리게 하는 드롭섀도(핀이 공중에 뜬 것처럼
 *     보여서 오래돼 보이던 그것)와는 다른 물건이고, 지도 위에 서 있는 것처럼 읽힌다
 *
 * 접지 그림자 때문에 물방울 그림이 52 → 58 로 6px 길어졌지만 **앵커는 그대로 (20,50)** 다.
 * 늘어난 6px 은 그림자 자리지 핀이 아니라서 가리키는 좌표가 안 움직인다.
 *
 * 그래서 **앵커가 서로 다르다**: 동그라미는 가운데(13,13), 물방울은 끝점(20,50)이 좌표에 앉는다.
 * 고르는 순간 핀이 위로 서는 것처럼 보이는데, 그게 맞다 — 둘 다 같은 점을 가리키고 있다.
 */
const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
     <circle cx="13" cy="13" r="9" fill="#ffe0cb" stroke="#fc7f35" stroke-width="1.5"/>
     <text x="13" y="17.5" font-family="system-ui,sans-serif" font-size="12" font-weight="700"
           fill="#fc7f35" text-anchor="middle">P</text>
   </svg>`,
);

const PIN_ON = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="58" viewBox="0 0 40 58">
     <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#ffa96f"/>
       <stop offset="0.55" stop-color="#fc7f35"/>
       <stop offset="1" stop-color="#e5601a"/>
     </linearGradient>
     <filter id="c" x="-70%" y="-200%" width="240%" height="500%">
       <feGaussianBlur stdDeviation="1.6"/>
     </filter>
     <ellipse cx="20" cy="53.5" rx="7.5" ry="2.4" fill="#7a3a10" opacity="0.3" filter="url(#c)"/>
     <path d="M20 2 C10.6 2 3 9.6 3 19 c0 12.4 17 30 17 30 s17-17.6 17-30 C37 9.6 29.4 2 20 2 z"
           fill="url(#g)" stroke="#fff" stroke-width="2.5"/>
     <ellipse cx="20" cy="11.5" rx="9.5" ry="6" fill="#fff" opacity="0.18"/>
     <text x="20" y="26" font-family="system-ui,sans-serif" font-size="19" font-weight="700"
           fill="#fff" text-anchor="middle">P</text>
   </svg>`,
);

/**
 * [폭, 높이, 앵커 x, 앵커 y] — 그림에서 **좌표에 앉을 점**을 직접 넘긴다.
 * 카카오 기본값("이미지 아래 가운데")에 맡기면 동그라미가 좌표 위로 반쯤 떠서 엉뚱한 데를 가리킨다.
 */
const PIN_SIZE = [26, 26, 13, 13] as const;
const PIN_ON_SIZE = [40, 58, 20, 50] as const;

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
  /** 지도를 밖에서 옮기는 손잡이. 목록 카드를 누르면 그 자리로 민다. */
  move: React.RefObject<((at: LatLng) => void) | null>;
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
function Map({ pins, selected, onPick, onBlank, move, start, dest }: MapProps) {
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

    move.current = (at) => m.panTo(new kakao.maps.LatLng(at[0], at[1]));

    // 컨테이너가 0폭인 동안 만들어지면 축척이 터진다 (RouteMap 과 같은 이유)
    const ro = new ResizeObserver(() => m.relayout());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, start, move]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h, ax, ay] = on ? PIN_ON_SIZE : PIN_SIZE;
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h), {
          offset: new kakao.maps.Point(ax, ay),
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
