"use server";

// 지오코딩은 서버에서만 돈다 — 카카오 REST 키(KAKAO_REST_API_KEY)가 서버 전용이라
// 브라우저로 내보낼 수 없다 (PLAN.md §2). 화면(page.tsx)은 클라이언트라 여기를 거쳐 부른다.
//
// 얇게 감싸기만 한다. 검색어 정리·실패 문구는 lib/geocode.ts 가 이미 하고 있어서 그대로 흘린다.

import { geocodePlace, searchPlaces, type Geocoded, type Place } from "@/lib/geocode";

export async function findPlace(query: string): Promise<Geocoded> {
  const q = query.trim();
  // 빈 입력은 카카오까지 갈 필요가 없다 — 왕복 한 번과 "찾지 못했습니다" 오해를 아낀다
  if (!q) return { error: "장소를 입력해주세요" };
  return geocodePlace(q);
}

/**
 * 타이핑 중에 보여줄 후보 목록 (HOME-01 a "검색하는 화면").
 * 사유 대신 빈 목록을 돌려준다 — 아직 다 적지도 않은 글자에 "찾지 못했습니다"를 띄우면
 * 한 글자 칠 때마다 빨간 줄이 깜빡인다. 진짜 사유가 필요한 건 엔터를 눌렀을 때고, 그건 findPlace 가 한다.
 */
export async function suggestPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const found = await searchPlaces(q);
  return "error" in found ? [] : found.places;
}
