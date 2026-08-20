// 임의 구간 런타임 경로 분석 — 계획서 Core 완료 기준 1·2·5
//
// 굳혀둔 3구간(lib/scenario.ts)과 달리 출발지·목적지를 받아 그 자리에서 분석한다.
// 분석 자체는 lib/analyze.ts 가 하고(빌드 스크립트와 같은 함수), 여기서는 세 가지를 한다:
//   ① 카카오 길찾기 2회 병렬 호출 (departure_time 없음 = 현재 교통)
//   ② 경로 이름 짓기 — 지명 하드코딩 없이 도로명 데이터에서 뽑는다
//   ③ 두 경로가 사실상 같은 길인지 판정 (Core 기준 5 "대안 경로가 없으면")
//
// 검증에 대해: 굳혀둔 3구간은 서귀포시 급커브 정답지로 대조한 구간이라 추천까지 하지만,
// 임의 구간은 그 대조를 할 수 없다. 그래서 이 모듈이 만든 경로는 verified: false 다 —
// 부담구간은 계산해 보여주되 "추천"이라고 말하지 않는다. 화면이 그 차이를 표시한다.

import {
  analyze,
  buildIndex,
  type Analysis,
  type Link,
  type LinkIndex,
} from "./analyze.ts";
import { distance, type LatLng } from "./curvature.ts";
import { burdenOf, type DriverProfile, type RiskFactor } from "./score.ts";

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

/** 길찾기 응답을 기다리는 한계. 넘기면 경로를 못 만든다 (호출한 쪽이 안내한다). */
const TIMEOUT_MS = 6000;

/**
 * 두 경로를 "다른 길"로 볼 최소 조건: 한쪽에만 이만큼 있는 도로가 있어야 다른 길이다.
 *
 * 짧은 구간에서는 최단거리·최단시간이 같은 길로 수렴한다 — 실측으로 공항→제주시청(약 5km)이
 * 4.9km vs 5.3km 로 갈렸는데 둘 다 서광로였다. 그때 두 경로를 나란히 보여주면 없는 선택지를
 * 만드는 것이다. 계획서 Core 기준 5가 말하는 "대안 경로가 없으면"이 이 경우다.
 *
 * 처음엔 "거리 3% 이내 + 가르는 도로 없음"으로 봤는데, 위 실측이 8% 차이라 두 장의 카드가
 * 똑같이 "서광로 경유"로 떴다. 거리는 같은 길에서도 우회 한 번에 흔들린다 —
 * **도로 구성**이 다른 길인지를 정한다. 거리 조건은 버렸다.
 */
const 갈림_최소도로km = 2;

const 곡률출처 =
  "경로좌표 곡률 계산 (카카오모빌리티 길찾기 API) · 임계값: 도로의 구조·시설 기준에 관한 규칙 제19조 최소 평면곡선반지름 · 표준노드링크 2026-07-16 제한속도 50km/h↑ 구간";
const 노드링크출처 = "표준노드링크 2026-07-16 (국가교통정보센터)";

/** 격자 인덱스는 만드는 데 14ms 지만 링크 파싱이 28ms 다. 인스턴스마다 한 번만 한다. */
let 인덱스: LinkIndex | null = null;

export function linkIndex(links: Link[]): LinkIndex {
  return (인덱스 ??= buildIndex(links));
}

const coord = ([la, lo]: LatLng) => `${lo},${la}`;

type KakaoRoute = {
  result_code: number;
  result_msg?: string;
  summary: { distance: number; duration: number };
  sections: {
    roads: {
      name?: string;
      distance: number;
      traffic_state?: number;
      vertexes: number[];
    }[];
  }[];
};

async function directions(
  origin: LatLng,
  destination: LatLng,
  priority: (typeof PRIORITIES)[number]["priority"],
  key: string,
): Promise<KakaoRoute[]> {
  const q = new URLSearchParams({
    origin: coord(origin),
    destination: coord(destination),
    priority,
    road_details: "true", // 좌표열과 traffic_state 가 이 옵션에 딸려 온다
    /*
     * 대안까지 받는다. 끄면 priority 셋을 다 불러도 카카오가 매번 자기 1등만 주는데,
     * 그 1등이 겹치면 후보가 한 장으로 접힌다 — 실측으로 중앙로 566 → 서귀포매일올레시장이
     * 516로(35km) 한 장만 남았다. 켜면 같은 호출에서 평화로·중산간서로(56.1km)가 따라온다.
     * 카카오맵 웹이 이 출발지에 보여주는 바로 그 길이다.
     */
    alternatives: "true",
    // departure_time 을 주지 않는다 = 현재 시각 교통 (lib/traffic.ts 와 같은 이유)
  });
  const res = await fetch(`${ENDPOINT}?${q}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    /*
     * 같은 출발·도착이면 5분 동안 다시 안 부른다. 카카오 길찾기 무료 쿼터가 **일 10,000건**인데
     * 이 화면 한 번이 3건(PRIORITIES)이고, dev 는 StrictMode 로 effect 가 두 번 돌아 6건이다 —
     * no-store 로 두면 같은 구간을 열 때마다 그대로 다시 나간다.
     *
     * 5분인 이유는 카카오 실시간 교통이 그 주기로 갱신되기 때문이다. 화면에 찍히는 조회 시각(at)은
     * 지금 시각이라 캐시가 맞은 회차는 최대 5분 어긋나는데, 교통 갱신 주기 안이라 값의 뜻은 안 바뀐다.
     */
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("길찾기 서버에서 응답을 받지 못했습니다");
  const routes: KakaoRoute[] = (await res.json()).routes ?? [];
  // result_msg 는 카카오가 준 한국어 문구다 ("도착 지점 주변의 도로를 탐색할 수 없음")
  // 한 대안만 실패하는 경우가 있어 성공한 것만 걸러 낸다. 전부 실패했을 때만 사유를 올린다.
  const ok = routes.filter((r) => r.result_code === 0);
  if (!ok.length)
    throw new Error(
      routes[0]
        ? routes[0].result_msg || `길찾기 실패 (${routes[0].result_code})`
        : "길찾기 결과가 비어 있습니다",
    );
  return ok;
}

/**
 * 경로 이름. 상대 경로엔 거의 없고 내 쪽에 길게 있는 도로 = 두 경로를 가르는 도로다.
 * 사람이 "5.16도로 경유 / 평화로 경유"라고 부르는 방식 그대로고, 이름은 표준노드링크에서 온다.
 *
 * 이름을 못 찾으면(단일 경로 등) 그냥 가장 긴 도로를 쓴다.
 */
export function nameOf(mine: Analysis, other?: Analysis): string {
  const mineRoads = Object.entries(mine.roadKm).filter(([r]) => r !== "(무명)");
  if (!mineRoads.length) return "경로";
  const 가른도로 = other
    ? mineRoads.find(
        ([road, km]) =>
          km >= 갈림_최소도로km && (other.roadKm[road] ?? 0) < km * 0.3,
      )
    : undefined;
  return `${(가른도로 ?? mineRoads[0])[0]} 경유`;
}

/** 한쪽에만 길게 있는 도로가 있나 — 두 경로를 가르는 도로다 (경로 이름도 여기서 나온다) */
const 가르는도로있나 = (x: Analysis, y: Analysis) =>
  Object.entries(x.roadKm).some(
    ([road, km]) =>
      road !== "(무명)" &&
      km >= 갈림_최소도로km &&
      (y.roadKm[road] ?? 0) < km * 0.3,
  );

/**
 * 두 분석이 사실상 같은 길인가. **양쪽 다** 상대를 가르는 도로를 가질 때만 다른 길이다.
 *
 * 한쪽에만 있으면 그건 갈림이 아니라 우회로 한 토막이다. 실측으로 공항→성산일출봉이
 * 그랬다: 간선(번영로 19.9km · 금백조로 10.6km · 서성일로 3.6km)을 통째로 공유하고
 * 최단시간 쪽만 서광로 3km · 동광로 2km 로 시내를 빠져나간다. 그런데 두 장의 카드가
 * "번영로 경유"와 "서광로 경유"로 떴다 — 둘 다 번영로 19.9km 를 달리는데도.
 * 이름이 다르니 사용자는 다른 길이라고 믿지만 47.2km/60분과 47.8km/60분, 부담 0.1점 차이다.
 *
 * 순수 함수라 lib/route.check.ts 가 네트워크 없이 검증한다.
 */
export function sameRoute(a: Analysis, b: Analysis): boolean {
  return !(가르는도로있나(a, b) && 가르는도로있나(b, a));
}

/**
 * 고른 경로를 카카오맵에 강제할 **경유지 한 점** (lib/parking.ts navigateTo).
 *
 * 상대 경로에서 가장 멀리 떨어진 점을 고른다. 중간 지점을 그냥 쓰면 안 된다 — 두 경로가
 * 앞쪽을 공유하고 뒤에서 갈리면 중간이 공유 구간에 앉아, 경유지를 찍어도 경로가 안 바뀐다.
 * "가장 먼 점"은 정의상 갈라진 구간 한복판이라 그 길로 확실히 돌아온다.
 *
 * 양 끝은 뺀다 — 출발·도착 근처는 두 경로가 어차피 같아서 경유지 노릇을 못 한다.
 * 상대가 없으면(단일 경로) 중간 지점이면 된다. 강제할 다른 길이 애초에 없다.
 *
 * path 는 이미 축약된 좌표열이라(analyze 의 simplify) 이중 루프여도 클릭 한 번에 끝난다.
 */
export function viaPoint(mine: LatLng[], other?: LatLng[]): LatLng {
  const middle = mine[Math.floor(mine.length / 2)];
  if (!other?.length || mine.length < 3) return middle;

  let best = middle;
  let far = -1;
  for (let i = 1; i < mine.length - 1; i++) {
    let near = Infinity;
    for (const p of other) near = Math.min(near, distance(mine[i], p));
    if (near > far) {
      far = near;
      best = mine[i];
    }
  }
  return best;
}

/** 도로별 거리 집계 → 근거 카드의 "위치" 문구. 상위 두 개까지만 쓴다 (길어지면 안 읽힌다). */
function 위치(byRoad: Record<string, number>): string {
  const top = Object.entries(byRoad)
    .filter(([, km]) => km > 0)
    .slice(0, 2);
  if (!top.length) return "-";
  return top.map(([road, km]) => `${road} ${km}km`).join(" · ");
}

/**
 * 분석 → 근거 카드용 위험요인 목록. 값이 0인 요인은 넣지 않는다 —
 * "0km 구간이 있습니다"는 근거가 아니고, 계획서 원칙(확인된 것만)에도 어긋난다.
 *
 * **spans 를 같이 옮긴다.** analyze 가 구간 좌표를 다 계산해 두는데(spansOf) 여기서 안 실으면
 * 화면까지 도달을 못 한다 — 지도에 경로선 위로 겹칠 빨간 구간도, 그 구간이 무엇인지 대는
 * 잔글씨 줄도, 근거 화면 표의 빨간 점도 전부 `spans?.length` 를 보고 그릴지 정하므로
 * 통째로 안 그려진다 (app/route/page.tsx 가른요인·위험구간).
 */
export function risksOf(a: Analysis): RiskFactor[] {
  const out: RiskFactor[] = [];

  if (a.sharpCurve.sections > 0 && a.sharpCurve.densest) {
    const 커브도로 = Object.keys(a.sharpCurve.byRoad).find(
      (r) => r !== "(무명)",
    );
    out.push({
      type: "sharpCurve",
      label: "연속 급커브",
      location: `${커브도로 ?? "경로 상"} 일대 (5km 내 ${a.sharpCurve.densest.count}곳)`,
      coord: a.sharpCurve.densest.at,
      value: `급커브 ${a.sharpCurve.sections}곳 (최소 반경 ${a.sharpCurve.minRadiusM}m) · 굽은 구간 ${a.sharpCurve.windingKm}km`,
      exposure: a.sharpCurve.exposure,
      source: 곡률출처,
      spans: a.sharpCurve.spans,
    });
  }

  if (a.narrow.km > 0 && a.narrow.at) {
    out.push({
      type: "narrowRoad",
      label: "좁은 교행 구간",
      location: 위치(a.narrow.byRoad),
      coord: a.narrow.at,
      value: `차로수 1 구간 ${a.narrow.km}km`,
      exposure: a.narrow.exposure,
      source: 노드링크출처,
      spans: a.narrow.spans,
    });
  }

  if (a.highSpeed.km > 0 && a.highSpeed.at) {
    out.push({
      type: "highSpeed",
      label: "고속주행 구간",
      location: 위치(a.highSpeed.byRoad),
      coord: a.highSpeed.at,
      value: `제한속도 80km/h 구간 ${a.highSpeed.km}km`,
      exposure: a.highSpeed.exposure,
      source: 노드링크출처,
      spans: a.highSpeed.spans,
    });
  }

  return out;
}

/**
 * 근거 화면(HOME-03)의 비교표에 그대로 들어가는 값들.
 *
 * risks 로는 표를 못 만든다 — risksOf 는 값이 0인 요인을 아예 뺀다(부담의 근거니까 맞다).
 * 표는 반대로 **0을 보여줘야** 비교가 된다: "급커브 12곳 → 없음"에서 오른쪽 칸이 요지다.
 * 그래서 같은 분석에서 따로 뽑는다.
 */
export type RouteStats = {
  /** 좌회전·유턴 (번). 맞은편 흐름을 끊고 들어가는 판단의 횟수다 */
  turns: number;
  /** 회전교차로 (곳) */
  roundabouts: number;
  /**
   * 굽은 구간 연장 (km). **개수가 아니라 길이다.**
   *
   * 곳 수(sharpCurve.sections)를 적었었는데, 그 숫자는 이 앱이 부담을 매길 때 안 쓰는 값이다 —
   * 점수는 연장 비율(lib/score.ts exposureFactor)로 매기고, 지도에 칠하는 것도 굽은 구간
   * 자체다(lib/analyze.ts 의 winding). 표만 개수를 세니 셋이 서로 다른 말을 했다:
   * "17곳"이라 적힌 길의 지도에는 덩어리가 둘뿐이라 "왜 이렇게 많다는 거냐"가 된다.
   *
   * 개수는 밀도를 못 말한다는 문제도 있다. 48곳 대 17곳은 3배로 읽히지만 연장은
   * 12.5km 대 2.5km 로 5배다 — 흩어진 17곳과 몰린 48곳의 차이가 개수에서는 지워진다.
   */
  sharpCurveKm: number;
  /** 좁은 교행 구간이 경로에서 차지하는 비율 (0~1) */
  narrow: number;
  /** 고속주행(제한속도 80↑) 구간 (km) */
  highSpeedKm: number;
};

export type LiveRoute = {
  id: "fast" | "safe";
  name: string;
  badge: string;
  color: string;
  durationMin: number;
  distanceKm: number;
  durationSource: string;
  path: LatLng[];
  risks: RiskFactor[];
  stats: RouteStats;
};

export type LiveRoutes =
  | {
      /** 두 개면 비교, 하나면 대안 경로가 없는 구간이다 (Core 기준 5) */
      routes: [LiveRoute, LiveRoute] | [LiveRoute];
      at: string; // 조회 시각 (Asia/Seoul)
    }
  | {
      /**
       * 화면에 그대로 보여줄 실패 사유.
       *
       * null 하나로 뭉치지 않는 이유: "API가 죽었다"와 "이 지점 주변에 도로가 없다"는
       * 사용자가 할 일이 다르다. 후자는 다른 지점을 고르면 되는데, 실측으로 성산일출봉
       * 정상 좌표가 그랬다 (result_code 103 "도착 지점 주변의 도로를 탐색할 수 없음").
       * 카카오가 한국어 사유를 주므로 우리가 코드별 문구를 따로 만들지 않는다.
       */
      error: string;
    };

/*
 * 경로선 색 — **DESIGN.md --color-fast / --color-safe 그대로다.**
 *
 * 한동안 주황(#fb923c) · 하늘(#38bdf8) 이었다. 고른 색이 아니라 이 파일이 생길 때 박힌
 * 값인데(f6ae676, 화면 배선 전이라 눈으로 볼 수 없었다) 그게 남아서 **부담색과 계열이 겹쳤다** —
 * 지도에 주황 경로선, 주황 말풍선, 그 위에 테라코타 부담 구간이 한꺼번에 있으면 뜻이 다른
 * 색 셋이 같은 색으로 읽힌다. DESIGN.md 가 색을 둘로 나눈 이유(경로의 성격 / 부담의 정도)가
 * 그 자리에서 무너진다.
 */
const 색 = { fast: "#4A7DFF", safe: "#2FA97C" };

function toRoute(
  id: "fast" | "safe",
  a: Analysis,
  name: string,
  badge: string,
  at: string,
): LiveRoute {
  return {
    id,
    name,
    badge,
    color: 색[id],
    durationMin: a.durationMin,
    distanceKm: a.distanceKm,
    durationSource: `카카오모빌리티 길찾기 API 실시간 교통 (${at} 조회)`,
    path: a.path,
    risks: risksOf(a),
    stats: {
      turns: a.guides.left + a.guides.uTurn,
      roundabouts: a.guides.roundabout,
      sharpCurveKm: a.sharpCurve.windingKm,
      narrow: a.narrow.exposure,
      highSpeedKm: a.highSpeed.km,
    },
  };
}

/**
 * 출발지·목적지 → 분석된 경로. 실패하면 사유를 준다 —
 * 굳혀둔 구간과 달리 폴백할 데이터가 없으므로(임의 구간이니 당연하다) 화면이 사유를 말해야 한다.
 */
/**
 * 카카오에 물어보는 후보들.
 *
 * **셋을 다 물어야 하는 이유가 실측으로 있다.** 예전에는 DISTANCE·TIME 둘만 불렀는데,
 * 제주시청→매일올레시장에서 그 둘이 **같은 길**(516로, 한라산 넘는 급커브 길)로 나와 카드가
 * 한 장으로 죽었다. 같은 구간에서 RECOMMEND 는 남조로·번영로로 전혀 다른 길을 준다 —
 * 초보에게 급커브가 훨씬 적은 쪽이다. 하나를 안 물어서 있는 선택지를 통째로 놓치고 있었다.
 *
 * 셋을 병렬로 던지므로 늘어나는 시간은 실측 +22ms 다 (2회 209ms → 3회 231ms, 중앙값).
 * alternatives=true 와 avoid= 는 이 키에서 응답이 안 바뀌는 걸 확인했다 — 후보를 늘리는
 * 방법은 priority 를 바꿔 묻는 것뿐이다.
 */
const PRIORITIES = [
  { priority: "DISTANCE", badge: "내비 최단거리" },
  { priority: "TIME", badge: "내비 최단시간" },
  { priority: "RECOMMEND", badge: "내비 추천" },
] as const;

/**
 * 카카오가 준 실패 사유를 **화면에 쓸 말**로 바꾼다.
 *
 * result_msg 는 개발자용이다 — "도착 지점 주변의 도로를 탐색할 수 없음" 처럼 명사로 끝나고
 * 무엇을 하라는 말이 없다. 그 문구가 그대로 길 비교 화면 한복판에 떴다.
 *
 * 이 사유가 제일 자주 나오는 자리가 **관광지 좌표로 곧장 길을 만들 때**다 (목적지 지도의 핀,
 * 대표 관광지 카드). 성산일출봉·우도처럼 봉우리나 섬 한복판이 대표 좌표라 붙일 도로가 없다 —
 * 게다가 성산일출봉은 목적지 검색 패널이 "제주에서 많이 찾는 곳"으로 **직접 권하는 곳**이라,
 * 그냥 두면 앱이 권한 대로 눌렀는데 막다른 길이 된다.
 *
 * 그래서 사유만 옮기지 않고 **다음에 할 일**까지 적는다. 실제로 그 길이 있다 — 주차장을
 * 골라 거기까지 가면 된다 (화면이 그 문을 같이 띄운다, app/route/page.tsx).
 */
const 사람말 = (msg: string) =>
  /도로를 탐색할 수 없|결과가 비어/.test(msg)
    ? "이 지점은 도로에서 떨어져 있어 바로 길을 만들 수 없어요. 근처 주차장을 골라 그곳까지 가면 돼요."
    : msg;

export async function routesFor(
  origin: LatLng,
  destination: LatLng,
  links: Link[],
  profile: DriverProfile,
): Promise<LiveRoutes> {
  /* 아래 사람말() 이 카카오 원문을 화면에 쓸 말로 바꾼다 — 이 함수의 error 가 그대로 화면에 뜬다 */
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "길찾기 키가 설정되지 않았습니다" };


  /*
   * allSettled 다 — 하나가 실패해도 나머지로 화면을 그린다. 도착 지점에 따라 특정 priority 만
   * 실패하는 경우가 있고("도착 지점 주변의 도로를 탐색할 수 없음"), 그때 셋을 다 버리면
   * 멀쩡한 후보를 두고 빈 화면을 보여주게 된다. 전부 실패했을 때만 사유를 올린다.
   */
  const settled = await Promise.allSettled(
    PRIORITIES.map((p) => directions(origin, destination, p.priority, key)),
  );

  const failed = settled.find((s) => s.status === "rejected");
  if (settled.every((s) => s.status === "rejected")) {
    // 타임아웃(AbortError)은 사유가 영어라 우리 문구로 갈아준다.
    const msg =
      failed && failed.status === "rejected" && failed.reason instanceof Error
        ? failed.reason.message
        : "";
    return {
      error:
        /abort|timeout/i.test(msg) || !msg
          ? "길찾기 응답이 늦어 경로를 만들지 못했어요. 잠시 뒤 다시 열어주세요."
          : 사람말(msg),
    };
  }

  const index = linkIndex(links);
  const at = new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });

  // 분석하고 같은 길은 접는다 — 없는 선택지를 여러 장의 카드로 만들지 않는다.
  // 앞엣것이 남으므로 배지는 DISTANCE → TIME → RECOMMEND 순으로 붙는다.
  const found: { a: Analysis; badge: string }[] = [];
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") return;
    // 한 priority 가 대안까지 여러 개를 준다 (directions 의 alternatives 주석)
    s.value.forEach((route) => {
      const a = analyze(route, index);
      if (!found.some((f) => sameRoute(f.a, a)))
        found.push({ a, badge: PRIORITIES[i].badge });
    });
  });

  if (found.length === 1)
    return {
      routes: [
        toRoute("safe", found[0].a, nameOf(found[0].a), "단일 경로", at),
      ],
      at,
    };

  /*
   * 부담이 가장 낮은 후보가 "안심 길" 자리(safe)에 앉는다.
   *
   * 예전에는 이 자리가 그냥 카카오 priority=TIME 결과였다 — 부담과 아무 관계가 없는데
   * 이름만 저부담이라, 실측에서 36점짜리가 35.9점짜리 옆에서 추천 배지를 달고 있었다.
   * 이제는 재서 고른다. 순위가 프로필을 타므로(초보는 급커브 가중치가 크다) 여기서 잰다.
   */
  const burden = found.map((f) => burdenOf(risksOf(f.a), profile));
  const safeAt = burden.indexOf(Math.min(...burden));
  const safe = found[safeAt];
  // 비교 상대는 나머지 중 가장 빠른 것 — 사용자가 저울질하는 건 결국 부담과 시간이다
  const fast = found
    .filter((_, i) => i !== safeAt)
    .reduce((m, f) => (f.a.durationMin < m.a.durationMin ? f : m));

  return {
    routes: [
      toRoute("fast", fast.a, nameOf(fast.a, safe.a), fast.badge, at),
      toRoute("safe", safe.a, nameOf(safe.a, fast.a), safe.badge, at),
    ],
    at,
  };
}
