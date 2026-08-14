"use client";

// PARK-02 아래쪽 버튼 + PARK-01-a 확인 모달 (Figma 2153:3136 하단 → 2153:1793).
//
// 와이어프레임 PARK-02 맨 아래에 "버튼 누르면 옆 화면이 나오는거에요" 라는 노트가 붙어 있고,
// 그 옆 화면이 확인 모달이다. 그래서 순서가 목록 → **상세** → 확인이다.
// (예전에는 반대였다: 고르는 즉시 모달이 뜨고 "네, 여기로 갈게요"가 상세로 갔다.
//  주차장을 정하는 데 필요한 요금·규모·주차형태가 정한 **뒤에** 나오는 순서였다.)
//
// 목적지를 물고 왔을 때만 쓴다. 목적지가 없으면 이 화면은 그냥 주차장 설명이라 확인할 것도 없다.
//
// 페이지(page.tsx)는 서버 컴포넌트로 둬야 주차장 데이터 1,572곳이 번들에 안 실린다.
// 그래서 상태를 드는 이 조각만 떼어 클라이언트로 둔다 (BackButton 과 같은 이유).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { navigateTo, walkMinutes } from "@/lib/parking";

export default function GoConfirm({
  name,
  at,
  walkM,
}: {
  name: string;
  at: [number, number];
  /** 목적지에서 이 주차장까지. 목적지를 물고 왔을 때만 이 컴포넌트를 그리므로 늘 값이 있다. */
  walkM: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mx-4 mt-6 shrink-0">
        <button
          onClick={() => setOpen(true)}
          className="h-[52px] w-full rounded-xl bg-[#ff6114] text-[15px] font-bold text-white transition active:scale-[0.98]"
        >
          이 주차장으로 갈게요
        </button>
      </div>

      {open && (
        /*
          PARK-01-a — 바깥을 누르면 닫힌다. 모달 안 클릭이 새어 나가지 않게 카드에서 전파를 끊는다.
          /parking 에서는 화면을 덮는 상자 안에 있어 absolute 였는데, 여기 페이지는 그냥 흐르는
          문서라 fixed 라야 스크롤 위치와 상관없이 화면을 덮는다.
        */
        <div className="fixed inset-0 z-30 flex flex-col justify-end bg-[#1f1f1f]/[0.38]" onClick={() => setOpen(false)}>
          <div className="relative mx-5 mb-8" onClick={(e) => e.stopPropagation()}>
            {/* 캐릭터는 카드 뒤에서 고개만 내민다. 스플래시와 같은 이미지라 에셋을 새로 안 넣었다 */}
            <img
              src="/character/splash.png"
              alt=""
              className="pointer-events-none absolute -top-[84px] -right-[15px] h-[132px] w-[154px] rotate-[2.09deg] object-contain"
            />
            <div className="relative rounded-[18px] border border-[#c7c7c7] bg-white px-[19px] pt-[25px] pb-[38px]">
              <h2 className="text-[18px] leading-normal font-bold text-[#1f1f1f]">이 주차장까지 안내해 드릴까요?</h2>
              <p className="mt-[10px] truncate text-[13px] leading-normal text-[#8f8f8f]">{name}</p>
              <p className="mt-[15px] text-[14px] leading-normal font-medium text-[#1f1f1f]">
                목적지에서 걸어서 <span className="text-[#fc7f35]">{walkMinutes(walkM)}분</span>
              </p>
              <div className="mt-[21px] flex gap-2.5">
                {/*
                  "다시 고르기"는 모달만 닫는 게 아니라 목록으로 돌아간다 — 글자가 뜻하는 일이 그거다.
                  모달만 닫으면 방금 고른 주차장 상세에 그대로 남아, 다시 고르려면 한 번 더 눌러야 한다.
                */}
                <button
                  onClick={() => router.back()}
                  className="h-[52px] w-[145px] shrink-0 rounded-lg border border-[#9e9e9e] bg-white text-[14px] leading-[22px] font-medium text-[#1f1f1f] active:bg-black/5"
                >
                  다시 고르기
                </button>
                <button
                  onClick={() => navigateTo({ name, at })}
                  className="h-[52px] flex-1 rounded-lg bg-[#fc7f35] text-[14px] leading-[22px] font-medium text-white transition active:scale-[0.98]"
                >
                  네, 여기로 갈게요
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
