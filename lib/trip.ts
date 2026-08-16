// 여행 계획 ↔ URL 쿼리 변환. AI 여행 코스 플로우(/trip)가 고른 값을 코스 생성(/trip/course)에 넘긴다.
//
// lib/profile.ts 와 같은 자리, 같은 이유다 — 링크 하나로 재현·공유되고 새로고침에도 안 날아간다.
// 그래서 같은 제약도 따라온다: URL 은 사용자가 손으로 고칠 수 있는 입력이라 여기가 신뢰 경계다.
//
// 선택지 목록이 화면이 아니라 여기 있는 것도 CONCERNS(lib/profile.ts)와 같은 이유다 —
// 화면이 보여주는 말과 URL 이 받아주는 값이 갈리면, 고른 적 없는 값이 코스에 들어간다.

import type { LatLng } from "@/app/RouteMap";

/**
 * TRIP-02 | 여행 테마 — **하나만** 고른다.
 *
 * 원래 "분위기 4개(복수) + 관심 장소 6개(복수)" 두 묶음이었는데 와이어프레임에서 테마 넷으로
 * 합쳐졌다 ("4개로 통합"). 고르는 게 하나라 코스가 무엇을 중심으로 짜였는지도 한 마디로 말해진다.
 *
 * recipes 는 후보를 모을 때 카카오 로컬에 보내는 검색 조건이다 (lib/poi.ts searchSpotsNear).
 * 한 테마가 여러 갈래를 묶으므로 목록이다 — "먹거리"는 시장과 맛집이 서로 다른 검색이고,
 * "감성 명소"는 카페와 전시가 그렇다. 갈래가 둘이면 코스 두 개를 갈래별로 나눠 짤 수도 있다
 * (lib/course.ts buildCourses).
 *
 * **query·code·kinds 셋 다 필요하다.** 실제 응답을 찍어보고 정한 값이라 하나라도 빼면 목록이 망가진다:
 *   · code 없이 키워드만 : "오름"에 세탁소·네일샵·빌라가 섞인다 (총 294건 중 대부분)
 *   · code 만           : 해수욕장·오름·테마파크가 전부 AT4 한 칸이라 서로 못 가른다
 *   · kinds 없이        : 카페에 공항 프랜차이즈가 앞자리를 다 먹는다 (끝 분류가 브랜드명이다)
 */
export const THEMES = [
  {
    emoji: "🌊",
    label: "조용한 바다 여행",
    desc: "한적한 해변 · 노을",
    recipes: [{ label: "해변", query: "해수욕장", code: "AT4", kinds: ["해수욕장", "해변"] }],
  },
  {
    emoji: "🌿",
    label: "자연 속 산책 여행",
    desc: "오름 · 숲길",
    recipes: [
      { label: "오름", query: "오름", code: "AT4", kinds: ["오름"] },
      { label: "숲길", query: "휴양림", code: "AT4", kinds: ["휴양림", "수목원", "식물원"] },
    ],
  },
  {
    emoji: "🍊",
    label: "제주 먹거리 여행",
    desc: "시장 · 로컬 맛집",
    recipes: [
      // 시장은 AT4 로 조회하면 0건이라 코드를 안 건다 — 카카오가 시장을 관광명소로 안 묶는다
      { label: "시장", query: "전통시장", code: "", kinds: ["시장"] },
      { label: "로컬 맛집", query: "제주 향토음식", code: "FD6", kinds: ["한식", "해물", "향토", "국수", "흑돼지"] },
    ],
  },
  {
    emoji: "📷",
    label: "감성 명소 여행",
    desc: "카페 · 전시 · 사진",
    recipes: [
      // "카페"로 찾으면 공항 상업시설이 먼저 온다. 여행에서 찾는 건 그 카페가 아니다
      { label: "카페", query: "오션뷰 카페", code: "CE7", kinds: ["카페", "커피전문점"] },
      { label: "전시", query: "박물관", code: "CT1", kinds: ["박물관", "미술관", "전시"] },
    ],
  },
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
  /** THEMES 인덱스. 하나만 고른다 — 아직 안 골랐으면 null */
  theme: number | null;
  /** YYYY-MM-DD. 빈 문자열이면 아직 안 골랐다 (start·end 는 늘 같이 차거나 같이 빈다) */
  start: string;
  end: string;
  /** 아직 안 고르면 null */
  companion: Companion | null;
  people: Record<PeopleKey, number>;
  /** 출발 위치 이름. 빈 문자열이면 아직 안 골랐다 */
  origin: string;
  /** 출발 위치 좌표. 이름만 받은 경우(직접 입력)를 위해 따로 둔다 */
  originAt: LatLng | null;
  /** 아직 안 고르면 null. 0 은 "시간 상관없음"이라 null 과 다르다 */
  driveHours: number | null;
  musts: string[];
};

/**
 * 아무것도 안 고른 상태 — 처음 열면 목록의 다섯 줄이 전부 비어 있어야 한다.
 *
 * 한때 동행과 하루 운전에 기본값(친구 2명 · 2시간)을 넣어뒀는데, 와이어프레임에 그려진
 * "친구 2명"은 기본값이 아니라 **다 고른 뒤의 모습**이었다. 고른 적 없는 값을 채워두면
 * 사용자는 손대지 않고 지나가고, 코스는 묻지도 않은 조건으로 짜인다.
 *
 * people 만 0 이 아닌 이유는 이게 화면에 안 보이는 값이라서다 — 동행을 안 고르면 줄 자체가
 * 비어 보이고, 04-B 를 열었을 때 카운터가 시작할 자리로만 쓰인다.
 */
export const DEFAULT_TRIP: TripPlan = {
  theme: null,
  start: "",
  end: "",
  companion: null,
  people: { adult: 2, teen: 0, child: 0 },
  origin: "",
  originAt: null,
  driveHours: null,
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

/**
 * 한 달치 달력 칸. 앞뒤로 옆 달 날짜를 채워 7칸씩 딱 떨어지게 만든다 (TRIP-04-A).
 *
 * UTC 로 센다 — nightsOf 와 같은 이유이자, 같은 기준이어야 한다. 로컬 시간대로 만들면
 * 서머타임이 있는 지역에서 하루가 밀려 격자와 기간 계산이 서로 다른 날을 가리킨다.
 *
 * @param month "2026-08"
 */
export function monthGrid(month: string): { date: string; inMonth: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  // 그 주 일요일까지 되감는다. 6주(42칸)면 어느 달이든 덮는다 —
  // 최악은 31일 달이 토요일에 시작하는 경우로 6주가 필요하다
  const from = first - new Date(first).getUTCDay() * 86_400_000;
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(from + i * 86_400_000);
    return { date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 };
  });
}

/** "2026-08" 에서 n 달 뒤/앞. 12월 다음이 이듬해 1월이 되게 한다. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** "2026-08-14" → "8월 14일" */
export const dayLabel = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
};

/** "2박 3일" · "당일치기". 아직 안 골랐으면 null — 화면이 자리를 채울 문구를 정한다. */
export function periodLabel(plan: TripPlan): string | null {
  const n = nightsOf(plan.start, plan.end);
  if (!n) return null;
  return n.nights === 0 ? "당일치기" : `${n.nights}박 ${n.days}일`;
}

export const peopleTotal = (plan: TripPlan) => PEOPLE.reduce((sum, p) => sum + plan.people[p.key], 0);

/** "친구 2명" — TRIP-04 목록과 TRIP-04-B 버튼이 같이 쓴다. 안 골랐으면 null */
export function companionLabel(plan: TripPlan): string | null {
  const found = COMPANIONS.find((c) => c.id === plan.companion);
  return found ? `${found.label} ${peopleTotal(plan)}명` : null;
}

/** "2시간 이내". 안 골랐으면 null */
export const driveLabel = (plan: TripPlan) =>
  DRIVE_HOURS.find((d) => d.hours === plan.driveHours)?.label ?? null;

/** "성산일출봉" · "성산일출봉 외 1곳". 안 골랐으면 null */
export function mustLabel(plan: TripPlan): string | null {
  if (!plan.musts.length) return null;
  return plan.musts.length === 1 ? plan.musts[0] : `${plan.musts[0]} 외 ${plan.musts.length - 1}곳`;
}

/**
 * 코스를 만들 수 있는 상태인지. 목록의 다섯 줄 중 "꼭 가고 싶은 곳"만 빼고 다 골라야 한다 —
 * 날짜·출발 위치·하루 운전은 전부 이동시간 계산의 입력이고, 안 고른 값을 대신 지어내면
 * 묻지도 않은 조건으로 코스가 짜인다. 꼭 가고 싶은 곳은 없어도 코스가 나온다.
 *
 * 테마는 여기서 안 본다 — TRIP-02 가 자기 화면에서 이미 막고 있고, 여기까지 왔다면 골라져 있다.
 */
export const isReady = (plan: TripPlan) =>
  nightsOf(plan.start, plan.end) !== null &&
  plan.origin !== "" &&
  plan.companion !== null &&
  plan.driveHours !== null;

/** ?key=value 에서 같은 키가 여러 번 오면 첫 값 (lib/profile.ts 와 같은 규칙) */
const oneOf = (sp: Record<string, string | string[] | undefined>, k: string) =>
  Array.isArray(sp[k]) ? sp[k][0] : sp[k];

/** 같은 키의 값을 전부. musts 처럼 개수가 정해지지 않은 값에 쓴다. */
const allOf = (sp: Record<string, string | string[] | undefined>, k: string): string[] => {
  const v = sp[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
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

  // 목록 밖이거나 없으면 null — 기본값으로 채우면 고른 적 없는 동행이 코스에 들어간다
  const companion = COMPANIONS.find((c) => c.id === oneOf(sp, "with"))?.id ?? null;
  const counts = (oneOf(sp, "ppl") ?? "").split(",");

  const lat = Number(oneOf(sp, "originLat"));
  const lng = Number(oneOf(sp, "originLng"));

  const driveRaw = Number(oneOf(sp, "drive"));

  // 숫자만 남기고 나서 Number 를 태운다 — Number("") 도 Number(" ") 도 0 이라
  // 그냥 태우면 빈 값이 테마 0("조용한 바다")으로 샌다. 목록 밖이어도 null 이다.
  const themeRaw = oneOf(sp, "theme");

  return {
    theme: themeRaw && /^\d+$/.test(themeRaw) && Number(themeRaw) < THEMES.length ? Number(themeRaw) : null,
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
    driveHours: DRIVE_HOURS.some((d) => d.hours === driveRaw) ? driveRaw : null,
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
  if (plan.theme !== null) params.set("theme", String(plan.theme));
  if (plan.start && plan.end) {
    params.set("from", plan.start);
    params.set("to", plan.end);
  }
  // 안 고른 동행은 키째 뺀다 — 인원도 같이 뺀다 (동행 없이 인원만 있으면 읽을 데가 없다)
  if (plan.companion) {
    params.set("with", plan.companion);
    params.set("ppl", PEOPLE.map((p) => plan.people[p.key]).join(","));
  }
  if (plan.origin) params.set("origin", plan.origin);
  if (plan.originAt) {
    params.set("originLat", String(plan.originAt[0]));
    params.set("originLng", String(plan.originAt[1]));
  }
  if (plan.driveHours !== null) params.set("drive", String(plan.driveHours));
  for (const m of plan.musts.slice(0, MAX_MUSTS)) params.append("must", m);
  return `?${params}`;
}
