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
  /** 이야기 소제목 ("좁은 해안도로에서 마주친 뜻밖의 정체"). 안 적으면 빈 문자열이다 */
  episode: string;
  body: string;
  /** 방문 장소 칩. route 에서 출발지를 뺀 값으로 시작하고, 작성 화면에서 더할 수 있다 */
  places: string[];
};

/**
 * 여행 이야기 글자 수 상한.
 *
 * 와이어프레임은 "52 / 500" 이지만 1000 으로 올렸다 — 상세(TRIP-09-A)의 예시 글이 이미 700자쯤이라
 * 500 이면 그 화면을 채울 수 없다. 한글 1자가 3바이트라 1000자는 3KB 안팎이고,
 * 서버 몸통 상한 8KB(app/api/records/route.ts) 안에 제목·경로·장소를 더해도 넉넉히 들어간다.
 */
export const BODY_MAX = 1000;

/** 소제목 상한. 상세에서 한 줄로 놓이는 자리라(와이어프레임 244px) 길면 두 줄로 접힌다 */
export const EPISODE_MAX = 40;

/**
 * "임시 저장" — 저장을 누르기 전의 초안들. 기록과 따로 둬야 목록이 초안에 안 오염된다.
 * 예전에는 한 벌만 눌러뒀는데(miri-ansim.record-draft) 그러면 다음 글을 쓸 때 지난 초안이
 * 화면에 저절로 올라왔다. 이제 여러 벌을 모아두고 **고른 것만** 이어 쓴다.
 */
const DRAFTS_KEY = "miri-ansim.drafts";

/** 초안 보관 개수. 사진까지 들고 있어 한 벌이 수백 KB 라 localStorage(5MB 안팎)가 금방 찬다 */
const DRAFT_MAX = 5;

/** 한 기록에 붙는 사진 (기기 저장). 기록 본문과 키를 나눠야 사진 없는 기기에서도 목록이 그대로 뜬다 */
const PHOTO_KEY = (id: number) => `miri-ansim.photos.${id}`;

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
    // 옛 기록에는 없던 칸이라 없으면 빈 문자열이다 — 그 기록은 상세에서 소제목 없이 그려진다
    episode: (str(r.episode) ?? "").slice(0, EPISODE_MAX),
    // 화면은 BODY_MAX 에서 막지만 API 는 공개라 그 상한을 여기서 다시 건다 (초안 loadDraft 와 같은 자리)
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

/** 목록에서 뺀다 (카드의 ✕). 새 목록을 돌려주고, 못 지웠으면 null 이다 — saveRecord 와 같은 규칙 */
export async function removeRecord(tier: number, id: number): Promise<TripRecord[] | null> {
  try {
    const res = await fetch(`${API}?t=${tier}&id=${id}`, { method: "DELETE" });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    return Array.isArray(raw) ? raw.map(asRecord).filter((r): r is TripRecord => r !== null) : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────── 사진 (기기에만) ─────────────────────────────── */

/**
 * **사진은 서버에 안 올린다.** 기록 본문은 티어 버킷으로 모두가 함께 보지만(위 첫 주석),
 * 사진은 올릴 자리도 용량 제한도 정해진 게 없다 — 지금은 찍은 기기에만 남는다.
 * 그래서 다른 기기에서 열면 사진 없는 기록으로 보인다. 아는 대가다.
 *
 * localStorage 는 5MB 안팎이라 원본을 그대로 넣으면 두 장에 찬다. shrinkImage 로 줄여서 넣고,
 * 그래도 넘치면 savePhotos 가 false 를 돌려준다 (화면이 그때 사실대로 말한다).
 */
export function loadPhotos(id: number): string[] {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PHOTO_KEY(id)) ?? "null");
    return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/** 사진을 기기에 담는다. 자리가 없으면 false — 부르는 쪽이 "다 못 담았다"고 말해야 한다 */
export function savePhotos(id: number, photos: string[]): boolean {
  try {
    if (!photos.length) return true;
    globalThis.localStorage?.setItem(PHOTO_KEY(id), JSON.stringify(photos));
    return true;
  } catch {
    return false; // QuotaExceededError 등
  }
}

/** 기록을 지울 때 사진도 같이 (기기에 유령이 남지 않게) */
export function clearPhotos(id: number): void {
  try {
    globalThis.localStorage?.removeItem(PHOTO_KEY(id));
  } catch {
    /* 지울 게 없거나 못 지운다 */
  }
}

/**
 * 사진 한 장을 줄여 data URL 로. 긴 변 720px · JPEG 0.6 —
 * 폰 사진 한 장이 3~5MB 라 원본으로는 localStorage 에 한 장도 안 들어간다.
 * 104px 썸네일과 목록 카드가 쓰는 크기라 720 이면 화면에서 뭉개지지 않는다.
 */
export async function shrinkImage(file: File, max = 720): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null; // 이미지가 아니거나 브라우저가 못 읽는 형식
  }
}

/* ─────────────────────────────── 임시 저장 (초안) ─────────────────────────────── */

/** 작성 화면이 들고 있는 값. 저장을 누르기 전까지의 모습 그대로다. */
export type Draft = {
  /** 처음 임시 저장한 시각(ms). 같은 초안을 다시 눌러 담을 때의 열쇠이자 목록 정렬 키 */
  id: number;
  course: string;
  route: string[];
  places: string[];
  title: string;
  episode: string;
  body: string;
  /** 아직 저장 안 누른 사진. 초안이 사진을 안 들면 임시 저장 뒤 돌아왔을 때 사진만 사라진다 */
  photos: string[];
};

/** 저장 시각 표기 ("2026.08.19 21:40"). 초안 카드는 날짜만으로는 어느 게 방금 것인지 안 갈린다 */
export function savedAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${dotted(isoToday(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 한 칸이 초안인지. 기록(asRecord)과 같은 규칙 — 모양이 안 맞으면 그 칸만 버린다 */
function asDraft(v: unknown): Draft | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isFinite(d.id)) return null;
  if (typeof d.title !== "string" || typeof d.body !== "string" || typeof d.course !== "string") return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is string => typeof n === "string") : []);

  return {
    id: d.id,
    course: d.course,
    title: d.title,
    episode: typeof d.episode === "string" ? d.episode.slice(0, EPISODE_MAX) : "",
    body: d.body.slice(0, BODY_MAX),
    route: list(d.route),
    places: list(d.places),
    photos: list(d.photos),
  };
}

/** 초안 목록, 최신순. 기기에만 있다 (기록과 달리 서버로 안 간다) */
export function loadDrafts(): Draft[] {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(DRAFTS_KEY) ?? "null");
    if (!Array.isArray(raw)) return [];
    return raw
      .map(asDraft)
      .filter((d): d is Draft => d !== null)
      .sort((a, b) => b.id - a.id);
  } catch {
    return [];
  }
}

/**
 * 담고 새 목록을 돌려준다. **못 담았으면 null 이다** (자리 부족 — 사진이 큰 초안이 그렇다).
 * 같은 id 는 덮어쓰고, DRAFT_MAX 를 넘으면 오래된 것부터 버린다.
 */
export function saveDraft(draft: Draft): Draft[] | null {
  const next = [draft, ...loadDrafts().filter((d) => d.id !== draft.id)].slice(0, DRAFT_MAX);
  try {
    globalThis.localStorage?.setItem(DRAFTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null; // QuotaExceededError 등 — 작성은 계속할 수 있다
  }
}

/** 하나 버린다 (초안 카드의 ✕, 그리고 그 초안을 기록으로 저장했을 때) */
export function removeDraft(id: number): Draft[] {
  const next = loadDrafts().filter((d) => d.id !== id);
  try {
    globalThis.localStorage?.setItem(DRAFTS_KEY, JSON.stringify(next));
  } catch {
    /* 못 지운다 — 다음 저장에서 덮어쓴다 */
  }
  return next;
}
