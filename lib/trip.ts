// 여행 계획 ↔ URL 쿼리 변환. AI 여행 코스 플로우(/trip)가 고른 값을 코스 생성(/trip/course)에 넘긴다.
//
// lib/profile.ts 와 같은 자리, 같은 이유다 — 링크 하나로 재현·공유되고 새로고침에도 안 날아간다.
// 그래서 같은 제약도 따라온다: URL 은 사용자가 손으로 고칠 수 있는 입력이라 여기가 신뢰 경계다.
//
// 선택지 목록이 화면이 아니라 여기 있는 것도 CONCERNS(lib/profile.ts)와 같은 이유다 —
// 화면이 보여주는 말과 URL 이 받아주는 값이 갈리면, 고른 적 없는 값이 코스에 들어간다.

import type { LatLng } from "@/app/RouteMap";

/**
 * TRIP-03 | 여행 테마 — **여러 개** 고른다.
 *
 * 원래 "분위기 4개(복수) + 관심 장소 6개(복수)" 두 묶음이었는데 와이어프레임에서 테마 넷으로
 * 합쳐졌고("4개로 통합"), 한동안 하나만 고르는 방식이었다가 다시 복수로 돌아왔다.
 * 여러 날 가는 사람이 하루는 바다, 하루는 오름을 보고 싶어 하는 게 이 화면이 받아야 할 말이라
 * 하나로 묶으면 그 말을 못 한다 ("여러 개 고르면 매일 다른 곳을 볼 수 있어요").
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
    icon: "/trip/theme-sea.png",
    label: "조용한 바다 여행",
    desc: "한적한 해변 · 노을",
    recipes: [{ label: "해변", query: "해수욕장", code: "AT4", kinds: ["해수욕장", "해변"] }],
  },
  {
    icon: "/trip/theme-nature.png",
    label: "자연 속 산책 여행",
    desc: "오름 · 숲길",
    recipes: [
      { label: "오름", query: "오름", code: "AT4", kinds: ["오름"] },
      { label: "숲길", query: "휴양림", code: "AT4", kinds: ["휴양림", "수목원", "식물원"] },
    ],
  },
  {
    icon: "/trip/theme-food.png",
    label: "제주 먹거리 여행",
    desc: "시장 · 로컬 맛집",
    recipes: [
      // 시장은 AT4 로 조회하면 0건이라 코드를 안 건다 — 카카오가 시장을 관광명소로 안 묶는다
      { label: "시장", query: "전통시장", code: "", kinds: ["시장"] },
      { label: "로컬 맛집", query: "제주 향토음식", code: "FD6", kinds: ["한식", "해물", "향토", "국수", "흑돼지"] },
    ],
  },
  {
    icon: "/trip/theme-photo.png",
    label: "감성 명소 여행",
    desc: "카페 · 전시 · 사진",
    recipes: [
      // "카페"로 찾으면 공항 상업시설이 먼저 온다. 여행에서 찾는 건 그 카페가 아니다
      { label: "카페", query: "오션뷰 카페", code: "CE7", kinds: ["카페", "커피전문점"] },
      { label: "전시", query: "박물관", code: "CT1", kinds: ["박물관", "미술관", "전시"] },
    ],
  },
];

/**
 * 후보를 긁을 때 카카오에 보내는 검색 조건 한 벌. THEMES 와 SEASONS 가 같은 모양을 쓴다
 * (lib/poi.ts searchSpotsNear 가 받는 값 + 화면·코스 제목에 쓸 label).
 */
export type Recipe = { label: string; query: string; code: string; kinds: readonly string[] };

export const SEASON_NAMES = ["봄", "여름", "가을", "겨울"] as const;
export type Season = (typeof SEASON_NAMES)[number];

/**
 * 계절마다 **그 계절에 가는 장소 유형**.
 *
 * **꽃·억새·단풍은 여기 없다.** 넣고 싶었지만 카카오로는 못 찾는다 — 실측한 결과다:
 *   · "유채꽃"+AT4 → 50곳인데 상여오름·에코랜드·올레길18코스… 검색어가 통째로 무시된다
 *   · "억새"+AT4  → 57곳, 전부 그냥 오름·올레길
 *   · "단풍"      → 청단풍(카페)·단풍정원(떡카페)·단풍이네농장
 * 카카오가 아는 건 "그 장소가 무엇인가"지 "지금 거기 뭐가 피는가"가 아니다. 계절 상태를
 * 넣으려면 사람이 적은 목록이 있어야 한다 (data/spots.json 이 그 방식이다).
 * 그래서 여기는 **유형이 계절을 타는 것만** 둔다 — 겨울에 해수욕장을 권하지 않는 정도면 충분하다.
 *
 * 아래 값은 전부 실제 응답을 찍어보고 남긴 것이다 (앵커 4곳 합계, 부대시설·폐업 거른 뒤):
 *   수목원 41 · 곶자왈 7 · 해수욕장 38 · 계곡 18 · 오름 59 · 휴양림 8 · 박물관 45 · 동백 5
 * 폭포는 뺐다 — AT4 로 3곳뿐이고 천지연·정방은 분류가 폭포가 아니라 전망대로 온다.
 *
 * label 에 계절을 붙이는 이유: 코스 제목이 "조용한 바다 여행 · 겨울 동백"처럼 나오는데,
 * "동백"만 있으면 왜 그게 붙었는지 안 읽힌다.
 */
export const SEASONS: Record<Season, Recipe[]> = {
  봄: [
    { label: "봄 수목원", query: "수목원", code: "AT4", kinds: ["수목원", "식물원"] },
    { label: "봄 곶자왈", query: "곶자왈", code: "AT4", kinds: ["숲", "곶자왈", "공원"] },
  ],
  여름: [
    { label: "여름 해수욕장", query: "해수욕장", code: "AT4", kinds: ["해수욕장", "해변"] },
    { label: "여름 계곡", query: "계곡", code: "AT4", kinds: ["계곡"] },
  ],
  가을: [
    { label: "가을 오름", query: "오름", code: "AT4", kinds: ["오름"] },
    { label: "가을 휴양림", query: "휴양림", code: "AT4", kinds: ["휴양림", "숲"] },
  ],
  겨울: [
    // 동백은 이름에 동백이 든 곳만 잡힌다 (동백동산·동백포레스트·제주동백수목원…) — 5곳이지만 전부 진짜다
    { label: "겨울 동백", query: "제주 동백", code: "AT4", kinds: ["숲", "수목원", "식물원", "관광농원"] },
    // 추워서 밖에 오래 못 있는 계절이라 실내 한 칸을 끼운다
    { label: "겨울 실내 전시", query: "박물관", code: "CT1", kinds: ["박물관", "미술관", "전시"] },
  ],
};

/**
 * 여행 시작일 → 계절. 기상학 기준(3·6·9·12월 시작)이다 —
 * 절기로 가르면 5월 초가 여름이 되는데, 사람이 짐 쌀 때 쓰는 계절은 달 단위다.
 *
 * 날짜가 없거나 망가졌으면 null 이다. 그때는 계절 후보를 안 붙인다 —
 * 모르는 계절을 아무거나로 채우면 겨울에 해수욕장이 섞인다.
 */
export function seasonOf(start: string): Season | null {
  if (!isDate(start)) return null;
  const m = Number(start.slice(5, 7));
  return m <= 2 || m === 12 ? "겨울" : m <= 5 ? "봄" : m <= 8 ? "여름" : "가을";
}

/** 갈래가 어디서 왔는지. 추천 카드를 이끌 수 있는 건 테마와 계절뿐이다 (lib/course.ts leadsOf) */
export type Role = "theme" | "season" | "staple";
export type Leg = Recipe & { role: Role };

/**
 * 어느 테마를 골랐든 늘 같이 넣는 갈래. **테마는 코스의 중심을 정하지, 후보 전체를 정하지 않는다.**
 *
 * 이게 없을 때 「조용한 바다」+ 여름의 후보가 해변 36곳과 계곡 18곳, 그게 전부였다 —
 * 하루 종일 물가만 도는 코스가 나온다.
 *
 * **후보를 카카오에서 안 받는다** — query·code·kinds 가 빈 건 그래서다. 이 갈래만
 * `data/spots.json` 에서 온다 (lib/course.ts gatherCandidates 가 role 로 갈라 채운다).
 * 카카오로 "관광지"를 긁으면 가삿기오름·8번게이트가 성산일출봉과 같은 자격으로 섞인다 —
 * 인기도 신호를 안 주기 때문이고, 그래서 사람이 고른 122곳을 따로 두고 있다
 * (scripts/build-spots.mjs 첫 주석). 여기서 그 목록을 그대로 쓴다.
 *
 * 한때 "근처 맛집·카페"였는데 뺐다 — 코스에 호텔·프랜차이즈 같은 이름이 관광지 자리에 섞였다.
 * 하루에 들어가는 건 어차피 한 곳이라(같은 갈래를 두 번 안 넣는다) 볼거리 쪽이 낫다.
 */
export const STAPLE: Leg = { label: "제주 대표 관광지", query: "", code: "", kinds: [], role: "staple" };

/**
 * 이 여행의 후보를 긁을 검색 조건 전부 — **고른 테마 + 그 계절 + 기본 갈래**.
 *
 * 계절을 테마 뒤에 이어 붙이는 것뿐이라 나머지가 다 그대로 돈다: 후보가 어느 갈래에서
 * 나왔는지(Candidate.recipe)도, 추천 카드 둘이 서로 다른 갈래를 앞세우는 것도(leadsOf).
 * 덕분에 **두 번째 카드가 계절 코스로 갈라진다** — 「조용한 바다」를 겨울에 고르면
 * 한 장은 해변, 한 장은 동백이 된다. 해변만 세 곳 나오던 것이 이걸로 갈린다.
 *
 * **같은 검색은 한 번만 한다.** 겹치는 게 실제로 있다: 「조용한 바다」의 "해변"과 「여름 해수욕장」은
 * query·code 가 똑같다.
 * 안 걸러내면 카카오를 네 번 더 부르고도 그 갈래는 0곳이 된다 — dedupe(lib/course.ts)가 먼저 온
 * 쪽을 남기기 때문이다. 그러면 추천 카드가 있지도 않은 갈래를 이끌게 된다.
 *
 * 순서가 중요하다: **테마 → 계절 → 기본**. 앞에 온 쪽이 겹칠 때 살아남고, leadsOf 가 이 role 로
 * 카드를 나눈다 (한 장은 테마, 한 장은 계절, 기본은 카드를 이끌지 않는다).
 */
export function recipesFor(plan: TripPlan): Leg[] {
  const season = seasonOf(plan.start);
  const 줄: Leg[] = [
    /*
      **고른 테마를 전부 쓴다.** 전에는 plan.themes[0] 하나만 봤다 — 화면은 "복수 선택 가능"
      배지를 달고 넷을 다 켜게 해주는데 코스에는 첫 테마만 들어갔다. 바다 + 먹거리를 고르면
      바다 코스만 나왔고, 고른 순서가 결과를 정하는데 화면에는 순서 표시도 없었다.
      고르게 해놓고 안 쓰는 값은 사용자 입장에서 답한 노력이 증발하는 것이다.

      갈래가 늘면 카카오 호출도 는다 (갈래 × ANCHORS 4). 테마 넷을 다 골라도 서른 남짓이고
      전부 병렬이며, 쿼터는 월 300만 중 앱 전체가 만 오천 남짓이라 여유가 있다
      (lib/course.ts gatherCandidates 주석의 실측).

      순서는 그대로 지킨다 — 첫 테마가 코스 제목의 중심이다 (lib/course.ts titleOf).
      아래 dedupe 가 테마끼리 겹치는 갈래를 한 번으로 접는다.
    */
    ...plan.themes.flatMap((t) => THEMES[t]?.recipes ?? []).map((r): Leg => ({ ...r, role: "theme" })),
    ...(season ? SEASONS[season] : []).map((r): Leg => ({ ...r, role: "season" })),
    STAPLE,
  ];
  const 본것 = new Set<string>();
  return 줄.filter((r) => !본것.has(`${r.query}|${r.code}`) && 본것.add(`${r.query}|${r.code}`));
}

/**
 * TRIP-04-B | 동행 선택.
 *
 * "혼자"가 맨 앞이다 (04-B-2). 넷이던 때는 혼자 온 사람이 고를 칸이 없어 아무거나 눌러야 했다 —
 * 동행은 쉬는 자리를 정하는 입력이라(주차·화장실·먹을 곳) 없는 동행을 지어내면 코스가 그만큼 틀어진다.
 *
 * **fixed 는 그 말에 인원이 이미 들어 있는지다** (혼자 1 · 연인 2). 0 이면 몇 명인지 물어야 한다.
 * 화면도 이 순서대로 2 × 2 로 앉는다 — 윗줄은 안 묻는 둘, 아랫줄은 묻는 둘이라
 * 위를 고르면 카운터가 안 나오고 아래를 고르면 나오는 게 줄 단위로 읽힌다 (app/trip/page.tsx CompanionView).
 *
 * **"반려견"은 뺐다.** 고를 수는 있는데 코스는 하나도 안 달라졌다 — 반려견을 고른 사람이
 * 기대하는 건 "들어갈 수 있는 곳"인데, 카카오 카테고리로는 동반 가능 여부를 알 수 없어서
 * (lib/trip.ts 계절 주석과 같은 한계) 박물관·전시가 그대로 코스에 들어갔다.
 * 가서야 못 들어가는 것보다 안 묻는 게 낫다. 사람이 만든 목록에 동반 가능 칸이 생기면 그때 되살린다.
 */
export const COMPANIONS = [
  { id: "solo", icon: "/trip/with-solo.png", label: "혼자", fixed: 1 },
  { id: "couple", icon: "/trip/with-couple.png", label: "연인", fixed: 2 },
  { id: "family", icon: "/trip/with-family.png", label: "가족", fixed: 0 },
  { id: "friend", icon: "/trip/with-friend.png", label: "친구", fixed: 0 },
] as const;

/** 인원이 말에 이미 들어 있는 동행이면 그 수, 아니면 0 (물어봐야 한다) */
export const fixedHeads = (id: Companion | null): number =>
  COMPANIONS.find((c) => c.id === id)?.fixed ?? 0;

export type Companion = (typeof COMPANIONS)[number]["id"];

/**
 * 인원 구분. 나이 경계 설명("중학생 ~ 고등학생")은 04-B-2 에서 빠졌다 —
 * 세 줄이 한 화면에 동행 타일과 같이 서면서 설명까지 들어갈 자리가 없어졌다.
 */
export const PEOPLE = [
  { key: "adult", label: "성인" },
  { key: "teen", label: "청소년" },
  { key: "child", label: "어린이" },
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
  /** THEMES 인덱스. 여러 개 고른다 — 고른 순서를 지킨다 (첫 번째가 코스의 중심이다) */
  themes: number[];
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
 * 인원도 0 에서 시작한다 (04-B-2). 카운터는 동행을 고른 **뒤에** 나타나므로 0 이 그대로 보이고,
 * 그 자리에서 세면 된다 — 성인 2 를 미리 넣어두면 혼자 온 사람도 둘로 세어진다.
 */
export const DEFAULT_TRIP: TripPlan = {
  themes: [],
  start: "",
  end: "",
  companion: null,
  people: { adult: 0, teen: 0, child: 0 },
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

/**
 * "친구 2명" — TRIP-02 목록과 TRIP-04-B 버튼이 같이 쓴다. 안 골랐으면 null.
 * 혼자는 인원을 안 붙인다 — "혼자 1명"은 같은 말을 두 번 하는 것이고, 그 화면도 카운터를 안 띄운다.
 */
export function companionLabel(plan: TripPlan): string | null {
  const found = COMPANIONS.find((c) => c.id === plan.companion);
  if (!found) return null;
  // 인원이 말에 이미 든 동행(혼자·연인)은 수를 안 붙인다 — "연인 2명"은 같은 말을 두 번 한다
  return found.fixed ? found.label : `${found.label} ${peopleTotal(plan)}명`;
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
 * 기본정보 화면(TRIP-02)에서 다음으로 넘어갈 수 있는 상태인지 — **필수 세 줄**이다.
 * 날짜·동행·출발 위치는 안 고른 값을 대신 지어내면 묻지도 않은 조건으로 코스가 짜인다.
 *
 * 하루 운전은 여기서 안 본다. 와이어프레임이 이 줄만 "선택" 묶음으로 내렸다 —
 * 없으면 이동시간 상한을 안 걸 뿐이라(lib/course.ts capMin) 코스는 그대로 나온다.
 * 테마도 안 본다 — 다음 화면(TRIP-03)이 자기 자리에서 막는다.
 */
export const isReady = (plan: TripPlan) =>
  nightsOf(plan.start, plan.end) !== null && plan.origin !== "" && plan.companion !== null;

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

/**
 * "?theme=0&theme=2&must=A&must=B" → parseTrip 이 받는 모양.
 *
 * **Object.fromEntries 를 쓰면 안 된다.** 같은 키가 여러 번 오면 마지막 하나만 남는다 —
 * 테마 둘을 골라도 하나만 도착하고, "꼭 가고 싶은 곳"은 마지막 한 곳만 코스에 들어간다
 * (실제로 그랬다: theme=0&theme=2 를 보냈는데 코스 제목이 두 번째 테마로 나왔다).
 * 반복 키는 이 앱이 일부러 고른 방식이라(장소 이름에 쉼표가 들어가도 안 쪼개진다) 읽는 쪽이 맞춰야 한다.
 */
export function queryRecord(query: string | URLSearchParams): Record<string, string | string[]> {
  const sp = typeof query === "string" ? new URLSearchParams(query) : query;
  const rec: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    rec[key] = all.length > 1 ? all : all[0];
  }
  return rec;
}

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

  /*
    테마는 반복 키(theme=0&theme=2)로 온다. 숫자만 남기고 나서 Number 를 태운다 —
    Number("") 도 Number(" ") 도 0 이라 그냥 태우면 빈 값이 테마 0("조용한 바다")으로 샌다.
    목록 밖은 버리고, 같은 값이 두 번 오면 한 번만 남긴다 (URL 을 손으로 고칠 수 있는 자리다 —
    중복이 남으면 그 테마만 후보를 두 배로 긁는다, lib/course.ts gatherCandidates).
  */
  const themes = [
    ...new Set(
      allOf(sp, "theme")
        .filter((t) => /^\d+$/.test(t) && Number(t) < THEMES.length)
        .map(Number),
    ),
  ];

  return {
    themes,
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
 * toTripQuery 가 싣는 키 전부.
 *
 * 조건을 **안 물려받을 때 URL 에서 걷어내는 데** 쓴다 (app/trip/page.tsx). 홈에서 새로 시작하는데
 * 지난 여행의 must 가 쿼리에 남아 있으면, 고른 적 없는 장소가 코스에 들어간다.
 * toTripQuery 에 키를 더하면 여기도 같이 더해야 한다 — lib/trip.check.ts 가 둘이 어긋나면 잡는다.
 */
export const TRIP_KEYS = ["theme", "from", "to", "with", "ppl", "origin", "originLat", "originLng", "drive", "must"] as const;

/**
 * 여행 계획 → "?mood=0,2&from=..". 안 고른 값은 키째 뺀다 —
 * parseTrip 이 없는 키를 기본값으로 읽으므로 URL 만 길어질 뿐이다.
 */
export function toTripQuery(plan: TripPlan): string {
  const params = new URLSearchParams();
  // 고른 순서대로 싣는다 — 첫 테마가 코스 제목과 후보의 중심이다 (lib/course.ts titleOf)
  for (const t of plan.themes) params.append("theme", String(t));
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
