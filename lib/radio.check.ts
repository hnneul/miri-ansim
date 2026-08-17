// 출발 전 음성 대본 검증 — node --experimental-strip-types lib/radio.check.ts
//
// AI가 죽거나 하루 한도에 걸린 날 **귀로 나가는** 문장이다. 여기서 볼 건 대본이 매끄러운가가
// 아니라 다섯 가지다:
//
//   ① 칸 구성이 AI 대본과 같은가 — 다르면 재생 컴포넌트가 어느 쪽이 왔는지 알아야 한다
//   ② 한 칸이 글자 상한 안에 드는가 — 넘으면 /api/tts 가 400 이라 목소리가 통째로 바뀐다
//   ③ 제주가 처음인 사람이 알아들을 말인가 — 도로 이름을 뜻 없이 부르지 않는가
//   ④ 추정을 단정으로 바꾸지 않는가 — 여기가 이 기능에서 제일 위험한 자리다
//   ⑤ 이미 길을 고른 사람을 되돌리려 하지 않는가
//
// ④를 따로 보는 이유: 초보에게 평행주차를 "직각주차입니다"라고 알려주면 아무 말도 안 하느니만
// 못하다. 화면(app/parking/detail)은 "확률이 높습니다"라고 말하는데 음성만 단정하면 두 매체가
// 어긋나고, 사람은 대개 눈보다 귀를 먼저 믿는다.

import assert from "node:assert";
import { radioScript, 칸_최대글자 } from "./briefing.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";
import { 대본_최대글자, 대본_최대숫자, type ArrivalFacts } from "./ai.ts";

const 초보: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};

/**
 * 위치를 받는다. ①칸의 정체("○○라는 산길")는 **요인이 그 도로에 있을 때만** 붙으므로
 * (briefing.ts radioScript), 위치가 경로 이름을 포함하는지가 픽스처의 전제가 된다.
 */
const risk = (
  type: RiskFactor["type"],
  label: string,
  exposure: number,
  location = "서귀포시 남원읍",
): RiskFactor => ({
  type,
  label,
  location,
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
  risks: [risk("sharpCurve", "연속 급커브", 0.29, "5.16도로 8.2km")],
};
const safe = {
  id: "safe" as const,
  name: "평화로 경유",
  durationMin: 58,
  risks: [risk("highSpeed", "고속주행 구간", 0.48, "평화로 22.5km")],
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
const 대본 = (r: 경로 = safe, o: 경로 = fast, a: ArrivalFacts | undefined = 추정평행) =>
  radioScript(초보, 점수, r, o, a, "성산일출봉");

// --- ① 칸 구성이 AI 대본과 같아야 한다 ---
// AI 스키마가 2~5칸이고(lib/ai.ts SCHEMA), 재생 컴포넌트는 둘을 구분하지 않는다.
// ①오프닝 ②추천이유 ③각오 ④도착 ⑤맺음말 중 ②③④가 빠질 수 있다.
assert.equal(대본().length, 5, "요인·주차장이 다 있으면 다섯 칸이다");
// 헬퍼를 안 쓴다 — 기본 인자에 undefined 를 넘기면 기본값이 살아나서 늘 통과한다
assert.equal(
  radioScript(초보, 점수, safe, fast, undefined, "성산일출봉").length,
  4,
  "주차장이 없으면 ④칸을 빼야 한다",
);
const 요인없음 = { ...safe, risks: [] };
const 요인없음점수 = scoreRoutes(초보, fast, 요인없음);
assert.equal(
  radioScript(초보, 요인없음점수, 요인없음, fast, 추정평행, "성산일출봉").length,
  4,
  "요인이 없으면 ③칸을 빼야 한다",
);
assert.equal(
  radioScript(초보, 요인없음점수, 요인없음, fast, undefined, "성산일출봉").length,
  3,
  "둘 다 없으면 세 칸이다",
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
// briefing.ts 는 ai.ts 에서 값을 못 가져온다(순환). 두 벌로 적힌 같은 값이 어긋나면 여기서 잡힌다.
assert.equal(칸_최대글자, 대본_최대글자, "briefing.ts 와 ai.ts 의 글자 상한이 갈라졌다");

for (const 종류 of [대본(), 대본(fast, safe)])
  for (const 칸 of 종류) {
    assert.ok(칸.length <= 대본_최대글자, `칸이 ${대본_최대글자}자를 넘는다 (${칸.length}자): ${칸}`);
    const 숫자 = 칸.match(/\d+(\.\d+)?/g) ?? [];
    assert.ok(
      숫자.length <= 대본_최대숫자,
      `칸에 숫자가 ${숫자.length}개다 (상한 ${대본_최대숫자}): ${칸}`,
    );
  }

// --- ② ①칸: 누구에게, 어디를, 어느 길로 ---
//
// 이름이 "평화로 경유" 꼴이라 그대로 쓰면 "평화로 경유라는 큰길"이 된다
assert.ok(!대본()[0].includes("경유"), `이름의 '경유'를 안 뗐다: ${대본()[0]}`);

/*
 * ★ **도로 이름에 뜻을 붙여야 한다.**
 *
 * 제주가 처음이면 "평화로"도 "5.16도로"도 아무 뜻이 없고, 추천된 경로는 화면에 "맞춤 안심 길"로
 * 떠서(app/route/page.tsx) 이름을 볼 데조차 없다 — 음성만 혼자 모르는 이름을 부르던 자리다.
 * 이름을 빼는 게 아니라 뜻을 붙인다: 표지판에는 도로명이 나오므로 이름 자체는 쓸모가 있다.
 */
assert.ok(대본()[0].includes("평화로라는 큰길"), 대본()[0]);
assert.ok(대본(fast, safe)[0].includes("5.16도로라는 산길"), 대본(fast, safe)[0]);
// 요인이 없으면 붙일 뜻도 없다 — 없는 성격을 지어내지 않고 이름만 부른다
const 뜻없음 = radioScript(초보, 요인없음점수, 요인없음, fast, undefined, "성산일출봉")[0];
assert.ok(뜻없음.includes("평화로 타시네요"), 뜻없음);

/*
 * ★ **요인이 다른 도로에 있으면 뜻을 붙이지 않는다.**
 *
 * 경로 이름은 가장 많이 달리는 도로에서 오는데(lib/route.ts roadKm) 요인은 다른 도로에 있을 수
 * 있다. 실측에서 "번영로라는 좁은 길"이 나왔다 — 번영로는 왕복 4차선이고 좁은 건 금백조로였다.
 */
const 남의도로 = {
  ...safe,
  name: "번영로 경유",
  risks: [risk("narrowRoad", "좁은 교행 구간", 0.295, "금백조로 10.5km · 비자림로 2.9km")],
};
const 남의도로첫칸 = radioScript(
  초보,
  scoreRoutes(초보, fast, 남의도로),
  남의도로,
  fast,
  undefined,
  "성산일출봉",
)[0];
assert.ok(남의도로첫칸.includes("번영로 타시네요"), 남의도로첫칸);
assert.ok(!남의도로첫칸.includes("라는"), `다른 도로의 성격을 경로 이름에 붙였다: ${남의도로첫칸}`);

// 오늘 어디 가는지 말한다. 라디오인데 목적지를 한 번도 안 부르고 있었다
assert.ok(대본()[0].includes("성산일출봉"), 대본()[0]);
// 모르면 지어내지 않는다 — 목적지 화면을 안 거쳐 온 흐름이다
const 목적지모름 = radioScript(초보, 점수, safe, fast, 추정평행)[0];
assert.ok(!목적지모름.includes("오늘은"), `목적지를 모르는데 불렀다: ${목적지모름}`);
assert.ok(목적지모름.includes("평화로라는 큰길 타시네요"), 목적지모름);

// --- ②-2 말투: 라디오 진행자 ---
//
// 화면 문장(verdict·briefing)과 **일부러 다른 말투**다. 저기는 읽는 글이라 "~합니다"고
// 여기는 출발 직전에 귀로 듣는 말이라 "~해요"다. 섞이면 낭독처럼 들린다.
// `습니다|입니다` 만 보면 샌다 — "편합니다"는 둘 다 아니라 그대로 통과했다. 어미는 "니다"다.
for (const 종류 of [대본(), 대본(fast, safe)])
  for (const 칸 of 종류)
    assert.ok(!/니다[.\s]*$/.test(칸.trim()), `읽는 글 말투가 섞였다 (해요체로 통일): ${칸}`);

/*
 * 프로필을 **단정형으로, 사람이 하는 말로** 호명한다.
 *
 * "~라면" 가정형은 위 조건말()이 쓰는 화면용 말투인데, 이미 프로필을 받아둔 사람에게
 * 가정형으로 말을 걸면 남 얘기처럼 들린다. 그렇다고 "운전 경력 1년 미만" 처럼 적으면
 * **입력 화면의 항목 이름을 소리내어 읽는 것**이 된다 — 사람은 자기 사정을 저렇게 말하지 않는다.
 */
assert.ok(
  대본()[0].startsWith("운전 시작한 지 얼마 안 되셨고, 제주도 처음이시죠."),
  대본()[0],
);
assert.ok(!대본()[0].includes("라면"), "가정형으로 호명했다");
for (const 항목 of ["경력 1년", "운전빈도", "미만"])
  assert.ok(!대본()[0].includes(항목), `입력 화면의 항목 이름을 그대로 읽었다: ${항목}`);

/*
 * 조각 다섯 갈래가 다 절로 이어지는지 훑는다. 연결형(잇고)과 종결형(맺고)을 따로 두는 이유가
 * 여기다 — 한 벌로 두고 어미를 붙이면 "…오랜만이시고이시죠" 가 된다.
 * 조각을 하나씩 못 꺼내니 프로필을 갈아 끼운다.
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
  const 첫칸 = radioScript(p, 점수, safe, fast, 추정평행, "성산일출봉")[0];
  const 호명 = 첫칸.split("죠.")[0];
  assert.ok(첫칸.includes("죠. "), `${이름}: 호명이 없다 — ${첫칸}`);
  // 연결형이 종결형 자리에 오면 "…이시고이시죠" 꼴이 된다
  assert.ok(!/(하고|이고|되셨고|나시고)$/.test(호명), `${이름}: 연결형으로 끝냈다 — ${호명}`);
}

// 걸릴 조건이 없으면 호명을 통째로 생략한다 — 없는 조건을 지어내지 않는다
const 조건없음 = radioScript(경력자, 점수, safe, fast, 추정평행, "성산일출봉")[0];
assert.ok(!조건없음.includes("시죠"), `호명할 조건이 없는데 호명했다: ${조건없음}`);
assert.ok(조건없음.startsWith("오늘은 성산일출봉"), 조건없음);

// --- ③ ②칸: 왜 이 길인지 — 세 갈래 ---
//
// (가) 추천한 길을 골랐다. **다른 길에는 있고 이 길에는 없는 부담**을 말한다.
//
// 비교표의 좌회전·회전교차로는 쓰지 않는다 — 추천점수에 한 점도 안 들어가는 축이라
// (lib/route.ts risksOf), 화면이 큰 글씨로 띄운 점수와 음성이 서로 다른 얘기를 하게 된다.
const 추천이유 = 대본()[1];
assert.ok(추천이유.includes("굽이가 계속 이어지는 산길인데"), 추천이유);
assert.ok(추천이유.includes("이 길은 그게 없어요"), 추천이유);
assert.ok(추천이유.includes("5분"), "시간 이득이 있으면 말해야 한다");
for (const 표 of ["좌회전", "회전교차로", "유턴"])
  assert.ok(!추천이유.includes(표), `추천점수에 없는 축을 추천 이유로 댔다: ${표}`);

/*
 * ★ **다른 경로를 이름이나 지시어로 부르지 않는다.**
 *
 * 이름은 제주가 처음인 사람에게 뜻이 없고, "저쪽"은 소리만으로 무엇을 가리키는지 모른다.
 * 화면에 카드가 두 장뿐이라 "다른 길"이면 흔들리지 않는다.
 */
for (const 종류 of [대본(), 대본(fast, safe)])
  for (const 칸 of 종류.slice(1)) {
    assert.ok(!칸.includes("저쪽"), `가리키는 말을 썼다: ${칸}`);
    for (const 이름 of ["평화로", "5.16도로"])
      assert.ok(!칸.includes(이름), `②칸 뒤에서 도로 이름을 불렀다: ${칸}`);
  }

// 차이가 작으면 없는 차이를 지어내지 않고 물러선다
const 차이작음 = { ...fast, risks: [risk("highSpeed", "고속주행 구간", 0.5)] };
const 작은점수 = scoreRoutes(초보, 차이작음, safe);
if (작은점수.recommendedRoute === "safe")
  assert.ok(
    !radioScript(초보, 작은점수, safe, 차이작음, undefined, "성산일출봉")[1].includes("이 길은 그게 없어요"),
    "양쪽에 같은 요인이 있는데 '그게 없어요'라고 했다",
  );

// (나) 추천하지 않은 길을 골랐다 — **설득하지 않는다.**
// 이미 고르고 출발하려는 참이라 여기서 되돌리려 하면 남는 건 불안뿐이다.
const 역선택 = 대본(fast, safe)[1];
assert.ok(역선택.includes("익숙한 분들이 고르는 코스예요"), 역선택);
for (const 설득 of ["추천하지 않습니다", "권하지 않", "다시 생각", "부담이 큰 길입니다"])
  assert.ok(!역선택.includes(설득), `고른 사람을 되돌리려 한다: ${역선택}`);
// 이 길이 더 느리기까지 하면 시간 얘기를 꺼내지 않는다 — 짚으면 나무라는 말이 된다
assert.ok(!/\d+분/.test(역선택), `느린 길을 고른 사람에게 시간을 짚었다: ${역선택}`);

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
  radioScript(초보, 동점, 동점경로, fast, undefined, "성산일출봉")[1],
  radioScript(초보, 애매, 느린큰부담, 빠른큰부담, undefined, "성산일출봉")[1],
  "tie 와 unclear 를 같은 문장으로 말하고 있다",
);
// "익숙한 길로 가세요"는 쓰면 안 된다 — 기본 프로필이 경력 1년·제주 처음이고,
// 익숙한 길이 없어서 여기까지 온 사람들이다 (briefing.ts 못고른말 주석)
for (const r of [
  radioScript(초보, 동점, 동점경로, fast, undefined, "성산일출봉"),
  radioScript(초보, 애매, 느린큰부담, 빠른큰부담, undefined, "성산일출봉"),
])
  assert.ok(!r.join(" ").includes("익숙한 길"), "없는 걸 가리키는 조언을 하고 있다");

// --- ④ ③칸: 각오할 것 하나 ---
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
  undefined,
  "성산일출봉",
)[2];
// "2차로"는 고속주행 칸에만 나온다 — 좁은 교행 칸이 잡히면 "비켜야 해요"가 온다
assert.ok(셋째.includes("2차로"), `safe 의 최대 요인(고속주행)이 안 잡혔다: ${셋째}`);
assert.ok(!셋째.includes("비켜야"), `노출 3%짜리 좁은 교행이 잡혔다: ${셋째}`);
assert.ok(셋째.startsWith("하나만 기억하세요."), 셋째);
// ①이 이미 "큰길"·"산길"이라고 불렀으니 되풀이하지 않는다
for (const 되풀이 of ["큰길", "산길", "고갯길"])
  assert.ok(!대본()[2].includes(되풀이), `①이 부른 길 이름을 ③에서 되풀이했다: ${대본()[2]}`);

/*
 * ★ **편도 1차선을 왕복 1차선처럼 말하지 않는다.**
 *
 * 이 요인의 근거는 LANES=1 이고 그건 편도 한 차로다 — 대개 왕복 2차선이라 중앙선이 있고
 * 비킬 일이 없다. "넓은 데서 기다렸다 가라"는 중앙선 없는 왕복 1차선 얘기고, 편도 1차선
 * 70km/h 구간(금백조로)에서는 틀린 데다 위험한 조언이다 (briefing.ts WHY.narrowRoad 주석).
 */
const 좁은길칸 = radioScript(
  초보,
  scoreRoutes(초보, fast, 남의도로),
  남의도로,
  fast,
  undefined,
  "성산일출봉",
)[2];
for (const 틀린말 of ["비켜", "기다렸다", "후진", "물러나"])
  assert.ok(!좁은길칸.includes(틀린말), `편도 1차선에 왕복 1차선 조언을 했다: ${좁은길칸}`);
assert.ok(좁은길칸.includes("앞지르기"), 좁은길칸);

// --- ⑤ ④칸: 도착해서 차를 댈 곳 — 이 기능에서 제일 위험한 자리 ---
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
assert.ok(유형모름.includes("무료"), "형태를 몰라도 요금은 아는 값이다");

// 요금은 무료일 때만 한 마디. 금액은 귀로 들어서 할 일이 없고 화면 카드가 이미 보여준다.
assert.ok(대본()[3].includes("무료이고,"), 대본()[3]);
const 유료 = 대본(safe, fast, { ...추정평행, 요금: "유료" })[3];
assert.ok(!유료.includes("무료"), 유료);
assert.ok(!/\d+원/.test(유료), "금액을 말했다");

// 목적지를 모르면(주차장 찾기로 바로 들어온 흐름) 걸어서 몇 분인지도 모른다
const 도보모름 = 대본(safe, fast, { ...추정평행, 목적지까지도보분: null })[3];
assert.ok(!도보모름.includes("걸어서"), 도보모름);

/*
 * ★ 이름이 긴 주차장에서 칸이 상한을 넘으면 안 된다.
 *
 * 원본에는 "이도일동 1324-21, 1324-14, 1324-13, 1324-19, 1321-2" 같은 이름이 있다 —
 * 노상주차장에는 번지를 늘어놓은 이름이 붙고, 1,572곳 중 최장이 47자다. 그대로 부르면
 * 번지 다섯 개를 하나하나 읽어 주는 데다 칸이 상한을 넘어 /api/tts 가 400 을 준다.
 * 그러면 부르는 쪽은 서버 음성 실패로 읽고 **대본 전체를 내장 음성으로 다시 읽는다** —
 * 한 칸이 길다는 이유로 안내 전체의 목소리가 바뀐다.
 */
const 긴이름 = 대본(safe, fast, {
  ...추정평행,
  주차장: "이도일동 1324-21, 1324-14, 1324-13, 1324-19, 1321-2",
})[3];
assert.ok(긴이름.length <= 대본_최대글자, `긴 이름에서 칸이 넘쳤다 (${긴이름.length}자): ${긴이름}`);
assert.ok(긴이름.includes("이도일동 1324-21"), 긴이름);
assert.ok(!긴이름.includes("1321-2"), `번지를 다 읽고 있다: ${긴이름}`);
// 번지가 이름이면 조사도 **읽는 소리**를 따라야 한다 — "이십일이에요"지 "이십일예요"가 아니다
assert.ok(긴이름.includes("1324-21이에요"), `숫자 뒤 조사를 틀렸다: ${긴이름}`);
assert.ok(
  대본(safe, fast, { ...추정평행, 주차장: "노형동 1052" })[3].includes("1052예요"),
  "받침 없는 숫자(2)에 '이에요'를 붙였다",
);
// 괄호 안은 눈으로 보는 위치 설명이라 소리로 옮기지 않는다
const 괄호이름 = 대본(safe, fast, {
  ...추정평행,
  주차장: "서홍공영노외1주차장(서홍동주민센터 북서측)",
})[3];
assert.ok(!괄호이름.includes("북서측"), 괄호이름);

// --- ⑥ ⑤칸: 맺음말 ---
// 라디오의 맺음말은 고정이고, 그 한 마디가 안내가 끝났다는 신호가 된다.
for (const 종류 of [
  대본(),
  대본(fast, safe),
  radioScript(초보, 점수, safe, fast, undefined, "성산일출봉"),
  radioScript(초보, 요인없음점수, 요인없음, fast, undefined, undefined),
])
  assert.equal(종류.at(-1), "오늘도 안전운전하세요.", `맺음말이 없거나 다르다: ${종류.at(-1)}`);

console.log("✅ 출발 전 음성 대본 정상");
console.log(`   칸 구성 2~5 · 도로 이름에 뜻 붙임 · 추정/확정 구분 · 역선택 시 설득 안 함 확인`);
