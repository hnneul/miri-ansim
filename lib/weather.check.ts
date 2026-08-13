// 날씨 판정 검증 — node --experimental-strip-types lib/weather.check.ts
//
// 네트워크는 안 탄다. 여기서 깨져야 하는 건 두 가지다:
//   ① WMO 코드 표의 경계 (하나 밀리면 "뇌우"를 "소나기"로 말하게 된다)
//   ② 강풍 경계 — 기상청 주의보 기준을 임의로 낮추거나 높이면 칩이 거짓말을 한다

import assert from "node:assert";
import { skyOf, windOf } from "./weather.ts";

// --- ① 하늘 상태 (경계 양쪽) ---
assert.equal(skyOf(0), "맑음");
assert.equal(skyOf(1), "맑음"); // mainly clear — 맑음으로 묶는다
assert.equal(skyOf(2), "구름많음");
assert.equal(skyOf(3), "흐림");
assert.equal(skyOf(48), "안개"); // 45·48 뿐이고 그 사이 코드는 없다
assert.equal(skyOf(57), "이슬비");
assert.equal(skyOf(65), "비");
assert.equal(skyOf(77), "눈");
assert.equal(skyOf(82), "소나기");
assert.equal(skyOf(86), "눈소나기");
assert.equal(skyOf(95), "뇌우");
assert.equal(skyOf(99), "뇌우");
assert.equal(skyOf(120), "뇌우"); // 모르는 코드는 마지막 이름으로 흐른다 — 던지지 않는다

// --- ② 강풍 ---
assert.equal(windOf(0, 0), "강풍 없음");
assert.equal(windOf(8, 12), "강풍 없음"); // 경계 바로 아래
assert.equal(windOf(9, 12), "바람 강함"); // 해안도로 옆바람 구간
assert.equal(windOf(13, 19), "바람 강함");
assert.equal(windOf(14, 0), "강풍 주의"); // 주의보 기준: 풍속 14
assert.equal(windOf(3, 20), "강풍 주의"); // 평균은 약해도 순간 20이면 주의보다

console.log("weather.check ok");
