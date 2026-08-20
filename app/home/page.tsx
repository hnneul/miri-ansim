"use client";

// 메인화면 — 최종 와이어프레임 "NEW 매인화면" (Figma 2759:2219).
// 같은 이름의 프레임이 캔버스에 둘 있다. 첫 칸이 혼잡도인 쪽(2759:2125)이 아니라 운전 TIP 인
// 이쪽이 최신이다 — 나머지는 두 벌이 같다.
// 온보딩(/onboarding)을 마치면 여기로 온다. 프로필은 URL 쿼리로 계속 나르고(lib/profile.ts),
// 검색바를 누르면 목적지 검색 화면(/destination)이 검색 패널을 편 채로 열린다.
//
// 이전 버전(HOME-00 v2)과 골격이 다르다. 히어로·프로모 카드가 빠지고 **지도가 화면의 중심**이다.
// 그래서 위치 권한을 검색을 누를 때가 아니라 화면에 들어오는 순간 묻는다 — 지도와 그 아래
// "현위치" 줄이 처음부터 뭔가를 보여줘야 하는 자리라서다. 거부당해도 화면은 그대로 돈다
// (지도는 제주시청을 보고, 검색은 그때 다시 묻는다).
//
// 세로 배치는 좌표가 아니라 흐름으로 쌓는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어
// 절대배치를 하면 그때 아래쪽이 프레임 밖으로 나간다 (app/page.tsx 첫 주석 참고).
// 이 화면은 1015px 라 어차피 스크롤된다 (.phone 이 overflow-y: auto, globals.css).

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import DemoNotice from "../DemoNotice";
import RouteMap, { type LatLng } from "../RouteMap";
import { characterOf, parseConcerns, parseProfile, toProfileQuery } from "@/lib/profile";
import { dotted, loadPhotos, loadRecords, type TripRecord } from "@/lib/record";
import { me } from "@/lib/me";
import { APP_FOOTER } from "@/lib/version";
import { hereNow } from "./actions";

/** 위치를 못 받았을 때 지도가 보는 곳. 제주시청이다 — 섬 한복판(한라산)보다 사람이 있는 자리다. */
const JEJU_CITY_HALL: LatLng = [33.4996, 126.5312];

/**
 * 내 위치 점 — 파란 점 + 옅은 후광이 한 장에 들어 있다 (public/home/my-location.svg).
 * 와이어프레임은 후광과 점을 따로 뒀지만 중심이 같아서, 마커 두 개로 나누면 지도가 흔들릴 때
 * 둘이 따로 논다. 한 장이면 그럴 일이 없다.
 */
const MY_LOCATION = { src: "/home/my-location.svg", size: [44, 44] as [number, number] };

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const profile = parseProfile(query);

  const [here, setHere] = useState<LatLng | null>(null);
  /**
   * 위치를 못 받은 사유. 지도 밑 "현위치" 줄이 이걸로 갈린다 ("위치를 확인할 수 없어요").
   * 검색바 밑 빨간 줄은 없앴다 — 검색이 위치를 안 기다리게 되면서 거기서 할 말이 없어졌다.
   */
  const [geoError, setGeoError] = useState<string | null>(null);
  /** 지금 선 동네 ("제주시 아라이동"). 번지는 일부러 안 받는다 — 이유는 lib/geocode.ts areaAt 주석에. */
  const [area, setArea] = useState<string | null>(null);
  const [sky, setSky] = useState<string | null>(null);
  /** 여행 기록 칸. 서버에서 익숙함 티어 버킷을 읽어온다 (lib/record.ts loadRecords) — 실패하면 빈 배열이라 ＋ 칸만 남는다. */
  const [records, setRecords] = useState<TripRecord[]>([]);

  // 지도 오른쪽 위 버튼도 같은 걸 다시 부른다 — 권한을 뒤늦게 허용한 사람이 쓸 문 하나는 있어야 한다.
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return setGeoError("이 브라우저는 위치 확인을 지원하지 않습니다");

    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const at: LatLng = [coords.latitude, coords.longitude];
        setHere(at);
        // 동네 이름·날씨는 서버를 거친다 (./actions.ts). 실패하면 각자 null 이라 그 조각만 안 그려진다.
        hereNow(...at).then((now) => {
          setArea(now.area);
          setSky(now.sky);
        });
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요."
            : "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  useEffect(locate, [locate]);

  // 기록 목록 화면(TRIP-09)과 같은 버킷을 읽는다 — 거기서 저장한 기록이 여기 위에 뜬다.
  // me() 는 localStorage 를 보므로 **effect 안에서** 부른다 (서버에는 그 저장소가 없다).
  useEffect(() => {
    let 살아있나 = true;
    loadRecords(me()).then((rs) => 살아있나 && setRecords(rs));
    return () => {
      살아있나 = false; // 늦게 온 옛 응답이 새 목록을 덮지 않게
    };
  }, []);

  /**
   * 검색바를 누르면 목적지 검색 화면을 연다 (수정 HOME-01 a).
   *
   * **여기서는 글자를 안 받는다.** 예전에는 이 칸에 직접 적고 돋보기를 눌러 넘겼는데, 그러면
   * 최근 검색어도 후보 목록도 없는 칸에 오타 없이 한 번에 적어야 했다. 적는 자리는 그 화면 하나로
   * 모으고 여기는 문만 한다 — 지도·목록 앱들이 다 그렇게 하는 이유이기도 하다.
   *
   * 현재 위치는 있으면 싣고, 없으면 안 싣는다. 예전처럼 막지 않는다 — 검색 목록을 여는 데는
   * 출발지가 필요 없고, 없으면 그 다음 화면들이 각자 다시 묻는다 (길 비교의 geolocation).
   * 검색을 눌렀는데 "위치 확인 중이에요"로 막히는 게 기다리게 할 값어치가 없었다.
   */
  function openSearch() {
    /*
     * 쿼리를 **다시 짓는다.** 여기 URL 을 통째로 복사하면 안 된다 — 목적지 화면에서 뒤로 나오면
     * 그 화면 쿼리가 프로필과 함께 여기까지 따라오고(dest·destLat·to…), 그걸 그대로 실어 보내면
     * 도착하자마자 자동 검색이 돌아 **검색창 대신 지난번 목적지 시트가 뜬다.**
     * 새로 찾으러 가는 길이니 프로필과 부담 유형만 남긴다.
     */
    const q = new URLSearchParams(toProfileQuery(profile, parseConcerns(query)));
    if (here) {
      q.set("originLat", String(here[0]));
      q.set("originLng", String(here[1]));
    }
    q.set("search", "1"); // 그 화면이 검색 패널을 편 채로 열린다
    router.push(`/destination?${q}`);
  }

  return (
    <div className="flex flex-1 flex-col bg-white pb-[18px]">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        brand/my page — 워드마크와 마이 화면 입구.
        아바타는 익숙함 티어마다 갈린다 (lib/profile.ts characterOf). 누르면 열리는 마이 화면(app/profile)이
        같은 그림을 크게 다시 보여주므로, 여기서 다른 얼굴이 뜨면 그 버튼이 내 프로필로 가는 입구로 안 읽힌다.
      */}
      <div className="flex h-[62px] shrink-0 items-center justify-between pr-5 pl-[29px]">
        <h1 className="text-[18px] leading-none font-bold text-[#1f1f1f]">미리 안심</h1>
        {/* 쿼리를 그대로 넘겨야 마이 화면에서 프로필을 되읽는다 (lib/profile.ts) */}
        <button
          onClick={() => router.push(`/profile?${searchParams}`)}
          aria-label="마이 화면"
          /*
            여기는 옅은 주황 바탕(빠르게 둘러보기 칸)을 못 쓴다 — 그림이 원을 꽉 채워서 바탕이 안 보인다.
            대신 원 밖에 테두리를 두른다. 쉬고 있을 때는 테두리가 아예 없어서, 얇아도 생겼다는 게 보인다.
          */
          className="size-[44px] shrink-0 overflow-hidden rounded-full transition hover:ring-2 hover:ring-[#fc7f35] active:scale-95"
        >
          {/* 배경까지 그려진 정사각 그림이라 그대로 원을 채운다 (마이 화면 94px 아바타와 같은 파일) */}
          <img src={characterOf(profile.experienceYears).src} alt="" className="size-full object-cover" />
        </button>
      </div>

      {/*
        destination-search — 흰 바탕에 주황 테두리. 이 화면에서 유일하게 색이 있는 테두리라 여기가 입구인 게 보인다.

        **입력칸이 아니라 버튼이다.** 생김새는 검색칸이지만 누르면 목적지 검색 화면이 열린다
        (openSearch). 적는 자리를 두 곳에 두지 않으려는 것이다 — 여기 적으면 최근 검색어도
        후보도 없이 한 번에 맞혀야 했다.

        **색은 누를 때만 나온다** (hover 아니고 active). 커서를 얹기만 해도 물들게 했더니
        54px 짜리 바가 통째로 켜져서 이 화면에서 제일 큰 색 덩어리가 됐다 — 눌러야 할 곳을
        알려주는 게 아니라 지나갈 때마다 켜졌다 꺼졌다 했다.
        누르는 순간에만 옅은 주황이 깔리면 "눌렸다"는 대답으로 읽히고, 그건 한 번뿐이다.
      */}
      <button
        onClick={openSearch}
        className="mx-[15px] flex h-[54px] shrink-0 items-center gap-2 rounded-[16px] border border-[#fc7f35] bg-white pr-6 pl-[14px] text-left shadow-[0_3px_5px_0_rgba(0,0,0,0.07)] transition active:scale-[0.99] active:bg-[#fff0e6]"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] text-[#7d7d7d]">
          가고 싶은 제주 장소를 검색해요
        </span>
        <img src="/home/icon-search.svg" alt="" aria-hidden className="h-[18px] w-[17px] shrink-0" />
      </button>

      {/*
        Hero / Character Journey. 높이가 166 으로 고정이라 안쪽은 절대배치를 쓴다 —
        캐릭터가 오른쪽 화면 밖으로 7px 걸쳐 나가는 게 와이어프레임의 모양이고, 흐름 배치로는
        그 걸침을 만들 수 없다. 바깥 상자 높이가 고정이니 프레임이 줄어도 안이 밀려나지 않는다.
      */}
      <div className="relative mt-2 h-[166px] shrink-0 overflow-hidden">
        <img
          src="/character/home-hero.png"
          alt=""
          className="absolute top-0 -right-[7px] h-[160px] w-[202px] object-cover"
        />
        <p className="absolute top-[46px] left-[33px] text-[12px] leading-none font-bold text-[#ff6114]">
          출발 전 알고 가는 안심 길
        </p>
        <p className="absolute top-[74px] left-[33px] text-[21px] leading-[25px] font-bold text-[#1f1f1f]">
          오늘 제주,
          <br />
          어디로 떠나볼까요?
        </p>
      </div>

      {/*
        map-card — 좌우를 꽉 채운다 (와이어프레임도 프레임 밖으로 넘겨 그렸다).
        지도 208 + 흰 현위치 줄 52 = 260.
      */}
      <div className="mt-[7px] shrink-0">
        <div className="relative h-[208px] w-full">
          <RouteMap
            center={here ?? JEJU_CITY_HALL}
            level={4}
            routes={[]}
            markers={here ? [{ coord: here, label: "현위치", icon: MY_LOCATION }] : []}
            className=""
            /*
              화면 한가운데 208px 짜리 미리보기다 — 지도가 스크롤 제스처를 먹으면 안 된다.
              데스크톱은 휠(wheelZoom), 폰은 끌기(interactive)가 그 자리를 먹는다. 둘 다 끈다.
              여기는 마커도 빈 곳도 누를 일이 없어서 지도를 손짓에서 통째로 빼도 잃는 게 없다.
              확대는 ＋/－ 버튼으로만 (zoomButtons).
            */
            wheelZoom={false}
            interactive={false}
            zoomButtons
          />

          {/*
            지도 위에 얹히는 것들은 z-10 이 필요하다. 카카오 SDK 가 지도 안에 z-index 를 매긴 층을
            여러 겹 깔고, RouteMap 의 바깥 상자는 position:relative + z-auto 라 쌓임 맥락을 만들지 않는다 —
            그래서 그 층들이 이 형제 요소들 위로 올라온다. 실제로 칩과 버튼이 지도 막에 덮여 흐릿했다.
          */}

          {/* today-condition — 날씨를 못 받으면 칩째 안 그린다 (lib/weather.ts 가 null 을 준다) */}
          {sky && (
            <div className="pointer-events-none absolute top-[12px] left-[33px] z-10 flex h-[28px] items-center gap-[6px] rounded-[14px] bg-white px-[12px] shadow-[0_1px_4px_0_rgba(0,0,0,0.1)]">
              <span aria-hidden className="size-[6px] rounded-full bg-[#fc7f35]" />
              <span className="text-[11px] leading-none font-medium whitespace-nowrap text-[#1f1f1f]">{sky}</span>
            </div>
          )}

          {/*
            그림 파일의 상자는 44 지만 눈에 보이는 동그라미는 그 안 36 이다 (나머지는 그림자 여백).
            상자를 36 으로 줄이면 버튼이 29px 로 쪼그라든다 — 44 로 두고 여백만큼 밀어 자리를 맞춘다.

            그래서 호버도 배경색이 아니라 **그림째 살짝 어둡게**다. 흰 원이 그림 안에 있어서
            버튼에 bg 를 깔면 원이 아니라 44 짜리 네모가 뜬다. brightness-95 면 원만 옅은 회색이
            되고, 줌 버튼의 hover:bg-[#f5f5f5] 와 같은 정도로 보인다 (app/RouteMap.tsx).
          */}
          <button
            onClick={locate}
            aria-label="현재 위치로"
            className="absolute top-[9px] right-[30px] z-10 size-[44px] transition hover:brightness-95 active:scale-90"
          >
            <img src="/home/btn-locate.svg" alt="" className="size-full" />
          </button>
        </div>

        {/* 현위치 줄. 동네를 못 받으면 오른쪽만 비운다 — "현위치" 라벨까지 사라지면 지도 밑이 잘린 것처럼 보인다 */}
        <div className="flex h-[52px] items-center justify-between border-t border-[#ededed] bg-white pr-6 pl-10">
          <span className="text-[13px] text-[#090808]">현위치</span>
          <span className="truncate pl-4 text-[13px] font-medium text-[#9e9e9e]">
            {area ?? (geoError ? "위치를 확인할 수 없어요" : "위치 확인 중…")}
          </span>
        </div>

        <DemoNotice />
      </div>

      <h2 className="mt-[13px] shrink-0 pl-[23px] text-[18px] leading-[22px] font-bold text-[#1f1f1f]">
        빠르게 둘러보기
      </h2>

      {/*
        빠르게 둘러보기 4칸. 갈 화면이 없는 칸은 흐리게 두고 못 누르게 막는다 —
        눌리는데 아무 일도 없으면 시연에서 더 나쁘다.

        첫 칸이 "대표 관광지"다. 와이어프레임(2759:2125)의 혼잡도 자리인데, 혼잡도 자체는
        만들지 않았다 — 제주ITS 로 재 보니 간선이 하루 종일 제한속도의 77~104% 로 흘러서
        화면이 1년 내내 원활이 된다. 대신 같은 실시간 값을 관광지에 붙였다: 지금 소요시간과
        정체를 재고, 거기에 **프로필별 운전 부담**을 얹어 줄 세운다 (app/nearby/page.tsx).
        혼잡도로 관광지를 세우는 건 지도 앱도 하지만, 초보 기준으로 세우는 건 이 앱뿐이다.

        sub 가 "운전 편한 순"인 이유 — "지금 편한 순"으로 뒀더니 무엇이 편한지 안 읽혔다.
        가기 편한 건지 주차가 편한 건지 모른다. 이 앱이 재는 건 운전이라 그걸 밝힌다.

        **여기서 카카오를 부르지 않는다.** 1등 관광지 이름을 실어 보이려면 홈을 열 때마다
        길찾기를 10건 써야 하는데(무료 쿼터 일 10,000건), 도로명 하나 때문에 홈이 느려지고
        쿼터가 샌다. 실시간 값은 칸을 눌러 들어가서 본다.

        운전 TIP 은 팁 화면이 생기면 quick-tip.png 로 되돌리면 된다.
      */}
      <div className="mt-[10px] flex shrink-0 gap-[10px] pl-[23px]">
        {/*
          href 를 다시 붙였다. 뗐던 이유는 카카오 길찾기 쿼터였는데(후보 열 곳까지 각각 조회 —
          lib/spots.ts BANDS 2+4+4 로 화면 한 번에 10건), 이 칸이 /nearby 로 가는 유일한 문이라
          막아 두면 화면이 있어도 아무도 못 본다. 무료 쿼터가 일 10,000건이라 하루 1,000번 열어야
          닿는다 — 홈을 열 때마다가 아니라 이 칸을 눌렀을 때만 나가므로 그 전 걱정과도 다르다.

          아이콘은 혼잡도 시절의 사람 셋(quick-traffic.png)에서 섬으로 바꿨다 (Figma 4209:2018).
          이 칸이 세는 건 길이 아니라 갈 곳이라, 관광지 그림이 라벨과 같은 말을 한다.
          quick-traffic.png 는 남겨 뒀다 — 혼잡도 칸이 생기면 그 자리로 돌아간다.
        */}
        <Quick
          icon="/home/quick-spot.png"
          iconClass="size-[35px]"
          label="대표 관광지"
          sub="운전 편한 순"
          href={`/nearby?${searchParams}`}
        />
        <Quick
          icon="/home/quick-tamna.png"
          iconClass="h-[28px] w-[34px]"
          label="탐나는전"
          sub="캐시백 매장"
          href={`/around?${searchParams}`}
        />
        <Quick
          icon="/home/quick-record.png"
          iconClass="size-[32px]"
          label="주행 저장"
          /*
            "글쓰러 가기"였는데 /safelog 에는 쓸 자리가 없다 — 그 화면에서 사람이 할 수 있는 건
            빼기(✕)와 나만의 길로 담기 둘뿐이고, 담기는 길 안내로 넘어갈 때 저절로 된다
            (app/safelog/page.tsx 첫 주석). 글 쓰는 곳은 여행 기록(/trip/record)이고
            홈에서는 아래 "여행 기록 ＋" 칸이 그리로 간다.
          */
          sub="달린 길 보기"
          href={`/safelog?${searchParams}`}
        />
        <Quick
          icon="/home/quick-course.png"
          iconClass="size-[34px]"
          label="여행 코스"
          sub="AI 맞춤 추천"
          href={`/trip?${searchParams}`}
        />
      </div>

      <h2 className="mt-[17px] shrink-0 pl-[22px] text-[18px] leading-[22px] font-bold text-[#1f1f1f]">여행 기록</h2>

      {/*
        실제로 저장한 기록이 최신순으로 뜬다 (서버 버킷, lib/record.ts). 목업 카드는 없앴다 —
        가짜 기록 한 장이 내가 쓴 기록과 같은 자리에 섞이면 어느 쪽이 진짜인지 구분이 안 된다.
        두 장까지만 보여준다. 나머지는 ＋ 칸으로 들어가는 목록(TRIP-09)의 몫이다.
      */}
      <div className="mt-[14px] flex shrink-0 flex-col gap-[10px] px-[21px]">
        {records.slice(0, 2).map((r) => (
          /* 카드를 누르면 **그 기록의 상세**로 (open=<id>). ＋ 칸은 바로 쓰는 화면으로 */
          <Record key={r.id} record={r} href={`/trip/record?${searchParams}&open=${r.id}`} />
        ))}
        {/* ＋ 는 "쓴다"는 표시다 — 목록으로 보내면 한 번 더 누르게 된다 (write=1, app/trip/record) */}
        <Link
          href={`/trip/record?${searchParams}&write=1`}
          aria-label="여행 기록하기"
          className="grid h-[84px] shrink-0 place-items-center rounded-[11px] bg-[#f0f0f0] transition hover:bg-[#e5e5e5] active:scale-[0.99]"
        >
          <img src="/home/icon-add.svg" alt="" className="size-[40px]" />
        </Link>
      </div>

      <p className="mt-[17px] shrink-0 text-center text-[11px] leading-none font-medium text-[#616161]">
        {APP_FOOTER}
      </p>
    </div>
  );
}

/**
 * 빠르게 둘러보기 한 칸. href 가 없으면 흐리게 죽은 칸이 된다.
 * 아이콘은 그림마다 원본 비율이 달라(39x39 · 34x28 · 34x34 · 32x32) 크기를 칸마다 받는다 —
 * 한 상자에 object-contain 으로 우겨넣으면 가로로 넓은 동전(탐나는전)만 혼자 커진다.
 */
function Quick({
  icon,
  iconClass,
  label,
  sub,
  href,
}: {
  icon: string;
  iconClass: string;
  label: string;
  sub: string;
  href?: string;
}) {
  const box = "flex h-[96px] w-[78px] shrink-0 flex-col items-center rounded-[16px] border border-[#e5e0db] bg-white pt-[6px]";
  const inner = (
    <>
      {/* 39px 짜리는 이 띠를 살짝 넘는다 — 와이어프레임에서도 아이콘이 글자 위로 조금 겹친다 */}
      <span className="flex h-[36px] shrink-0 items-center justify-center">
        <img src={icon} alt="" className={`${iconClass} object-contain`} />
      </span>
      <span className="text-[13px] leading-[19px] font-medium text-[#1f1f1f]">{label}</span>
      <span className="mt-[4px] text-[9px] leading-[13px] text-[#707070]">{sub}</span>
    </>
  );
  /*
    호버는 살아 있는 칸에만 붙인다 — 흐린 칸에 붙으면 커서를 올렸을 때 눌리는 것처럼 보인다.
    폰에서는 아무 일도 안 일어나는 게 맞다 (누르는 느낌은 active:scale 이 맡는다). Tailwind v4 는
    hover: 를 @media (hover: hover) 로 감싸 주므로, 탭한 뒤 상태가 눌어붙는 일은 없다.

    테두리 색이 아니라 바탕에 옅은 주황을 깐다. 테두리 #fc7f35 는 이 앱에서 "지금 입력 중"을
    뜻하는 색이라(검색바) 커서만 얹은 칸에 쓰면 그 뜻이 흐려지고, 1px 은 78px 칸에서 너무 얇다.
    #fff0e6 은 이미 23군데 쓰는 집 색이라 새 색을 만들지 않는다.
  */
  return href ? (
    <Link href={href} className={`${box} transition hover:bg-[#fff0e6] active:scale-[0.96]`}>
      {inner}
    </Link>
  ) : (
    <div className={`${box} opacity-40`} aria-disabled>
      {inner}
    </div>
  );
}

/**
 * 여행 기록 카드.
 *
 * 글자 크기는 와이어프레임(9.06px / 6.04px)을 그대로 옮기지 않고 13/10 으로 올렸다 —
 * 저 값은 디자인에서 2배 크기 컴포넌트를 축소해 붙이며 딸려온 숫자로 보이고, 실제 390px 화면에서는
 * 읽히지 않는다. 사진 대신 옅은 주황 바탕이다 — 기록에 아직 사진 칸이 없다 (기록 목록의 썸네일 자리와 같다).
 */
function Record({ record, href }: { record: TripRecord; href: string }) {
  /*
    첫 사진을 카드에 깐다 — 기록 상세의 히어로와 같은 장이라, 홈에서 본 카드와 열어본 화면이 이어진다.
    사진은 **기기에만** 있어서(lib/record.ts) 다른 기기에서는 없다. 그때는 옅은 주황 카드로 돌아간다 —
    빈 회색 상자를 두면 사진을 못 불러온 것처럼 보인다.

    localStorage 는 첫 그림 뒤에 읽는다 (렌더 중에 읽으면 서버가 그린 화면과 달라져 하이드레이션이 어긋난다).
  */
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => setShot(loadPhotos(record.id)[0] ?? null), [record.id]);

  const 아래 = `${record.course} · ${record.places.length}곳${record.km > 0 ? ` · ${record.km}km` : ""}`;

  return (
    <Link
      href={href}
      className="relative block h-[84px] overflow-hidden rounded-[11px] bg-[#fff0e6] transition active:scale-[0.98]"
    >
      {shot && (
        <>
          <img src={shot} alt="" className="absolute inset-0 size-full object-cover" />
          {/* 사진 위 흰 글씨라 어둠막을 깐다 — 밝은 하늘 사진이 오면 글자가 사라진다 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-black/10" />
        </>
      )}
      <div className="relative px-[14px] py-[13px]">
        <p className={`text-[10px] leading-none ${shot ? "text-white/80" : "text-[#7d7d7d]"}`}>{dotted(record.date)}</p>
        <p className={`mt-[8px] truncate text-[13px] leading-none font-bold ${shot ? "text-white" : "text-[#1f1f1f]"}`}>
          {record.title}
        </p>
        <p className={`mt-[8px] truncate text-[10px] leading-none ${shot ? "text-white/85" : "text-[#7d7d7d]"}`}>
          {아래}
        </p>
      </div>
    </Link>
  );
}
