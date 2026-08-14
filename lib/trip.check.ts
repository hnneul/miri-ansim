// 여행 계획 URL 변환 검증 — node --experimental-strip-types lib/trip.check.ts
// URL은 사용자가 고칠 수 있는 입력이다. 여기가 새면 고른 적 없는 조건으로 코스가 만들어진다.

import assert from "node:assert";
import {
  COMPANIONS,
  DEFAULT_TRIP,
  DRIVE_HOURS,
  INTERESTS,
  MAX_MUSTS,
  MAX_PER_PEOPLE,
  MOODS,
  companionLabel,
  isReady,
  mustLabel,
  nightsOf,
  parseTrip,
  periodLabel,
  toTripQuery,
  type TripPlan,
} from "./trip.ts";

/** toTripQuery 결과를 다시 parseTrip 입력 형태로 되돌린다. 같은 키가 여러 번이면 배열로 모은다. */
const roundTrip = (q: string) => {
  const sp = new URLSearchParams(q);
  const rec: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    rec[key] = all.length > 1 ? all : all[0];
  }
  return parseTrip(rec);
};

// --- 왕복 ---
// 기본값이 왕복을 견딘다
assert.deepEqual(roundTrip(toTripQuery(DEFAULT_TRIP)), DEFAULT_TRIP);

// 다 채운 계획도 왕복을 견딘다 — 한 값이라도 새면 그 조건이 코스에서 빠진다
const full: TripPlan = {
  moods: [0, 3],
  interests: [1, 2, 5],
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

// 동행·운전시간의 모든 선택지가 왕복을 견딘다
for (const c of COMPANIONS)
  for (const d of DRIVE_HOURS) {
    const plan = { ...full, companion: c.id, driveHours: d.hours };
    assert.deepEqual(roundTrip(toTripQuery(plan)), plan);
  }

// 장소 이름에 쉼표·앰퍼샌드가 들어가도 쪼개지지 않는다 (반복 키로 싣는 이유)
const comma = { ...full, musts: ["카페 A&B", "제주, 그 바다"] };
assert.deepEqual(roundTrip(toTripQuery(comma)).musts, comma.musts);

// --- 검증 (신뢰 경계) ---
// 빈 쿼리는 기본 계획
assert.deepEqual(parseTrip({}), DEFAULT_TRIP);

// 목록 밖 인덱스·정수 아닌 값·중복은 버린다
assert.deepEqual(parseTrip({ mood: String(MOODS.length) }).moods, []);
assert.deepEqual(parseTrip({ int: String(INTERESTS.length + 7) }).interests, []);
assert.deepEqual(parseTrip({ mood: "2,0,2" }).moods, [0, 2]);
// 꼬리 쉼표가 인덱스 0 으로 새면 안 된다 — 고른 적 없는 취향이 화면에 켜진다
assert.deepEqual(parseTrip({ mood: "1," }).moods, [1]);
assert.deepEqual(parseTrip({ mood: " " }).moods, []);

// 없는 날짜는 안 받는다
assert.equal(parseTrip({ from: "2026-02-31", to: "2026-03-02" }).start, "");
assert.equal(parseTrip({ from: "2026-8-1", to: "2026-08-03" }).start, "");
// 끝이 시작보다 앞서면 둘 다 버린다 — 음수 기간으로 코스를 짜지 않는다
assert.equal(parseTrip({ from: "2026-08-16", to: "2026-08-14" }).end, "");
// 한쪽만 와도 둘 다 버린다
assert.equal(parseTrip({ from: "2026-08-14" }).start, "");

// 허용 목록 밖의 동행·운전시간은 기본값
assert.equal(parseTrip({ with: "coworker" }).companion, DEFAULT_TRIP.companion);
assert.equal(parseTrip({ drive: "24" }).driveHours, DEFAULT_TRIP.driveHours);
// 0(상관없음)은 유효한 값이라 기본값으로 떨어지면 안 된다
assert.equal(parseTrip({ drive: "0" }).driveHours, 0);

// 인원은 0~MAX 로 자른다. 음수·소수는 기본값으로 되돌린다
assert.equal(parseTrip({ ppl: "99,0,0" }).people.adult, MAX_PER_PEOPLE);
assert.equal(parseTrip({ ppl: "-3,0,0" }).people.adult, DEFAULT_TRIP.people.adult);
assert.equal(parseTrip({ ppl: "1.5,0,0" }).people.adult, DEFAULT_TRIP.people.adult);
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
assert.equal(companionLabel(DEFAULT_TRIP), "친구 2명");

assert.equal(mustLabel(full), "성산일출봉 외 1곳");
assert.equal(mustLabel({ ...full, musts: ["비자림"] }), "비자림");
assert.equal(mustLabel(DEFAULT_TRIP), null);

// --- 코스를 만들 수 있는 조건 ---
assert.equal(isReady(full), true);
assert.equal(isReady(DEFAULT_TRIP), false);
// 날짜만 있고 출발 위치가 없으면 못 만든다 (이동시간의 기준점이 없다)
assert.equal(isReady({ ...full, origin: "" }), false);
assert.equal(isReady({ ...full, start: "", end: "" }), false);
// 취향·관심 장소는 비어도 막지 않는다 — 후보를 좁히는 값이지 필수 입력이 아니다
assert.equal(isReady({ ...full, moods: [], interests: [] }), true);

console.log("lib/trip.ts OK");
