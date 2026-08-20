"use server";

// 지오코딩은 서버에서만 돈다 — 카카오 REST 키(KAKAO_REST_API_KEY)가 서버 전용이라
// 브라우저로 내보낼 수 없다 (PLAN.md §2). 화면(page.tsx)은 클라이언트라 여기를 거쳐 부른다.
//
// 얇게 감싸기만 한다. 검색어 정리·실패 문구는 lib/geocode.ts 가 이미 하고 있어서 그대로 흘린다.

import { geocodePlace, postalOf, searchPlaces, type Geocoded, type Place, type Suggested } from "@/lib/geocode";
import SPOTS from "@/data/spots.json";

export async function findPlace(query: string): Promise<Geocoded> {
  const q = query.trim();
  // 빈 입력은 카카오까지 갈 필요가 없다 — 왕복 한 번과 "찾지 못했습니다" 오해를 아낀다
  if (!q) return { error: "장소를 입력해주세요" };
  return geocodePlace(q);
}

/**
 * 타이핑 중에 보여줄 후보 목록 (HOME-01 a "검색하는 화면").
 *
 * **문장으로 된 사유는 안 돌려준다** — 아직 다 적지도 않은 글자에 "찾지 못했습니다"를 띄우면
 * 한 글자 칠 때마다 빨간 줄이 깜빡인다. 진짜 사유가 필요한 건 엔터를 눌렀을 때고, 그건 findPlace 가 한다.
 *
 * 대신 **물어보기는 했는지**만 흘린다 (Suggested). 목록이 빈 이유가 "제주에 없다"인지
 * "물어보지 못했다"인지에 따라 화면이 할 말이 달라서다 — 전에는 둘 다 빈 배열이라,
 * 네트워크가 죽어도 화면이 "제주에서 못 찾았어요"라고 단정했다.
 */
export async function suggestPlaces(query: string): Promise<Suggested> {
  const q = query.trim();
  if (!q) return { places: [], 물어봤나: true };
  const found = await searchPlaces(q);
  // 못 물어본 실패는 빈 목록과 함께 그 사실을 흘린다 — 화면이 "없다"고 단정하지 않게 (Suggested)
  if ("error" in found) return { places: [], 물어봤나: found.없음 === true };
  return { places: found.places, 물어봤나: true };
}

/**
 * 주소 카드를 펼칠 때 부른다 (lib/geocode.ts postalOf).
 *
 * **미리 안 받는 이유.** 목적지는 엔터(findPlace)로도, 자동완성 목록(suggestPlaces)에서 골라서도
 * 정해진다. 그런데 suggestPlaces 는 한 번에 열 곳까지 돌려주므로, 거기서 미리 받으려면 글자를
 * 칠 때마다 카카오 호출이 열 배가 된다. 주소를 펼치는 사람은 소수라 그때 한 번이 맞다.
 */
export async function findPostal(road: string): Promise<string | null> {
  return postalOf(road);
}

/**
 * 검색 패널이 비어 있을 때 띄우는 추천 장소 (HOME-01 a).
 *
 * **기준은 거리가 아니라 유명세다.** 거리로 고르는 건 이미 /nearby 가 하고, 거긴 실시간
 * 소요시간과 프로필별 운전 부담까지 잰다 — 여기서 흉내내면 같은 일을 더 못하게 하는 꼴이다.
 * 실제로 45km 로 걸러 봐도 제주가 동서 73km 라 공항·중문·성산 어디서 재든 목록이 거의 같았다.
 * lib/spots.ts 의 pickCandidates 도 안 쓴다 — 그건 카카오를 부를 후보를 거리·종류로 흩는
 * 함수라 유명도가 계산에 없다. 공항 기준으로 돌리면 별도봉·제주경마공원이 나오고
 * 함덕도 성산일출봉도 없다. "뭘 검색하지"의 답이 안 된다.
 *
 * 유명세는 **data/spots.json 의 순서**다. 카카오도 관광공사도 인기도 신호를 안 줘서
 * 사람이 카테고리별로 유명한 순서대로 적어둔 목록이다 (scripts/build-spots.mjs SPOTS 주석).
 * 그 순서를 그대로 쓰되 카테고리를 한 바퀴씩 돈다 — 앞에서 여덟 개를 자르면 전부 해수욕장이다.
 * 그 위에 한 겹 더 얹는다 — 길이 두 갈래로 갈리는 곳이 앞이다 (아래 두갈래).
 *
 * **화면이 쓸 여덟보다 넉넉히 준다.** 최근 검색어와 겹치는 이름은 화면에서 걷어내는데
 * (한 화면에 같은 이름이 두 번 뜨면 고장으로 읽힌다), 최근 검색어가 최대 열이라
 * 다 겹쳐도 여덟이 남으려면 열여덟이 필요하다 (lib/recent.ts MAX — 그쪽을 고치면 여기도 같이).
 *
 * **이름만 돌려준다.** 좌표는 여기 있지만 주소가 한 줄뿐이라 도로명·지번이 안 갈린다.
 * 그대로 Place 를 지으면 목적지 시트의 주소 카드가 "도로명: …성산리 78" 처럼 틀린 배지를 단다.
 * 눌렀을 때 최근 검색어와 똑같이 검색을 태우면 카카오가 제대로 나눠 준 값이 온다 (탭 한 번에 1건).
 */
const 통 = new Map<string, string[]>();
for (const s of SPOTS) 통.set(s.category, [...(통.get(s.category) ?? []), s.name]);
const 줄 = [...통.values()];

/**
 * **길이 둘로 갈리는 곳을 앞에 세운다.**
 *
 * 이 앱이 보여줄 게 있는 목적지는 길이 두 갈래인 곳이다 — 한 갈래뿐이면 길 비교 화면이
 * 카드 한 장("단일 경로")으로 죽어서, 권한 대로 눌렀는데 고를 게 없는 화면이 나온다
 * (lib/route.ts routesFor 의 found.length === 1).
 *
 * 아래 여섯은 **제주공항에서 재 본 결과**다. 추천 18곳을 공항([33.507, 126.493]) 출발로
 * routesFor 에 넣고 routes.length 를 센 것이고, 나머지 열두 곳은 전부 한 갈래였다
 * (함덕·협재·금능·곽지 일주도로, 성산일출봉·섭지코지·에코랜드 번영로, 만장굴 일주동로,
 * 동문시장·오일시장 시내, 천제연·오설록 평화로).
 *
 * 손으로 적은 목록인 건 어쩔 수 없다 — 갈리는지 아닌지는 카카오한테 물어봐야 알고,
 * 18곳을 미리 물으면 화면 한 번에 길찾기 54건이다(무료 쿼터 일 10,000건). 출발지가
 * 공항이 아니면 순서의 근거도 사라진다. 다른 출발지가 기본이 되면 그때 다시 재면 된다.
 */
const 두갈래 = new Set([
  "천지연폭포", // 516로 ↔ 평화로
  "정방폭포", // 516로 ↔ 평화로
  "서귀포매일올레시장", // 516로 ↔ 평화로
  "엉또폭포", // 1100로 ↔ 평화로
  "비자림", // 조천우회로 ↔ 번영로
  "카멜리아힐", // 화전길 ↔ 한창로
]);

const 추천 = Array.from({ length: 18 }, (_, i) => 줄[i % 줄.length]?.[(i / 줄.length) | 0])
  .filter((name): name is string => Boolean(name))
  // 정렬은 안정적이라(V8) 갈리는 곳만 앞으로 오고 나머지 순서 — 카테고리 한 바퀴 — 는 그대로다
  .sort((a, b) => Number(두갈래.has(b)) - Number(두갈래.has(a)));

export async function recommendSpots(): Promise<string[]> {
  return 추천;
}
