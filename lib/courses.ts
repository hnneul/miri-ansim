// 받아 둔 코스. 저장소가 없어 브라우저(localStorage)에 둔다 — lib/recent.ts 와 같은 이유·같은 모양이다.
//
// **왜 기록과 따로 두는가.** 예전에는 기록 화면의 "지난 여행"이 저장된 기록에서 코스 이름만
// 뽑아 만들었다. 그래서 기록을 지우면 그 코스도 목록에서 같이 사라졌다 — 사용자는 기록을
// 지운 것인데 받아 둔 코스까지 없어졌다. 받은 코스와 쓴 기록은 수명이 달라야 한다.
//
// 코스 전체가 아니라 요약(CourseSummary)만 담는다. 기록에 필요한 건 이름 몇 개와 거리뿐이다
// (lib/record.ts 첫 주석과 같은 이유).
//
// localStorage 는 서버에 없고, 사파리 비공개 모드에서는 쓰기가 예외를 던진다. 여기서 다 막는다 —
// 코스 목록 때문에 화면이 죽는 일은 없어야 한다.

import type { CourseSummary } from "./record";

const KEY = "gilansim:courses";
/** 몇 벌까지 기억하는가. 기록 화면이 PAST_MAX 줄만 보여주므로 그보다 넉넉하면 된다. */
const MAX = 10;

const 코스인가 = (v: unknown): v is CourseSummary =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as CourseSummary).course === "string" &&
  Array.isArray((v as CourseSummary).route) &&
  (v as CourseSummary).route.every((s) => typeof s === "string");

/** 저장된 코스. 값이 깨졌거나 못 읽으면 빈 목록으로 시작한다. */
export function loadCourses(): CourseSummary[] {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter(코스인가).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/**
 * 맨 앞에 넣는다. 같은 이름의 코스는 한 벌만 남긴다 — 같은 코스를 여러 번 받아도
 * 목록이 그 이름으로 도배되면 안 된다 (기록 화면의 "지난 여행"도 같은 규칙이다).
 *
 * 부르는 쪽이 목록을 들고 있지 않아서 prev 를 받지 않는다 (lib/recent.ts 와 다른 점).
 * 코스를 받는 순간은 화면을 떠나는 순간이라 상태로 들고 있을 이유가 없다.
 */
export function rememberCourse(c: CourseSummary): void {
  try {
    const next = [c, ...loadCourses().filter((o) => o.course !== c.course)].slice(0, MAX);
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 못 써도 이번 화면은 그대로 간다 — 다음에 기록하러 올 때 목록에 없을 뿐이다 */
  }
}
