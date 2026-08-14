// 지오코딩 실패 사유 검증 — node --experimental-strip-types lib/geocode.check.ts
//
// 성공 경로가 아니라 **실패 경로**를 검증한다. 여기가 새면 화면이 사용자에게 거짓말을 한다:
// 키가 없거나 카카오가 오류를 줘도 "그 장소를 못 찾았습니다, 정확히 다시 입력해주세요"가
// 떴었다. 맞는 지명("제주국제공항")을 적은 사람이 몇 번을 다시 적어도 같은 화면을 본다.
//
// fetch 를 갈아끼워 네트워크 없이 돌린다 — 검증할 게 카카오가 답하느냐가 아니라
// 답하지 않을 때 우리가 무슨 말을 하느냐다.

import assert from "node:assert";
import { geocodePlace, reverseGeocode } from "./geocode.ts";

const 응답 = (body: unknown, status = 200) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

// address_name 은 실제 응답 그대로다 — 화면에 붙는 짧은 행정구역이 여기서 잘려 나온다
const 공항 = {
  documents: [
    {
      place_name: "제주국제공항",
      address_name: "제주특별자치도 제주시 용담이동 2002",
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
  // 도 이름을 줄이고 앞 두 마디만 — 전체 주소는 시트 한 줄에 안 들어간다
  region: "제주 제주시",
});

// 주소가 통째로 빠진 응답도 있다(카카오가 늘 채워 주지는 않는다). 빈 문자열로 두고 화면이 그 줄만 비운다 —
// 여기서 던지면 좌표는 멀쩡한데 목적지를 못 고른다.
globalThis.fetch = 응답({ documents: [{ place_name: "어딘가", x: "126.5", y: "33.4" }] });
const 주소없음 = await geocodePlace("어딘가");
assert.deepEqual("error" in 주소없음 ? 주소없음 : 주소없음.region, "");

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
// 주소를 어느 필드에서 어떤 모양으로 꺼내느냐다.
const 좌표응답 = (doc: unknown) => 응답({ documents: doc ? [doc] : [] });

// 도로명이 있으면 도로명, 도 이름은 떼고 — 와이어프레임의 "제주시 아란4길 89-4" 모양
globalThis.fetch = 좌표응답({
  road_address: { address_name: "제주특별자치도 제주시 아란4길 89-4" },
  address: { address_name: "제주특별자치도 제주시 아라일동 1234" },
});
assert.equal(await reverseGeocode(33.4665, 126.5601), "제주시 아란4길 89-4");

// 도로명이 없는 좌표(밭·오름·바다). 카카오가 road_address 를 null 로 준다 — 지번으로 내려가야 한다.
globalThis.fetch = 좌표응답({ road_address: null, address: { address_name: "제주특별자치도 제주시 아라일동 1234" } });
assert.equal(await reverseGeocode(33.4, 126.5), "제주시 아라일동 1234");

// 바다 한가운데면 documents 가 비어 온다 — 던지지 말고 줄만 비운다
globalThis.fetch = 좌표응답(null);
assert.equal(await reverseGeocode(33.0, 126.0), null);

// 서버 오류·네트워크 오류도 마찬가지. 장식 줄 하나 때문에 메인화면이 깨지면 안 된다.
globalThis.fetch = 응답({}, 500);
assert.equal(await reverseGeocode(33.4, 126.5), null);
globalThis.fetch = (() => Promise.reject(new Error("The operation was aborted"))) as unknown as typeof fetch;
assert.equal(await reverseGeocode(33.4, 126.5), null);

console.log("geocode.check.ts ok");
