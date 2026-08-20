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
const ADDRESS_SEARCH = "https://dapi.kakao.com/v2/local/search/address.json";
const JEJU_RECT = "126.05,33.05,126.99,33.62";

/** 길찾기(lib/route.ts)와 같은 한계. 여기서 매달리면 결과 페이지가 끝없이 기다린다. */
const TIMEOUT_MS = 6000;

/**
 * region 은 접힌 상태로 보이는 짧은 행정구역이고("제주 서귀포시"), address 는 펼쳤을 때 나오는
 * 전체 주소다("제주 서귀포시 칠십리로 242"). region 이 address 의 앞부분과 같은 글자라서
 * 시트에서 한 줄이 그대로 늘어나는 것처럼 보인다 (app/destination/page.tsx PlaceSheet).
 * type 은 이름 옆 유형 뱃지다 ("호텔" · "카페" · "해수욕장").
 */
/**
 * region 은 시트에 늘 보이는 짧은 행정구역이고("제주 서귀포시"), road·jibun 은 주소 카드를 펼쳤을 때
 * 줄줄이 나오는 전체 주소다. type 은 이름 옆 유형 뱃지다 ("호텔" · "카페" · "해수욕장").
 *
 * road 와 jibun 을 한 필드로 합치지 않는 이유 — 주소 카드가 둘을 **각각 한 줄씩** 보여준다
 * (Figma "목적지 주소 펼쳤을때" 2606:847, 카카오·네이버도 같은 모양이다). 합쳐 두면 화면에서
 * 다시 못 가른다. 도로명이 없는 장소(성산일출봉·협재해수욕장·우도 같은 관광지)는 road 가 빈 문자열이고,
 * 그때는 그 줄을 통째로 빼면 된다.
 *
 * 우편번호는 여기 없다. 카카오 키워드 검색 응답에 아예 안 들어 있어서 따로 부른다 — postalOf 참고.
 */
export type Place = { coord: LatLng; label: string; region: string; road: string; jibun: string; type: string };
export type Geocoded = Place | { error: string };

/**
 * 치는 중에 목록이 통째로 사라지지 않게 붙드는 규칙.
 *
 * **카카오는 낱말 단위로 맞춘다** — "협재"는 10건인데 "협재해"는 0건이고 "협재해수욕장"이면 다시 나온다
 * ("스타벅"도 0인데 "스타벅스"는 나온다). 이름을 다 치는 도중에 반드시 지나가는 구멍이라,
 * 그때마다 목록이 사라지면 방금 눈앞에 있던 협재해수욕장이 없어진다.
 *
 * 그래서 **앞 검색어를 이어 친 것이면 앞 목록을 붙든다.** 단, 붙들되 **친 글자가 실제로 든 것만**
 * 남긴다 — 안 그러면 "협재해"라고 쳐 있는데 한림공원을 내밀게 되고, 그건 빈 화면보다 나쁘다.
 * 남는 줄은 전부 입력칸 글자를 품고 있어서, 최악이 "보여줄 게 적다"이지 "틀린 걸 보여준다"가 아니다.
 *
 * 이어 친 것이 아니면(지우고 새로 침) 빈 배열이다 — 붙들기가 진짜 없는 이름을 가려주면 안 된다.
 */
export const 이어친목록 = (앞: { 말: string; 목록: Place[] }, 말: string): Place[] =>
  앞.말 && 말.startsWith(앞.말) ? 앞.목록.filter((p) => p.label.includes(말)) : [];

/**
 * 후보 목록과 **왜 비었는지**. 타이핑 중 화면(suggestPlaces)이 쓴다.
 *
 * 빈 목록에는 뜻이 둘 있다 — "제주에 그 이름이 없다"와 "물어보지 못했다"(타임아웃·네트워크·키 없음).
 * 둘을 같은 빈 배열로 뭉개 놓으면 화면이 네트워크가 느렸을 뿐인 사람에게 "그런 곳 없어요"라고
 * 단정하게 된다. 이 앱의 "모르면 침묵" 규칙이 걸리는 자리라 이유를 같이 들고 다닌다.
 */
export type Suggested = { places: Place[]; 물어봤나: boolean };

/** 도 이름은 늘 같은 값이라 자리만 차지한다 — 제주 안만 검색하므로(JEJU_RECT) 줄여 쓴다. */
const shortJeju = (address: string) => address.replace(/^제주특별자치도/, "제주");

/**
 * "제주특별자치도 서귀포시 색달동 3039-1" → "제주 서귀포시".
 * 앞 두 마디만 쓴다. 마디가 하나뿐이면 그것만 돌려준다.
 */
const shortRegion = (address: string) => shortJeju(address).split(" ").slice(0, 2).join(" ");

/**
 * 카테고리 경로 → 유형 한 낱말. "여행 > 숙박 > 호텔 > 칼호텔" → "호텔".
 *
 * **세 번째 칸을 집는 게 요지다.** 카카오 경로는 깊이가 제각각인데, 4단짜리는 마지막이 유형이 아니라
 * 브랜드다 — "… > 호텔 > 칼호텔", "… > 커피전문점 > 스타벅스", "… > 렌터카 > 롯데렌터카 G car".
 * 마지막 칸을 쓰면 뱃지에 상호가 두 번 적힌다. 3단 이하는 마지막이 유형이라 그대로 쓴다
 * ("가정,생활 > 시장" → 시장, "교통,수송 > 교통시설 > 공항" → 공항).
 *
 * category_group_name 이라는 더 굵은 분류도 같이 오지만 안 쓴다. 빈 값으로 오는 곳이 많고
 * (시장·공항·성산일출봉이 전부 빈 값이었다), 값이 있어도 해수욕장·국립공원·미술관을 죄다
 * "관광명소" 하나로 뭉갠다 — 어디로 운전해 갈지 고르는 사람에게 알맹이가 빠지는 쪽이다.
 *
 * 쉼표는 카카오가 같은 뜻 둘을 붙여 적은 것이라("해수욕장,해변") 앞엣것만 쓴다.
 *
 * **음식 가지만 예외다.** 거기서는 세 번째 칸이 "육류"·"해물"처럼 식재료로 내려가는데
 * ("음식점 > 한식 > 육류,고기 > 삼겹살"), 목적지 뱃지에 재료를 적을 이유가 없다. 뿌리인 "음식점"에서 끊는다.
 * 카페만 남기는 건 관광객에게 밥집과 카페가 서로 다른 목적지라서다 — 커피 마시러 가는 길과
 * 밥 먹으러 가는 길은 다른 결정이다. 반면 "초밥"이냐 "국수"냐는 여기까지 와서 가릴 일이 아니다.
 * 뿌리로 안 끊고 parts[0] 을 그냥 쓰면 다른 가지가 "여행"·"교통,수송"으로 망가진다.
 */
const typeOf = (categoryName: string) => {
  const parts = categoryName
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts[0] === "음식점") return parts[1] === "카페" ? "카페" : "음식점";
  return parts[Math.min(2, parts.length - 1)].split(",")[0];
};

/* 카카오 문서 한 건 → 우리 Place. 목록이든 한 건이든 같은 규칙으로 옮긴다. */
const toPlace = (place: {
  place_name: string;
  address_name?: string;
  road_address_name?: string;
  category_name?: string;
  x: string;
  y: string;
}): Place => ({
  coord: [Number(place.y), Number(place.x)],
  label: place.place_name,
  // region 은 지번 쪽을 기준으로 잡는다 — 도로명이 없는 곳에서도 행정구역은 나와야 한다
  region: shortRegion(place.address_name ?? place.road_address_name ?? ""),
  // 카카오는 road_address_name 을 **빈 문자열**로 주는 곳이 많다 (성산일출봉·협재해수욕장·우도).
  // null 이 아니라 "" 라 ?? 로는 안 걸러지므로 || 로 받는다 — 여기가 새면 주소 카드에 빈 줄이 하나 뜬다.
  road: shortJeju(place.road_address_name || ""),
  jibun: shortJeju(place.address_name || ""),
  type: typeOf(place.category_name ?? ""),
});

/**
 * 검색어로 후보를 여러 개 받아온다. 목적지 검색 화면(HOME-01 a)이 고르라고 늘어놓는 목록이다.
 * 실패 사유는 아래 geocodePlace 와 같은 모양이라 부르는 쪽이 그대로 보여주면 된다.
 */
export async function searchPlaces(
  query: string,
  size = 10,
  // 없음: **물어봤는데 제주에 그 이름이 없었다.** 못 물어본 실패(타임아웃·네트워크·키)와 갈라야
  // 부르는 쪽이 "없다"고 단정할지 입을 다물지 정할 수 있다 (Suggested 주석)
): Promise<{ places: Place[] } | { error: string; 없음?: true }> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색 키(KAKAO_REST_API_KEY)가 설정되지 않았습니다" };

  const q = new URLSearchParams({ query, rect: JEJU_RECT, size: String(size) });
  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: `장소 검색 서버가 응답하지 않았습니다 (HTTP ${res.status})` };

    const docs = (await res.json()).documents ?? [];
    // 입력을 의심하는 건 여기 하나뿐이다 — 검색은 됐는데 제주 안에 그 이름이 없는 경우다
    if (!docs.length)
      return {
        error: `"${query}"의 위치를 제주에서 찾지 못했습니다. 정확한 장소명이나 주소로 다시 입력해주세요.`,
        없음: true,
      };

    return { places: docs.map(toPlace) };
  } catch {
    // 타임아웃(AbortError)·네트워크 오류·깨진 JSON. 사유는 영어라 우리 문구로 갈아준다.
    return { error: "장소 검색 응답을 받지 못했습니다 (응답 지연 또는 네트워크 오류)" };
  }
}

/** 후보 중 첫 번째. 엔터로 바로 찾을 때(그리고 /parking·/around 의 기준 장소)가 이 길이다. */
export async function geocodePlace(query: string): Promise<Geocoded> {
  const found = await searchPlaces(query, 1);
  return "error" in found ? found : found.places[0];
}

/**
 * 도로명 주소 → 우편번호 ("63599"). 목적지 시트의 주소 카드 세 번째 줄에만 쓴다.
 *
 * **왜 따로 부르는가.** 우편번호는 키워드 검색 응답에 아예 없다 — 실제 응답 키가
 * address_name · road_address_name · category_name · phone · place_url · x · y 뿐이다.
 * 그래서 주소 검색 API 를 한 번 더 부른다. 카카오가 방금 준 도로명 문자열을 그대로 되물으므로
 * 도로명이 있는 곳은 다 찾아진다 (호텔·음식점·카페·시장·공항 다섯 곳으로 확인).
 *
 * **좌표로 부르지 않는 이유.** coord2address 에도 zone_no 가 있지만, 좌표가 건물 위에 정확히
 * 떨어지지 않으면 road_address 를 통째로 null 로 준다. 제주는 그런 좌표가 흔해서 도로명이 있는
 * 장소도 놓친다. 문자열로 되묻는 쪽이 확실하다.
 *
 * 도로명이 없으면 부르지도 않는다 — 그런 곳(성산일출봉·협재해수욕장·우도)은 우편번호도 없다.
 * 데이터가 빠진 게 아니라 그 장소에 도로명 주소가 없는 것이라, 화면은 그 줄만 빼면 된다.
 *
 * 실패는 사유가 아니라 null 이다 (areaAt 과 같은 이유 — 사용자가 할 수 있는 일이 없다).
 */
export async function postalOf(road: string): Promise<string | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !road.trim()) return null;

  const q = new URLSearchParams({ query: road, size: "1" });
  try {
    const res = await fetch(`${ADDRESS_SEARCH}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    // 지번으로 찾힌 결과(address_type REGION_ADDR)는 road_address 가 null 이다 — 그때도 우편번호는 없다
    return (await res.json()).documents?.[0]?.road_address?.zone_no || null;
  } catch {
    return null;
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
