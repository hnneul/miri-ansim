// 여행 코스 짜기 — 와이어프레임 TRIP-05(생성 중) · TRIP-06(코스 추천)이 쓰는 계산.
//
// **AI 는 여기서 아무것도 안 정한다.** 어느 장소를 넣을지, 어떤 순서로 돌지, 며칠째에 갈지는
// 전부 이 파일이 좌표와 시간으로 계산한다. AI 는 다 정해진 코스를 읽어 이름과 설명을 쓸 뿐이다
// (lib/ai.ts 첫 주석과 같은 원칙 — 숫자·추천 결과는 계산이 정하고 AI 는 한국어로 옮긴다).
// 이걸 뒤집으면 실재하지 않는 장소나 맞지 않는 이동시간이 코스에 섞인다.
//
// 후보 수집(카카오 호출)은 gatherCandidates 가 하고, 코스를 짜는 buildCourses 는 순수 함수다 —
// 그래서 lib/course.check.ts 가 네트워크 없이 규칙을 전부 검증할 수 있다.

import { meters } from "./parking.ts";
import { searchSpotsNear, type Spot } from "./poi.ts";
import { geocodePlace } from "./geocode.ts";
import { THEMES, nightsOf, type TripPlan } from "./trip.ts";
import type { LatLng } from "@/app/RouteMap";

/**
 * 직선거리 → 실제 도로 거리 보정.
 * ponytail: 제주는 해안도로·중산간이 곡선이라 직선보다 멀다. 후보 하나하나에 카카오 길찾기를
 * 부르면 장소 수의 제곱만큼 호출이 나가므로, 고른 코스의 정확한 값은 화면(2b)에서
 * compareRoutes 로 다시 잰다. 여기서는 순서를 정하는 데만 쓰는 어림값이다.
 */
const DETOUR = 1.3;

/** 평균 주행 속도(km/h). 제주 일반도로 기준 — 고속도로가 없는 섬이라 한 값으로 잡는다. */
const SPEED_KMH = 40;

/**
 * 후보를 찾는 기준점. 카카오 반경 상한이 20km 인데 제주는 동서 73km 라, 출발지 한 곳에서만
 * 찾으면 섬 절반이 후보에서 빠진다 — 공항에서 성산은 42km, 서귀포는 29km 다.
 * 실측: 해수욕장 후보가 한 곳에서 10곳, 네 곳에서 38곳. 중문·월정리·협재·표선이 그 차이다.
 *
 * 네 곳으로 섬이 덮인다. 출발지는 앵커에 안 넣는다 — 제주가 좁아 어느 출발지든
 * 이 넷 중 하나의 반경 안이고, 겹치는 결과는 dedupe 가 정리한다.
 */
const ANCHORS: LatLng[] = [
  [33.4996, 126.5312], // 제주시
  [33.2541, 126.56], // 서귀포
  [33.458, 126.9425], // 성산
  [33.414, 126.269], // 한림
];

/** 하루에 넣을 장소 수. 3곳이면 이동·관람·식사가 한 낮에 들어간다. */
const STOPS_PER_DAY = 3;

/** 추천 코스 개수 (와이어프레임 TRIP-06 이 카드 두 장이다) */
const COURSE_COUNT = 2;

/**
 * 이만큼 안에 붙어 있으면 사실상 같은 자리로 본다.
 * 카카오는 한 자리를 여러 이름으로 준다 — 그대로 넣으면 "이동 0분"짜리 정거장이 하루 정원을 먹는다.
 * 300m 는 이동시간이 1분으로 찍히기 시작하는 지점(256m)에 맞춘 값이다. 그보다 멀면 서로 다른
 * 가게로 보고 남긴다 — 한 동네의 카페 두 곳을 묶어 도는 건 코스로서 말이 된다.
 */
const MIN_GAP_M = 300;

export const driveMinutes = (m: number) => Math.round(((m * DETOUR) / 1000 / SPEED_KMH) * 60);

/** 코스 후보 한 곳. must 는 사용자가 "꼭 가고 싶은 곳"에 직접 넣은 자리다. */
export type Candidate = Spot & {
  /** 테마의 몇 번째 갈래(THEMES[t].recipes 인덱스)에서 나왔는지. must 로 들어온 곳은 null */
  recipe: number | null;
  must: boolean;
};

export type Stop = Candidate & {
  /** 직전 지점(하루의 첫 자리는 출발지)에서 여기까지 */
  legM: number;
  legMin: number;
};

export type Day = {
  /** YYYY-MM-DD */
  date: string;
  stops: Stop[];
  /** 출발지에서 나가 마지막 장소를 보고 돌아오기까지 — 이게 "하루 운전 시간"이다 */
  driveM: number;
  driveMin: number;
};

export type Course = {
  /** 이 코스를 이끄는 갈래(THEMES[t].recipes 인덱스). 갈래가 하나뿐인 테마면 null */
  lead: number | null;
  /** 규칙으로 지은 이름. 2b 에서 AI 문장으로 갈아끼운다 (실패하면 이 값이 그대로 남는다) */
  title: string;
  days: Day[];
  totalM: number;
  totalMin: number;
};

/* ─────────────────────────── 후보 수집 (네트워크) ─────────────────────────── */

/**
 * 코스에 쓸 후보를 모은다. 고른 테마의 갈래 × 앵커(ANCHORS)마다 카카오를 한 번씩 부르고,
 * "꼭 가고 싶은 곳"은 이름만 있으므로 지오코딩으로 좌표를 붙인다.
 *
 * 갈래가 둘인 테마면 8회가 나가는데 전부 병렬이라 0.2초쯤 걸린다(실측). 쿼터도 넉넉하다 —
 * 월 300만 중 앱 전체가 쓰는 게 만 오천 남짓이다.
 *
 * 실패한 호출은 건너뛴다 — 여덟 중 하나가 응답을 못 받았다고 코스를 통째로 못 만들 이유가 없다.
 * 다만 must 는 사용자가 직접 지목한 곳이라, 좌표를 못 받으면 조용히 빼지 않고 missing 으로 알린다.
 */
export async function gatherCandidates(
  plan: TripPlan,
): Promise<{ candidates: Candidate[]; missing: string[] }> {
  const origin = plan.originAt;
  if (!origin) return { candidates: [], missing: plan.musts };

  const recipes = plan.theme === null ? [] : THEMES[plan.theme].recipes;
  const fromTheme = await Promise.all(
    recipes.flatMap((recipe, r) =>
      ANCHORS.map(async (at) => {
        const found = await searchSpotsNear(at, recipe, 20000);
        return "error" in found ? [] : found.spots.map((s): Candidate => ({ ...s, recipe: r, must: false }));
      }),
    ),
  );

  const missing: string[] = [];
  const fromMusts = await Promise.all(
    plan.musts.map(async (name): Promise<Candidate | null> => {
      const found = await geocodePlace(name);
      if ("error" in found) {
        missing.push(name);
        return null;
      }
      return { name: found.label, at: found.coord, addr: found.road || found.jibun || null, kind: found.type, recipe: null, must: true };
    }),
  );

  // must 를 앞에 둔다 — 뒤의 dedupe 가 먼저 온 쪽을 남기므로, 같은 곳이 관심사 검색에도
  // 걸렸을 때 must 표시가 살아남는다 (must 는 절대 빠지면 안 되는 자리다).
  return { candidates: dedupe([...fromMusts.filter(Boolean as unknown as (c: Candidate | null) => c is Candidate), ...fromTheme.flat()]), missing };
}

/** 같은 장소가 여러 관심사에 걸린다. 이름이 같으면 한 곳으로 본다 — 먼저 온 쪽을 남긴다. */
const dedupe = (list: Candidate[]): Candidate[] => {
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.name) && seen.add(c.name));
};

/* ─────────────────────────── 코스 짜기 (순수) ─────────────────────────── */

/**
 * 후보에서 추천 코스 두 개를 짠다. 같은 입력이면 늘 같은 결과다 —
 * 새로고침마다 코스가 바뀌면 "어제 본 그 코스"를 다시 꺼낼 수가 없다.
 *
 * 두 코스는 서로 다른 관심사를 앞세운다 (와이어프레임의 "바다와 노을을 따라" / "숲과 오름 사이로").
 * 관심사가 하나뿐이면 두 번째는 첫 코스가 안 고른 후보로 짠다. 그마저 같아지면 하나만 돌려준다 —
 * 내용이 같은 카드를 둘로 늘리는 건 고를 게 있는 척하는 것이다.
 */
export function buildCourses(plan: TripPlan, candidates: Candidate[]): Course[] {
  const origin = plan.originAt;
  const period = nightsOf(plan.start, plan.end);
  if (!origin || !period || candidates.length === 0) return [];

  const capMin = plan.driveHours ? plan.driveHours * 60 : Infinity;

  /*
    하루 상한으로 왕복이 안 되는 곳은 아예 뺀다.

    "2시간 이내"를 고른 사람에게 편도 88분짜리 성산일출봉을 내밀 수는 없다. 예전에는 이 걸러내기
    없이 schedule 이 담는 중에 상한을 봤는데, 그러면 못 갈 곳이 자리만 차지하다 버려졌다.
    직접 지목한 must 는 예외다 — 사용자가 알고 고른 곳이라 시간을 넘겨서라도 넣는다.
  */
  const reachable = candidates.filter((c) => c.must || 2 * driveMinutes(meters(origin, c.at)) <= capMin);
  if (!reachable.length) return [];

  const leads = leadsOf(reachable);
  const courses: Course[] = [];
  const used = new Set<string>();

  for (let n = 0; n < COURSE_COUNT; n++) {
    const lead = leads[n] ?? null;
    // 두 번째 코스는 첫 코스가 안 쓴 후보를 먼저 본다. 갈래가 하나뿐일 때 이게 유일한 차이다
    const pool = n === 0 ? reachable : [...reachable.filter((c) => c.must || !used.has(c.name)), ...reachable];
    const course = schedule(dedupe(pool), origin, plan.start, period.days, capMin, plan.theme, lead);
    if (!course.days.some((d) => d.stops.length)) break;

    // 앞 코스와 장소가 똑같으면 카드를 하나 더 만들지 않는다
    if (courses.some((c) => sameStops(c, course))) break;

    course.days.flatMap((d) => d.stops).forEach((s) => used.add(s.name));
    courses.push(course);
  }

  return courses;
}

/** 후보가 많은 갈래 순. 같으면 표 순서(인덱스)로 — 순서가 흔들리면 코스도 흔들린다. */
function leadsOf(candidates: Candidate[]): number[] {
  const count = new Map<number, number>();
  for (const c of candidates) if (c.recipe !== null) count.set(c.recipe, (count.get(c.recipe) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => i);
}

/**
 * 후보를 날짜 수만큼의 지역으로 가른다 — 하루에 한 지역을 돈다.
 *
 * **왜 지역으로 나누나.** 예전에는 출발지에서 가까운 순으로 자리를 채웠는데, 그러면 후보를
 * 아무리 많이 모아도 공항 근처 몇 곳이 자리를 다 먹었다. 실제로 후보를 23곳에서 93곳으로
 * 늘려봐도 코스는 한 곳만 바뀌었고, 하루 운전 시간을 "상관없음"으로 풀어도 결과가 같았다 —
 * 성산·중문은 목록에 있는데도 영영 안 뽑혔다. 제주 여행이 원래 동부·서부로 나눠 도는 것이라,
 * 날짜에 지역을 배정하는 편이 실제 여행에도 가깝다.
 *
 * 경도로 자르는 이유: 제주는 동서 73km · 남북 40km 라 동서 축이 훨씬 길다.
 * 가까운 지역부터 도는 이유: 도착한 날에 섬 반대편까지 건너가지 않는다.
 */
function regionsOf(pool: Candidate[], days: number, origin: LatLng): Candidate[][] {
  if (days === 1) return [pool];

  const sorted = [...pool].sort((a, b) => a.at[1] - b.at[1] || (a.name < b.name ? -1 : 1));
  const per = Math.ceil(sorted.length / days);
  const bands = Array.from({ length: days }, (_, i) => sorted.slice(i * per, (i + 1) * per));

  const reach = (band: Candidate[]) =>
    band.length ? band.reduce((s, c) => s + meters(origin, c.at), 0) / band.length : Infinity;
  return bands.sort((a, b) => reach(a) - reach(b));
}

/**
 * 고른 자리를 날짜에 나눠 담는다.
 *
 * 하루는 출발지에서 나가 마지막 장소를 보고 **돌아오는 것까지**다 — "하루에 2시간 운전"은
 * 돌아오는 길을 뺀 시간이 아니다. 숙소를 묻지 않으므로 매일 출발지에서 다시 나서는 것으로 본다.
 *
 * 순서는 최근접 이웃이다. 장소가 하루 3곳이라 더 나은 순회를 찾아봐야 눈에 띄는 차이가 없고,
 * 무엇보다 같은 입력에 같은 순서가 나온다.
 */
function schedule(
  pool: Candidate[],
  origin: LatLng,
  start: string,
  days: number,
  capMin: number,
  theme: number | null,
  lead: number | null,
): Course {
  const bands = regionsOf(pool, days, origin);
  const out: Day[] = [];

  for (let d = 0; d < days; d++) {
    const left = [...bands[d]];
    const stops: Stop[] = [];
    let at = origin;
    let driveM = 0;
    let driveMin = 0;

    while (left.length) {
      /*
        하루 정원(STOPS_PER_DAY)은 must 가 아닌 곳만 센다. 정원은 "하루가 이 정도면 알차다"는
        어림 규칙이고, must 는 사용자가 직접 지목한 자리다 — 어림 규칙이 사용자 입력을 밀어내면 안 된다.
        그래서 정원이 찬 뒤에는 must 만 더 들어간다.
      */
      const filled = stops.filter((s) => !s.must).length;
      let eligible0 = filled >= STOPS_PER_DAY ? left.filter((c) => c.must) : left;

      // 같은 자리를 두 번 세우지 않는다 — 카카오는 한 장소를 여러 이름으로 준다
      eligible0 = eligible0.filter((c) => c.must || stops.every((s) => meters(s.at, c.at) > MIN_GAP_M));

      // 이 코스가 앞세우는 갈래가 이 지역에 있으면 그것부터. 없으면 지역에 있는 것으로 채운다
      const led = eligible0.filter((c) => c.recipe === lead);
      if (led.length) eligible0 = led;

      /*
        하루의 첫 자리는 남은 must 중 가장 가까운 곳으로 연다.

        안 그러면 먼 must 가 매번 뒤로 밀린다 — 최근접 이웃이 가까운 곳부터 집어가다가
        마지막 날에야 순서가 오고, 그날은 상한을 훌쩍 넘긴다 (성산일출봉은 공항에서 편도 88분인데
        다른 두 곳을 채운 뒤 붙으니 하루 222분이 됐다). 먼저 놓으면 그날 예산을 그 곳이 쓰고,
        남은 예산만큼만 근처를 채운다.
      */
      const mustsLeft = left.filter((c) => c.must);
      const eligible = !stops.length && mustsLeft.length ? mustsLeft : eligible0;

      if (!eligible.length) break;

      const next = nearest(at, eligible);
      const legM = meters(at, next.at);
      const legMin = driveMinutes(legM);
      const homeMin = driveMinutes(meters(next.at, origin));

      // 이 자리를 넣고 돌아오는 것까지 하루 상한을 넘는가.
      // 하루의 첫 자리는 넘겨도 넣는다 — 가장 가까운 곳조차 상한 밖이면 그날은 아무 데도 못 간다
      // (must 가 그렇다. reachable 을 통과한 나머지는 혼자서는 늘 상한 안이다).
      if (stops.length && driveMin + legMin + homeMin > capMin) {
        left.splice(left.indexOf(next), 1);
        continue;
      }

      left.splice(left.indexOf(next), 1);
      stops.push({ ...next, legM, legMin });
      driveM += legM;
      driveMin += legMin;
      at = next.at;
    }

    // 돌아오는 길. 하루에 한 곳도 못 넣었으면 나간 적이 없으니 0 이다
    if (stops.length) {
      driveM += meters(at, origin);
      driveMin += driveMinutes(meters(at, origin));
    }
    out.push({ date: dayAfter(start, d), stops, driveM: Math.round(driveM), driveMin });
  }

  return {
    lead,
    title: titleOf(theme, lead),
    days: out,
    totalM: out.reduce((s, d) => s + d.driveM, 0),
    totalMin: out.reduce((s, d) => s + d.driveMin, 0),
  };
}

/** 지금 자리에서 가장 가까운 후보. 거리가 같으면 이름순 — 순서가 흔들리지 않게 한다. */
function nearest(at: LatLng, list: Candidate[]): Candidate {
  return list.reduce((best, c) => {
    const d = meters(at, c.at);
    const b = meters(at, best.at);
    return d < b || (d === b && c.name < best.name) ? c : best;
  });
}

/** "2026-08-14" + 2일 → "2026-08-16". UTC 로 더한다 (nightsOf 와 같은 이유 — 서머타임) */
function dayAfter(start: string, add: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
}

/**
 * AI 가 이름을 못 지었을 때 남는 이름. 없는 감상 대신 무엇 중심인지만 말한다.
 * 갈래가 둘인 테마에서는 갈래까지 붙여야 두 카드가 구분된다 ("제주 먹거리 여행 · 시장").
 */
function titleOf(theme: number | null, lead: number | null): string {
  if (theme === null) return "가볍게 도는 코스";
  const { label, recipes } = THEMES[theme];
  return recipes.length > 1 && lead !== null ? `${label} · ${recipes[lead].label}` : label;
}

/* ─────────────────────────── 화면 문구 ─────────────────────────── */

/** 95 → "1시간 35분" · 40 → "40분" · 120 → "2시간" */
export const hourMin = (m: number) =>
  m < 60 ? `${m}분` : m % 60 === 0 ? `${m / 60}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;

export const stopCount = (c: Course) => c.days.reduce((n, d) => n + d.stops.length, 0);

/** 카드 한 줄 — "5곳 · 이동 1시간 45분" */
export const courseMeta = (c: Course) => `${stopCount(c)}곳 · 이동 ${hourMin(c.totalMin)}`;

/**
 * 카드 오른쪽 아래 한 줄. 하루 평균 운전 시간이 고른 상한의 어디쯤인지만 말한다.
 *
 * lib/score.ts 의 부담점수가 **아니다** — 그건 급커브·차로수 같은 경로 분석이 있어야 나오고,
 * 여기서는 아직 구간별 길찾기를 안 했다. 지어낸 등급 대신 우리가 실제로 계산한 값(운전 시간)만
 * 말한다. ponytail: 고른 코스에 compareRoutes 를 태우면 진짜 부담점수로 바꾼다.
 */
export function driveNote(c: Course, driveHours: number | null): string {
  const perDay = c.totalMin / Math.max(c.days.length, 1);
  const ratio = perDay / (driveHours ? driveHours * 60 : 180);
  return ratio < 0.5 ? "운전 부담 낮음" : ratio < 0.85 ? "여유 있는 편" : "이동이 많은 편";
}

const sameStops = (a: Course, b: Course) => {
  const names = (c: Course) => c.days.flatMap((d) => d.stops.map((s) => s.name)).join("|");
  return names(a) === names(b);
};
