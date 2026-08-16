// 여행 기록 — 최종 와이어프레임 "여행 기록" 섹션(Figma 2765:1883)이 쓰는 데이터.
//
// 서버가 없다. 그래서 기록은 브라우저 localStorage 에 쌓고, 방금 끝낸 코스의 **요약만** URL 로 넘긴다 —
// 코스 전체(장소 × 좌표 × 날짜)는 URL 에 담기 너무 크고(app/trip/course/page.tsx 첫 주석),
// 기록에 필요한 건 이름 몇 개와 거리뿐이다.
//
// URL 도 localStorage 도 사용자가 손으로 고칠 수 있는 입력이다. 여기가 신뢰 경계라
// 읽을 때마다 모양을 확인하고, 안 맞으면 그 칸을 조용히 버린다 (lib/profile.ts 와 같은 규칙).

import type { Course } from "./course";

/** 방금 끝낸 코스에서 기록으로 넘어오는 값. 이것만 URL 에 실린다. */
export type CourseSummary = {
  /** YYYY-MM-DD */
  date: string;
  /** 코스 이름 ("바다와 노을 코스") */
  course: string;
  /** 출발지 → 들른 곳들. 첫 칸이 출발지다 ("제주공항 → 애월 → 협재 → 금능") */
  route: string[];
  km: number;
};

export type TripRecord = CourseSummary & {
  /** 저장 시각(ms). 목록 정렬 키 겸 id */
  id: number;
  title: string;
  body: string;
  /** 방문 장소 칩. route 에서 출발지를 뺀 값으로 시작하고, 작성 화면에서 더할 수 있다 */
  places: string[];
};

/** 여행 이야기 글자 수 상한 (와이어프레임 "52 / 500") */
export const BODY_MAX = 500;

const KEY = "miri-ansim.records";
/** "임시 저장" — 저장을 누르기 전의 초안. 기록과 따로 둬야 목록이 초안에 안 오염된다 */
const DRAFT_KEY = "miri-ansim.record-draft";

/* ─────────────────────────────── 날짜 ─────────────────────────────── */

/** YYYY-MM-DD. 로컬 시간 기준이다 — toISOString 은 UTC 라 밤 9시 이후 하루 밀린다 */
export function isoToday(now = new Date()): string {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 2026-08-14 → 2026.08.14 (화면 표기) */
export const dotted = (iso: string) => iso.replaceAll("-", ".");

/* ─────────────────────────────── 코스 → 요약 ─────────────────────────────── */

/**
 * 코스 한 벌에서 기록에 남길 값만 뽑는다.
 * 며칠짜리라도 들른 곳을 한 줄로 잇는다 — 기록은 "이번 여행"이 한 장이고, 날짜별로 쪼개면
 * 카드가 여행 수만큼이 아니라 날짜 수만큼 쌓인다.
 */
export function summaryOf(course: Course, origin: string): CourseSummary {
  const stops = course.days.flatMap((d) => d.stops);
  return {
    date: course.days[0]?.date ?? isoToday(),
    course: course.title,
    route: [origin, ...stops.map((s) => s.name)],
    km: Math.round(course.totalM / 1000),
  };
}

/* ─────────────────────────────── 요약 ↔ URL ─────────────────────────────── */

/**
 * 요약을 쿼리로. keep 에 지금 화면의 쿼리(프로필 등)를 주면 그대로 물려 나른다 —
 * 기록 화면이 끝나고 /home 으로 돌아갈 때 프로필이 살아 있어야 한다.
 *
 * route 는 r=a&r=b 로 하나씩 붙인다. "a,b" 로 이어 붙이면 이름에 쉼표가 든 장소에서 쪼개진다.
 */
export function toRecordQuery(s: CourseSummary, keep?: URLSearchParams | string): string {
  const q = new URLSearchParams(keep);
  q.set("c", s.course);
  q.set("d", s.date);
  q.set("km", `${s.km}`);
  q.delete("r");
  for (const name of s.route) q.append("r", name);
  return q.toString();
}

/** 쿼리를 요약으로. 코스 이름과 최소 두 칸(출발지 + 한 곳)이 없으면 요약이 아니다 — null 이면 목록만 보여준다. */
export function parseSummary(params: URLSearchParams): CourseSummary | null {
  const course = params.get("c")?.trim();
  const route = params.getAll("r").filter((n) => n.trim());
  if (!course || route.length < 2) return null;

  const km = Number(params.get("km"));
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("d") ?? "") ? params.get("d")! : isoToday(),
    course,
    route,
    km: Number.isFinite(km) && km >= 0 ? Math.round(km) : 0,
  };
}

/* ─────────────────────────────── 저장소 ─────────────────────────────── */

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** localStorage 에서 읽은 한 칸이 기록인지. 하나라도 모양이 다르면 그 칸을 버린다. */
function asRecord(v: unknown): TripRecord | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const title = str(r.title);
  const course = str(r.course);
  if (title === null || course === null) return null;
  if (!Array.isArray(r.route) || !Array.isArray(r.places)) return null;
  if (typeof r.id !== "number" || !Number.isFinite(r.id)) return null;

  return {
    id: r.id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(r.date) ?? "") ? (r.date as string) : isoToday(),
    course,
    title,
    body: str(r.body) ?? "",
    route: r.route.filter((n): n is string => typeof n === "string"),
    places: r.places.filter((n): n is string => typeof n === "string"),
    km: typeof r.km === "number" && Number.isFinite(r.km) && r.km >= 0 ? r.km : 0,
  };
}

/** 최근 저장한 것이 앞이다 (목록 "최근 기록" 순서). 브라우저가 아니거나 값이 깨졌으면 빈 목록. */
export function loadRecords(): TripRecord[] {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map(asRecord)
      .filter((r): r is TripRecord => r !== null)
      .sort((a, b) => b.id - a.id);
  } catch {
    return [];
  }
}

/** 저장하고 새 목록을 돌려준다. 저장이 막혀도(사파리 시크릿 모드 등) 화면은 넘어가야 하므로 삼킨다. */
export function saveRecord(record: TripRecord): TripRecord[] {
  const next = [record, ...loadRecords()];
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장은 못 했지만 이번 화면에서는 보인다 */
  }
  return next;
}

/* ─────────────────────────────── 임시 저장 (초안) ─────────────────────────────── */

/** 작성 화면이 들고 있는 값. 저장을 누르기 전까지의 모습 그대로다. */
export type Draft = { course: string; route: string[]; places: string[]; title: string; body: string };

export function saveDraft(draft: Draft): void {
  try {
    globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* 임시 저장이 안 되는 환경 — 작성은 계속할 수 있다 */
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(DRAFT_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const d = raw as Record<string, unknown>;
    if (typeof d.title !== "string" || typeof d.body !== "string" || typeof d.course !== "string") return null;
    return {
      course: d.course,
      title: d.title,
      body: d.body.slice(0, BODY_MAX),
      route: Array.isArray(d.route) ? d.route.filter((n): n is string => typeof n === "string") : [],
      places: Array.isArray(d.places) ? d.places.filter((n): n is string => typeof n === "string") : [],
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    globalThis.localStorage?.removeItem(DRAFT_KEY);
  } catch {
    /* 지울 게 없거나 못 지운다 — 다음 작성에서 덮어쓴다 */
  }
}
