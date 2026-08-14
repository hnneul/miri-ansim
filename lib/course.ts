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
import { INTERESTS, nightsOf, type TripPlan } from "./trip.ts";
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
  /** 어느 관심 장소(INTERESTS 인덱스)에서 나왔는지. must 로 들어온 곳은 null */
  interest: number | null;
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
  /** 이 코스를 이끄는 관심 장소(INTERESTS 인덱스). 관심사 없이 짜였으면 null */
  theme: number | null;
  /** 규칙으로 지은 이름. 2b 에서 AI 문장으로 갈아끼운다 (실패하면 이 값이 그대로 남는다) */
  title: string;
  days: Day[];
  totalM: number;
  totalMin: number;
};

/* ─────────────────────────── 후보 수집 (네트워크) ─────────────────────────── */

/**
 * 코스에 쓸 후보를 모은다. 관심 장소마다 카카오를 한 번씩 부르고, "꼭 가고 싶은 곳"은
 * 이름만 있으므로 지오코딩으로 좌표를 붙인다.
 *
 * 실패한 관심사는 건너뛴다 — 여섯 중 하나가 응답을 못 받았다고 코스를 통째로 못 만들 이유가 없다.
 * 다만 must 는 사용자가 직접 지목한 곳이라, 좌표를 못 받으면 조용히 빼지 않고 missing 으로 알린다.
 */
export async function gatherCandidates(
  plan: TripPlan,
): Promise<{ candidates: Candidate[]; missing: string[] }> {
  const origin = plan.originAt;
  if (!origin) return { candidates: [], missing: plan.musts };

  const fromInterests = await Promise.all(
    plan.interests.map(async (i) => {
      const found = await searchSpotsNear(origin, INTERESTS[i], 20000);
      return "error" in found ? [] : found.spots.map((s): Candidate => ({ ...s, interest: i, must: false }));
    }),
  );

  const missing: string[] = [];
  const fromMusts = await Promise.all(
    plan.musts.map(async (name): Promise<Candidate | null> => {
      const found = await geocodePlace(name);
      if ("error" in found) {
        missing.push(name);
        return null;
      }
      return { name: found.label, at: found.coord, addr: found.road || found.jibun || null, kind: found.type, interest: null, must: true };
    }),
  );

  // must 를 앞에 둔다 — 뒤의 dedupe 가 먼저 온 쪽을 남기므로, 같은 곳이 관심사 검색에도
  // 걸렸을 때 must 표시가 살아남는다 (must 는 절대 빠지면 안 되는 자리다).
  return { candidates: dedupe([...fromMusts.filter(Boolean as unknown as (c: Candidate | null) => c is Candidate), ...fromInterests.flat()]), missing };
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
  const themes = themesOf(candidates);

  const courses: Course[] = [];
  const used = new Set<string>();

  for (let n = 0; n < COURSE_COUNT; n++) {
    const theme = themes[n] ?? null;
    // 두 번째 코스는 첫 코스가 안 쓴 후보를 먼저 본다. 관심사가 하나뿐일 때 이게 유일한 차이다
    const pool = n === 0 ? candidates : [...candidates.filter((c) => c.must || !used.has(c.name)), ...candidates];
    const picked = pick(dedupe(pool), theme, period.days, origin);
    if (picked.length === 0) break;

    const course = schedule(picked, origin, plan.start, period.days, capMin, theme);
    // 앞 코스와 장소가 똑같으면 카드를 하나 더 만들지 않는다
    if (courses.some((c) => sameStops(c, course))) break;

    course.days.flatMap((d) => d.stops).forEach((s) => used.add(s.name));
    courses.push(course);
  }

  return courses;
}

/** 후보가 많은 관심사 순. 같으면 화면 순서(인덱스)로 — 순서가 흔들리면 코스도 흔들린다. */
function themesOf(candidates: Candidate[]): number[] {
  const count = new Map<number, number>();
  for (const c of candidates) if (c.interest !== null) count.set(c.interest, (count.get(c.interest) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => i);
}

/**
 * 코스에 넣을 자리를 고른다. must 가 먼저고, 그 다음이 이 코스의 관심사, 마지막이 나머지다.
 * must 가 자리를 다 먹어도 자르지 않는다 — 사용자가 지목한 곳을 개수 때문에 빼면 안 된다.
 *
 * 관심사 안에서는 출발지에 가까운 순으로 자른다. 두 가지를 동시에 푼다 —
 * 자리가 모자랄 때 덜 운전하는 쪽을 남기고, 카카오가 후보를 어떤 순서로 주든 같은 코스가 나온다
 * (정확도순 응답은 같은 검색어면 대체로 같지만, 그걸 코스의 재현성이 기대고 있으면 안 된다).
 */
function pick(pool: Candidate[], theme: number | null, days: number, origin: LatLng): Candidate[] {
  const room = Math.max(days * STOPS_PER_DAY, pool.filter((c) => c.must).length);
  const near = (a: Candidate, b: Candidate) => meters(origin, a.at) - meters(origin, b.at) || (a.name < b.name ? -1 : 1);
  const musts = pool.filter((c) => c.must); // 사용자가 적은 순서를 그대로 둔다
  const themed = pool.filter((c) => !c.must && c.interest === theme).sort(near);
  const rest = pool.filter((c) => !c.must && c.interest !== theme).sort(near);

  /*
    겹치는 후보는 여기서 걸러낸다 — 자리를 다 채운 뒤가 아니라, 채우는 동안에.

    처음엔 schedule 이 담을 때 걸렀는데, 그러면 이미 뽑아둔 아홉 곳 중 여럿이 한 동네에 몰려
    있을 때 그 자리가 통째로 날아가 하루가 한 곳으로 줄었다. 자리를 더 넉넉히 뽑아 해결하려
    했더니 이번엔 후보를 다 담게 되어 두 코스가 똑같아졌다 (관심사가 힘을 쓰는 곳이 이 자르기다).
    고를 때 거르면 둘 다 풀린다: 뽑힌 아홉 곳이 이미 서로 떨어져 있고, 자르는 개수는 그대로다.
  */
  const out = [...musts];
  for (const c of [...themed, ...rest]) {
    if (out.length >= room) break;
    if (out.some((p) => meters(p.at, c.at) <= MIN_GAP_M)) continue;
    out.push(c);
  }
  return out;
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
  picked: Candidate[],
  origin: LatLng,
  start: string,
  days: number,
  capMin: number,
  theme: number | null,
): Course {
  const left = [...picked];
  const out: Day[] = [];

  for (let d = 0; d < days; d++) {
    const stops: Stop[] = [];
    let at = origin;
    let driveM = 0;
    let driveMin = 0;
    const lastDay = d === days - 1;

    while (left.length) {
      /*
        하루 정원(STOPS_PER_DAY)은 must 가 아닌 곳만 센다. 정원은 "하루가 이 정도면 알차다"는
        어림 규칙이고, must 는 사용자가 직접 지목한 자리다 — 어림 규칙이 사용자 입력을 밀어내면 안 된다.
        그래서 정원이 찬 뒤에는 must 만 더 들어간다.
      */
      const filled = stops.filter((s) => !s.must).length;
      const eligible0 = filled >= STOPS_PER_DAY ? left.filter((c) => c.must) : left;

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
      // 하루의 첫 자리는 넘겨도 넣는다 — 가장 가까운 곳조차 상한 밖이면 그날은 아무 데도 못 간다.
      if (stops.length && driveMin + legMin + homeMin > capMin) {
        // 아직 날이 남았으면 다음 날로 미룬다
        if (!lastDay) break;
        // 마지막 날이면 더 미룰 곳이 없다. must 는 넘겨서라도 넣고, 나머지는 못 간 곳으로 남긴다
        if (!next.must) {
          left.splice(left.indexOf(next), 1);
          continue;
        }
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
    theme,
    title: titleOf(theme),
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

/** AI 가 이름을 못 지었을 때 남는 이름. 없는 감상 대신 무엇 중심인지만 말한다. */
const titleOf = (theme: number | null) =>
  theme === null ? "가볍게 도는 코스" : `${INTERESTS[theme].label} 중심 코스`;

const sameStops = (a: Course, b: Course) => {
  const names = (c: Course) => c.days.flatMap((d) => d.stops.map((s) => s.name)).join("|");
  return names(a) === names(b);
};
