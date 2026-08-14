// 지명·주소 지오코딩 — 출발지·목적지 둘 다 여기를 쓴다.
//
// 출발지와 목적지 모두 사용자가 입력한 지명/주소를 카카오 로컬 키워드 검색으로 좌표화한다.
// 제주 밖 결과가 섞이지 않도록 제주 바운딩 박스(rect)로 제한한다.
//
// 실패는 null 이 아니라 사유로 돌려준다 (lib/route.ts 의 LiveRoutes 와 같은 모양).
// null 하나로 뭉치면 화면이 사유를 지어내야 하고, 실제로 지어냈다 — 키가 없거나 카카오가
// 오류를 줘도 "제주국제공항의 위치를 찾을 수 없습니다, 정확히 다시 입력해주세요"가 떴다.
// 맞는 지명을 적은 사람에게 네 입력이 틀렸다고 하는 거짓말이고, 고칠 방법도 알려주지 못한다.

import type { LatLng } from "@/app/RouteMap";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const COORD2ADDRESS = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
const JEJU_RECT = "126.05,33.05,126.99,33.62";

/** 길찾기(lib/route.ts)와 같은 한계. 여기서 매달리면 결과 페이지가 끝없이 기다린다. */
const TIMEOUT_MS = 6000;

/** region 은 화면에 붙이는 짧은 행정구역이다 ("제주 서귀포시") — 전체 주소는 길어서 한 줄에 안 들어간다. */
export type Geocoded = { coord: LatLng; label: string; region: string } | { error: string };

/**
 * "제주특별자치도 서귀포시 색달동 3039-1" → "제주 서귀포시".
 * 앞 두 마디만 쓰고 도 이름은 줄인다 — 제주 안만 검색하므로(JEJU_RECT) 도 이름은 늘 같은 값이라
 * 자리만 차지한다. 마디가 하나뿐이면 그것만 돌려준다.
 */
const shortRegion = (address: string) =>
  address.replace(/^제주특별자치도/, "제주").split(" ").slice(0, 2).join(" ");

export async function geocodePlace(query: string): Promise<Geocoded> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색 키(KAKAO_REST_API_KEY)가 설정되지 않았습니다" };

  const q = new URLSearchParams({ query, rect: JEJU_RECT, size: "1" });
  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: `장소 검색 서버가 응답하지 않았습니다 (HTTP ${res.status})` };

    const place = (await res.json()).documents?.[0];
    // 입력을 의심하는 건 여기 하나뿐이다 — 검색은 됐는데 제주 안에 그 이름이 없는 경우다
    if (!place)
      return { error: `"${query}"의 위치를 제주에서 찾지 못했습니다. 정확한 장소명이나 주소로 다시 입력해주세요.` };

    return {
      coord: [Number(place.y), Number(place.x)],
      label: place.place_name,
      region: shortRegion(place.address_name ?? place.road_address_name ?? ""),
    };
  } catch {
    // 타임아웃(AbortError)·네트워크 오류·깨진 JSON. 사유는 영어라 우리 문구로 갈아준다.
    return { error: "장소 검색 응답을 받지 못했습니다 (응답 지연 또는 네트워크 오류)" };
  }
}

/**
 * 좌표 → 짧은 주소 ("제주시 아란4길 89-4"). 메인화면(app/home) 지도 아래 "현위치" 줄에만 쓴다.
 *
 * 여기만 실패를 사유가 아니라 null 로 돌려준다 — 위 geocodePlace 와 정반대라 이유를 적어둔다.
 * 저기는 사용자가 적은 지명을 찾는 일이라 실패하면 고칠 사람이 사용자고, 그래서 무엇이 틀렸는지
 * 말해줘야 한다. 여기는 위치를 이미 브라우저가 준 뒤 그 옆에 주소를 덧붙이는 장식 줄이다 —
 * 사용자가 할 수 있는 일이 없으니 사유를 띄우면 고칠 수 없는 경고만 하나 남는다. 부르는 쪽은 그 줄만 비운다.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  // 카카오는 x=경도, y=위도다 (geocodePlace 가 받을 때 뒤집는 것과 같은 규칙, 방향만 반대)
  const q = new URLSearchParams({ x: String(lng), y: String(lat) });
  try {
    const res = await fetch(`${COORD2ADDRESS}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const doc = (await res.json()).documents?.[0];
    // 도로명이 먼저다 — 와이어프레임의 "제주시 아란4길 89-4" 가 도로명이다.
    // 도로명이 없는 좌표(밭·오름·바다 위)는 카카오가 road_address 를 null 로 주므로 지번으로 내려간다.
    const address: string | undefined = doc?.road_address?.address_name ?? doc?.address?.address_name;
    // 도 이름은 늘 같은 값이라 자리만 차지한다 (shortRegion 과 같은 이유)
    return address ? address.replace(/^제주특별자치도\s*/, "") : null;
  } catch {
    return null;
  }
}
