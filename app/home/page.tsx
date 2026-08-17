"use client";

// 메인화면 — 최종 와이어프레임 "NEW 매인화면" (Figma 2759:2219).
// 같은 이름의 프레임이 캔버스에 둘 있다. 첫 칸이 혼잡도인 쪽(2759:2125)이 아니라 운전 TIP 인
// 이쪽이 최신이다 — 나머지는 두 벌이 같다.
// 온보딩(/onboarding)을 마치면 여기로 온다. 프로필은 URL 쿼리로 계속 나르고(lib/profile.ts),
// 목적지를 검색하면 그대로 /destination 으로 넘긴다.
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
import RouteMap, { type LatLng } from "../RouteMap";
import { parseProfile, toCustomQuery } from "@/lib/profile";
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
  const profile = parseProfile(Object.fromEntries(searchParams));

  const [destination, setDestination] = useState("");
  const [here, setHere] = useState<LatLng | null>(null);
  /** 위치를 못 받은 사유. 검색을 눌렀을 때 이걸 그대로 보여준다 — 고칠 방법이 여기 적혀 있다. */
  const [geoError, setGeoError] = useState<string | null>(null);
  /** 지금 선 동네 ("제주시 아라이동"). 번지는 일부러 안 받는다 — 이유는 lib/geocode.ts areaAt 주석에. */
  const [area, setArea] = useState<string | null>(null);
  const [sky, setSky] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // 출발지(현재 위치)를 붙여 목적지 입력 화면(/destination)으로 넘긴다.
  // 거기서 지오코딩해 지도에 찍으므로 여기서는 적은 글자를 그대로 실어 보내면 된다.
  function search(e: React.FormEvent) {
    e.preventDefault();
    if (!destination.trim()) return setError("목적지를 입력해주세요");
    // 화면에 들어올 때 이미 물었다. 아직 없으면 사유가 있거나(권한 거부) 응답을 기다리는 중이다.
    if (!here) return setError(geoError ?? "현재 위치를 확인하는 중이에요. 잠시 후 다시 눌러주세요.");

    setError(null);
    router.push(`/destination${toCustomQuery(profile, here, destination.trim())}`);
  }

  return (
    <div className="flex flex-1 flex-col bg-white pb-[18px]">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        brand/my page — 워드마크와 마이 화면 입구.
        아바타는 와이어프레임에 박힌 그림 한 장이다 (avatar-my). 이전 버전은 경력에 따라 캐릭터가
        갈렸지만(lib/profile.ts characterOf) 여기서는 누구에게나 같은 그림이다 — 프로필을 바꿔도
        아바타는 안 바뀐다. 되살리려면 src 를 characterOf(profile.experienceYears).src 로 되돌리면 된다.
      */}
      <div className="flex h-[62px] shrink-0 items-center justify-between pr-5 pl-[29px]">
        <p className="text-[18px] leading-none font-bold text-[#1f1f1f]">미리 안심</p>
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
          {/* 원본이 세로로 긴 장면(1086x1448)이라 가운데를 정사각형으로 잘라 넣어뒀다 — 여기서는 그대로 채운다 */}
          <img src="/character/avatar-my.png" alt="" className="size-full object-cover" />
        </button>
      </div>

      {/* destination-search — 흰 바탕에 주황 테두리. 이 화면에서 유일하게 색이 있는 테두리라 여기가 입구인 게 보인다 */}
      <form
        onSubmit={search}
        className="mx-[15px] flex h-[54px] shrink-0 items-center gap-2 rounded-[16px] border border-[#fc7f35] bg-white pr-6 pl-[14px] shadow-[0_3px_5px_0_rgba(0,0,0,0.07)]"
      >
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="가고 싶은 제주 장소를 검색해요"
          aria-label="목적지"
          className="min-w-0 flex-1 text-[15px] text-[#1f1f1f] outline-none placeholder:text-[#7d7d7d]"
        />
        <button type="submit" aria-label="검색" className="shrink-0 transition active:scale-90">
          <img src="/home/icon-search.svg" alt="" className="h-[18px] w-[17px]" />
        </button>
      </form>

      {error && <p className="mt-2 shrink-0 px-[15px] text-[12px] text-rose-600">{error}</p>}

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
          */}
          <button
            onClick={locate}
            aria-label="현재 위치로"
            className="absolute top-[9px] right-[30px] z-10 size-[44px] transition active:scale-90"
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
      </div>

      <h2 className="mt-[13px] shrink-0 pl-[23px] text-[18px] leading-[22px] font-bold text-[#1f1f1f]">
        빠르게 둘러보기
      </h2>

      {/*
        빠르게 둘러보기 4칸. 갈 화면이 없는 칸은 흐리게 두고 못 누르게 막는다 —
        눌리는데 아무 일도 없으면 시연에서 더 나쁘다.

        첫 칸이 혼잡도에서 운전 TIP 으로 바뀌었다 (와이어프레임 2759:2219). 혼잡도는 실시간 도로
        API 승인을 기다리는 중이라 화면이 없고, 팁은 만들 화면이 정해져 있다 —
        둘 다 아직 흐린 칸이지만 나올 순서가 다르다. 되살리려면 quick-traffic.png 가 그대로 있다.
      */}
      <div className="mt-[10px] flex shrink-0 gap-[10px] pl-[23px]">
        <Quick icon="/home/quick-tip.png" iconClass="size-[35px]" label="운전 TIP" sub="초보운전자" />
        <Quick
          icon="/home/quick-record.png"
          iconClass="size-[32px]"
          label="주행 저장"
          sub="글쓰러 가기"
        />
        <Quick
          icon="/home/quick-tamna.png"
          iconClass="h-[28px] w-[34px]"
          label="탐나는전"
          sub="캐시백 매장"
          href={`/around?${searchParams}`}
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
        와이어프레임이 두 장을 채워 보여주던 걸 한 장 + ＋ 칸으로 줄였다 — 가짜 기록을 두 장
        쌓아두는 것보다, 한 장으로 어떻게 보이는지만 알려주는 편이 정직하다.
        record-1.png 는 되살릴 때를 위해 남겨뒀다.
      */}
      <div className="mt-[14px] flex shrink-0 flex-col gap-[10px] px-[21px]">
        <Record photo="/home/record-2.png" title="중문 나들이" count={23} />
        {/*
          ＋ 칸은 기록 목록(TRIP-09)으로 들어가는 문이다. 요약 쿼리를 안 붙여야 완료 화면(TRIP-08)을
          건너뛰고 목록부터 뜬다 — 완료 화면은 방금 다녀온 코스가 있을 때만 나오는 자리다
          (app/trip/record/page.tsx 첫 주석). 프로필 쿼리는 그대로 물려 보낸다.
        */}
        <Link
          href={`/trip/record?${searchParams}`}
          aria-label="여행 기록 보기"
          className="grid h-[84px] shrink-0 place-items-center rounded-[11px] bg-[#f0f0f0] transition active:scale-[0.99]"
        >
          <img src="/home/icon-add.svg" alt="" className="size-[40px]" />
        </Link>
      </div>

      <p className="mt-[17px] shrink-0 text-center text-[11px] leading-none font-medium text-[#616161]">
        미리 안심 · 앱 버전 1.0.0
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
 * 읽히지 않는다. 사진 위 흰 글씨라 아래쪽 어둠막도 함께 깐다 (밝은 하늘 사진이 오면 글자가 사라진다).
 */
function Record({ photo, title, count, href }: { photo: string; title: string; count: number; href?: string }) {
  const inner = (
    <>
      <img src={photo} alt="" className="size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
      <div className="absolute bottom-[10px] left-[14px] flex items-baseline gap-[8px]">
        <span className="text-[13px] leading-none font-bold text-white">{title}</span>
        <span className="text-[10px] leading-none text-[#e6e6e6]">사진 {count}장</span>
      </div>
    </>
  );
  const box = "relative block h-[84px] overflow-hidden rounded-[11px]";
  return href ? (
    <Link href={href} className={`${box} transition active:scale-[0.98]`}>
      {inner}
    </Link>
  ) : (
    <div className={box}>{inner}</div>
  );
}
