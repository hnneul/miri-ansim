"use server";

// 메인화면 지도에 얹히는 두 조각 — 왼쪽 위 "흐림 | 28°" 칩과 지도 아래 "현위치 / 제주시 아란4길 89-4".
//
// 역지오코딩이 서버 전용 키(KAKAO_REST_API_KEY)를 쓰므로 화면(클라이언트)은 여기를 거친다
// (app/parking/actions.ts 와 같은 모양). 날씨는 키가 없어 브라우저에서도 되지만 같이 부른다 —
// 둘 다 "지금 내가 선 자리"에 대한 답이라 따로 부르면 왕복만 두 번이고, 한쪽만 먼저 와서
// 지도 위 칩과 아래 주소가 시차를 두고 하나씩 튀어나온다.

import { reverseGeocode } from "@/lib/geocode";
import { weatherAt } from "@/lib/weather";

/** 둘 다 실패는 null 이다 — 부르는 쪽은 그 조각만 안 그린다 (lib/geocode.ts reverseGeocode 주석 참고). */
export async function hereNow(lat: number, lng: number): Promise<{ address: string | null; sky: string | null }> {
  const [address, weather] = await Promise.all([reverseGeocode(lat, lng), weatherAt(lat, lng)]);
  return {
    address,
    // 와이어프레임 문구가 "흐림 | 28°" 다. 소수점은 버린다 — 칩이 28.3°까지 담을 폭이 아니고,
    // 0.1도 차이를 알려주는 화면도 아니다.
    sky: weather && `${weather.sky} | ${Math.round(weather.tempC)}°`,
  };
}
