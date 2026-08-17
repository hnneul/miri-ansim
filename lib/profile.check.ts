// 프로필 URL 변환 검증 — node --experimental-strip-types lib/profile.check.ts
// URL은 사용자가 고칠 수 있는 입력이다. 여기가 새면 점수가 조용히 틀린 프로필로 계산된다.

import assert from "node:assert";
import { parseProfile, parseConcerns, fearedRisksOf, toQuery, toProfileQuery, CONCERNS, DEFAULT_PROFILE, OPTIONS } from "./profile.ts";

/** toQuery 결과를 다시 parseProfile 입력 형태로 되돌린다 */
const roundTrip = (q: string) => parseProfile(Object.fromEntries(new URLSearchParams(q)));

// --- 왕복 ---
// 모든 선택지 조합이 왕복을 견딘다 — 하나라도 새면 그 조합의 점수가 틀린다
for (const exp of OPTIONS.experienceYears)
  for (const freq of OPTIONS.drivingFrequency)
    for (const car of OPTIONS.vehicleSize)
      for (const time of OPTIONS.timeOfDay)
        for (const jeju of [true, false]) {
          const p = { experienceYears: exp, drivingFrequency: freq, jejuExperience: jeju, vehicleSize: car, timeOfDay: time };
          assert.deepEqual(roundTrip(toQuery(p, "x")), p);
        }

// 구간 id도 실려야 한다
assert.equal(new URLSearchParams(toQuery(DEFAULT_PROFILE, "hyeopjae")).get("route"), "hyeopjae");

// --- 검증 (신뢰 경계) ---
// 빈 쿼리는 기본 프로필
assert.deepEqual(parseProfile({}), DEFAULT_PROFILE);

// 허용 목록 밖의 값은 기본값으로 되돌린다 — 부담을 낮추는 쪽으로 새면 안 된다
assert.equal(parseProfile({ exp: "99" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ exp: "0" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ exp: "abc" }).experienceYears, DEFAULT_PROFILE.experienceYears);
assert.equal(parseProfile({ freq: "never" }).drivingFrequency, DEFAULT_PROFILE.drivingFrequency);
assert.equal(parseProfile({ car: "truck" }).vehicleSize, DEFAULT_PROFILE.vehicleSize);
assert.equal(parseProfile({ time: "dawn" }).timeOfDay, DEFAULT_PROFILE.timeOfDay);

// jeju는 "true"만 참 — 오타가 "경험 있음"으로 새면 가중치 ×1.2가 빠져 부담이 과소 계상된다
assert.equal(parseProfile({ jeju: "true" }).jejuExperience, true);
assert.equal(parseProfile({ jeju: "1" }).jejuExperience, false);
assert.equal(parseProfile({ jeju: "TRUE" }).jejuExperience, false);
assert.equal(parseProfile({}).jejuExperience, false);

// 같은 키가 여러 번 오면 첫 값을 쓴다 (?exp=1&exp=10)
assert.equal(parseProfile({ exp: ["10", "1"] }).experienceYears, 10);
assert.equal(parseProfile({ exp: ["bad", "10"] }).experienceYears, DEFAULT_PROFILE.experienceYears);

// --- 부담 유형 (마이 화면이 되읽는 값) ---
const concerns = (q: string) => parseConcerns(Object.fromEntries(new URLSearchParams(q)));

// 왕복 — 고른 인덱스가 그대로 돌아온다
assert.deepEqual(concerns(toProfileQuery(DEFAULT_PROFILE, [0, 4])), [0, 4]);
// 안 고르면 키째 빠지고, 빈 배열로 읽힌다
assert.equal(new URLSearchParams(toProfileQuery(DEFAULT_PROFILE)).has("hard"), false);
assert.deepEqual(concerns(toProfileQuery(DEFAULT_PROFILE)), []);

// 범위 밖·정수 아님·중복은 버린다. 화면 순서대로 나온다 — CONCERNS 인덱스로 읽으니 새면 [i] 가 undefined 다
assert.deepEqual(parseConcerns({ hard: `${CONCERNS.length}` }), []);
assert.deepEqual(parseConcerns({ hard: "-1,abc,1.5," }), []);
assert.deepEqual(parseConcerns({ hard: "4,0,4" }), [0, 4]);
assert.ok(parseConcerns({ hard: "0,1,2,3,4,5,6,7" }).every((i) => CONCERNS[i]));

// --- 부담 유형 → 위험 타입 (점수 가중치로 넘어가는 매핑) ---
// 승인된 표 그대로. 여기가 새면 사용자가 고른 긴장되는 길과 다른 위험에 가중치가 붙는다.
assert.deepEqual(fearedRisksOf([0]), ["narrowRoad"]); // 좁은 골목길
assert.deepEqual(fearedRisksOf([1]), ["complexJunction"]); // 복잡한 교차로
assert.deepEqual(fearedRisksOf([2]), ["steepSlope", "sharpCurve"]); // 급경사·굽은 길 (둘)
assert.deepEqual(fearedRisksOf([3]), ["sharpCurve"]); // 어두운 길 → 곡률로 대신
assert.deepEqual(fearedRisksOf([4]), [], "주차 어려운 곳은 경로 점수 대응이 없다");
assert.deepEqual(fearedRisksOf([5]), [], "해당 없음은 대응이 없다");
// 급경사·굽은 길 + 어두운 길이 둘 다 급커브를 가리켜도 한 번만 (스택 안 함)
assert.deepEqual(fearedRisksOf([2, 3]), ["steepSlope", "sharpCurve"]);

// parseProfile 이 hard= 를 fearedRisks 로 옮긴다 — 여기서 점수 경로에 실제로 닿는다
assert.deepEqual(parseProfile({ hard: "0" }).fearedRisks, ["narrowRoad"]);
assert.deepEqual(parseProfile({ hard: "2,3" }).fearedRisks, ["steepSlope", "sharpCurve"]);
// 대응이 없으면(주차·없음만, 또는 아무것도) 키째 빠진다 — 위 deepEqual(parseProfile({}), DEFAULT) 이 이걸 지킨다
assert.equal("fearedRisks" in parseProfile({}), false);
assert.equal("fearedRisks" in parseProfile({ hard: "4,5" }), false);

console.log("✅ 프로필 URL 왕복 + 입력 검증 정상");
