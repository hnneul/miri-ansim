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
 * 좌표 → 지금 서 있는 동네 ("제주시 아라이동"). 메인화면(app/home) 지도 아래 "현위치" 줄에만 쓴다.
 *
 * **번지까지 적지 않는 게 이 함수의 요지다.** 와이어프레임에는 "제주시 아란4길 89-4" 라고 전체
 * 도로명이 적혀 있지만 예시로 채운 값이었고, 실제로 그렇게 쓰면 세 가지가 어긋난다 —
 *
 * 하나, 이 줄은 아무 데도 안 쓰인다. 검색이 /destination 으로 넘기는 건 좌표지 이 문자열이 아니라,
 * 사용자가 하는 일은 "제대로 잡혔네" 하고 넘어가는 것뿐이다. 배달 주소처럼 검수할 값이 아니다.
 * 둘, 노트북 WiFi 측위는 수백 m 씩 틀어진다. 번지를 박으면 그게 틀렸을 때 바로 티가 나지만
 * 동 이름은 그 오차를 흡수한다.
 * 셋, 도로명이 있는 좌표와 없는 좌표가 섞여 있어(아래 참고) 전체 주소로 적으면 같은 동네에서도
 * 줄 모양이 "아란4길 89-4" 와 "아라이동 61-6" 사이를 오간다. region 필드로 뽑으면 늘 같은 모양이다.
 *
 * 실패는 사유가 아니라 null 이다 — 위 geocodePlace 와 정반대라 이유를 적어둔다. 저기는 사용자가
 * 적은 지명을 찾는 일이라 실패하면 고칠 사람이 사용자고, 그래서 무엇이 틀렸는지 말해줘야 한다.
 * 여기는 브라우저가 준 위치 옆에 동네 이름을 덧붙이는 게 전부라 사용자가 할 수 있는 일이 없다.
 * 사유를 띄우면 고칠 수 없는 경고만 하나 남는다. 부르는 쪽은 그 줄만 비운다.
 */
export async function areaAt(lat: number, lng: number): Promise<string | null> {
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

    /*
     * 지번(address) 쪽을 쓴다. 도로명(road_address)이 아니라 —
     * 건물이 없는 좌표(밭·오름·바다 위, 도로 한복판)에는 카카오가 road_address 를 통째로 null 로
     * 주는데, 제주는 그런 좌표가 흔하다. 지번 블록은 늘 온다.
     *
     * region_2depth_name = "제주시" · region_3depth_name = "아라이동" 이고,
     * 읍면 지역이면 3depth 에 "애월읍 하귀일리" 처럼 읍까지 들어온다 — 어느 쪽이든 그대로 붙이면 된다.
     */
    const addr = (await res.json()).documents?.[0]?.address;
    const area = [addr?.region_2depth_name, addr?.region_3depth_name].filter(Boolean).join(" ");
    return area || null;
  } catch {
    return null;
  }
}
