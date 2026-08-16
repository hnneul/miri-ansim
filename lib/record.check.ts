// 여행 기록 왕복 + 입력 검증 — node --experimental-strip-types lib/record.check.ts
// URL 과 localStorage 는 둘 다 사용자가 고칠 수 있는 입력이다. 여기가 새면 목록이 깨진 칸을 그린다.

import assert from "node:assert";
import {
  BODY_MAX,
  clearDraft,
  dotted,
  isoToday,
  loadDraft,
  loadRecords,
  parseSummary,
  saveDraft,
  saveRecord,
  summaryOf,
  toRecordQuery,
  type CourseSummary,
  type TripRecord,
} from "./record.ts";
import type { Course } from "./course.ts";

// localStorage 흉내. 노드에는 없다 — 저장소 함수는 부를 때 globalThis 를 보므로 여기서 깔아두면 된다.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

/** null 이면 검증이 샌 것이다 — 그 자리에서 멈춘다 */
function some<T>(v: T | null): T {
  assert.ok(v !== null);
  return v;
}

/* ─────────────────────────────── 요약 ↔ URL ─────────────────────────────── */

const summary: CourseSummary = {
  date: "2026-08-14",
  course: "바다와 노을 코스",
  route: ["제주공항", "애월", "협재", "금능"],
  km: 62,
};

// 왕복 — 실어 보낸 값이 그대로 돌아온다
assert.deepEqual(parseSummary(new URLSearchParams(toRecordQuery(summary))), summary);

// 쉼표가 든 장소 이름도 쪼개지지 않는다 (r=a&r=b 로 하나씩 붙이는 이유)
const comma = { ...summary, route: ["제주공항", "카페, 바다"] };
assert.deepEqual(some(parseSummary(new URLSearchParams(toRecordQuery(comma)))).route, comma.route);

// 물려받은 쿼리(프로필)는 살아 있다 — 목록에서 /home 으로 돌아갈 때 필요하다
const kept = new URLSearchParams(toRecordQuery(summary, "exp=10&car=suv"));
assert.equal(kept.get("exp"), "10");
assert.equal(kept.get("car"), "suv");

// 같은 요약을 두 번 실어도 route 가 쌓이지 않는다 (q.delete("r") 가 하는 일)
assert.equal(new URLSearchParams(toRecordQuery(summary, toRecordQuery(summary))).getAll("r").length, 4);

// --- 검증 (신뢰 경계) ---
// 코스 이름이 없거나 들른 곳이 없으면 요약이 아니다 → 완료 화면을 건너뛰고 목록만 보여준다
assert.equal(parseSummary(new URLSearchParams("")), null);
assert.equal(parseSummary(new URLSearchParams("c=코스")), null);
assert.equal(parseSummary(new URLSearchParams("c=코스&r=제주공항")), null);
assert.equal(parseSummary(new URLSearchParams("c=+++&r=a&r=b")), null);

// 날짜가 형식에 안 맞으면 오늘로 떨어진다 — 목록이 "NaN.NaN" 을 그리면 안 된다
assert.equal(some(parseSummary(new URLSearchParams("c=코스&r=a&r=b&d=어제"))).date, isoToday());
assert.equal(some(parseSummary(new URLSearchParams("c=코스&r=a&r=b&d=2026-8-14"))).date, isoToday());

// 거리는 음수·NaN 을 안 받는다 (합계가 줄어들면 "총 여행 거리"가 거짓말이 된다)
assert.equal(some(parseSummary(new URLSearchParams("c=코스&r=a&r=b&km=-99"))).km, 0);
assert.equal(some(parseSummary(new URLSearchParams("c=코스&r=a&r=b&km=abc"))).km, 0);
assert.equal(some(parseSummary(new URLSearchParams("c=코스&r=a&r=b&km=61.6"))).km, 62);

/* ─────────────────────────────── 코스 → 요약 ─────────────────────────────── */

/** 요약이 보는 건 title·totalM·days[].date·stops[].name 뿐이다 — 나머지는 안 쓴다 */
const stop = (name: string) => ({ name }) as Course["days"][number]["stops"][number];
const course = {
  lead: null,
  title: "바다와 노을 코스",
  totalM: 61_600,
  totalMin: 90,
  days: [
    { date: "2026-08-14", driveM: 0, driveMin: 0, stops: [stop("애월"), stop("협재")] },
    { date: "2026-08-15", driveM: 0, driveMin: 0, stops: [stop("금능")] },
  ],
} satisfies Course;

// 며칠짜리라도 한 줄로 잇는다. 날짜는 첫날, 거리는 km 로 반올림.
assert.deepEqual(summaryOf(course, "제주공항"), summary);

// 장소가 하나도 없는 코스여도 터지지 않는다 (출발지만 남는다)
const empty = summaryOf({ ...course, days: [] }, "제주공항");
assert.deepEqual(empty.route, ["제주공항"]);
assert.equal(empty.date, isoToday());

/* ─────────────────────────────── 저장소 ─────────────────────────────── */

const record: TripRecord = { ...summary, id: 2, title: "애월에서 협재까지", body: "좋았다", places: ["애월", "협재", "금능"] };

assert.deepEqual(loadRecords(), []);
saveRecord(record);
assert.deepEqual(loadRecords(), [record]);

// 최근 저장한 것이 앞이다 — 나중에 넣은 id 3 이 위로 온다
saveRecord({ ...record, id: 3, title: "비 오는 날의 성산" });
assert.deepEqual(
  loadRecords().map((r) => r.id),
  [3, 2],
);

// --- 검증 (신뢰 경계) ---
// 손으로 고친 값. 모양이 안 맞는 칸만 버리고 나머지는 살린다
store.set(
  "miri-ansim.records",
  JSON.stringify([
    record,
    null,
    42,
    "기록",
    { title: "제목만" },
    { ...record, id: "1" },
    { ...record, id: 9, km: -5, date: "언젠가", body: 7 },
  ]),
);
const loaded = loadRecords();
assert.deepEqual(
  loaded.map((r) => r.id),
  [9, 2],
);
assert.equal(loaded[0].km, 0);
assert.equal(loaded[0].date, isoToday());
assert.equal(loaded[0].body, "");

// 배열이 아니거나 JSON 이 깨졌으면 빈 목록 — 화면이 뻗는 대신 "기록이 아직 없어요"가 뜬다
store.set("miri-ansim.records", '{"not":"array"}');
assert.deepEqual(loadRecords(), []);
store.set("miri-ansim.records", "{{{");
assert.deepEqual(loadRecords(), []);

/* ─────────────────────────────── 임시 저장 ─────────────────────────────── */

const draft = { course: "바다와 노을 코스", route: ["제주공항", "애월"], places: ["애월"], title: "제목", body: "본문" };

assert.equal(loadDraft(), null);
saveDraft(draft);
assert.deepEqual(loadDraft(), draft);

// 500자를 넘겨 들어온 초안은 잘라서 돌려준다 — 그대로 두면 저장 버튼이 안 눌리는 화면으로 열린다
saveDraft({ ...draft, body: "가".repeat(BODY_MAX + 10) });
assert.equal(some(loadDraft()).body.length, BODY_MAX);

clearDraft();
assert.equal(loadDraft(), null);

// 초안이 깨져도 작성 화면은 빈 값으로 열린다
store.set("miri-ansim.record-draft", JSON.stringify({ title: 1 }));
assert.equal(loadDraft(), null);

/* ─────────────────────────────── 표기 ─────────────────────────────── */

assert.equal(dotted("2026-08-14"), "2026.08.14");
// 로컬 시간 기준이다 — UTC(toISOString)로 잡으면 밤 9시 이후 하루 밀린다
assert.equal(isoToday(new Date(2026, 7, 14, 23, 30)), "2026-08-14");
assert.equal(isoToday(new Date(2026, 0, 5)), "2026-01-05");

console.log("✅ 여행 기록 URL 왕복 + 저장소 입력 검증 정상");
