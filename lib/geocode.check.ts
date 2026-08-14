// 지오코딩 실패 사유 검증 — node --experimental-strip-types lib/geocode.check.ts
//
// 성공 경로가 아니라 **실패 경로**를 검증한다. 여기가 새면 화면이 사용자에게 거짓말을 한다:
// 키가 없거나 카카오가 오류를 줘도 "그 장소를 못 찾았습니다, 정확히 다시 입력해주세요"가
// 떴었다. 맞는 지명("제주국제공항")을 적은 사람이 몇 번을 다시 적어도 같은 화면을 본다.
//
// fetch 를 갈아끼워 네트워크 없이 돌린다 — 검증할 게 카카오가 답하느냐가 아니라
// 답하지 않을 때 우리가 무슨 말을 하느냐다.

import assert from "node:assert";
import { geocodePlace, areaAt } from "./geocode.ts";

const 응답 = (body: unknown, status = 200) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

// 실제 카카오 응답 그대로다 — 공항은 road_address_name 은 있고 category_group_name 은 빈 값으로 온다
const 공항 = {
  documents: [
    {
      place_name: "제주국제공항",
      address_name: "제주특별자치도 제주시 용담이동 2002",
      road_address_name: "제주특별자치도 제주시 공항로 2",
      category_name: "교통,수송 > 교통시설 > 공항",
      category_group_name: "",
      x: "126.49272304493574",
      y: "33.50683984835887",
    },
  ],
};

/** 입력을 의심하는 문구가 붙었나 — 서버·키 문제에 이게 붙으면 사용자를 헛수고시킨다 */
const 입력탓 = (g: Awaited<ReturnType<typeof geocodePlace>>) => "error" in g && g.error.includes("다시 입력");

// --- ① 키가 없을 때 ---
// 실측에서 이게 "제주국제공항의 위치를 찾을 수 없습니다"로 떴다. 고칠 사람은 사용자가 아니다.
delete process.env.KAKAO_REST_API_KEY;
globalThis.fetch = 응답(공항);
const 키없음 = await geocodePlace("제주국제공항");
assert.ok("error" in 키없음 && 키없음.error.includes("KAKAO_REST_API_KEY"), `키 사유가 없다: ${JSON.stringify(키없음)}`);
assert.ok(!입력탓(키없음), "키가 없는데 사용자 입력을 의심했다");

process.env.KAKAO_REST_API_KEY = "test-key";

// --- ② 정상 응답 ---
// 좌표는 [위도, 경도]다 — 카카오는 x=경도, y=위도라 뒤집어 담는다. 뒤집히면 지도가 서해로 간다.
assert.deepEqual(await geocodePlace("제주국제공항"), {
  coord: [33.50683984835887, 126.49272304493574],
  label: "제주국제공항",
  // 접힌 줄에 붙는 짧은 행정구역. 도 이름을 줄이고 앞 두 마디만.
  region: "제주 제주시",
  // 펼치면 나오는 전체 주소. 도로명이 있으면 그쪽이다 — region 으로 시작해야 한 줄이 늘어난 것처럼 보인다.
  address: "제주 제주시 공항로 2",
  type: "공항",
});

// 주소가 통째로 빠진 응답도 있다(카카오가 늘 채워 주지는 않는다). 빈 문자열로 두고 화면이 그 줄만 비운다 —
// 여기서 던지면 좌표는 멀쩡한데 목적지를 못 고른다.
globalThis.fetch = 응답({ documents: [{ place_name: "어딘가", x: "126.5", y: "33.4" }] });
const 주소없음 = await geocodePlace("어딘가");
assert.deepEqual("error" in 주소없음 ? 주소없음 : [주소없음.region, 주소없음.address, 주소없음.type], ["", "", ""]);

// --- ②-b 유형 뱃지 (typeOf) ---
// 실제 카카오 응답에서 그대로 가져온 경로들이다. 깊이가 제각각인 게 이 규칙의 전부라, 표본을 줄이면
// 규칙이 왜 "세 번째 칸"인지가 안 남는다.
const 유형 = async (category: string, road = "제주특별자치도 제주시 어딘가로 1") => {
  globalThis.fetch = 응답({
    documents: [{ place_name: "x", address_name: "제주특별자치도 제주시 어딘가", road_address_name: road, category_name: category, x: "126.5", y: "33.4" }],
  });
  const g = await geocodePlace("x");
  return "error" in g ? g.error : g.type;
};

// 4단 — 마지막은 브랜드다. 여기서 마지막 칸을 쓰면 뱃지에 "칼호텔" · "롯데렌터카 G car"가 박힌다.
assert.equal(await 유형("여행 > 숙박 > 호텔 > 칼호텔"), "호텔");
assert.equal(await 유형("서비스,산업 > 전문대행 > 렌터카 > 롯데렌터카 G car"), "렌터카");
// 3단 이하 — 마지막 칸이 곧 유형이다
assert.equal(await 유형("교통,수송 > 교통시설 > 공항"), "공항");
assert.equal(await 유형("여행 > 관광,명소 > 국립공원"), "국립공원");
assert.equal(await 유형("문화,예술 > 문화시설 > 미술관"), "미술관");
assert.equal(await 유형("가정,생활 > 시장"), "시장");
// 쉼표는 같은 뜻 둘을 붙여 적은 것 — 앞엣것만
assert.equal(await 유형("여행 > 관광,명소 > 해수욕장,해변"), "해수욕장");

// 음식 가지는 뿌리에서 끊는다. 세 번째 칸을 그대로 쓰면 "육류"·"해물" 같은 식재료가 뱃지에 붙는다.
assert.equal(await 유형("음식점 > 한식 > 육류,고기 > 삼겹살"), "음식점");
assert.equal(await 유형("음식점 > 한식 > 해물,생선 > 회"), "음식점");
assert.equal(await 유형("음식점 > 일식 > 초밥,롤"), "음식점");
assert.equal(await 유형("음식점 > 치킨"), "음식점");
// 카페만 예외 — 밥집과 카페는 관광객에게 서로 다른 목적지다
assert.equal(await 유형("음식점 > 카페 > 커피전문점 > 스타벅스"), "카페");
assert.equal(await 유형("음식점 > 카페"), "카페");

// 뿌리(parts[0])를 그냥 쓰면 안 된다는 것 — 음식 아닌 가지는 뿌리가 뱃지로 못 쓸 말이다.
// 위 "여행 > 숙박 > 호텔" 이 "여행"으로, "교통,수송 > 교통시설 > 공항" 이 "교통,수송"으로 나오면 이 규칙이 샌 것이다.

// 카테고리가 없는 곳도 있다 — 뱃지만 비고 나머지는 멀쩡해야 한다
assert.equal(await 유형(""), "");

// 도로명이 **빈 문자열**로 오는 곳이 많다 (흑돼지거리·성산일출봉). null 이 아니라 "" 라 ?? 로는 안 걸러진다 —
// 여기가 새면 펼친 주소가 통째로 빈칸이 된다.
globalThis.fetch = 응답({
  documents: [{ place_name: "성산일출봉", address_name: "제주특별자치도 서귀포시 성산읍 성산리 78", road_address_name: "", category_name: "여행 > 관광,명소 > 산봉우리", x: "126.9", y: "33.45" }],
});
const 도로명없음 = await geocodePlace("성산일출봉");
assert.deepEqual("error" in 도로명없음 ? 도로명없음 : 도로명없음.address, "제주 서귀포시 성산읍 성산리 78");

globalThis.fetch = 응답(공항);

// --- ③ HTTP 오류 (429 한도 초과·5xx) ---
globalThis.fetch = 응답({}, 429);
const 한도 = await geocodePlace("제주국제공항");
assert.ok("error" in 한도 && 한도.error.includes("429"), `상태 코드가 사라졌다: ${JSON.stringify(한도)}`);
assert.ok(!입력탓(한도), "서버가 429를 줬는데 사용자 입력을 의심했다");

// --- ④ 타임아웃·네트워크 오류 (fetch 가 던진다) ---
globalThis.fetch = (() => Promise.reject(new Error("The operation was aborted"))) as unknown as typeof fetch;
const 지연 = await geocodePlace("제주국제공항");
assert.ok("error" in 지연, "던진 fetch 가 그대로 페이지를 깨뜨렸다");
assert.ok(!입력탓(지연), "네트워크 오류인데 사용자 입력을 의심했다");

// --- ⑤ 검색은 됐는데 제주에 그 이름이 없을 때 ---
// 여기서만 입력을 의심한다. 지명이 들어가야 사용자가 무엇을 고쳐야 할지 안다.
globalThis.fetch = 응답({ documents: [] });
const 없음 = await geocodePlace("서울시청");
assert.ok(입력탓(없음) && "error" in 없음 && 없음.error.includes("서울시청"), `없는 장소 사유가 부실하다: ${JSON.stringify(없음)}`);

// --- ⑥ 역지오코딩 (메인화면 "현위치" 줄) ---
// 여기는 실패가 전부 null 이다 — 검증할 건 "무슨 말을 하느냐"가 아니라 "던지지 않느냐"와
// **번지가 새어 나오지 않느냐**다. 동 단위로 끊는 게 이 함수의 요지라(lib/geocode.ts 주석) 거기가 새면
// 화면이 GPS 오차를 번지까지 확대해 보여준다.
const 좌표응답 = (doc: unknown) => 응답({ documents: doc ? [doc] : [] });

// 응답 필드는 카카오 coord2address 실제 모양이다. address_name 에는 번지가 붙어 오는데 그걸 안 쓴다.
globalThis.fetch = 좌표응답({
  road_address: { address_name: "제주특별자치도 제주시 아란4길 89-4" },
  address: {
    address_name: "제주특별자치도 제주시 아라이동 61-6",
    region_2depth_name: "제주시",
    region_3depth_name: "아라이동",
  },
});
assert.equal(await areaAt(33.4665, 126.5601), "제주시 아라이동");

// 건물이 없는 좌표(밭·오름·바다 위, 도로 한복판)는 road_address 가 통째로 null 이다.
// 지번 블록만 보고 있으므로 여기서 아무 일도 일어나지 않아야 한다 — 도로명을 먼저 봤다면 여기서 깨진다.
globalThis.fetch = 좌표응답({
  road_address: null,
  address: { address_name: "제주특별자치도 제주시 오라이동 산 12-3", region_2depth_name: "제주시", region_3depth_name: "오라이동" },
});
assert.equal(await areaAt(33.4, 126.5), "제주시 오라이동");

// 읍면 지역. 카카오가 3depth 에 읍까지 담아 준다 — 그대로 붙여 나가면 된다.
globalThis.fetch = 좌표응답({
  address: { region_2depth_name: "제주시", region_3depth_name: "애월읍 하귀일리" },
});
assert.equal(await areaAt(33.47, 126.4), "제주시 애월읍 하귀일리");

// 바다 한가운데면 documents 가 비어 온다 — 던지지 말고 줄만 비운다
globalThis.fetch = 좌표응답(null);
assert.equal(await areaAt(33.0, 126.0), null);

// 서버 오류·네트워크 오류도 마찬가지. 장식 줄 하나 때문에 메인화면이 깨지면 안 된다.
globalThis.fetch = 응답({}, 500);
assert.equal(await areaAt(33.4, 126.5), null);
globalThis.fetch = (() => Promise.reject(new Error("The operation was aborted"))) as unknown as typeof fetch;
assert.equal(await areaAt(33.4, 126.5), null);

console.log("geocode.check.ts ok");
