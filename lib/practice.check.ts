// 연습 구간 검증 — node --experimental-strip-types lib/practice.check.ts
//
// 네트워크를 타지 않는다. 검증할 것:
//   ① 단계가 급커브 → 신호 순으로 갈리는가 (부담점수와 같은 우선순위여야 한다)
//   ② 왕복 링크를 편도로 접는가 (안 접으면 모든 거리·급커브가 두 배다)
//   ③ 연습으로 쓸 수 없는 길이를 걸러내는가

import assert from "node:assert";
import { buildIndex, type Link } from "./analyze.ts";
import { levelOf, practiceSegments } from "./practice.ts";
import type { Baseline } from "./flow.ts";
import type { LatLng } from "./curvature.ts";

// --- ① 단계 ---

assert.equal(levelOf(0, 0), 1); // 급커브도 신호도 없다 — 첫 연습
assert.equal(levelOf(0, 5), 1); // 신호 5개까지는 "몇 번 안 만난다"
assert.equal(levelOf(0, 6), 2); // 그 위는 신호 연습
assert.equal(levelOf(0, 20), 2);
assert.equal(levelOf(1, 0), 3); // 급커브가 있으면 신호와 무관하게 3단계
// 급커브가 신호보다 먼저다 — lib/score.ts 가 sharpCurve(12) 를 narrowRoad(10) 보다 크게 보는 것과 같은 순서
assert.equal(levelOf(1, 30), 3);

// --- ② 편도 접기 ---

const 시청: LatLng = [33.4996, 126.5312];

/**
 * 곧은 링크 하나. 위도 0.001도 ≈ 111m 라, 좌표 10개면 약 1km 다.
 * calmRoads 가 링크 3개 이상을 요구하므로(한 조각으로 도로를 대표하지 않는다)
 * 상행 2 + 하행 2 로 넉넉히 넣는다.
 */
const 곧은길 = (i: string, n: string, 시작la: number, 점수 = 10): Link => ({
  i,
  n,
  l: 2,
  s: 50,
  c: Array.from({ length: 점수 }, (_, k) => [126.5312, 시작la + k * 0.001] as [number, number]),
});

/** 같은 길을 상행·하행 두 줄로 깐다 — 표준노드링크가 왕복을 따로 담는 것과 같은 모양이다. */
const 왕복 = (n: string, 조각 = 2, 점수 = 10) =>
  ["U", "D"].flatMap((향) =>
    Array.from({ length: 조각 }, (_, k) => 곧은길(`${향}${k}`, n, 33.4996 + k * 0.009, 점수)),
  );

const 판 = buildIndex(왕복("복지로"));
const 속도 = new Map(판.links.map((l) => [l.i, 40]));
const 기준: Baseline = Object.fromEntries(판.links.map((l) => [l.i, 40]));

const [seg] = practiceSegments(판, 속도, 시청, 기준, []);
// 링크 4개(상행 2·하행 2) × 약 1km = 4km 지만, 편도는 2km 여야 한다
assert.ok(seg.km > 1.8 && seg.km < 2.2, `편도 ${seg.km}km — 왕복을 안 접었다`);
assert.equal(seg.curves, 0); // 곧은 길
assert.equal(seg.signals, 0); // 신호를 안 넘겼다
assert.equal(seg.level, 1);
assert.equal(seg.lanes, 2);

// 신호를 도로 위에 놓으면 세어야 한다 (그리고 2단계로 올라간다)
const 신호들: LatLng[] = Array.from({ length: 6 }, (_, k) => [33.4996 + k * 0.003, 126.5312]);
const [신호구간] = practiceSegments(판, 속도, 시청, 기준, 신호들);
assert.equal(신호구간.signals, 6);
assert.equal(신호구간.level, 2);

// 멀리 떨어진 신호는 안 센다 (100m 밖)
const [먼신호] = practiceSegments(판, 속도, 시청, 기준, [[33.4996, 126.545]]);
assert.equal(먼신호.signals, 0);

// --- ③ 길이 거르기 ---

// 300m 짜리는 연습이 안 된다 (편도 1km 미만)
const 짧은판 = buildIndex(왕복("짧은로", 2, 3));
const 짧은속도 = new Map(짧은판.links.map((l) => [l.i, 40]));
assert.deepEqual(
  practiceSegments(짧은판, 짧은속도, 시청, Object.fromEntries(짧은판.links.map((l) => [l.i, 40])), []),
  [],
);

// 차 없는 길이 하나도 없으면 연습 구간도 없다 (calmRoads 를 그대로 따른다)
const 막힌속도 = new Map(판.links.map((l) => [l.i, 10]));
assert.deepEqual(practiceSegments(판, 막힌속도, 시청, 기준, []), []);

// --- ④ 단계마다 따로 자른다 ---
//
// 전체에서 상위 N 개를 자르면 1단계가 많을 때 3단계가 영원히 안 나온다.
// 조용한 길 넷 + 커브 있는 길 하나를 놓고, 상한 2 에서도 3단계가 살아남는지 본다.
// 경도 0.01도 ≈ 930m 라, 반경(5km) 안에 들어오도록 촘촘히 벌린다
const 여럿 = buildIndex([
  ...왕복("가로"), // 곧고 신호 없음 → 1단계
  ...왕복("나로", 2, 10).map((l) => ({ ...l, c: l.c.map(([lo, la]) => [lo + 0.01, la] as [number, number]) })),
  ...왕복("다로", 2, 10).map((l) => ({ ...l, c: l.c.map(([lo, la]) => [lo + 0.02, la] as [number, number]) })),
  // 지그재그 + 제한속도 80 → 급커브. 임계 반경이 속도로 정해져서(80km/h → 280m,
  // 50km/h → 90m) 같은 굽이도 빠른 길에서만 급커브가 된다 — lib/curvature.ts MIN_CURVE_RADIUS.
  ...왕복("커브로", 2, 10).map((l) => ({
    ...l,
    s: 80,
    c: l.c.map(([lo, la], k) => [lo + 0.03 + (k % 2) * 0.0006, la] as [number, number]),
  })),
]);
const 여럿속도 = new Map(여럿.links.map((l) => [l.i, 40]));
const 여럿기준 = Object.fromEntries(여럿.links.map((l) => [l.i, 40]));
const 뽑힘 = practiceSegments(여럿, 여럿속도, 시청, 여럿기준, [], 2);
const 단계들 = new Set(뽑힘.map((s) => s.level));
assert.ok(단계들.has(3), `3단계가 잘렸다 — 나온 단계: ${[...단계들]}`);
// 단계마다 상한을 지킨다
for (const lv of 단계들) assert.ok(뽑힘.filter((s) => s.level === lv).length <= 2, `${lv}단계가 상한을 넘었다`);

console.log("✅ 연습 구간 정상");
console.log("   단계: 급커브 있으면 3 · 없으면 신호 5개 이하 1, 그 위 2");
console.log("   왕복 링크를 편도로 접는다 (안 접으면 거리·급커브가 두 배)");
console.log("   편도 1~5km 밖은 연습 구간으로 안 쓴다");
console.log("   단계마다 따로 자른다 — 전체 상위 N 개면 3단계가 영원히 밀린다");
