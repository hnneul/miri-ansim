// 여행 계획 ↔ URL 쿼리 변환. AI 여행 코스 플로우(/trip)가 고른 값을 코스 생성(/trip/course)에 넘긴다.
//
// lib/profile.ts 와 같은 자리, 같은 이유다 — 링크 하나로 재현·공유되고 새로고침에도 안 날아간다.
// 그래서 같은 제약도 따라온다: URL 은 사용자가 손으로 고칠 수 있는 입력이라 여기가 신뢰 경계다.
//
// 선택지 목록이 화면이 아니라 여기 있는 것도 CONCERNS(lib/profile.ts)와 같은 이유다 —
// 화면이 보여주는 말과 URL 이 받아주는 값이 갈리면, 고른 적 없는 값이 코스에 들어간다.

import type { LatLng } from "@/app/RouteMap";

/**
 * TRIP-02 | 여행 취향 — 여러 개 고를 수 있다.
 * short 는 화면 아래 "선택한 여행 키워드" 줄에 쓴다 ("한적함 · 자연 · 바다 · 카페") —
 * 네 개를 고르면 label 로는 한 줄에 안 들어간다. CONCERNS(lib/profile.ts)의 short 와 같은 쓰임이다.
 */
export const MOODS = [
  { emoji: "🌀", label: "조용하고 한적한 곳", desc: "여유로운 여행", short: "한적함" },
  { emoji: "✨", label: "활기찬 명소", desc: "대표 명소 중심", short: "활기참" },
  { emoji: "🌿", label: "자연과 풍경", desc: "바다·오름·숲", short: "자연" },
  { emoji: "🍊", label: "맛집과 시장", desc: "제주 로컬 음식", short: "맛집" },
];

/**
 * TRIP-03 | 관심 장소 — 여러 개 고를 수 있다.
 *
 * 뒤 세 칸(query·code·kinds)은 코스 후보를 모을 때 카카오 로컬에 보내는 검색 조건이다
 * (lib/poi.ts searchSpotsNear). 화면과 한 표에 두는 이유는 CONCERNS 와 같다 —
 * 목록이 둘로 갈리면 관심사를 하나 늘렸을 때 한쪽만 고치고 지나간다.
 *
 * **셋 다 필요하다.** 실제 응답을 찍어보고 정한 값이라 하나라도 빼면 목록이 망가진다:
 *   · code 없이 키워드만 : "오름"에 세탁소·네일샵·빌라가 섞인다 (총 294건 중 대부분)
 *   · code 만           : 해수욕장·오름·테마파크가 전부 AT4 한 칸이라 서로 못 가른다
 *   · kinds 없이        : 카페에 공항 프랜차이즈가 앞자리를 다 먹는다 (끝 분류가 브랜드명이다)
 */
export const INTERESTS = [
  { emoji: "🌊", label: "바다·해변", short: "바다", query: "해수욕장", code: "AT4", kinds: ["해수욕장", "해변"] },
  { emoji: "🌿", label: "오름·숲", short: "오름", query: "오름", code: "AT4", kinds: ["오름", "수목원", "식물원", "휴양림"] },
  { emoji: "🏛️", label: "전시·박물관", short: "전시", query: "박물관", code: "CT1", kinds: ["박물관", "미술관", "전시"] },
  // 시장은 AT4 로 조회하면 0건이라 코드를 안 건다 — 카카오가 시장을 관광명소로 안 묶는다
  { emoji: "🍜", label: "시장·맛집", short: "시장", query: "전통시장", code: "", kinds: ["시장"] },
  // "카페"로 찾으면 공항 상업시설이 먼저 온다. 여행에서 찾는 건 그 카페가 아니다
  { emoji: "📷", label: "카페·사진", short: "카페", query: "오션뷰 카페", code: "CE7", kinds: ["카페", "커피전문점"] },
  { emoji: "🐴", label: "체험·동물", short: "체험", query: "테마파크", code: "AT4", kinds: ["테마파크", "동물원", "체험"] },
];

/** TRIP-04-B | 동행 선택 */
export const COMPANIONS = [
  { id: "family", emoji: "👨‍👩‍👧", label: "가족" },
  { id: "friend", emoji: "🧑‍🤝‍🧑", label: "친구" },
  { id: "couple", emoji: "💛", label: "연인" },
  { id: "pet", emoji: "🐶", label: "반려견" },
] as const;

export type Companion = (typeof COMPANIONS)[number]["id"];

/**
 * 인원 구분. desc 가 빈 성인은 와이어프레임에도 설명이 없다 —
 * 나이 경계가 애매한 청소년·어린이만 적어 둔다.
 */
export const PEOPLE = [
  { key: "adult", label: "성인", desc: "" },
  { key: "teen", label: "청소년", desc: "중학생 ~ 고등학생" },
  { key: "child", label: "어린이", desc: "36개월 이상 ~ 초등학생" },
] as const;

export type PeopleKey = (typeof PEOPLE)[number]["key"];

/** 한 칸이 받을 수 있는 최대 인원. 렌터카 한 대에 탈 수 있는 수를 넘길 이유가 없다. */
export const MAX_PER_PEOPLE = 9;

/**
 * TRIP-04-D | 하루 운전 시간. hours 0 은 "상관없음"이다 —
 * 2단계(코스 생성)에서 이동시간 상한을 걸지 않는다는 뜻이라 0 이 "운전 안 함"이 되면 안 된다.
 */
export const DRIVE_HOURS = [
  { hours: 1, label: "1시간 이내", desc: "운전을 최소화하고 가까운 곳 위주" },
  { hours: 2, label: "2시간 이내", desc: "여유로운 이동과 관광의 균형" },
  { hours: 3, label: "3시간 이내", desc: "제주 여러 지역을 넓게 둘러보기" },
  { hours: 0, label: "시간 상관없음", desc: "거리보다 가고 싶은 장소 우선" },
];

/**
 * 꼭 가고 싶은 곳의 상한. URL 길이를 묶어두는 값이다 —
 * 장소 이름을 반복 키(must=A&must=B)로 싣기 때문에 개수가 곧 URL 길이다.
 */
export const MAX_MUSTS = 10;

export type TripPlan = {
  /** MOODS 인덱스 */
  moods: number[];
  /** INTERESTS 인덱스 */
  interests: number[];
  /** YYYY-MM-DD. 빈 문자열이면 아직 안 골랐다 (start·end 는 늘 같이 차거나 같이 빈다) */
  start: string;
  end: string;
  companion: Companion;
  people: Record<PeopleKey, number>;
  /** 출발 위치 이름. 빈 문자열이면 아직 안 골랐다 */
  origin: string;
  /** 출발 위치 좌표. 이름만 받은 경우(직접 입력)를 위해 따로 둔다 */
  originAt: LatLng | null;
  driveHours: number;
  musts: string[];
};

/**
 * 아무것도 안 고른 상태. 날짜·출발 위치가 비어 있어 isReady 가 막는다 —
 * 이 둘은 코스 생성이 없으면 계산을 못 하는 값이라 기본값으로 지어내지 않는다.
 * 나머지는 와이어프레임의 선택 상태를 따른다 (친구 2명 · 2시간 이내).
 */
export const DEFAULT_TRIP: TripPlan = {
  moods: [],
  interests: [],
  start: "",
  end: "",
  companion: "friend",
  people: { adult: 2, teen: 0, child: 0 },
  origin: "",
  originAt: null,
  driveHours: 2,
  musts: [],
};

/** YYYY-MM-DD 이면서 실제로 있는 날짜인지. 2026-02-31 같은 값을 걸러낸다. */
const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * 여행 일수. 못 세면 null (아직 안 골랐거나 값이 망가진 경우).
 * UTC 로 파싱한다 — 로컬 시간대로 두면 서머타임이 있는 지역에서 하루가 23시간이라 밤이 하나 샌다.
 */
export function nightsOf(start: string, end: string): { nights: number; days: number } | null {
  if (!isDate(start) || !isDate(end)) return null;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (ms < 0) return null;
  const nights = Math.round(ms / 86_400_000);
  return { nights, days: nights + 1 };
}

/** "2박 3일" · "당일치기". 아직 안 골랐으면 null — 화면이 자리를 채울 문구를 정한다. */
export function periodLabel(plan: TripPlan): string | null {
  const n = nightsOf(plan.start, plan.end);
  if (!n) return null;
  return n.nights === 0 ? "당일치기" : `${n.nights}박 ${n.days}일`;
}

export const peopleTotal = (plan: TripPlan) => PEOPLE.reduce((sum, p) => sum + plan.people[p.key], 0);

/** "친구 2명" — TRIP-04 목록과 TRIP-04-B 버튼이 같이 쓴다 */
export function companionLabel(plan: TripPlan): string {
  const found = COMPANIONS.find((c) => c.id === plan.companion);
  return `${found?.label ?? ""} ${peopleTotal(plan)}명`.trim();
}

export const driveLabel = (plan: TripPlan) =>
  DRIVE_HOURS.find((d) => d.hours === plan.driveHours)?.label ?? DRIVE_HOURS[1].label;

/** 고른 취향·관심 장소를 한 줄로 — "한적함 · 자연 · 바다 · 카페". 아무것도 안 골랐으면 null */
export function keywordLine(plan: TripPlan): string | null {
  const words = [...plan.moods.map((i) => MOODS[i].short), ...plan.interests.map((i) => INTERESTS[i].short)];
  return words.length ? words.join(" · ") : null;
}

/** "성산일출봉" · "성산일출봉 외 1곳". 안 골랐으면 null */
export function mustLabel(plan: TripPlan): string | null {
  if (!plan.musts.length) return null;
  return plan.musts.length === 1 ? plan.musts[0] : `${plan.musts[0]} 외 ${plan.musts.length - 1}곳`;
}

/**
 * 코스를 만들 수 있는 상태인지. 날짜와 출발 위치가 있어야 한다 —
 * 둘 다 이동시간 계산의 입력이라, 없으면 코스가 아니라 장소 목록만 나온다.
 * 취향·관심 장소가 비어도 막지 않는다: 그건 후보를 좁히는 값이지 없다고 못 만드는 값이 아니다.
 */
export const isReady = (plan: TripPlan) => nightsOf(plan.start, plan.end) !== null && plan.origin !== "";

/** ?key=value 에서 같은 키가 여러 번 오면 첫 값 (lib/profile.ts 와 같은 규칙) */
const oneOf = (sp: Record<string, string | string[] | undefined>, k: string) =>
  Array.isArray(sp[k]) ? sp[k][0] : sp[k];

/** 같은 키의 값을 전부. musts 처럼 개수가 정해지지 않은 값에 쓴다. */
const allOf = (sp: Record<string, string | string[] | undefined>, k: string): string[] => {
  const v = sp[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

/**
 * "0,2" → [0, 2]. 목록 밖·정수 아님·중복은 버리고 화면 순서로 정렬한다.
 * parseConcerns(lib/profile.ts)와 같은 이유로 숫자만 남기고 나서 Number 를 태운다 —
 * Number("") 도 Number(" ") 도 0 이라 꼬리 쉼표가 인덱스 0 으로 샌다.
 */
const parseIndexes = (raw: string | undefined, max: number): number[] => {
  if (!raw) return [];
  const picked = raw
    .split(",")
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((i) => i < max);
  return [...new Set(picked)].sort((a, b) => a - b);
};

/** 0 이상 MAX_PER_PEOPLE 이하의 정수로 자른다. 음수 인원이 총원을 깎으면 안 된다. */
const parseCount = (raw: string | undefined, fallback: number) => {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), MAX_PER_PEOPLE);
};

/** URL 쿼리 → 여행 계획. 값이 없거나 허용 목록 밖이면 기본값으로 되돌린다. */
export function parseTrip(sp: Record<string, string | string[] | undefined>): TripPlan {
  const start = oneOf(sp, "from") ?? "";
  const end = oneOf(sp, "to") ?? "";
  // 한쪽만 성하면 기간을 못 세므로 둘 다 버린다 — 반쪽 날짜로 "당일치기"를 지어내지 않는다
  const period = nightsOf(start, end) ? { start, end } : { start: "", end: "" };

  const companion = COMPANIONS.find((c) => c.id === oneOf(sp, "with"))?.id ?? DEFAULT_TRIP.companion;
  const counts = (oneOf(sp, "ppl") ?? "").split(",");

  const lat = Number(oneOf(sp, "originLat"));
  const lng = Number(oneOf(sp, "originLng"));

  const driveRaw = Number(oneOf(sp, "drive"));

  return {
    moods: parseIndexes(oneOf(sp, "mood"), MOODS.length),
    interests: parseIndexes(oneOf(sp, "int"), INTERESTS.length),
    ...period,
    companion,
    people: {
      adult: parseCount(counts[0], DEFAULT_TRIP.people.adult),
      teen: parseCount(counts[1], DEFAULT_TRIP.people.teen),
      child: parseCount(counts[2], DEFAULT_TRIP.people.child),
    },
    origin: (oneOf(sp, "origin") ?? "").trim(),
    // 좌표는 둘 다 수여야 쓴다. 하나만 오면 지도 위 엉뚱한 자리에 찍히느니 없는 편이 낫다
    originAt: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null,
    driveHours: DRIVE_HOURS.some((d) => d.hours === driveRaw) ? driveRaw : DEFAULT_TRIP.driveHours,
    musts: allOf(sp, "must")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, MAX_MUSTS),
  };
}

/**
 * 여행 계획 → "?mood=0,2&from=..". 안 고른 값은 키째 뺀다 —
 * parseTrip 이 없는 키를 기본값으로 읽으므로 URL 만 길어질 뿐이다.
 */
export function toTripQuery(plan: TripPlan): string {
  const params = new URLSearchParams();
  if (plan.moods.length) params.set("mood", plan.moods.join(","));
  if (plan.interests.length) params.set("int", plan.interests.join(","));
  if (plan.start && plan.end) {
    params.set("from", plan.start);
    params.set("to", plan.end);
  }
  params.set("with", plan.companion);
  params.set("ppl", PEOPLE.map((p) => plan.people[p.key]).join(","));
  if (plan.origin) params.set("origin", plan.origin);
  if (plan.originAt) {
    params.set("originLat", String(plan.originAt[0]));
    params.set("originLng", String(plan.originAt[1]));
  }
  params.set("drive", String(plan.driveHours));
  for (const m of plan.musts.slice(0, MAX_MUSTS)) params.append("must", m);
  return `?${params}`;
}
