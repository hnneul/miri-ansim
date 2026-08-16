// node --experimental-strip-types lib/unprotected.check.ts
//
// 이 파일이 지키는 건 하나다: **모르는 것과 없는 것이 섞이지 않는가.**
// 판독표에 없는 좌회전을 지나면 0 이 아니라 null 이어야 한다. 여기가 무너지면 화면이
// "비보호 없음"이라고 확인한 척한다 — 이 프로젝트가 처음부터 안 하기로 한 일이다.

import assert from "node:assert";
import { unprotectedCount } from "./unprotected.ts";
import type { LatLng } from "./curvature.ts";

/** 판독표에 실제로 있는 지점들 (data/unprotected-left.json) */
const 덕수1: LatLng = [33.27379411164411, 126.30395888982868]; // 비보호
const 다호: LatLng = [33.50417160924162, 126.49627450764577]; // 보호
const 중앙로: LatLng = [33.25078305542968, 126.5643264985591]; // 무신호
const 사계리: LatLng = [33.234786934466385, 126.30819914779829]; // 미판정(null)
const 바다: LatLng = [33.9, 126.9]; // 표에 없는 좌표

assert.equal(unprotectedCount([]), 0, "좌회전이 없으면 0이다 — 모르는 게 아니라 없는 것이다");
assert.equal(unprotectedCount([덕수1]), 1);
assert.equal(unprotectedCount([다호]), 0, "보호만 지나면 확인된 0");
assert.equal(unprotectedCount([중앙로]), 0, "무신호는 비보호가 아니다");
assert.equal(unprotectedCount([덕수1, 다호, 중앙로]), 1);

// 여기가 요점이다
assert.equal(unprotectedCount([바다]), null, "표에 없는 지점 → 모른다");
assert.equal(unprotectedCount([사계리]), null, "판단불가·미판정 → 모른다");
assert.equal(
  unprotectedCount([덕수1, 바다]),
  null,
  "하나만 몰라도 전체가 null — 아는 것만 세면 과소집계가 사실처럼 읽힌다",
);

// 30m 밖은 다른 지점이다. 중앙로62번길 두 지점이 62m 떨어져 있어 이 경계가 실제로 걸린다.
const 덕수1_40m밖: LatLng = [33.27379411164411 + 0.00036, 126.30395888982868];
assert.equal(unprotectedCount([덕수1_40m밖]), null, "40m 떨어지면 그 지점으로 안 본다");

console.log("✅ 비보호 조회 정상 — 모르는 것(null)과 없는 것(0)이 안 섞인다");
