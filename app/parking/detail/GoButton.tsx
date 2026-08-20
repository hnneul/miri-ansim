"use client";

// PARK-02 아래쪽 "이 주차장까지 경로보기" — 길 비교 화면(/route, Figma HOME-02)으로 넘긴다.
//
// 예전에는 여기서 곧장 카카오맵을 열었다. 그 자리를 길 비교가 가져간다 — 초보에게 "어느 길로
// 가느냐"는 "어디에 대느냐"만큼 큰 결정이고, 그걸 답해주는 게 이 앱이 하려는 일이다.
// 외부 내비는 사라진 게 아니라 두 화면 뒤(길을 고른 다음)로 밀렸다.
//
// 와이어프레임에는 여기서 확인 모달(PARK-01-a)이 한 번 더 떴는데 뺐다. 새 정보가 없었고
// (주차장 이름도 "목적지에서 걸어서 N분"도 바로 위 카드에 이미 있다), 여기 오기까지 같은 뜻의
// 버튼을 이미 두 번 눌렀다. 확인 모달은 되돌릴 수 없는 일 앞에서나 값어치가 있다.
//
// 페이지(page.tsx)는 서버 컴포넌트로 둬야 주차장 데이터 1,572곳이 번들에 안 실린다.
// 그래서 브라우저가 필요한 이 버튼만 떼어 클라이언트로 둔다 (BackButton 과 같은 이유).

import { useRouter, useSearchParams } from "next/navigation";

export default function GoButton({ name, at }: { name: string; at: [number, number] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * 다음 화면은 길 비교(/route)다. 목적지 쿼리(dest*)는 그대로 두고 to* 를 얹는다 —
   * 길의 도착지는 관광지가 아니라 **차를 대는 자리**여야 소요시간이 실제로 운전하는 시간이 된다.
   * 출발지(originLat/originLng)는 앞 화면들이 실어 보낸 값이 쿼리에 이미 있다.
   */
  function go() {
    const q = new URLSearchParams(searchParams);
    q.set("to", name);
    q.set("toLat", String(at[0]));
    q.set("toLng", String(at[1]));
    // ✕ 로 닫으면 주차장 목록으로 돌아간다. 안 실어 보내면 화이트리스트가 못 알아듣고 홈으로 튕겨
    // 목적지·목록·상세 세 화면을 한 번에 건너뛴다 (목록의 "여기로 갈게요"와 같은 값이어야 한다).
    q.set("back", "parking");
    router.push(`/route?${q}`);
  }

  return (
    <div className="mx-4 mt-6 shrink-0">
      <button
        onClick={go}
        className="h-[52px] w-full rounded-[8px] bg-[#fc7f35] text-[14px] leading-[22px] font-medium text-white transition active:scale-[0.98]"
      >
        이 주차장까지 경로보기
      </button>
    </div>
  );
}
