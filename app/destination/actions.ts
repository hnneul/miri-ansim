"use server";

// 지오코딩은 서버에서만 돈다 — 카카오 REST 키(KAKAO_REST_API_KEY)가 서버 전용이라
// 브라우저로 내보낼 수 없다 (PLAN.md §2). 화면(page.tsx)은 클라이언트라 여기를 거쳐 부른다.
//
// 얇게 감싸기만 한다. 검색어 정리·실패 문구는 lib/geocode.ts 가 이미 하고 있어서 그대로 흘린다.

import { geocodePlace, type Geocoded } from "@/lib/geocode";

export async function findPlace(query: string): Promise<Geocoded> {
  const q = query.trim();
  // 빈 입력은 카카오까지 갈 필요가 없다 — 왕복 한 번과 "찾지 못했습니다" 오해를 아낀다
  if (!q) return { error: "장소를 입력해주세요" };
  return geocodePlace(q);
}
