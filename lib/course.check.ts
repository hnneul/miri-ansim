// 코스 생성 검증 — node --experimental-strip-types lib/course.check.ts
//
// 네트워크를 안 탄다. gatherCandidates(카카오 호출)와 buildCourses(순수 계산)를 나눠둔 이유가
// 이것이다 — 코스 규칙은 실제 응답 없이 전부 확인할 수 있어야 한다.
//
// 여기서 지키는 약속:
//   1. "꼭 가고 싶은 곳"은 절대 안 빠진다
//   2. 하루 운전 시간을 넘기지 않고, 못 가는 곳은 후보에서 아예 빠진다
//   3. 하루는 한 지역을 돈다 (섬을 왔다 갔다 하지 않는다)
//   4. 같은 입력이면 같은 코스가 나온다
//   5. 내용이 같은 코스를 둘로 늘리지 않는다

import assert from "node:assert";
import { buildCourses, driveMinutes, type Candidate, type Course } from "./course.ts";
import { meters } from "./parking.ts";
import { DEFAULT_TRIP, type TripPlan } from "./trip.ts";

const AIRPORT: [number, number] = [33.507, 126.493];

const spot = (name: string, at: [number, number], recipe: number | null, must = false): Candidate => ({
  name,
  at,
  addr: null,
  kind: "테스트",
  recipe,
  must,
});

// 실제 제주 좌표다 — 거리 계산이 말이 되는지 눈으로 확인할 수 있어야 한다.
// 갈래마다 다섯 곳씩 두는 건 실제와 같은 조건을 만들기 위해서다: 카카오는 한 갈래에
// 최대 15곳 × 앵커 4곳을 주므로 후보가 늘 자리(하루 3곳 × 일수)보다 많다.
const BEACHES = [
  spot("이호테우해수욕장", [33.4939, 126.4536], 0),
  spot("함덕해수욕장", [33.5432, 126.6695], 0),
  spot("곽지해수욕장", [33.4506, 126.306], 0),
  spot("삼양해수욕장", [33.5241, 126.5936], 0),
  spot("협재해수욕장", [33.3944, 126.2396], 0),
];
const OREUM = [
  spot("도두봉", [33.5065, 126.47], 1),
  spot("사라봉", [33.5209, 126.5423], 1),
  spot("새별오름", [33.3644, 126.3568], 1),
  spot("어승생악", [33.3925, 126.4964], 1),
  spot("절물자연휴양림", [33.4436, 126.6303], 1),
];
const SEONGSAN = spot("성산일출봉", [33.458, 126.9425], null, true);

/** 1박 2일 = 자리 6개. 후보 10곳이라 무엇을 넣을지 실제로 골라야 한다. */
const plan = (over: Partial<TripPlan> = {}): TripPlan => ({
  ...DEFAULT_TRIP,
  start: "2026-08-14",
  end: "2026-08-15",
  origin: "제주국제공항",
  originAt: AIRPORT,
  theme: 1, // 자연 속 산책 — 갈래가 둘(오름·숲길)이라 코스도 둘로 갈린다
  ...over,
});

const stopsOf = (c: Course) => c.days.flatMap((d) => d.stops.map((s) => s.name));

// --- 기본 모양 ---
const base = buildCourses(plan(), [...BEACHES, ...OREUM]);
assert.equal(base.length, 2, "관심사가 둘이면 코스도 둘");
for (const c of base) {
  assert.equal(c.days.length, 2, "1박 2일이면 하루씩 이틀");
  assert.deepEqual(c.days.map((d) => d.date), ["2026-08-14", "2026-08-15"], "날짜가 하루씩 늘어난다");
  // 같은 곳을 두 번 가지 않는다
  assert.equal(new Set(stopsOf(c)).size, stopsOf(c).length);
  // 합계는 날짜별 값의 합이다 (화면이 둘을 따로 보여준다)
  assert.equal(c.totalMin, c.days.reduce((s, d) => s + d.driveMin, 0));
}
// 두 코스가 서로 다른 갈래를 앞세운다
assert.notEqual(base[0].lead, base[1].lead);
assert.notDeepEqual(stopsOf(base[0]), stopsOf(base[1]), "내용이 같은 코스를 둘로 늘리지 않는다");

// --- 1. 꼭 가고 싶은 곳은 안 빠진다 ---
// 성산일출봉은 공항에서 편도 약 88분이라 "1시간 이내"를 혼자서도 넘긴다.
// 그래도 사용자가 지목한 자리라 코스에 남아야 한다.
const withMust = buildCourses(plan({ driveHours: 1 }), [SEONGSAN, ...BEACHES, ...OREUM]);
for (const c of withMust) assert.ok(stopsOf(c).includes("성산일출봉"), "must 는 상한을 넘겨서라도 넣는다");

// 자리보다 must 가 많아도 전부 들어간다 (하루 3곳 × 1일 = 3자리에 must 5곳)
const manyMusts = [
  spot("must1", [33.51, 126.5], null, true),
  spot("must2", [33.52, 126.51], null, true),
  spot("must3", [33.5, 126.52], null, true),
  spot("must4", [33.49, 126.49], null, true),
  spot("must5", [33.48, 126.48], null, true),
];
const packed = buildCourses(plan({ start: "2026-08-14", end: "2026-08-14", driveHours: 0 }), manyMusts);
assert.equal(packed[0].days.length, 1, "당일치기는 하루");
assert.equal(stopsOf(packed[0]).length, 5, "must 는 자리 수보다 많아도 안 자른다");

// --- 2. 하루 운전 시간 ---
// 상한을 넘는 날은 "한 곳뿐이라 더 줄일 수 없는 날"뿐이다
for (const hours of [1, 2, 3]) {
  const cap = hours * 60;
  for (const c of buildCourses(plan({ driveHours: hours }), [...BEACHES, ...OREUM])) {
    for (const d of c.days) {
      if (d.driveMin > cap) assert.equal(d.stops.length, 1, `${hours}시간 상한 초과는 한 곳짜리 날만 (${d.date})`);
    }
  }
}

// "시간 상관없음"(0)은 상한이 없다
const noCap = buildCourses(plan({ driveHours: 0 }), [...BEACHES, ...OREUM]);

// 하루 운전 시간은 돌아오는 길을 포함한다 — 왕복이 편도 합보다 커야 한다
for (const d of noCap[0].days) {
  if (!d.stops.length) continue;
  const legs = d.stops.reduce((s, x) => s + x.legMin, 0);
  assert.ok(d.driveMin > legs, "돌아오는 길이 빠져 있다");
}

// --- 날짜별로 지역이 갈린다 ---
// 하루는 한 지역을 돈다. 두 날의 경도 범위가 겹치면 섬을 왔다 갔다 하는 코스다.
for (const c of base) {
  const lngs = c.days.map((d) => d.stops.map((s) => s.at[1]));
  const [a, b] = lngs;
  if (a.length && b.length) {
    const apart = Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a);
    assert.ok(apart, `하루가 다른 날의 지역을 침범했다: ${c.days.map((d) => d.stops.map((s) => s.name).join(",")).join(" | ")}`);
  }
}

// --- 못 가는 곳은 후보에서 빠진다 ---
// "1시간 이내"를 골랐으면 편도 30분 밖은 아예 안 나온다. 사용자가 지목한 must 만 예외다.
for (const c of buildCourses(plan({ driveHours: 1 }), [SEONGSAN, ...BEACHES, ...OREUM]))
  for (const s of c.days.flatMap((d) => d.stops))
    if (!s.must)
      assert.ok(
        2 * driveMinutes(meters(AIRPORT, s.at)) <= 60,
        `${s.name} 은 하루 상한(60분)으로 왕복이 안 되는데 코스에 들어왔다`,
      );

// --- 3. 같은 입력이면 같은 코스 ---
const again = buildCourses(plan(), [...BEACHES, ...OREUM]);
assert.deepEqual(again, base, "새로고침마다 코스가 바뀌면 안 된다");
// 후보가 오는 순서가 달라져도(카카오 응답 순서는 보장이 없다) 결과는 같아야 한다
const shuffled = buildCourses(plan(), [...OREUM].reverse().concat([...BEACHES].reverse()));
assert.deepEqual(stopsOf(shuffled[0]), stopsOf(base[0]), "후보 순서가 달라도 같은 코스");

// --- 4. 가짜 선택지를 만들지 않는다 ---
// 후보가 자리보다 적으면 두 코스가 같은 곳을 돌 수밖에 없다 — 그럴 땐 카드가 하나다
const fits = buildCourses(plan({ theme: 0 }), BEACHES.slice(0, 3));
assert.equal(fits.length, 1, "후보가 자리 안에 다 들어가면 코스는 하나");
assert.equal(fits[0].days.flatMap((d) => d.stops).length, 3, "그 하나에는 후보가 다 들어간다");

// --- 못 만드는 경우 ---
assert.deepEqual(buildCourses(plan(), []), [], "후보가 없으면 코스도 없다");
assert.deepEqual(buildCourses(plan({ originAt: null }), BEACHES), [], "출발 좌표가 없으면 거리를 못 잰다");
assert.deepEqual(buildCourses(plan({ start: "", end: "" }), BEACHES), [], "날짜가 없으면 며칠짜리인지 모른다");

// --- 이동시간 어림값 ---
// 40km/h + 우회 1.3 배 — 20km 직선이면 39분
assert.equal(driveMinutes(20000), 39);
assert.equal(driveMinutes(0), 0);

console.log("lib/course.ts OK");
