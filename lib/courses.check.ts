// 받아 둔 코스 저장소 확인 — node --experimental-strip-types lib/courses.check.ts
//
// 브라우저 없이 도는 자리라 localStorage 를 흉내 내서 끼운다. 여기서 보는 건 세 가지다 —
// 같은 이름을 한 벌만 남기는가, 상한을 지키는가, 깨진 값을 걸러내는가.

import assert from "node:assert/strict";

const 저장소 = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => 저장소.get(k) ?? null,
  setItem: (k: string, v: string) => void 저장소.set(k, v),
  removeItem: (k: string) => void 저장소.delete(k),
};

const { loadCourses, rememberCourse } = await import("./courses.ts");

const 코스 = (name: string) => ({ date: "2026-08-20", course: name, route: ["제주공항", name], km: 30 });

assert.deepEqual(loadCourses(), [], "빈 저장소는 빈 목록이다");

rememberCourse(코스("바다와 노을"));
rememberCourse(코스("오름 한 바퀴"));
assert.deepEqual(
  loadCourses().map((c) => c.course),
  ["오름 한 바퀴", "바다와 노을"],
  "맨 앞에 넣는다",
);

// 같은 이름을 다시 받아도 목록이 그 이름으로 늘어나지 않는다 — 앞으로 올라오기만 한다
rememberCourse(코스("바다와 노을"));
assert.deepEqual(
  loadCourses().map((c) => c.course),
  ["바다와 노을", "오름 한 바퀴"],
  "같은 코스는 한 벌만, 맨 앞으로",
);

for (let i = 0; i < 20; i++) rememberCourse(코스(`코스 ${i}`));
assert.equal(loadCourses().length, 10, "상한(MAX)을 넘지 않는다");

// 사용자가 손댈 수 있는 입력이다 — 목록이 아니거나 모양이 틀린 값은 화면까지 가면 안 된다
저장소.set("gilansim:courses", '{"course":"객체다"}');
assert.deepEqual(loadCourses(), [], "배열이 아니면 빈 목록");

저장소.set("gilansim:courses", '[{"course":"이름만"},{"course":"제대로","route":["제주공항","협재"],"date":"2026-08-20","km":1}]');
assert.deepEqual(
  loadCourses().map((c) => c.course),
  ["제대로"],
  "route 가 없는 값은 걸러낸다",
);

저장소.set("gilansim:courses", "깨진 JSON {{");
assert.deepEqual(loadCourses(), [], "JSON 이 깨져도 빈 목록");

console.log("✅ 받아 둔 코스 저장소 정상");
