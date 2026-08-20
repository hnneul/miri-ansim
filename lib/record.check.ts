// 여행 기록 왕복 + 입력 검증 — node --experimental-strip-types lib/record.check.ts
// URL·서버 응답·localStorage 는 모두 사용자가 고칠 수 있는 입력이다. 여기가 새면 목록이 깨진 칸을 그린다.
// 저장소 자체(SQLite)는 lib/records.db.check.ts 가 본다 — 여기는 모양 검사만.

import assert from "node:assert";
import { asOwner, me, OWNER_RE } from "./me.ts";
import {
  BODY_MAX,
  EPISODE_MAX,
  removeDraft,
  dotted,
  asRecord,
  isoToday,
  loadDrafts,
  parseSummary,
  RECORD_KEYS,
  savedAt,
  saveDraft,
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

/* ─────────────────────────────── 기록 모양 (신뢰 경계) ─────────────────────────────── */

// 서버가 돌려준 목록도 손댈 수 있는 입력이다. 화면과 서버가 **같은** asRecord 를 쓴다
// (app/api/records/route.ts) — 여기가 느슨해지면 양쪽이 같이 느슨해진다.
const record: TripRecord = {
  ...summary,
  id: 2,
  title: "애월에서 협재까지",
  episode: "좁은 길에서 마주친 차",
  body: "좋았다",
  places: ["애월", "협재", "금능"],
};

// 소제목은 나중에 생긴 칸이다 — 없는 옛 기록도 그대로 읽혀야 한다 (빈 문자열로)
const { episode: _, ...옛기록 } = record;
assert.equal(some(asRecord(옛기록)).episode, "");
assert.equal(some(asRecord({ ...record, episode: "가".repeat(EPISODE_MAX + 5) })).episode.length, EPISODE_MAX);

assert.deepEqual(asRecord(record), record);

// 모양이 안 맞으면 그 칸만 버린다
assert.equal(asRecord(null), null);
assert.equal(asRecord(42), null);
assert.equal(asRecord("기록"), null);
assert.equal(asRecord({ title: "제목만" }), null);
assert.equal(asRecord({ ...record, id: "1" }), null, "id 가 숫자가 아니면 정렬 키가 없다");
assert.equal(asRecord({ ...record, route: "제주공항" }), null);

// 살릴 수 있는 칸은 고쳐서 살린다 — 한 값이 깨졌다고 기록째 버리면 시연 중에 목록이 빈다
const 고침 = some(asRecord({ ...record, id: 9, km: -5, date: "언젠가", body: 7 }));
assert.equal(고침.km, 0);
assert.equal(고침.date, isoToday());
assert.equal(고침.body, "");

// 이야기는 500자에서 잘린다. 화면은 이미 막지만 API 가 공개라 여기서 다시 건다
assert.equal(some(asRecord({ ...record, body: "가".repeat(BODY_MAX + 50) })).body.length, BODY_MAX);

/* ─────────────────────────────── 주인 id (버킷 키) ─────────────────────────────── */

const 성한id = "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e";
assert.equal(asOwner(성한id), 성한id);

// 그 밖은 **기본값으로 안 떨어뜨리고 거절한다** — 아무 문자열이나 버킷이 되면
// 공개 엔드포인트로 표를 무한히 불릴 수 있다 (lib/records.db.ts TOTAL_MAX 가 마지막 방어다)
for (const bad of [
  1,
  "1",
  "",
  " ",
  "abc",
  성한id.toUpperCase(), // 대문자는 안 받는다 — 같은 사람이 두 버킷을 갖게 된다
  성한id + "x",
  성한id.slice(0, -1),
  성한id.replace(/-/g, ""),
  null,
  undefined,
  {},
  [성한id],
])
  assert.equal(asOwner(bad), null, `주인 id 가 아닌 값이 통과했다: ${JSON.stringify(bad)}`);

/* ─────────────────────────────── 임시 저장 ─────────────────────────────── */

const draft = {
  id: 1000,
  course: "바다와 노을 코스",
  route: ["제주공항", "애월"],
  places: ["애월"],
  title: "제목",
  episode: "소제목",
  body: "본문",
  photos: [],
};

assert.deepEqual(loadDrafts(), []);
saveDraft(draft);
assert.deepEqual(loadDrafts(), [draft]);

// 같은 id 는 덮어쓴다 — 임시 저장을 두 번 눌러도 초안이 둘로 늘지 않는다
saveDraft({ ...draft, title: "고친 제목" });
assert.equal(loadDrafts().length, 1);
assert.equal(some(loadDrafts()[0]).title, "고친 제목");

// 여러 벌을 모아두고 최신순으로 돌려준다 (목록 "작성 중인 기록" 순서)
saveDraft({ ...draft, id: 2000, title: "둘째" });
assert.deepEqual(
  loadDrafts().map((d) => d.id),
  [2000, 1000],
);

// 상한을 넘겨 들어온 초안은 잘라서 돌려준다 — 그대로 두면 저장 버튼이 안 눌리는 화면으로 열린다
saveDraft({ ...draft, id: 3000, body: "가".repeat(BODY_MAX + 10) });
assert.equal(some(loadDrafts()[0]).body.length, BODY_MAX);

// 다섯 벌까지만 — 사진까지 든 초안이라 무한히 쌓으면 localStorage 가 찬다. 오래된 것부터 나간다
for (const id of [4000, 5000, 6000]) saveDraft({ ...draft, id });
assert.deepEqual(
  loadDrafts().map((d) => d.id),
  [6000, 5000, 4000, 3000, 2000],
);

removeDraft(6000);
assert.equal(
  loadDrafts().some((d) => d.id === 6000),
  false,
);

// 초안이 깨져도 작성 화면은 빈 값으로 열린다 (그 칸만 버린다)
store.set("miri-ansim.drafts", JSON.stringify([{ title: 1 }, { ...draft, id: 7000 }]));
assert.deepEqual(
  loadDrafts().map((d) => d.id),
  [7000],
);
store.set("miri-ansim.drafts", "깨진 값");
assert.deepEqual(loadDrafts(), []);

// 저장 시각 표기 — 날짜만으로는 오늘 쓴 초안 둘이 안 갈린다
assert.equal(savedAt(new Date(2026, 7, 19, 21, 5).getTime()), "2026.08.19 21:05");

/* ─────────────────────────────── 표기 ─────────────────────────────── */

assert.equal(dotted("2026-08-14"), "2026.08.14");
// 로컬 시간 기준이다 — UTC(toISOString)로 잡으면 밤 9시 이후 하루 밀린다
assert.equal(isoToday(new Date(2026, 7, 14, 23, 30)), "2026-08-14");
assert.equal(isoToday(new Date(2026, 0, 5)), "2026-01-05");

// RECORD_KEYS 는 toRecordQuery 가 싣는 키와 어긋나면 안 된다 —
// 빠진 키는 홈으로 나갈 때 안 걷혀서, 홈의 "여행 기록 ＋" 가 목록 대신 작성 화면을 연다
{
  const 요약: CourseSummary = { course: "조용한 바다 여행", date: "2026-08-25", km: 62, route: ["공항", "금능해수욕장"] };
  const 실린키 = [...new Set(new URLSearchParams(toRecordQuery(요약)).keys())].sort();
  assert.deepEqual(실린키, [...RECORD_KEYS].sort(), "toRecordQuery 가 RECORD_KEYS 밖의 키를 싣는다");

  // 걷어내면 코스 요약이 남지 않는다 — 그래야 홈이 목록을 연다
  const 나갈쿼리 = new URLSearchParams(toRecordQuery(요약, "exp=1&freq=low"));
  for (const k of RECORD_KEYS) 나갈쿼리.delete(k);
  assert.equal(parseSummary(나갈쿼리), null, "걷어냈는데도 코스 요약이 읽힌다");
  assert.equal(나갈쿼리.get("exp"), "1", "프로필까지 걷어내면 안 된다");
}

// me() 가 만드는 값은 asOwner 가 받아야 한다 — 화면과 서버가 어긋나면 아무것도 안 저장된다.
// localStorage 가 없는 node 라 catch 갈래(임시 id)를 타는데, 그 값도 같은 모양이어야 한다.
assert.ok(OWNER_RE.test(me()), "me() 가 만든 id 를 서버가 거절한다");
assert.equal(asOwner(me()), me(), "같은 판에서 me() 는 같은 값이어야 한다");

console.log("✅ 여행 기록 URL 왕복 + 저장소 입력 검증 정상");
