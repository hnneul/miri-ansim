"use server";

// 주차장 POI 검색은 서버에서만 돈다 — 카카오 REST 키(KAKAO_REST_API_KEY)가 서버 전용이다.
// 화면(page.tsx)은 클라이언트라 여기를 거쳐 부른다 (app/destination/actions.ts 와 같은 모양).
//
// 얇게 감싸기만 한다. 실패 문구는 lib/poi.ts 가 이미 만들고 있어서 그대로 흘린다.

import { searchParkingNear, type Pois } from "@/lib/poi";

export async function findParkingNear(at: [number, number]): Promise<Pois> {
  return searchParkingNear(at);
}
