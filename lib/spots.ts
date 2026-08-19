// 지금 나한테 편한 곳 — 관광지를 "지금 가기 편한 순"으로 줄 세운다.
//
// **왜 이 앱만 할 수 있나.** 혼잡도로 관광지를 줄 세우는 건 지도 앱이 이미 한다. 여기서
// 더 하는 건 **초보에게 그 길이 얼마나 부담인가**다 (급커브·좁은 길·복잡한 교차로).
// 실측해 보면 두 순서가 완전히 갈린다 — 제주공항에서 신제주는 6분이라 시간으로는 1등인데,
// 왕초보 부담으로는 22곳 중 최악 3위다. 반대로 월정리는 46분이 걸려도 부담이 가장 낮다.
// 같은 시각·같은 자리인데 **프로필에 따라 순서가 바뀌는 목록**이라, 온보딩에서 받은
// 운전 경력이 길 비교 화면 말고 여기서 두 번째로 쓰인다.
//
// **세 값의 출처가 다르다.**
//   소요시간·막힘 → 카카오 길찾기 (실시간 교통이 반영된 값)
//   운전 부담     → 표준노드링크로 굳혀둔 값 (lib/analyze.ts → lib/score.ts)
//   관광지·사진   → data/spots.json (scripts/build-spots.mjs)
//
// **혼잡을 정렬에 안 쓰는 이유.** 카카오 소요시간에 이미 실시간 교통이 들어 있어서 또 쓰면
// 이중 계산이고, 5분마다 순서가 뒤집히면 사용자가 목록을 신뢰하지 못한다. 혼잡은
// "막히는 구간 N곳"으로 **보여주기만** 한다.

import { analyze, type Link, type LinkIndex } from "./analyze.ts";
import { risksOf } from "./route.ts";
import { burdenOf, expWeightOf, type DriverProfile } from "./score.ts";
import { congestionOf } from "./traffic.ts";
import { distance, type LatLng } from "./curvature.ts";

const ENDPOINT = "https://apis-navi.kakaomobility.com/v1/directions";

/** 길찾기 한 건의 한계. 실측 150~200ms 라 넉넉하다 — 넘기면 그 관광지만 목록에서 빠진다. */
const TIMEOUT_MS = 5000;

/**
 * 후보를 고르는 거리 띠(직선 km)와 띠마다 뽑을 개수.
 *
 * **거리순으로 자르면 안 된다.** 실측으로 제주시청 기준 가까운 8곳이 삼성혈·목관아·
 * 중앙지하상가처럼 전부 도보권 시내였다. 관광객이 차를 몰고 갈 곳이 아니다.
 *
 * **카테고리로만 갈라도 안 된다.** 그렇게 했더니 공항 반경 5km 가 다섯 칸을 다 차지해
 * 무지개해안도로·용두암·도두봉이 목록을 채웠다. 함덕도 협재도 없는 "제주 여행" 목록이다.
 *
 * 그래서 **거리 띠로 먼저 가르고, 띠 안에서 카테고리를 섞는다.** 가까운 데 하나쯤은
 * 있어야 "지금 바로"가 되고, 30km 밖이 있어야 여행이 된다.
 */
const BANDS = [
  { max: 10, take: 2 }, // 근처 — 지금 바로 갈 수 있는 곳
  { max: 25, take: 4 }, // 반나절
  { max: 45, take: 4 }, // 하루 나들이
];

/** 한 띠 안에서 같은 카테고리를 이보다 많이 담지 않는다 — 해변만 넷이면 목록이 심심하다. */
const PER_CATEGORY_IN_BAND = 2;

/** 띠 밖(직선 45km 초과)은 후보에서 뺀다. 제주가 동서 73km 라 이 밖이면 하루를 통째로 쓴다. */
const MAX_DIRECT_KM = 45;

/**
 * 부담 등급 경계 — **경력 가중치를 곱해서 쓴다.**
 *
 * 처음엔 20/40 고정이었는데 프로필마다 분포가 밀렸다. lib/score.ts 의 경력 가중치가
 * 왕초보 1.6 · 초보 1.2 · 익숙 1.0 이라 같은 길이 48점과 30점이 되기 때문이다.
 * 실측(출발지 4곳 × 프로필 3종)으로 왕초보는 편8/보통3/부담8 로 중간이 비고,
 * 익숙은 편15/보통11/부담1 로 "부담돼요"가 사라졌다.
 *
 * 경계에 같은 가중치를 곱하면 세 프로필이 같은 잣대를 갖는다 — 등급은 "나에게 어떤가"지
 * "남들보다 어떤가"가 아니므로, 왕초보의 '편해요'와 익숙한 사람의 '편해요'는 다른 길이어야 한다.
 */
const GRADE = { easy: 15, ok: 30 };

export type Spot = {
  name: string;
  category: string;
  at: LatLng;
  addr: string | null;
  kind: string | null;
  thumb: string | null;
  imageRights: string | null;
};

export type Ranked = Spot & {
  /** 지금 출발했을 때 걸리는 시간(분). 카카오가 실시간 교통을 반영해 준 값이다 */
  min: number;
  km: number;
  /**
   * 지금 정체 구간 거리(km). **서행은 안 센다.**
   *
   * 처음엔 정체·서행을 다 세서 "막히는 구간 16곳"이 나왔다. 시내는 신호 때문에 늘 서행이라
   * 3.3km 짜리 시내 경로가 "68% 막힘"으로 찍혔다 — 막힌 게 아니라 원래 그런 길이다.
   * 정체(traffic_state 1·2)만 세면 "지금 실제로 밀리는가"만 남는다.
   */
  jamKm: number;
  /** 가장 길게 막히는 도로. 없으면 null */
  jamRoad: string | null;
  /** 프로필별 운전 부담 (낮을수록 편하다) */
  burden: number;
  grade: "easy" | "ok" | "hard";
  /** 지도에 그릴 경로 */
  path: LatLng[];
};

export const GRADE_LABEL: Record<Ranked["grade"], string> = {
  easy: "편해요",
  ok: "보통",
  hard: "부담돼요",
};

export const gradeOf = (burden: number, profile: DriverProfile): Ranked["grade"] => {
  const w = expWeightOf(profile);
  return burden <= GRADE.easy * w ? "easy" : burden <= GRADE.ok * w ? "ok" : "hard";
};

/**
 * 카카오를 부를 후보 고르기 — 거리 띠로 가르고 띠 안에서 카테고리를 섞는다.
 * 순수 함수라 lib/spots.check.ts 가 네트워크 없이 검증한다.
 */
export function pickCandidates(spots: Spot[], here: LatLng): Spot[] {
  // curvature.ts 의 distance 는 **미터**를 준다 (analyze.ts 도 /1000 해서 쓴다)
  const 잰것 = spots
    .map((s) => ({ s, km: distance(here, s.at) / 1000 }))
    .filter((x) => x.km <= MAX_DIRECT_KM)
    .sort((a, b) => a.km - b.km);

  const out: Spot[] = [];
  const 담긴것 = new Set<string>();
  let 아래 = 0;
  for (const band of BANDS) {
    const 띠 = 잰것.filter((x) => x.km > 아래 && x.km <= band.max);
    const 시작 = 아래;
    아래 = band.max;
    if (!띠.length) continue;

    // **띠 안에서도 거리를 흩는다.** 가까운 것부터 담으면 띠 앞쪽에 몰린다 —
    // 실측으로 제주공항에서 2km·2km 다음이 11km·11km·12km·13km 로 건너뛰었다.
    // 띠를 뽑을 개수만큼 잘게 쪼개고 칸마다 가장 가까운 곳을 하나씩 집으면 고르게 퍼진다.
    const 폭 = (band.max - 시작) / band.take;
    const 카테고리수 = new Map<string, number>();
    for (let k = 0; k < band.take; k++) {
      const 칸아래 = 시작 + 폭 * k;
      const 칸위 = k === band.take - 1 ? band.max : 시작 + 폭 * (k + 1);
      const 고름 = 띠.find(
        (x) =>
          x.km > 칸아래 &&
          x.km <= 칸위 &&
          !담긴것.has(x.s.name) &&
          (카테고리수.get(x.s.category) ?? 0) < PER_CATEGORY_IN_BAND,
      );
      // 빈 칸은 건너뛴다 — 억지로 채우려 다른 칸을 뒤지면 다시 한쪽으로 쏠린다
      if (!고름) continue;
      카테고리수.set(고름.s.category, (카테고리수.get(고름.s.category) ?? 0) + 1);
      담긴것.add(고름.s.name);
      out.push(고름.s);
    }
  }
  return out;
}

type KakaoRoute = {
  result_code: number;
  summary: { distance: number; duration: number };
  sections: { roads: { name?: string; distance: number; traffic_state?: number; vertexes: number[] }[] }[];
};

const coord = ([la, lo]: LatLng) => `${lo},${la}`;

async function directions(origin: LatLng, dest: LatLng, key: string): Promise<KakaoRoute | null> {
  const q = new URLSearchParams({
    origin: coord(origin),
    destination: coord(dest),
    // 화면이 "안심 길"로 안내하는 것과 같은 갈래를 본다 (lib/route.ts PRIORITIES)
    priority: "RECOMMEND",
    road_details: "true", // traffic_state 가 이 옵션에 딸려 온다
    alternatives: "false",
  });
  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const r: KakaoRoute | undefined = (await res.json()).routes?.[0];
    return r?.result_code === 0 ? r : null;
  } catch {
    return null; // 한 곳이 실패해도 나머지는 보여준다
  }
}

/**
 * 지금 가기 편한 관광지들.
 *
 * **부담 등급으로 묶고 등급 안에서는 시간순**이다. 부담만으로 줄 세우면 3분 거리를 두고
 * 46분짜리를 권하게 되고, 시간만으로 줄 세우면 시내 한복판이 1등이 된다.
 *
 * 실패한 관광지는 조용히 빠진다 — 한 곳 때문에 목록 전체가 비면 안 된다.
 */
export async function rankSpots(
  here: LatLng,
  profile: DriverProfile,
  spots: Spot[],
  index: LinkIndex,
): Promise<Ranked[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];

  const 후보 = pickCandidates(spots, here);
  const 결과 = await Promise.all(
    후보.map(async (s) => {
      const route = await directions(here, s.at, key);
      if (!route) return null;

      const roads = route.sections.flatMap((x) => x.roads);
      const c = congestionOf(roads);
      // 부담은 굳혀둔 값으로만 낸다 — 같은 프로필이면 언제 열어도 같은 점수여야 한다
      const a = analyze(route, index);
      const burden = Math.round(burdenOf(risksOf(a), profile));

      return {
        ...s,
        min: Math.round(route.summary.duration / 60),
        km: Math.round((route.summary.distance / 1000) * 10) / 10,
        jamKm: c.jamKm,
        jamRoad: c.jamKm > 0 ? c.topRoad : null,
        burden,
        grade: gradeOf(burden, profile),
        path: a.path,
      } satisfies Ranked;
    }),
  );

  return 결과.filter((r): r is Ranked => r != null).sort(byGradeThenTime);
}

/**
 * 목록 정렬 — 부담 등급이 먼저, 같은 등급 안에서는 가까운 순.
 *
 * 부담만으로 줄 세우면 3분 거리를 두고 46분짜리를 권하게 되고, 시간만으로 줄 세우면
 * 시내 한복판이 1등이 된다. 등급으로 묶고 그 안에서 시간을 보는 게 둘 다 사는 방법이다.
 */
export const byGradeThenTime = (a: Pick<Ranked, "grade" | "min">, b: Pick<Ranked, "grade" | "min">) => {
  const 순서 = { easy: 0, ok: 1, hard: 2 };
  return 순서[a.grade] - 순서[b.grade] || a.min - b.min;
};
