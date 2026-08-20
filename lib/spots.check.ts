// 관광지 순위 검증 — node --experimental-strip-types lib/spots.check.ts
//
// 네트워크를 타지 않는다. 검증할 게 카카오가 응답하느냐가 아니라 **무엇을 후보로 고르고
// 어떤 순서로 세우느냐**이기 때문이다.
//
//   ① 후보를 거리 띠로 고르는가 (한쪽으로 쏠리면 "제주 여행" 목록이 안 된다)
//   ② 띠 안에서 카테고리를 섞는가 (해변만 넷이면 심심하다)
//   ③ 부담을 등급으로 옳게 가르는가 (경계가 경력 가중치를 타야 한다)
//   ④ 등급 먼저, 같은 등급이면 가까운 순으로 세우는가
//
// 정체 집계는 lib/traffic.ts 의 congestionOf 를 그대로 쓰므로 저쪽 check 가 맡는다.

import assert from "node:assert";
import { pickCandidates, gradeOf, byGradeThenTime, type Spot } from "./spots.ts";
import type { DriverProfile } from "./score.ts";
import type { LatLng } from "./curvature.ts";

/** 등급 경계가 경력 가중치를 타므로 프로필을 같이 넘겨야 한다 */
const 프로필 = (experienceYears: number): DriverProfile => ({
  experienceYears,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
});
const 왕초보 = 프로필(1); // 가중치 1.6
const 익숙 = 프로필(10); // 가중치 1.0

const 공항: LatLng = [33.507, 126.493];

/**
 * 관광지 하나. 위도 0.009도 ≈ 1km 라, km 를 주면 그만큼 북쪽에 놓인다.
 * (거리 띠 경계를 정확히 겨냥하려고 위도만 움직인다)
 */
const spot = (name: string, category: string, km: number): Spot => ({
  name,
  category,
  at: [공항[0] + km * 0.009, 공항[1]],
  addr: null,
  kind: null,
  thumb: null,
  imageRights: null,
});

// --- ① 거리 띠 ---

// 45km 밖은 후보에서 빠진다 — 제주가 동서 73km 라 이 밖이면 하루를 통째로 쓴다
assert.deepEqual(pickCandidates([spot("먼곳", "바다", 60)], 공항), []);

// **이 검증이 잡아야 하는 실제 버그**: 처음엔 카테고리별 최근접만 뽑았더니 제주공항
// 반경 5km 가 목록을 다 차지해 무지개해안도로·용두암·도두봉만 나왔다. 함덕도 협재도
// 없는 "제주 여행" 목록이었다. 그래서 **근처가 아무리 많아도 근처 띠 몫만 가져가야** 한다.
const 근처몰림 = [
  // 근처(~10km)에 카테고리를 흩어 여덟 곳 — 거리순으로 자르면 이것들이 목록을 다 먹는다
  spot("근처1", "바다", 1),
  spot("근처2", "자연", 2),
  spot("근처3", "전시", 3),
  spot("근처4", "시장", 4),
  spot("근처5", "폭포", 5),
  spot("근처6", "바다", 6),
  spot("근처7", "자연", 7),
  spot("근처8", "전시", 8),
  // 멀리 있는 진짜 관광지들
  spot("먼바다", "바다", 30),
  spot("먼자연", "자연", 35),
  spot("먼전시", "전시", 40),
];
const 뽑힘 = pickCandidates(근처몰림, 공항);
const 이름들 = 뽑힘.map((s) => s.name);

const 근처수 = 이름들.filter((n) => n.startsWith("근처")).length;
assert.ok(근처수 <= 2, `근처가 ${근처수}곳 — 가까운 곳이 목록을 다 먹었다: ${이름들}`);
assert.ok(
  이름들.some((n) => n.startsWith("먼")),
  `먼 곳이 하나도 없다 — 여행 목록이 아니라 동네 목록이다: ${이름들}`,
);

// 같은 곳이 두 번 담기지 않는다
assert.equal(new Set(이름들).size, 이름들.length);

// 카카오를 부를 개수라 상한이 있어야 한다 (10곳 = 실측 400ms)
assert.ok(뽑힘.length <= 10, `후보가 ${뽑힘.length}곳 — 상한을 넘었다`);

// --- ② 띠 안 카테고리 섞기 ---

// 중간 띠(~25km, 4곳 몫)에 해변만 여섯을 깔아도 카테고리 상한(2) 때문에 둘까지만 담는다.
// 근처 띠는 비워 둬서 "띠 몫이 2곳이라 2곳"인 것과 구분한다.
const 해변만 = [12, 14, 16, 18, 20, 22].map((km) => spot(`해변${km}`, "바다", km));
const 해변뽑힘 = pickCandidates(해변만, 공항);
assert.ok(
  해변뽑힘.length <= 2,
  `한 띠에서 같은 카테고리를 ${해변뽑힘.length}곳 담았다 — 목록이 해변으로만 찬다`,
);

// 빈 입력은 빈 결과다 (화면이 "주변에 없어요"로 떨어진다)
assert.deepEqual(pickCandidates([], 공항), []);

// --- ③ 부담 등급 (경계 = 15/30 × 경력 가중치) ---

// 익숙(가중치 1.0) — 경계가 15/30 이다
assert.equal(gradeOf(15, 익숙), "easy");
assert.equal(gradeOf(16, 익숙), "ok");
assert.equal(gradeOf(30, 익숙), "ok");
assert.equal(gradeOf(31, 익숙), "hard");

// 왕초보(가중치 1.6) — 경계가 24/48 로 밀린다
assert.equal(gradeOf(24, 왕초보), "easy");
assert.equal(gradeOf(25, 왕초보), "ok");
assert.equal(gradeOf(48, 왕초보), "ok");
assert.equal(gradeOf(49, 왕초보), "hard");

// **같은 점수라도 프로필이 다르면 등급이 다르다.** 부담점수 자체가 이미 가중치를 타서
// 왕초보는 같은 길에 더 높은 점수를 받기 때문이다 — 경계를 고정하면 왕초보는 죄다
// "부담돼요"가 되고 익숙한 사람은 죄다 "편해요"가 된다 (실측으로 그렇게 나왔다).
assert.equal(gradeOf(28, 익숙), "ok");
assert.equal(gradeOf(28, 왕초보), "ok");
assert.equal(gradeOf(20, 익숙), "ok");
assert.equal(gradeOf(20, 왕초보), "easy");

// --- ④ 정렬 ---

const r = (grade: "easy" | "ok" | "hard", min: number) => ({ grade, min });

// 등급이 먼저다 — 7분짜리 "보통"보다 54분짜리 "편해요"가 위로 온다.
// 이게 이 화면의 요점이다: 시간이 아니라 부담이 순서를 정한다.
assert.deepEqual([r("ok", 7), r("easy", 54)].sort(byGradeThenTime), [r("easy", 54), r("ok", 7)]);
// 같은 등급 안에서는 가까운 순
assert.deepEqual([r("easy", 54), r("easy", 7)].sort(byGradeThenTime), [r("easy", 7), r("easy", 54)]);
// 세 등급이 순서대로 선다
assert.deepEqual(
  [r("hard", 1), r("ok", 1), r("easy", 1)].sort(byGradeThenTime).map((x) => x.grade),
  ["easy", "ok", "hard"],
);

console.log("✅ 관광지 순위 정상");
console.log("   후보: 거리 띠(10/25/45km)로 갈라 뽑고, 띠 안에서 카테고리를 섞는다");
console.log("   순서: 부담 등급이 먼저 · 같은 등급이면 가까운 순");
