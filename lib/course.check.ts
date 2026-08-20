// 코스 생성 검증 — node --experimental-strip-types lib/course.check.ts
//
// 네트워크를 안 탄다. gatherCandidates(카카오 호출)와 buildCourses(순수 계산)를 나눠둔 이유가
// 이것이다 — 코스 규칙은 실제 응답 없이 전부 확인할 수 있어야 한다.
//
// 여기서 지키는 약속:
//   1. "꼭 가고 싶은 곳"은 절대 안 빠진다
//   2. 하루 운전 시간을 넘기지 않고, 못 가는 곳은 후보에서 아예 빠진다
//   3. 몇 박 며칠이든 코스는 하루치다
//   4. 하루가 출발지 옆에서 끝나지 않고, 한 유형만 돌지 않는다 (＝ "여행 같이")
//   5. 같은 입력이면 같은 코스가 나온다
//   6. 내용이 같은 코스를 둘로 늘리지 않는다 — 두 카드는 다른 지역이다

import assert from "node:assert";
import { buildCourses, driveMinutes, type Candidate, type Course } from "./course.ts";
import { meters } from "./parking.ts";
import { DEFAULT_TRIP, recipesFor, seasonOf, type TripPlan } from "./trip.ts";

const AIRPORT: [number, number] = [33.507, 126.493];

/** role 은 안 주면 테마 갈래로 본다 — 검사 대부분이 "고른 테마에서 나온 후보"를 다룬다 */
const spot = (
  name: string,
  at: [number, number],
  recipe: number | null,
  must = false,
  role: Candidate["role"] = recipe === null ? null : "theme",
): Candidate => ({
  name,
  at,
  addr: null,
  kind: "테스트",
  recipe,
  role,
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

/** 1박 2일을 골라도 코스는 하루(자리 3개)다. 후보 10곳이라 무엇을 넣을지 실제로 골라야 한다. */
const plan = (over: Partial<TripPlan> = {}): TripPlan => ({
  ...DEFAULT_TRIP,
  start: "2026-08-14",
  end: "2026-08-15",
  origin: "제주국제공항",
  originAt: AIRPORT,
  themes: [1], // 자연 속 산책 — 갈래가 둘(오름·숲길)이라 코스도 둘로 갈린다
  ...over,
});

const stopsOf = (c: Course) => c.days.flatMap((d) => d.stops.map((s) => s.name));

// --- 기본 모양 ---
const base = buildCourses(plan(), [...BEACHES, ...OREUM]);
assert.equal(base.length, 2, "관심사가 둘이면 코스도 둘");
for (const c of base) {
  assert.equal(c.days.length, 1, "1박 2일이어도 코스는 하루치");
  assert.deepEqual(c.days.map((d) => d.date), ["2026-08-14"], "하루는 여행 시작일이다");
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
assert.equal(packed[0].days.length, 1, "당일치기도 하루");
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

// --- 3. 몇 박 며칠이든 하루치 ---
// 기간이 길어져도 코스는 늘어나지 않는다. 늘어나면 화면(TRIP-06)이 다시 여러 날짜를 그린다.
for (const end of ["2026-08-14", "2026-08-16", "2026-08-20"])
  for (const c of buildCourses(plan({ end }), [...BEACHES, ...OREUM]))
    assert.equal(c.days.length, 1, `${end} 까지 가는 여행인데 코스가 하루가 아니다`);

// must 가 아닌 자리는 하루 정원(3곳)을 안 넘는다
for (const c of base)
  assert.ok(c.days[0].stops.filter((s) => !s.must).length <= 3, "하루 정원을 넘겼다");

// --- 계절 ---
// 달로 가른다. 날짜가 없거나 망가지면 null 이라 계절 후보를 안 붙인다
assert.equal(seasonOf("2026-03-01"), "봄");
assert.equal(seasonOf("2026-05-31"), "봄");
assert.equal(seasonOf("2026-06-01"), "여름");
assert.equal(seasonOf("2026-09-01"), "가을");
assert.equal(seasonOf("2026-12-01"), "겨울");
assert.equal(seasonOf("2026-02-28"), "겨울");
assert.equal(seasonOf(""), null);
assert.equal(seasonOf("2026-02-31"), null, "없는 날짜로 계절을 지어내지 않는다");

// 갈래는 테마 → 계절 → 기본 순이고, 같은 검색은 한 번만 한다
{
  const 여름 = recipesFor(plan({ themes: [0] })); // 8월 = 여름
  assert.equal(여름[0].role, "theme", "테마 갈래가 먼저");
  assert.equal(여름[0].label, "해변");
  assert.deepEqual(
    여름.map((r) => r.role),
    [...여름].sort((a, b) => "theme season staple".indexOf(a.role) - "theme season staple".indexOf(b.role)).map((r) => r.role),
    "테마 → 계절 → 기본 순서가 지켜진다",
  );

  // 「해변」과 「여름 해수욕장」은 검색이 똑같다 — 두 번 부르면 뒤엣것이 0곳이 되고
  // 있지도 않은 갈래가 카드를 이끈다 (recipesFor 의 중복 제거)
  assert.equal(여름.filter((r) => r.query === "해수욕장").length, 1, "같은 검색을 두 번 하지 않는다");
  assert.ok(!여름.some((r) => r.label === "여름 해수욕장"), "테마의 해변이 이미 있으면 계절 해수욕장은 빠진다");

  // 기본 갈래는 카카오를 안 부른다 — data/spots.json 에서 온다 (검색 조건이 비어 있다)
  const 기본 = 여름.filter((r) => r.role === "staple");
  assert.equal(기본.length, 1, "기본 갈래는 하나다 — 그래서 하루 한 곳으로 묶인다");
  assert.equal(기본[0].query, "", "기본 갈래는 검색 조건이 없다");

  // 겨울 여행에는 여름 갈래가 안 붙는다
  const 겨울 = recipesFor(plan({ themes: [0], start: "2026-12-10", end: "2026-12-11" }));
  assert.ok(!겨울.some((r) => r.label.startsWith("여름")));
  assert.ok(겨울.some((r) => r.label === "겨울 동백"));

  // 날짜를 모르면 계절 갈래만 빠진다 — 기본 갈래는 늘 붙는다 (밥 한 끼는 계절을 안 탄다)
  const 날짜없음 = recipesFor(plan({ themes: [0], start: "", end: "" }));
  assert.ok(!날짜없음.some((r) => r.role === "season"), "계절을 모르면 계절 후보를 안 붙인다");
  assert.deepEqual(날짜없음.map((r) => r.label), ["해변", "제주 대표 관광지"]);
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

// 계절 갈래가 후보가 더 많아도 **고른 테마가 1번 카드**다.
// (겨울에 「조용한 바다」를 골랐더니 1번이 "겨울 실내 전시"로 나왔다 — 박물관 45 > 해변 38)
{
  // themes:[0] 은 갈래가 하나(해변)라 recipe 0 이 테마, 1 부터가 계절이다
  const 테마 = BEACHES.slice(0, 3);
  const 계절 = OREUM.map((o) => spot(o.name, o.at, 1, false, "season"));
  const [첫카드, 둘째] = buildCourses(plan({ themes: [0] }), [...테마, ...계절]);
  assert.equal(첫카드.lead, 0, "고른 테마가 첫 카드를 잡는다");
  assert.equal(둘째?.lead, 1, "계절은 두 번째 카드로");
  assert.ok(첫카드.title.endsWith("해변"), `첫 카드 제목이 테마 갈래가 아니다: ${첫카드.title}`);
}

// 갈래가 둘인 테마여도 계절이 두 번째 카드를 잡는다 — 테마를 앞에 다 몰면 계절이 영영 안 나온다
{
  // themes:[1] 은 갈래가 둘(오름·숲길)이라 recipe 0·1 이 테마, 2 부터가 계절이다.
  // 테마 갈래 둘 다 계절보다 후보가 많게 둔다 — 그래도 계절이 두 번째 카드를 잡아야 한다.
  const 테마 = [
    ...OREUM.slice(0, 3).map((o) => spot(o.name, o.at, 0)),
    ...BEACHES.slice(0, 3).map((b) => spot(b.name, b.at, 1)),
  ];
  const 계절 = [
    spot("한라수목원", [33.4525, 126.4915], 2, false, "season"),
    spot("상효원수목원", [33.2965, 126.5905], 2, false, "season"),
  ];
  const [첫카드, 둘째] = buildCourses(plan({ themes: [1] }), [...테마, ...계절]);
  assert.ok(첫카드.lead !== null && 첫카드.lead < 2, `첫 카드는 테마 갈래여야 한다 (lead=${첫카드.lead})`);
  assert.equal(둘째?.lead, 2, "두 번째 카드는 테마의 다른 갈래가 아니라 계절");
}

// --- 4. "여행 같이" 세 가지 ---
// 셋 다 실제로 나왔던 코스다. 눈으로 보고 고친 규칙이라 눈이 없을 때 여기가 잡아야 한다.

// (가) 하루가 출발지 옆에서 끝나지 않는다
// 공항에서 「제주 먹거리」를 고르니 먹돌고기국수(1분) → 논짓물식당(2분) → 김희선제주몸국(3분),
// 3시간 예산에 이동 8분짜리가 나왔다 (lib/course.ts ANCHOR_SHARE).
{
  const 코앞 = [
    spot("공항앞1", [33.507, 126.5], 0),
    spot("공항앞2", [33.5, 126.493], 0),
    spot("공항앞3", [33.513, 126.487], 0),
  ];
  // 3시간이면 편도 54분 ≒ 27km 를 목표로 잡는다 — 협재·한림권이 그 거리다
  const 서부 = [
    spot("협재해수욕장", [33.3944, 126.2396], 0),
    spot("한림매일시장", [33.4142, 126.2652], 1),
    spot("금능낙원", [33.3898, 126.2352], 1),
  ];
  const [c] = buildCourses(plan({ driveHours: 3 }), [...코앞, ...서부]);
  const 이름 = c.days[0].stops.map((s) => s.name);
  assert.ok(!이름.every((n) => n.startsWith("공항앞")), `코앞 세 곳이 그대로 코스가 됐다: ${이름.join(" → ")}`);
  assert.ok(이름[0].startsWith("공항앞") === false, `하루의 첫 자리가 예산만큼 안 나갔다: ${이름.join(" → ")}`);
}

// (나) 한 유형만 돌지 않는다 — 「조용한 바다」가 해변만 셋이던 그 자리다
{
  const [c] = buildCourses(plan({ driveHours: 0 }), [...BEACHES, ...OREUM]);
  const 갈래 = c.days[0].stops.map((s) => s.recipe);
  assert.ok(
    new Set(갈래).size >= 2,
    `갈래가 둘인데 코스가 한 유형만 돈다: ${c.days[0].stops.map((s) => `${s.name}(${s.recipe})`).join(" → ")}`,
  );
}

// (다) 두 카드는 다른 지역이다 — 금능해수욕장·협재해수욕장을 두 카드가 나눠 갖던 자리
{
  const [a, b] = buildCourses(plan({ driveHours: 0 }), [...BEACHES, ...OREUM]);
  if (b)
    for (const s of b.days.flatMap((d) => d.stops))
      for (const t of a.days.flatMap((d) => d.stops))
        assert.ok(meters(s.at, t.at) >= 10_000, `두 카드가 같은 동네다: ${s.name} ↔ ${t.name}`);
}

// --- 5. 같은 입력이면 같은 코스 ---
const again = buildCourses(plan(), [...BEACHES, ...OREUM]);
assert.deepEqual(again, base, "새로고침마다 코스가 바뀌면 안 된다");
// 후보가 오는 순서가 달라져도(카카오 응답 순서는 보장이 없다) 결과는 같아야 한다
const shuffled = buildCourses(plan(), [...OREUM].reverse().concat([...BEACHES].reverse()));
assert.deepEqual(stopsOf(shuffled[0]), stopsOf(base[0]), "후보 순서가 달라도 같은 코스");

// --- 6. 가짜 선택지를 만들지 않는다 ---
// 후보가 자리보다 적으면 두 코스가 같은 곳을 돌 수밖에 없다 — 그럴 땐 카드가 하나다
const fits = buildCourses(plan({ themes: [0] }), BEACHES.slice(0, 3));
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
