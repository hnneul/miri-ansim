// 카카오 로컬 카테고리 검색으로 주차장 찾기 — 공공데이터가 못 담는 곳을 메운다.
//
// 왜 필요한가 — data/parking-data.json 의 1,657곳은 전부 `주차장구분: 공영`이다.
// 관광지·호텔·마트의 부설주차장이 한 곳도 없어서, 성산일출봉 반경 1km 에 잡히는 주차장이
// 1곳뿐이다(협재 9곳, 서귀포 매일올레시장 26곳). 제주를 찾는 초보 운전자가 쓰는 앱인데
// 정작 관광지에서 가장 부실한 셈이라, 목적지 근처는 카카오로 덧붙인다.
//
// **받은 결과를 저장하지 않는다.** 카카오 로컬 결과를 DB 에 굳혀 재배포하는 건 이용약관을
// 따로 확인해야 하는 영역이고, 관광지 주차장은 어차피 최신성이 중요해 굳혀둘 이유도 없다.
// 공공데이터 = 굳혀둔 기본, 카카오 = 화면을 열 때마다 받는 보강. 둘의 역할을 섞지 않는다.
//
// 서버에서만 돈다 — KAKAO_REST_API_KEY 는 서버 전용이라 브라우저로 못 내보낸다
// (lib/geocode.ts 와 같은 이유. 화면은 app/parking/actions.ts 를 거쳐 부른다).

import type { Lot } from "./parking";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";

/** 키워드 검색. 카테고리 코드만으로는 못 가르는 관광지를 찾을 때 쓴다 (searchSpotsNear 주석) */
const KEYWORD_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";

/** 카카오 카테고리 코드 — PK6 = 주차장 */
const PARKING = "PK6";

/** 길찾기·지오코딩과 같은 한계. 여기서 매달리면 지도가 멎은 것처럼 보인다. */
const TIMEOUT_MS = 6000;

/**
 * 한 번에 받을 개수. 카카오 한 페이지 최대치다.
 * ponytail: 관광지에서 15곳으로 모자라면 page=2,3 을 더 부른다 (최대 45곳). 지금은 공공데이터
 * 40곳에 얹는 보강이라 한 번이면 충분하고, 요청 수를 늘릴 이유가 아직 없다.
 */
const SIZE = 15;

/** 실패는 null 이 아니라 사유로 돌려준다 (lib/geocode.ts 의 Geocoded 와 같은 모양). */
export type Pois = { spots: Lot[] } | { error: string };

/**
 * 좌표 주변 주차장. 거리(walkM)는 여기서 붙이지 않는다 — 화면이 지도를 조금 움직여도
 * 다시 부르지 않으므로, 받아둔 좌표에서 그때그때 재는 쪽이 공공데이터와 같은 기준이 된다.
 *
 * @param radiusM 카카오 상한은 20,000m. 도보권 밖까지 긁어봐야 지도에 안 보인다.
 */
export async function searchParkingNear([lat, lng]: [number, number], radiusM = 2000): Promise<Pois> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색 키(KAKAO_REST_API_KEY)가 설정되지 않았습니다" };

  const q = new URLSearchParams({
    category_group_code: PARKING,
    x: String(lng), // 카카오는 x=경도, y=위도 순서다
    y: String(lat),
    radius: String(Math.min(radiusM, 20000)),
    size: String(SIZE),
    sort: "distance",
  });

  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: `주차장 검색 서버가 응답하지 않았습니다 (HTTP ${res.status})` };

    const docs: any[] = (await res.json()).documents ?? [];
    return {
      spots: docs
        .map(
          (d): Lot => ({
            name: d.place_name,
            // 도로명이 있으면 그쪽이 짧고 읽기 쉽다. 번지는 이미 이름에 없으니 그대로 줄인다.
            addr: shortAddr(d.road_address_name || d.address_name || ""),
            source: "카카오",
            // 유형·구획수·요금은 카카오가 주지 않는다. 모르는 걸 채우면 화면이 거짓말을 한다 —
            // type "" 이면 "주차 쉬움" 배지도 안 붙는다 (lib/parking.ts isEasyParking).
            type: "",
            spaces: null,
            fee: null,
            at: [Number(d.y), Number(d.x)],
          }),
        )
        .filter((s) => Number.isFinite(s.at[0]) && Number.isFinite(s.at[1])),
    };
  } catch {
    // 타임아웃(AbortError)·네트워크 오류·깨진 JSON
    return { error: "주차장 검색 응답을 받지 못했습니다 (응답 지연 또는 네트워크 오류)" };
  }
}

/** 여행 코스 후보 한 곳 (lib/course.ts 가 순서를 짠다) */
export type Spot = { name: string; at: [number, number]; addr: string | null; kind: string };

/**
 * 관심 장소 하나의 검색 조건. lib/trip.ts INTERESTS 의 뒤 세 칸이 그대로 들어온다 —
 * 왜 셋 다 필요한지는 거기 주석에 있다.
 */
export type Recipe = { query: string; code: string; kinds: readonly string[] };

/**
 * 좌표 주변에서 관심 장소에 맞는 곳들. 코스 후보를 모을 때 쓴다.
 *
 * sort 가 distance 가 아니라 accuracy 인 이유 — 거리순으로 받으면 출발지(대개 공항) 반경
 * 몇백 미터가 목록을 다 먹는다. 코스는 섬을 도는 것이라 "가까운 순"이 아니라 "그 관심사에
 * 맞는 순"으로 받아서, 순서는 lib/course.ts 가 이동거리를 보고 다시 짠다.
 */
export async function searchSpotsNear(
  [lat, lng]: [number, number],
  recipe: Recipe,
  radiusM = 20000,
): Promise<{ spots: Spot[] } | { error: string }> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색 키(KAKAO_REST_API_KEY)가 설정되지 않았습니다" };

  const q = new URLSearchParams({
    query: recipe.query,
    x: String(lng),
    y: String(lat),
    radius: String(Math.min(radiusM, 20000)),
    size: String(SIZE),
    sort: "accuracy",
  });
  if (recipe.code) q.set("category_group_code", recipe.code);

  try {
    const res = await fetch(`${KEYWORD_ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: `장소 검색 서버가 응답하지 않았습니다 (HTTP ${res.status})` };

    const docs: any[] = (await res.json()).documents ?? [];
    return { spots: docs.map(toSpot).filter((s) => keep(s, recipe)) };
  } catch {
    return { error: "장소 검색 응답을 받지 못했습니다 (응답 지연 또는 네트워크 오류)" };
  }
}

const toSpot = (d: any): Spot => ({
  name: d.place_name,
  at: [Number(d.y), Number(d.x)],
  addr: shortAddr(d.road_address_name || d.address_name || ""),
  // 카카오 분류는 "여행 > 관광,명소 > 해수욕장,해변" 처럼 계층이다. 끝 마디가 실제 유형이고,
  // 프랜차이즈는 여기에 브랜드명이 들어온다 ("엔제리너스") — kinds 로 거르는 지점이 이 값이다.
  kind: String(d.category_name ?? "").split(">").pop()?.trim() ?? "",
});

/**
 * 관광지의 부대시설. 분류가 본체와 같아서(“삼양해수욕장종합상황실”도 해수욕장,해변이다)
 * kinds 로는 못 거른다 — 코스에 넣으면 상황실 앞에 차를 대라는 안내가 된다.
 * "관사"는 겨울 코스에 "국립제주박물관 관사"가 들어와서 붙었다 — 분류는 박물관인데 직원 숙소다.
 */
const FACILITY = /상황실|관리사무소|매표소|화장실|주차장|안내소|탈의장|샤워장|입구|정류장|관사/;

/** 좌표가 성하고, 관심사에 맞는 유형이고, 갈 수 있는 곳이어야 후보로 쓴다 */
const keep = (s: Spot, recipe: Recipe) =>
  Number.isFinite(s.at[0]) &&
  Number.isFinite(s.at[1]) &&
  recipe.kinds.some((k) => s.kind.includes(k)) &&
  // 카카오가 폐업·폐쇄를 이름 뒤에 달아 둔다 ("남짓은오름 (폐쇄)") — 코스에 넣으면 헛걸음이다
  !/폐쇄|폐업/.test(s.name) &&
  !FACILITY.test(s.name);

/**
 * "제주특별자치도 제주시 동광로 30" → "제주시 동광로".
 * 굳혀둔 데이터와 같은 규칙이다 (scripts/build-parking-data.mjs shortAddr) — 한 화면에 두
 * 출처가 섞이는데 주소 모양이 다르면 그것부터 눈에 걸린다.
 */
const shortAddr = (full: string): string | null =>
  full
    .replace(/^제주특별자치도\s*/, "")
    .split(" ")
    .filter((t) => t && !/^\d/.test(t))
    .join(" ") || null;
