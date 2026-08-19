"use client";

// 이 화면에서 브라우저가 필요한 곳은 여기 하나뿐이라 버튼만 떼어 클라이언트로 둔다.
// 페이지(page.tsx)가 서버 컴포넌트여야 주차장 데이터 1,572곳이 번들에 안 실린다.
//
// <Link href="/parking"> 로 바꾸지 않는다 — 목록에서 지도/목록 어느 쪽을 보고 있었는지,
// 어떤 곳을 골라 시트를 열어뒀는지가 history 에만 남아 있어서, 링크로 되돌리면 그게 날아간다.

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      aria-label="뒤로"
      className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90"
    >
      <img src="/icon-arrow-left.svg" alt="" className="size-6" />
    </button>
  );
}
