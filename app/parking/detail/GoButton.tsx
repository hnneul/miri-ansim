"use client";

// PARK-02 아래쪽 "이 주차장으로 갈게요" — 길 비교 화면(/route, Figma HOME-02)으로 넘긴다.
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
   * 시트(app/parking/page.tsx)의 "여기로 갈게요"와 **같은 곳으로 간다** — 상세를 거쳤든 안 거쳤든
   * 다음 화면은 길 비교다. 쿼리 만드는 규칙은 거기 routeQuery 주석에 있다.
   * 출발지(originLat/originLng)는 메인화면이 잡아 넘긴 값이 쿼리에 이미 실려 있다.
   */
  function go() {
    const q = new URLSearchParams(searchParams);
    q.set("to", name);
    q.set("toLat", String(at[0]));
    q.set("toLng", String(at[1]));
    router.push(`/route?${q}`);
  }

  return (
    <div className="mx-4 mt-6 shrink-0">
      <button
        onClick={go}
        className="h-[52px] w-full rounded-xl bg-[#ff6114] text-[15px] font-bold text-white transition active:scale-[0.98]"
      >
        이 주차장으로 갈게요
      </button>
    </div>
  );
}
