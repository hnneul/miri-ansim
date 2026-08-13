// 실시간 교통 — 계획서 Core 완료 기준 "길찾기 API로 후보 경로가 실시간 조회되고"
//
// 무엇만 실시간인가: 소요시간과 구간별 혼잡도뿐이다.
// 경로 좌표·급커브·차로수·제한속도는 표준노드링크 기반이라 교통 상황과 무관하고,
// 빌드 시점에 검증해 둔 값이다 (scripts/build-route-data.mjs). 교통이 실제로 바꾸는
// 값만 갈아끼운다. 실시간으로 전부 다시 계산하면 검증되지 않은 숫자가 근거 카드에 오른다.
//
// 혼잡도를 부담점수에 넣지 않는 이유도 같다 — 근거 카드의 완료 기준이 "동일 입력에서
// 같은 근거를 사용한다"다. 점수에 실시간 값이 섞이면 같은 프로필로 두 번 열었을 때
// 점수가 달라진다. 혼잡도는 경로 카드 표시로만 쓴다.
//
// 실패해도 throw 하지 않는다 — API가 죽어도 굳혀둔 값으로 화면이 그대로 떠야 한다.

import type { LatLng } from "@/app/RouteMap";

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

/**
 * 응답을 기다리는 한계. 넘기면 굳혀둔 값으로 떨어진다 — 페이지가 멈추는 게 더 나쁘다.
 *
 * 실측 호출당 0.7~2.8초다 (road_details=true 라 응답에 좌표열이 다 실려 온다).
 * 처음 4초로 뒀다가 화면이 폴백으로 떨어지는 걸 봤다 — 최댓값의 1.4배는 여유가 아니다.
 * 이 대기는 페이지 렌더를 막으므로 무한정 늘릴 수도 없다. 2배 남기고 끊는다.
 */
const TIMEOUT_MS = 6000;

/** 실시간 거리가 검증된 거리와 이만큼 벌어지면 다른 길로 안내된 것으로 본다. */
const DRIFT_RATIO = 0.05;

/**
 * 카카오 traffic_state 코드. 문서 대신 같은 응답의 traffic_speed 로 확인했다
 * (제주공항→서귀포 두 경로): 1 → 8~16km/h, 3 → 30~33km/h, 4 → 48~60km/h.
 * 2(지체)는 이 구간 응답에 나오지 않았지만 1과 3 사이라 정체 쪽으로 묶는다.
 * 모르는 코드는 정보없음으로 흘린다 — 없는 혼잡을 만들지 않는다.
 */
const JAM = new Set([1, 2]);
const SLOW = new Set([3]);

/**
 * 빠른 흐름 경계 (실제 통행속도 km/h). analyze.ts 의 고속주행(제한속도 80↑)보다 낮게 잡는다 —
 * 실제로 70으로 흐르는 구간이면 제한속도는 그 이상이고, 그 옆에 붙어 달리는 것 자체가
 * 초보에게는 부담이다. 제한속도는 굳혀둔 값이라 "이 길은 원래 빠르다"까지밖에 말하지 못하고,
 * 지금 실제로 빠른지는 이 값만 안다.
 */
const FAST = 70;

/**
 * 느긋한 흐름 구간. 아래를 막아두는 이유가 있다 — 20km/h 는 느긋한 게 아니라 막힌 것이고,
 * 그건 congestionOf 가 이미 말한다. 정체를 "느긋"이라고 부르면 카드가 거짓말을 한다.
 */
const CALM = { min: 35, max: 55 };

export type Congestion = {
  jamKm: number;
  slowKm: number;
  /** 막히는 거리가 가장 긴 도로. 이름 없는 조각뿐이면 null */
  topRoad: string | null;
};

export type Live = {
  durationMin: number;
  distanceKm: number;
  congestion: Congestion;
  /** 경로 전체 실제 통행속도 (km/h). 속도가 실린 조각이 없으면 null */
  flowKmh: number | null;
  /** 실시간 안내 경로가 검증된 경로와 다른가 (사고·통제로 우회) */
  drift: boolean;
};

export type LiveTraffic = {
  fast: Live;
  safe: Live;
  /** 조회 시각 (Asia/Seoul). 실시간이라고 적으려면 언제 값인지도 같이 적어야 한다. */
  at: string;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

type Road = { name?: string; distance: number; traffic_state?: number; traffic_speed?: number };

/** 도로 조각들 → 혼잡 요약. 순수 함수라 traffic.check.ts 가 픽스처로 검증한다. */
export function congestionOf(roads: Road[]): Congestion {
  let jamKm = 0;
  let slowKm = 0;
  const byRoad = new Map<string, number>();

  for (const r of roads) {
    const st = r.traffic_state;
    if (st == null) continue;
    const jam = JAM.has(st);
    if (!jam && !SLOW.has(st)) continue; // 원활·정보없음은 세지 않는다

    const km = r.distance / 1000;
    if (jam) jamKm += km;
    else slowKm += km;

    const name = r.name?.trim();
    if (name) byRoad.set(name, (byRoad.get(name) ?? 0) + km);
  }

  const top = [...byRoad.entries()].sort((a, b) => b[1] - a[1])[0];
  return { jamKm: round1(jamKm), slowKm: round1(slowKm), topRoad: top?.[0] ?? null };
}

/**
 * 도로 조각들 → 경로 전체 실제 통행속도 (km/h). 속도가 실린 조각이 없으면 null.
 *
 * traffic_state 는 4단계 등급이라 "평소보다 느린가"까지만 말한다. 82km/h 로 흐르는 평화로와
 * 45km/h 로 흐르는 5.16로가 똑같이 "원활(4)"로 온다. 초보가 무서워하는 건 막히는 게 아니라
 * 빠른 차 옆에 붙는 것이라, 등급이 아니라 이 숫자가 있어야 둘을 가른다.
 *
 * 거리가중 산술평균이 아니라 총거리÷총시간(조화평균)이다. 실제로 그 길을 지나는 데 걸리는
 * 시간은 느린 구간이 지배한다 — 산술평균을 쓰면 짧은 정체 구간이 묻혀 실제보다 빠르게 나온다.
 */
export function flowSpeed(roads: Road[]): number | null {
  let km = 0;
  let hours = 0;
  for (const r of roads) {
    const v = r.traffic_speed;
    if (v == null || v <= 0) continue; // 0 은 속도가 아니라 정보없음이다 (나누면 Infinity)
    const d = r.distance / 1000;
    km += d;
    hours += d / v;
  }
  return hours > 0 ? Math.round(km / hours) : null;
}

/**
 * 흐름 한 줄. 할 말이 있을 때만 준다 — 중간 속도는 null 이다.
 *
 * 양쪽을 다 말하는 이유: 초보에게 "빠르게 흐름"은 경고고 "느긋하게 흐름"은 안심이다.
 * 이 앱이 하려는 말이 후자라 경고만 남기면 반쪽이 된다.
 */
export function flowLabel(kmh: number | null): string | null {
  if (kmh == null) return null;
  if (kmh >= FAST) return `${kmh}km/h로 빠르게 흐름`;
  if (kmh >= CALM.min && kmh <= CALM.max) return `${kmh}km/h로 느긋하게 흐름`;
  return null;
}

/**
 * 카드에 붙일 한 줄. 원활하면 null 을 준다.
 *
 * 1km 미만은 말하지 않는다 — 신호 대기 한두 개로도 잡히는 길이라
 * 매번 무언가 막힌 것처럼 보이면 경고가 무의미해진다.
 */
export function congestionLabel(c: Congestion): string | null {
  const 정체가큰가 = c.jamKm >= c.slowKm;
  const km = 정체가큰가 ? c.jamKm : c.slowKm;
  if (km < 1) return null;
  const 상태 = 정체가큰가 ? "정체" : "서행";
  return c.topRoad ? `${c.topRoad} ${km}km ${상태}` : `${km}km ${상태}`;
}

type Section = { roads: Road[] };
type KakaoRoute = {
  result_code: number;
  result_msg?: string;
  summary: { distance: number; duration: number };
  sections: Section[];
};

/** 검증된 거리와 비교해 실시간 안내가 다른 길로 갔는지 본다. */
export function driftedFrom(liveKm: number, verifiedKm: number | null): boolean {
  if (verifiedKm == null || verifiedKm === 0) return false;
  return Math.abs(liveKm - verifiedKm) / verifiedKm > DRIFT_RATIO;
}

function liveOf(route: KakaoRoute, verifiedKm: number | null): Live {
  const distanceKm = round1(route.summary.distance / 1000);
  const roads = route.sections.flatMap((s) => s.roads);
  return {
    durationMin: Math.round(route.summary.duration / 60),
    distanceKm,
    congestion: congestionOf(roads),
    flowKmh: flowSpeed(roads),
    drift: driftedFrom(distanceKm, verifiedKm),
  };
}

const coord = ([la, lo]: LatLng) => `${lo},${la}`;

async function directions(
  origin: LatLng,
  destination: LatLng,
  priority: "DISTANCE" | "TIME",
  key: string,
): Promise<KakaoRoute> {
  const q = new URLSearchParams({
    origin: coord(origin),
    destination: coord(destination),
    priority,
    road_details: "true", // traffic_state 가 이 옵션에 딸려 온다
    alternatives: "false",
    // departure_time 을 주지 않는다 = 현재 시각 교통.
    // 주면 미래 운행 예측이 오고, 그건 실시간이 아니다 (빌드 스크립트가 그쪽을 쓴다).
  });

  const res = await fetch(`${ENDPOINT}?${q}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${priority}: HTTP ${res.status}`);

  const route: KakaoRoute | undefined = (await res.json()).routes?.[0];
  if (!route) throw new Error(`${priority}: routes 없음`);
  if (route.result_code !== 0) throw new Error(`${priority}: ${route.result_msg}`);
  return route;
}

/**
 * 두 경로의 실시간 소요시간·혼잡도. 실패하면 null — 호출한 쪽이 굳혀둔 값으로 떨어진다.
 *
 * @param verifiedKm 검증된 경로 거리 (data/route-data.json). 이탈 판정에만 쓴다.
 */
export async function liveTraffic(
  origin: LatLng,
  destination: LatLng,
  verifiedKm: { fast: number | null; safe: number | null },
): Promise<LiveTraffic | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  try {
    // priority=DISTANCE → 5.16도로, TIME → 평화로. 빌드 스크립트와 같은 갈래다.
    const [fast, safe] = await Promise.all([
      directions(origin, destination, "DISTANCE", key),
      directions(origin, destination, "TIME", key),
    ]);
    return {
      fast: liveOf(fast, verifiedKm.fast),
      safe: liveOf(safe, verifiedKm.safe),
      at: new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false, // ko-KR 기본이 12시간제라 "AM 12:13" 같은 표기가 나온다
        timeZone: "Asia/Seoul", // 서버가 어디서 돌든 사용자가 보는 시각은 제주 시각이다
      }),
    };
  } catch {
    return null;
  }
}
