// 출발 전 음성 대본 검증 — node --experimental-strip-types lib/radio.check.ts
//
// AI가 죽거나 하루 한도에 걸린 날 **귀로 나가는** 문장이다. 여기서 볼 건 대본이 매끄러운가가
// 아니라 세 가지다:
//
//   ① 칸 구성이 AI 대본과 같은가 — 다르면 재생 컴포넌트가 어느 쪽이 왔는지 알아야 한다
//   ② 추정을 단정으로 바꾸지 않는가 — 여기가 이 기능에서 제일 위험한 자리다
//   ③ 이미 길을 고른 사람을 되돌리려 하지 않는가
//
// ②를 따로 보는 이유: 초보에게 평행주차를 "직각주차입니다"라고 알려주면 아무 말도 안 하느니만
// 못하다. 화면(app/parking/detail)은 "확률이 높습니다"라고 말하는데 음성만 단정하면 두 매체가
// 어긋나고, 사람은 대개 눈보다 귀를 먼저 믿는다.

import assert from "node:assert";
import { radioScript } from "./briefing.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";
import { 대본_최대글자, 대본_최대숫자, type ArrivalFacts } from "./ai.ts";

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};

const risk = (type: RiskFactor["type"], label: string, exposure: number): RiskFactor => ({
  type,
  label,
  location: "서귀포시 남원읍",
  coord: [33.3, 126.6],
  value: "급커브 42곳",
  exposure,
  source: "테스트",
});

// 실측 구간과 같은 모양: 최단거리 경로가 시간까지 5분 손해다 → safe 추천
const fast = {
  id: "fast" as const,
  name: "5.16도로 경유",
  durationMin: 63,
  risks: [risk("sharpCurve", "연속 급커브", 0.29)],
};
const safe = {
  id: "safe" as const,
  name: "평화로 경유",
  durationMin: 58,
  risks: [risk("highSpeed", "고속주행 구간", 0.48)],
};
const 점수 = scoreRoutes(초보, fast, safe);
assert.equal(점수.recommendedRoute, "safe", "픽스처 전제가 깨졌다");

/** 추정 평행(노상). 확인된 값이 아니라 주차장유형으로 넘겨짚은 것이다 */
const 추정평행: ArrivalFacts = {
  주차장: "매일올레시장 공영주차장",
  요금: "무료",
  주차형태: { 형태: "평행주차", 확인됨: false },
  목적지까지도보분: 4,
};

/** 기본 인자에서 타입이 좁혀지면 대본(fast, safe) 가 안 들어간다 — 둘 다 받는 모양으로 적는다 */
type 경로 = { id: "fast" | "safe"; name: string; durationMin: number | null; risks: RiskFactor[] };
const 대본 = (r: 경로 = safe, o: 경로 = fast, a: ArrivalFacts = 추정평행) =>
  radioScript(초보, 점수, r, o, a);

// --- ① 칸 구성이 AI 대본과 같아야 한다 ---
// AI 스키마가 2~4칸이고(lib/ai.ts SCHEMA), 재생 컴포넌트는 둘을 구분하지 않는다.
assert.equal(대본().length, 4, "요인·주차장이 다 있으면 네 칸이다");
// 헬퍼를 안 쓴다 — 기본 인자에 undefined 를 넘기면 기본값이 살아나서 늘 통과한다
assert.equal(radioScript(초보, 점수, safe, fast).length, 3, "주차장이 없으면 ④칸을 빼야 한다");
const 요인없음 = { ...safe, risks: [] };
assert.equal(
  radioScript(초보, scoreRoutes(초보, fast, 요인없음), 요인없음, fast, 추정평행).length,
  3,
  "요인이 없으면 ③칸을 빼야 한다",
);
assert.equal(
  radioScript(초보, scoreRoutes(초보, fast, 요인없음), 요인없음, fast, undefined).length,
  2,
  "둘 다 없으면 두 칸이다",
);
/*
 * ★ 규칙 대본은 **AI 대본의 검증 기준을 그대로 통과해야 한다.**
 *
 * 두 대본은 같은 자리에 같은 모양으로 나가므로, 한쪽이 다른 쪽 기준에 걸리면 그 기준이 틀린 것이다.
 * 실제로 그렇게 틀렸다: 숫자 상한을 판정과 같은 2로 뒀더니 ACTION.highSpeed 를 쓴 칸이
 * ("…48%로 이어집니다. 1차로보다 2차로가 편합니다") 걸렸는데, 그건 사람이 검토해서 넣어둔
 * 우리 문장이다. 모델이 그 문장을 충실히 따를수록 더 자주 걸리는 검증이었다.
 *
 * 그래서 상한을 하드코딩하지 않고 ai.ts 에서 가져다 쓴다 — 저쪽을 조이면 여기가 먼저 운다.
 */
for (const 종류 of [대본(), 대본(fast, safe)])
  for (const 칸 of 종류) {
    assert.ok(칸.length <= 대본_최대글자, `칸이 ${대본_최대글자}자를 넘는다 (${칸.length}자): ${칸}`);
    const 숫자 = 칸.match(/\d+(\.\d+)?/g) ?? [];
    assert.ok(
      숫자.length <= 대본_최대숫자,
      `칸에 숫자가 ${숫자.length}개다 (상한 ${대본_최대숫자}): ${칸}`,
    );
  }

// --- ② ①칸: 이 길이 어떤 길인가 ---
// 이름이 "평화로 경유" 꼴이라 그대로 쓰면 "평화로 경유로 가는 길"이 된다
assert.ok(대본()[0].includes("평화로 타고 갈게요"), 대본()[0]);
assert.ok(!대본()[0].includes("경유로"), "이름의 '경유'를 안 뗐다");
// 요인이 없으면 없다고 말한다 — 없는 위험을 만들어 붙이지 않는다
assert.ok(
  radioScript(초보, scoreRoutes(초보, fast, 요인없음), 요인없음, fast).at(0)!.includes("특별히 신경 쓸 구간은 없어요"),
);

// --- ②-2 말투: 조수석에 앉은 아는 사람 ---
//
// 화면 문장(verdict·briefing)과 **일부러 다른 말투**다. 저기는 읽는 글이라 "~합니다"고
// 여기는 출발 직전에 귀로 듣는 말이라 "~해요"다. 섞이면 낭독처럼 들린다.
// `습니다|입니다` 만 보면 샌다 — "편합니다"는 둘 다 아니라 그대로 통과했다. 어미는 "니다"다.
for (const 종류 of [대본(), 대본(fast, safe)])
  for (const 칸 of 종류)
    assert.ok(!/니다[.\s]*$/.test(칸.trim()), `읽는 글 말투가 섞였다 (해요체로 통일): ${칸}`);

// 프로필을 **단정형으로 호명**한다. "~라면" 가정형은 위 조건말()이 쓰는 화면용 말투인데,
// 이미 프로필을 받아둔 사람에게 가정형으로 말을 걸면 남 얘기처럼 들린다.
assert.ok(대본()[0].startsWith("운전 경력 1년 미만, 제주는 처음이시죠."), 대본()[0]);
assert.ok(!대본()[0].includes("라면"), "가정형으로 호명했다");

/*
 * 호명 조각은 전부 **받침으로 끝나는 명사구**여야 "이시죠"가 붙는다.
 * 실제로 "요즘 운전은 뜸하고"라고 적었다가 "…뜸하고이시죠"가 나왔다.
 * 조각을 하나씩 못 꺼내니 프로필을 갈아 끼워 다섯 갈래를 다 훑는다.
 */
const 경력자: DriverProfile = {
  experienceYears: 10,
  drivingFrequency: "high",
  jejuExperience: true,
  vehicleSize: "sedan",
  timeOfDay: "day",
};
for (const [이름, p] of Object.entries<DriverProfile>({
  초보: 초보,
  제주처음: { ...경력자, jejuExperience: false },
  뜸함: { ...경력자, drivingFrequency: "low" },
  큰차: { ...경력자, vehicleSize: "suv" },
  밤: { ...경력자, timeOfDay: "night" },
})) {
  const 첫칸 = radioScript(p, 점수, safe, fast, 추정평행)[0];
  const 호명 = 첫칸.split("이시죠.")[0];
  assert.ok(첫칸.includes("이시죠."), `${이름}: 호명이 없다 — ${첫칸}`);
  // 받침으로 끝나야 한다 (한글 음절은 0xAC00 부터 28개씩 종성이 돌고, 나머지가 0이면 받침 없음)
  const 끝 = 호명.charCodeAt(호명.length - 1) - 0xac00;
  assert.ok(끝 >= 0 && 끝 < 11172 && 끝 % 28 !== 0, `${이름}: "이시죠"가 안 붙는 조각 — ${호명}`);
  // 연결어미로 끝나면 명사구가 아니다
  assert.ok(!/(하고|이고|고)$/.test(호명), `${이름}: 명사구가 아니다 — ${호명}`);
}

// 걸릴 조건이 없으면 호명을 통째로 생략한다 — 없는 조건을 지어내지 않는다
const 조건없음 = radioScript(경력자, 점수, safe, fast, 추정평행)[0];
assert.ok(!조건없음.includes("이시죠"), `호명할 조건이 없는데 호명했다: ${조건없음}`);
assert.ok(조건없음.startsWith("평화로 타고"), 조건없음);

// --- ③ ②칸: 왜 이 길인지 — 세 갈래 ---
// (가) 추천한 길을 골랐다
assert.ok(대본()[1].includes("이 길로 골랐어요"), 대본()[1]);
assert.ok(대본()[1].includes("5분"), "시간 이득이 있으면 말해야 한다");

// (나) 추천하지 않은 길을 골랐다 — **설득하지 않는다.**
// 이미 고르고 출발하려는 참이라 여기서 되돌리려 하면 남는 건 불안뿐이다.
const 역선택 = 대본(fast, safe)[1];
assert.ok(역선택.includes("익숙한 운전자에게 알맞은 선택이에요"), 역선택);
for (const 설득 of ["추천하지 않습니다", "권하지 않", "다시 생각", "부담이 큰 길입니다"])
  assert.ok(!역선택.includes(설득), `고른 사람을 되돌리려 한다: ${역선택}`);

// (다) 추천이 없다 — tie 와 unclear 를 **다른 문장으로** 말해야 한다.
// 예전에 한 문장이 둘을 덮어서 68점과 57점을 두고 "비슷합니다"라고 했다 (score.ts noPick).
const 동점경로 = { ...safe, risks: [risk("sharpCurve", "연속 급커브", 0.29)] };
const 동점 = scoreRoutes(초보, fast, 동점경로);
assert.equal(동점.noPick, "tie", "픽스처 전제가 깨졌다");
const 느린큰부담 = {
  id: "safe" as const,
  name: "평화로 경유",
  durationMin: 70,
  risks: [risk("sharpCurve", "연속 급커브", 0.6), risk("narrowRoad", "좁은 교행 구간", 0.35)],
};
const 빠른큰부담 = {
  id: "fast" as const,
  name: "5.16도로 경유",
  durationMin: 50,
  risks: [risk("sharpCurve", "연속 급커브", 0.9), risk("narrowRoad", "좁은 교행 구간", 0.5)],
};
const 애매 = scoreRoutes(초보, 빠른큰부담, 느린큰부담);
assert.equal(애매.noPick, "unclear", "픽스처 전제가 깨졌다");
assert.notEqual(
  radioScript(초보, 동점, 동점경로, fast)[1],
  radioScript(초보, 애매, 느린큰부담, 빠른큰부담)[1],
  "tie 와 unclear 를 같은 문장으로 말하고 있다",
);
// "익숙한 길로 가세요"는 쓰면 안 된다 — 기본 프로필이 경력 1년·제주 처음이고,
// 익숙한 길이 없어서 여기까지 온 사람들이다 (briefing.ts 못고른말 주석)
for (const r of [radioScript(초보, 동점, 동점경로, fast), radioScript(초보, 애매, 느린큰부담, 빠른큰부담)])
  assert.ok(!r.join(" ").includes("익숙한 길"), "없는 걸 가리키는 조언을 하고 있다");

// --- ④ ④칸: 도착해서 차를 댈 곳 — 이 기능에서 제일 위험한 자리 ---
const 도착칸 = 대본()[3];
assert.ok(도착칸.includes("매일올레시장 공영주차장"), 도착칸);
assert.ok(도착칸.includes("걸어서 4분"), "목적지까지 도보 시간을 빼먹었다");

// ★ 추정을 단정으로 바꾸지 않는다
assert.ok(도착칸.includes("평행주차일 가능성이 높으니"), 도착칸);
assert.ok(!도착칸.includes("평행주차 자리라"), "추정을 확정처럼 말했다");
// 확인된 곳에서는 단정해도 된다 — 위성사진으로 사람이 본 값이다
const 확인직각 = 대본(safe, fast, {
  ...추정평행,
  주차형태: { 형태: "직각주차", 확인됨: true },
})[3];
assert.ok(확인직각.includes("직각주차 자리라"), 확인직각);
assert.ok(!확인직각.includes("가능성"), "확인된 값까지 얼버무렸다");

// 유형을 모르는 곳(카카오 POI)은 **아무 말도 안 한다** — 모르면 침묵 (lib/parking.ts)
const 유형모름 = 대본(safe, fast, { ...추정평행, 주차형태: null })[3];
for (const w of ["평행", "직각", "가능성"])
  assert.ok(!유형모름.includes(w), `모르는 주차 형태를 말했다: ${유형모름}`);
assert.ok(유형모름.includes("걸어서 4분"), "아는 것까지 지우면 안 된다");

// 요금은 무료일 때만 한 마디. 금액은 귀로 들어서 할 일이 없고 화면 카드가 이미 보여준다.
assert.ok(대본()[3].includes("무료예요"));
const 유료 = 대본(safe, fast, { ...추정평행, 요금: "유료" })[3];
assert.ok(!유료.includes("무료"), 유료);
assert.ok(!/\d+원/.test(유료), "금액을 말했다");

// 목적지를 모르면(주차장 찾기로 바로 들어온 흐름) 걸어서 몇 분인지도 모른다
const 도보모름 = 대본(safe, fast, { ...추정평행, 목적지까지도보분: null })[3];
assert.ok(!도보모름.includes("걸어서"), 도보모름);

// --- ⑤ ③칸: 각오할 것 하나 ---
// 부담이 가장 큰 요인이어야 한다. breakdown 을 경로로 안 좁히면 늘 fast 행이 잡힌다.
const 양쪽같은이름 = {
  ...safe,
  risks: [risk("narrowRoad", "좁은 교행 구간", 0.03), risk("highSpeed", "고속주행 구간", 0.48)],
};
const 같은이름fast = {
  ...fast,
  risks: [risk("narrowRoad", "좁은 교행 구간", 0.31), risk("sharpCurve", "연속 급커브", 0.29)],
};
const 셋째 = radioScript(
  초보,
  scoreRoutes(초보, 같은이름fast, 양쪽같은이름),
  양쪽같은이름,
  같은이름fast,
)[2];
assert.ok(셋째.includes("속도"), `safe 의 최대 요인(고속주행)이 안 잡혔다: ${셋째}`);

console.log("✅ 출발 전 음성 대본 정상");
console.log(`   칸 구성 2~4 · 추정/확정 구분 · 역선택 시 설득 안 함 확인`);
