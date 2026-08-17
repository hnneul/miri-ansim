"use client";

// 여행 완료 — 와이어프레임 TRIP-08. 코스를 다 돌고 오거나(/trip/course), 홈 "주행 저장"으로 들어온다.
// 하루를 닫는 축하 한 장이다: 기록으로 남길지(→ /trip/record) 그냥 넘어갈지(→ /home)만 고른다.
// 프로필·코스 쿼리는 그대로 실어 나른다 — 기록 화면이 방금 그 코스를 기본값으로 집게 하려는 것이다.
//
// 디자인 문구는 "굴이"지만 앱 전체가 마스코트를 "귤이"(귤)로 부르므로 여기서도 귤이로 맞춘다.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 use-search-params.md)
export default function TripCompletePage() {
  return (
    <Suspense>
      <Complete />
    </Suspense>
  );
}

function Complete() {
  const q = useSearchParams().toString();
  const suffix = q ? `?${q}` : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />

      <div className="flex min-h-0 flex-1 flex-col items-center px-[23px] text-center">
        <h1 className="mt-[54px] text-[25px] leading-[34px] font-bold text-[#262626]">오늘의 제주 여행 완료!</h1>
        <p className="mt-3 text-[14px] leading-[21px] text-[#7d7d7d]">귤이랑 같이 오늘의 순간을 간직하러 떠날래요?</p>

        {/* 잠든 귤이 — 원본이 세로로 긴 장면(1086x1448)이라 가운데를 원으로 잘라 넣는다 (홈 아바타와 같은 방식) */}
        <div className="mt-[46px] size-[168px] shrink-0 overflow-hidden rounded-full border-[3px] border-[#ff7d32]">
          <img src="/trip/complete-hero.png" alt="" className="size-full object-cover" />
        </div>

        {/* 말풍선 — 위로 뻗은 꼬리가 캐릭터를 가리킨다 (꼬리는 45° 돌린 사각형의 윗변이다) */}
        <div className="relative mt-[38px] shrink-0 rounded-[18px] bg-[#fff0e6] px-7 py-[18px]">
          <span aria-hidden className="absolute -top-1.5 left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-[#fff0e6]" />
          <p className="text-[15px] leading-[22px] font-bold text-[#262626]">“오늘 여행, 정말 멋졌어요!”</p>
        </div>

        {/* 버튼은 화면 아래에 붙인다 — 위 내용이 짧아 남는 자리를 mt-auto 로 밀어낸다 */}
        <div className="mt-auto flex w-full flex-col gap-[10px] pt-10">
          <Link
            href={`/trip/record${suffix}`}
            className="grid h-12 place-items-center rounded-2xl bg-[#ff7d32] text-[16px] font-bold text-white transition active:scale-[0.98]"
          >
            여행 기록에 저장
          </Link>
          <Link
            href={`/home${suffix}`}
            className="grid h-12 place-items-center rounded-2xl bg-[#e5e3e0] text-[16px] font-bold text-[#57534e] transition active:scale-[0.98]"
          >
            저장 안할래요
          </Link>
        </div>
      </div>

      <div className="h-[34px] shrink-0" />
    </div>
  );
}
