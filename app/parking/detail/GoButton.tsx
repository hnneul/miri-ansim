"use client";

// PARK-02 아래쪽 "이 주차장으로 갈게요" — 누르면 곧장 카카오맵 길안내다.
//
// 와이어프레임에는 여기서 확인 모달(PARK-01-a "이 주차장까지 안내해 드릴까요?")이 한 번 더 떴다.
// 뺐다. 그 모달에 **새 정보가 없었다** — 주차장 이름도 "목적지에서 걸어서 N분"도 바로 위 카드에
// 이미 적혀 있고, 여기 오기까지 같은 뜻의 버튼을 이미 두 번 눌렀다(시트 → 상세).
// 확인 모달이 값어치 있는 건 되돌릴 수 없는 일 앞에서인데, 지도 앱 하나 여는 건 뒤로가기면 끝이다.
//
// 페이지(page.tsx)는 서버 컴포넌트로 둬야 주차장 데이터 1,572곳이 번들에 안 실린다.
// 그래서 브라우저가 필요한 이 버튼만 떼어 클라이언트로 둔다 (BackButton 과 같은 이유).

import { navigateTo } from "@/lib/parking";

export default function GoButton({ name, at }: { name: string; at: [number, number] }) {
  return (
    <div className="mx-4 mt-6 shrink-0">
      <button
        onClick={() => navigateTo({ name, at })}
        className="h-[52px] w-full rounded-xl bg-[#ff6114] text-[15px] font-bold text-white transition active:scale-[0.98]"
      >
        이 주차장으로 갈게요
      </button>
    </div>
  );
}
