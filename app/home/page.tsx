"use client";

// 메인화면 — 최종 와이어프레임 HOME-00 | 제주 안심 메인 v2.
// 온보딩(/onboarding)을 마치면 여기로 온다. 프로필은 URL 쿼리로 계속 나르고(lib/profile.ts),
// 목적지를 검색하면 그대로 /result 로 넘긴다.
//
// 출발지는 묻지 않고 현재 위치를 쓴다 — 와이어프레임의 "목적지 -> 출발 선택" 화면이 아직 없어서다.
// ponytail: 출발지를 직접 고르려면 그 화면(Figma 2173:1932)을 만들고 여기서 목적지만 넘기면 된다.

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { parseProfile, characterOf, toCustomQuery } from "@/lib/profile";

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
  const me = characterOf(profile.experienceYears);
  const [destination, setDestination] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 출발지(현재 위치)를 붙여 목적지 입력 화면(/destination)으로 넘긴다.
  // 거기서 지오코딩해 지도에 찍으므로 여기서는 적은 글자를 그대로 실어 보내면 된다.
  function search(e: React.FormEvent) {
    e.preventDefault();
    if (!destination.trim()) return setError("목적지를 입력해주세요");
    if (!("geolocation" in navigator)) return setError("이 브라우저는 위치 확인을 지원하지 않습니다");

    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        router.push(
          `/destination${toCustomQuery(profile, [coords.latitude, coords.longitude], destination.trim())}`,
        );
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요."
            : "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-white pb-8">
      {/*
        hero-promotion. 와이어프레임 높이는 218 이지만 22px 키웠다 — 거기엔 Dynamic Island 가 없어서
        상태바가 y:24 에서 끝나는데, 프레임에서는 아일랜드를 피하느라 y:59 까지 내려간다(app/StatusBar.tsx).
        안쪽 간격은 와이어프레임 그대로 두고 히어로째 내리는 쪽이, 간격을 깎아 218 에 우겨넣는
        것보다 낫다 — 깎으면 제목·아바타가 아일랜드에 붙는다. 아래 검색바가 30px 겹쳐 올라오는 건 그대로.
      */}
      <div className="relative h-[240px] shrink-0 bg-[#e2f1fe]">
        <StatusBar tone="text-[#1f1f1f]" />
        {/* 상태바 아래 17px — 와이어프레임의 제목 top:54 와 같은 간격이다 */}
        <div className="flex items-start justify-between pl-6 pr-3">
          <h1 className="mt-[17px] text-[23px] leading-[1.3] font-bold whitespace-nowrap text-[#1f1f1f]">
            제주 초보 운전자라면?
            <br />
            부담 적은 길로 출발해요
          </h1>
          {/* 마이 화면(/profile) 입구. 쿼리를 그대로 넘겨야 거기서 프로필을 되읽는다 (lib/profile.ts) */}
          <button
            onClick={() => router.push(`/profile?${searchParams}`)}
            className="mt-[11px] flex shrink-0 flex-col items-center gap-1 transition active:scale-95"
          >
            <img src={me.src} alt={me.alt} className="size-[90px] rounded-full bg-[#1f1f1f] object-contain" />
            <span className="text-[15px] font-bold text-black">프로필</span>
          </button>
        </div>
      </div>

      {/* floating-search — 히어로 위로 떠 있다 (와이어프레임 top:188 = 히어로 바닥 218 - 30) */}
      <form
        onSubmit={search}
        className="relative z-10 mx-6 -mt-[30px] flex h-[62px] shrink-0 items-center gap-3 rounded-[31px] bg-white px-[22px] shadow-[0_8px_20px_0_rgba(0,0,0,0.14)]"
      >
        <span aria-hidden className="text-[18px] leading-none font-bold text-[#ff6114]">
          ●
        </span>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="장소를 검색해 주세요"
          aria-label="목적지"
          className="min-w-0 flex-1 text-[14px] text-[#1f1f1f] outline-none placeholder:text-[#a6a6a6]"
        />
        <button type="submit" aria-label="검색" disabled={locating} className="text-[22px] leading-none font-bold text-[#1f1f1f] disabled:opacity-40">
          ⌕
        </button>
      </form>

      {(error || locating) && (
        <p className={`mt-3 shrink-0 px-6 text-[12px] ${error ? "text-rose-600" : "text-[#616161]"}`}>
          {error ?? "현재 위치 확인 중…"}
        </p>
      )}

      {/*
        프로모 카드 세 장. 갈 화면이 있는 것만 누를 수 있다 —
        누를 수 있어 보이는데 아무 일도 없으면 시연에서 더 나쁘다.
      */}
      <div className="mt-9 grid shrink-0 grid-cols-2 gap-3 px-6">
        <div className="flex h-[190px] flex-col rounded-2xl border border-[#dbe0e0] bg-[#f7fafa] p-[15px]">
          <p className="text-[17px] leading-[1.3] font-bold text-[#1f1f1f]">
            AI가 추천한 길로
            <br />
            떠나는 여행
          </p>
          <p className="mt-4 text-[12px] font-bold text-[#ff6114]">브리핑 듣기 &gt;</p>
          <p aria-hidden className="mt-auto text-center text-[23px] leading-none text-[#2e9c85]">
            ◉&nbsp;&nbsp;↗&nbsp;&nbsp;◉
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          {/* 쿼리를 그대로 넘겨야 주차 화면에서 뒤로 나올 때 프로필이 살아 있다 (lib/profile.ts) */}
          <PromoCard eyebrow="내 목적지 가까이" title="주차장 찾기" mark="P" href={`/parking?${searchParams}`} />
          <PromoCard eyebrow="제주 관광객 혜택" title="탐나는전 사용처" mark="₩" href={`/around?${searchParams}`} />
        </div>
      </div>

      <h2 className="mt-[26px] shrink-0 px-6 text-[18px] font-bold text-[#1f1f1f]">제주 운전자 도움 정보</h2>
      <div className="mt-4 grid shrink-0 grid-cols-2 gap-2.5 px-6">
        <HelpCard
          tone="bg-[#e5f5ff]"
          title="렌터카 반납 전"
          lines={["주유소와 반납 장소를", "미리 확인해요"]}
        />
        <HelpCard
          tone="bg-[#fff2d6]"
          title="탐나는전 사용처"
          lines={["주변 가맹점과 주차 가능", "매장을 찾아봐요"]}
        />
      </div>
    </div>
  );
}

/** 오른쪽 주황 카드 두 장 — 문구만 다르고 골격이 같다. href 가 있으면 누를 수 있는 카드가 된다. */
function PromoCard({ eyebrow, title, mark, href }: { eyebrow: string; title: string; mark: string; href?: string }) {
  const box = `flex h-[90px] flex-col justify-center rounded-2xl bg-[#ff6108] px-[14px]`;
  const inner = (
    <>
      <p className="text-[11px] leading-none text-[#ffd1b2]">{eyebrow}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-[16px] leading-none font-bold text-white">{title}</p>
        <span aria-hidden className="text-[22px] leading-none font-bold text-[#ffe5cc]">
          {mark}
        </span>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={`${box} transition active:scale-[0.98]`}>
      {inner}
    </Link>
  ) : (
    <div className={box}>{inner}</div>
  );
}

/** 아래 도움 정보 카드 두 장 */
function HelpCard({ tone, title, lines }: { tone: string; title: string; lines: [string, string] }) {
  return (
    <div className={`h-[132px] rounded-2xl p-4 ${tone}`}>
      <p aria-hidden className="text-[16px] leading-none font-bold text-[#ff5914]">
        ●
      </p>
      <p className="mt-4 text-[14px] leading-none font-bold text-[#1f1f1f]">{title}</p>
      <p className="mt-2 text-[11px] leading-[1.5] text-[#616161]">
        {lines[0]}
        <br />
        {lines[1]}
      </p>
    </div>
  );
}
