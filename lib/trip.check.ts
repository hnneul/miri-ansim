// 여행 계획 URL 변환 검증 — node --experimental-strip-types lib/trip.check.ts
// URL은 사용자가 고칠 수 있는 입력이다. 여기가 새면 고른 적 없는 조건으로 코스가 만들어진다.

import assert from "node:assert";
import {
  COMPANIONS,
  DEFAULT_TRIP,
  DRIVE_HOURS,
  MAX_MUSTS,
  THEMES,
  dayLabel,
  monthGrid,
  shiftMonth,
  MAX_PER_PEOPLE,
  companionLabel,
  isReady,
  driveLabel,
  mustLabel,
  nightsOf,
  parseTrip,
  periodLabel,
  queryRecord,
  TRIP_KEYS,
  toTripQuery,
  type TripPlan,
} from "./trip.ts";

/** toTripQuery 결과를 다시 parseTrip 입력 형태로 되돌린다 — 화면이 쓰는 그 함수 그대로다 */
const roundTrip = (q: string) => parseTrip(queryRecord(q));

// 반복 키가 배열로 모인다. 여기가 새면 테마도 "꼭 가고 싶은 곳"도 마지막 하나만 살아남는다
assert.deepEqual(queryRecord("theme=0&theme=2&must=A"), { theme: ["0", "2"], must: "A" });

// --- 왕복 ---
// 기본값이 왕복을 견딘다
assert.deepEqual(roundTrip(toTripQuery(DEFAULT_TRIP)), DEFAULT_TRIP);

// 다 채운 계획도 왕복을 견딘다 — 한 값이라도 새면 그 조건이 코스에서 빠진다
const full: TripPlan = {
  themes: [1, 3],
  start: "2026-08-14",
  end: "2026-08-16",
  companion: "family",
  people: { adult: 2, teen: 1, child: 3 },
  origin: "제주국제공항",
  originAt: [33.5070, 126.4930],
  driveHours: 0,
  musts: ["성산일출봉", "협재해수욕장"],
};
assert.deepEqual(roundTrip(toTripQuery(full)), full);

// 동행·운전시간·테마의 모든 선택지가 왕복을 견딘다
for (const c of COMPANIONS)
  for (const d of DRIVE_HOURS)
    for (let t = 0; t < THEMES.length; t++) {
      const plan = { ...full, companion: c.id, driveHours: d.hours, themes: [t] };
      assert.deepEqual(roundTrip(toTripQuery(plan)), plan);
    }

// 테마를 전부 고른 것도, 하나도 안 고른 것도 왕복을 견딘다 — 순서까지 그대로다
const every = { ...full, themes: THEMES.map((_, i) => i) };
assert.deepEqual(roundTrip(toTripQuery(every)).themes, every.themes);
assert.deepEqual(roundTrip(toTripQuery({ ...full, themes: [3, 0] })).themes, [3, 0]);
assert.deepEqual(roundTrip(toTripQuery({ ...full, themes: [] })).themes, []);

// 장소 이름에 쉼표·앰퍼샌드가 들어가도 쪼개지지 않는다 (반복 키로 싣는 이유)
const comma = { ...full, musts: ["카페 A&B", "제주, 그 바다"] };
assert.deepEqual(roundTrip(toTripQuery(comma)).musts, comma.musts);

// TRIP_KEYS 는 toTripQuery 가 싣는 키와 어긋나면 안 된다 —
// 빠진 키는 "새로 시작"할 때 안 걷혀서 지난 여행 조건이 그대로 따라온다
assert.deepEqual(
  [...new Set(new URLSearchParams(toTripQuery(full).slice(1)).keys())].sort(),
  [...TRIP_KEYS].filter((k) => new URLSearchParams(toTripQuery(full).slice(1)).has(k)).sort(),
  "toTripQuery 가 TRIP_KEYS 에 없는 키를 싣는다",
);
assert.equal(new URLSearchParams(toTripQuery(full).slice(1)).getAll("theme").length, full.themes.length);

// --- 검증 (신뢰 경계) ---
// 빈 쿼리는 기본 계획
assert.deepEqual(parseTrip({}), DEFAULT_TRIP);

// 테마는 여러 개. 목록 밖·정수 아님은 통째로 버린다 — 고른 적 없는 테마로 코스를 짜지 않는다
for (let i = 0; i < THEMES.length; i++) assert.deepEqual(parseTrip({ theme: String(i) }).themes, [i]);
assert.deepEqual(parseTrip({ theme: String(THEMES.length) }).themes, []);
assert.deepEqual(parseTrip({ theme: "-1" }).themes, []);
assert.deepEqual(parseTrip({ theme: "1.5" }).themes, []);
assert.deepEqual(parseTrip({ theme: "바다" }).themes, []);
assert.deepEqual(parseTrip({ theme: "" }).themes, []);
// 빈 문자열이 0 으로 새면 안 된다 — Number("") 는 0 이다
assert.deepEqual(parseTrip({}).themes, []);
// 성한 값만 남기고 나머지는 버린다 (하나가 망가졌다고 나머지까지 버리지 않는다)
assert.deepEqual(parseTrip({ theme: ["1", "바다", "2"] }).themes, [1, 2]);
// 같은 테마가 두 번 오면 한 번만 — 안 지우면 그 테마만 후보를 두 배로 긁는다
assert.deepEqual(parseTrip({ theme: ["2", "2", "0"] }).themes, [2, 0]);

// 없는 날짜는 안 받는다
assert.equal(parseTrip({ from: "2026-02-31", to: "2026-03-02" }).start, "");
assert.equal(parseTrip({ from: "2026-8-1", to: "2026-08-03" }).start, "");
// 끝이 시작보다 앞서면 둘 다 버린다 — 음수 기간으로 코스를 짜지 않는다
assert.equal(parseTrip({ from: "2026-08-16", to: "2026-08-14" }).end, "");
// 한쪽만 와도 둘 다 버린다
assert.equal(parseTrip({ from: "2026-08-14" }).start, "");

// 허용 목록 밖의 동행·운전시간은 null — 기본값으로 채우면 고른 적 없는 조건이 코스에 들어간다
assert.equal(parseTrip({ with: "coworker" }).companion, null);
assert.equal(parseTrip({ drive: "24" }).driveHours, null);
// 0(상관없음)은 유효한 값이라 기본값으로 떨어지면 안 된다
assert.equal(parseTrip({ drive: "0" }).driveHours, 0);

// 인원은 0~MAX 로 자른다. 음수·소수는 기본값으로 되돌린다
assert.equal(parseTrip({ ppl: "99,0,0" }).people.adult, MAX_PER_PEOPLE);
assert.equal(parseTrip({ ppl: "-3,0,0" }).people.adult, DEFAULT_TRIP.people.adult);
assert.equal(parseTrip({ ppl: "1.5,0,0" }).people.adult, DEFAULT_TRIP.people.adult);
assert.equal(DEFAULT_TRIP.people.adult, 0, "카운터가 0 에서 시작한다 (04-B-2)");
assert.equal(parseTrip({ ppl: "0,0,0" }).people.adult, 0);

// 좌표는 둘 다 수여야 쓴다 — 하나만 오면 지도에 엉뚱한 자리가 찍힌다
assert.equal(parseTrip({ originLat: "33.5" }).originAt, null);
assert.equal(parseTrip({ originLat: "33.5", originLng: "abc" }).originAt, null);
assert.deepEqual(parseTrip({ originLat: "33.5", originLng: "126.5" }).originAt, [33.5, 126.5]);

// 꼭 가고 싶은 곳은 상한을 넘지 않고, 빈 값은 자리를 차지하지 않는다
assert.equal(parseTrip({ must: Array.from({ length: MAX_MUSTS + 5 }, (_, i) => `장소${i}`) }).musts.length, MAX_MUSTS);
assert.deepEqual(parseTrip({ must: ["  ", "비자림", ""] }).musts, ["비자림"]);

// 같은 키가 하나만 와도 배열로 취급된다 (Next 의 searchParams 는 둘 다 준다)
assert.deepEqual(parseTrip({ must: "비자림" }).musts, ["비자림"]);

// --- 화면 문구 ---
assert.deepEqual(nightsOf("2026-08-14", "2026-08-16"), { nights: 2, days: 3 });
assert.deepEqual(nightsOf("2026-08-14", "2026-08-14"), { nights: 0, days: 1 });
assert.equal(nightsOf("2026-08-16", "2026-08-14"), null);
// 서머타임이 있는 지역에서도 밤이 새지 않는다 (UTC 로 세는 이유)
assert.deepEqual(nightsOf("2026-03-07", "2026-03-09"), { nights: 2, days: 3 });

assert.equal(periodLabel(full), "2박 3일");
assert.equal(periodLabel({ ...full, end: full.start }), "당일치기");
assert.equal(periodLabel(DEFAULT_TRIP), null);

assert.equal(companionLabel(full), "가족 6명");
// 혼자는 인원을 안 붙인다 — "혼자 1명"은 같은 말을 두 번 한다
assert.equal(companionLabel({ ...full, companion: "solo" }), "혼자");
// 안 고른 값은 문구를 지어내지 않는다 — 화면이 "동행을 골라주세요"를 대신 쓴다
assert.equal(companionLabel(DEFAULT_TRIP), null);
assert.equal(driveLabel(full), "시간 상관없음");
assert.equal(driveLabel(DEFAULT_TRIP), null);

assert.equal(mustLabel(full), "성산일출봉 외 1곳");
assert.equal(mustLabel({ ...full, musts: ["비자림"] }), "비자림");
assert.equal(mustLabel(DEFAULT_TRIP), null);

// --- 코스를 만들 수 있는 조건 ---
assert.equal(isReady(full), true);
assert.equal(isReady(DEFAULT_TRIP), false);
// 필수 세 줄 중 하나라도 비면 못 넘어간다
assert.equal(isReady({ ...full, origin: "" }), false);
assert.equal(isReady({ ...full, start: "", end: "" }), false);
assert.equal(isReady({ ...full, companion: null }), false);
assert.equal(isReady({ ...full, musts: [] }), true, "꼭 가고 싶은 곳은 없어도 코스가 나온다");
// 하루 운전은 "선택" 묶음이라 안 골라도 넘어간다 (없으면 이동시간 상한을 안 걸 뿐이다)
assert.equal(isReady({ ...full, driveHours: null }), true);
// 테마도 여기서 안 본다 — 다음 화면(TRIP-03)이 자기 자리에서 막는다
assert.equal(isReady({ ...full, themes: [] }), true);

// --- 달력 격자 (TRIP-04-A) ---
// 월말·윤년에서 조용히 틀리는 자리라 눈으로 안 보고 여기서 잡는다
{
  const aug = monthGrid("2026-08");
  assert.equal(aug.length, 42, "6주 × 7칸");
  // 첫 칸은 늘 일요일이고, 마지막 칸까지 하루씩 이어진다
  assert.equal(new Date(`${aug[0].date}T00:00:00Z`).getUTCDay(), 0);
  for (let i = 1; i < aug.length; i++)
    assert.equal(
      Date.parse(`${aug[i].date}T00:00:00Z`) - Date.parse(`${aug[i - 1].date}T00:00:00Z`),
      86_400_000,
      `${aug[i - 1].date} 다음이 ${aug[i].date} 가 아니다`,
    );
  // 그 달 날짜는 빠짐없이 들어 있다
  assert.equal(aug.filter((c) => c.inMonth).length, 31);
  assert.equal(aug.find((c) => c.inMonth)!.date, "2026-08-01");

  // 윤년 2월은 29일 — 2024 는 윤년, 2026 은 아니다
  assert.equal(monthGrid("2024-02").filter((c) => c.inMonth).length, 29);
  assert.equal(monthGrid("2026-02").filter((c) => c.inMonth).length, 28);

  // 어느 달이든 42칸에 다 담긴다 (31일 달이 토요일에 시작하는 최악의 경우 포함)
  for (let y = 2024; y <= 2030; y++)
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const cells = monthGrid(key);
      assert.equal(cells.filter((c) => c.inMonth).length, new Date(Date.UTC(y, m, 0)).getUTCDate(), `${key} 가 안 담긴다`);
    }

  // 달 넘기기 — 연말·연초를 넘어간다
  assert.equal(shiftMonth("2026-08", 1), "2026-09");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-08", 0), "2026-08");

  assert.equal(dayLabel("2026-08-14"), "8월 14일");
  assert.equal(dayLabel("2026-12-01"), "12월 1일");
}

console.log("lib/trip.ts OK");