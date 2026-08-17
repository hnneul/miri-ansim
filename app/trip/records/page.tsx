"use client";

// 나의 여행 기록 — 와이어프레임 TRIP-09. 기록을 저장(/trip/record)하면 여기로 온다.
// 쌓인 여행을 한눈에 본다: 총 거리·방문·사진 요약 + 최근 기록 카드. "홈으로 돌아가기"로 나간다.
//
// 저장소가 아직 없어 목록은 와이어프레임 샘플이다 — 저장이 실제로 되면 이 배열을 그 값으로 바꾼다.
// 디자인 문구는 "굴이"지만 앱은 마스코트를 "귤이"로 부르므로 여기서도 귤이로 맞춘다.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";

type Item = { photo: string; date: string; title: string; course: string; meta: string };

const RECORDS: Item[] = [
  { photo: "/trip/photo-sunset.png", date: "2026.08.14", title: "애월에서 협재까지", course: "바다와 노을 코스", meta: "5곳 · 62km · 사진 12장" },
  { photo: "/trip/photo-seongsan.png", date: "2026.05.03", title: "비 오는 날의 성산", course: "전시와 로컬 맛집", meta: "4곳 · 48km · 사진 21장" },
];

export default function TripRecordsPage() {
  return (
    <Suspense>
      <Records />
    </Suspense>
  );
}

function Records() {
  const q = useSearchParams().toString();
  const suffix = q ? `?${q}` : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[23px] pb-6">
        <div className="mt-4 shrink-0">
          <h1 className="text-[26px] leading-[34px] font-bold text-[#262626]">나의 여행 기록</h1>
          <p className="mt-2 text-[14px] leading-[21px] text-[#7d7d7d]">귤이와 함께한 제주 여행 {RECORDS.length + 2}개</p>
        </div>

        {/* 요약 — 총 거리 크게, 방문·사진은 오른쪽에 */}
        <div className="mt-5 flex shrink-0 items-center justify-between rounded-2xl bg-[#fff0e6] px-5 py-[18px]">
          <div>
            <p className="text-[12px] leading-[17px] text-[#9a958d]">총 여행 거리</p>
            <p className="mt-0.5 text-[24px] leading-[30px] font-bold text-[#262626]">286 km</p>
          </div>
          <p className="text-[14px] leading-[20px] font-medium text-[#525252]">방문 21곳 · 사진 74장</p>
        </div>

        <p className="mt-8 shrink-0 text-[18px] leading-[24px] font-bold text-[#262626]">최근 기록</p>

        <div className="mt-4 flex shrink-0 flex-col gap-4">
          {RECORDS.map((r, i) => (
            <div key={i} className="flex gap-4 rounded-2xl border border-[#f0eeeb] bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
              <div className="size-[104px] shrink-0 overflow-hidden rounded-xl bg-[#f0eeeb]">
                <img src={r.photo} alt="" className="size-full object-cover" />
              </div>
              <div className="flex min-w-0 flex-col justify-center gap-1.5">
                <p className="text-[13px] leading-[18px] text-[#9a958d]">{r.date}</p>
                <p className="truncate text-[18px] leading-[24px] font-bold text-[#262626]">{r.title}</p>
                <p className="truncate text-[14px] leading-[20px] text-[#7d7d7d]">{r.course}</p>
                <p className="truncate text-[13px] leading-[18px] text-[#9a958d]">{r.meta}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Link
        href={`/home${suffix}`}
        className="mx-[23px] mt-2 grid h-12 shrink-0 place-items-center rounded-2xl bg-[#ff7d32] text-[16px] font-bold text-white transition active:scale-[0.98]"
      >
        홈으로 돌아가기
      </Link>
      <div className="h-[34px] shrink-0" />
    </div>
  );
}
