// 여행 기록 — 최종 와이어프레임 "여행 기록" 섹션(Figma 2765:1883)이 쓰는 데이터.
//
// 기록은 **서버**에 쌓는다 (/api/records → lib/records.db.ts). 익숙함 티어 셋이 곧 버킷이라,
// 같은 티어를 고른 사람은 어느 기기로 들어와도 같은 목록을 본다 — 로그인 대신이다.
// 방금 끝낸 코스의 **요약만** URL 로 넘긴다 — 코스 전체(장소 × 좌표 × 날짜)는 URL 에 담기
// 너무 크고(app/trip/course/page.tsx 첫 주석), 기록에 필요한 건 이름 몇 개와 거리뿐이다.
//
// 작성 중인 초안만 localStorage 에 남는다. 아직 저장 안 누른 글은 그 브라우저 것이지 공용이 아니다.
//
// URL 도 서버 응답도 localStorage 도 전부 사용자가 손댈 수 있는 입력이다. 여기가 신뢰 경계라
// 읽을 때마다 모양을 확인하고, 안 맞으면 그 칸을 조용히 버린다 (lib/profile.ts 와 같은 규칙).
// **서버도 같은 asRecord 를 쓴다** — 검사가 두 벌이면 한쪽만 느슨해진다.

import type { Course } from "./course";
import { OPTIONS } from "./profile.ts";

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

/**
 * 한 칸이 기록인지. 하나라도 모양이 다르면 그 칸을 버린다.
 * 서버가 받은 몸통을 검사할 때도 이걸 쓴다 (app/api/records/route.ts).
 */
export function asRecord(v: unknown): TripRecord | null {
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
    // 화면은 500자에서 막지만 API 는 공개라 그 상한을 여기서 다시 건다 (초안 loadDraft 와 같은 자리)
    body: (str(r.body) ?? "").slice(0, BODY_MAX),
    route: r.route.filter((n): n is string => typeof n === "string"),
    places: r.places.filter((n): n is string => typeof n === "string"),
    km: typeof r.km === "number" && Number.isFinite(r.km) && r.km >= 0 ? r.km : 0,
  };
}

/**
 * 티어인지. 온보딩이 고를 수 있는 세 값(1·3·10)만 버킷이 된다 — 그 밖의 값이 들어오면
 * 아무도 안 보는 버킷이 조용히 생기므로 기본값으로 떨어뜨리지 않고 거절한다.
 * 서버(app/api/records/route.ts)와 화면이 같은 판정을 써야 해서 여기 하나만 둔다.
 */
export function asTier(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && (OPTIONS.experienceYears as readonly number[]).includes(n) ? n : null;
}

const API = "/api/records";

/**
 * 한 티어의 기록, 최신순. **서버가 죽어도 빈 목록으로 돌아온다** — 화면이 뻗는 대신
 * "기록이 아직 없어요"가 뜬다. 목록을 못 읽는 것과 없는 것이 화면에서 같아 보이는 건
 * 아는 대가다: 시연 중에 예외 화면이 뜨는 쪽이 더 나쁘다.
 */
export async function loadRecords(tier: number): Promise<TripRecord[]> {
  try {
    const res = await fetch(`${API}?t=${tier}`);
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? raw.map(asRecord).filter((r): r is TripRecord => r !== null) : [];
  } catch {
    return []; // 네트워크가 없거나 서버가 안 뜬 경우
  }
}

/**
 * 저장하고 그 티어의 새 목록을 돌려준다. **못 저장했으면 null 이다.**
 *
 * 빈 배열로 뭉개지 않는 이유: 부르는 쪽(app/trip/record)이 "서버에 남았다"와 "이번 화면에서만
 * 보인다"를 갈라 다뤄야 한다. 예전 localStorage 판은 실패를 삼키고 목록을 돌려줬는데,
 * 그러면 저장이 안 된 기록이 저장된 것과 똑같이 보였다.
 */
export async function saveRecord(tier: number, record: TripRecord): Promise<TripRecord[] | null> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, record }),
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? raw.map(asRecord).filter((r): r is TripRecord => r !== null) : null;
  } catch {
    return null;
  }
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
