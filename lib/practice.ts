// 연습 구간 — "지금 차 없는 길"(lib/flow.ts)에 연습 조건을 붙여 단계로 나눈다.
//
// **왜 도로 하나인가.** 순환 코스를 만들려면 경로 탐색을 새로 짜야 한다 — 카카오 길찾기는
// A→B 만 준다. 그런데 도로 하나는 그 자체로 이미 선형 코스고, 끝에서 돌아 나오면 출발지로
// 돌아온다. 초보가 길을 잃을 일도 없다. 연습에 필요한 건 예쁜 동그라미가 아니라
// **같은 길을 반복해서 익히는 것**이라, 왕복이 오히려 목적에 맞는다.
//
// **단계를 나누는 근거.** 초보가 어려워하는 순서가 곧 단계다:
//   1단계 — 굴러가는 감각. 급커브 없고 신호도 몇 번 안 만나는 길.
//   2단계 — 신호와 차선. 급커브는 없지만 신호를 여러 번 만나는 길.
//   3단계 — 커브까지. 급커브가 있는 길.
// 급커브를 마지막에 두는 이유는 이 앱이 부담점수에서 급커브에 가장 큰 가중치를 주기 때문이다
// (lib/score.ts BASE_SCORE — sharpCurve 12, narrowRoad 10). 화면마다 다른 순서를 말하면 안 된다.
//
// **모르는 것은 말하지 않는다.** 비보호 좌회전은 여기서 세지 않는다 — 로드뷰 판독표가
// 굳혀둔 3구간에만 있어서(lib/unprotected.ts), 임의 도로에서 세면 "비보호 없음"이 확인한
// 사실처럼 읽힌다. 초보에게 가장 어려운 항목인데도 빼는 이유다.

import { distance, sharpCurves, simplify, type LatLng } from "./curvature.ts";
import type { Link, LinkIndex } from "./analyze.ts";
import { calmRoads, MIN_LANES, type Baseline, type CalmRoad } from "./flow.ts";

/**
 * 연습 구간을 찾는 반경(m). "차 없는 길"(10km)보다 좁다 —
 * 연습은 마음먹고 나가는 일이 아니라 집 앞에서 30분 도는 일이다.
 */
const RADIUS_M = 5000;

/**
 * 연습 구간으로 쓸 편도 길이(km). 너무 짧으면 돌리기만 하다 끝나고,
 * 너무 길면 왕복이 부담이라 "잠깐 연습"이 안 된다.
 * 화면에는 왕복으로 적으므로 사람이 보는 숫자는 2~10km 다.
 */
const LENGTH_KM = { min: 1, max: 5 };

/** 이 개수 이하면 신호를 "몇 번 안 만난다"고 본다 — 1단계와 2단계를 가르는 값이다. */
const QUIET_SIGNALS = 5;

/** 신호기를 도로에 붙이는 거리(m). 교차로 신호가 도로 중심선에서 조금 떨어져 서 있다. */
const SIGNAL_NEAR_M = 100;

/**
 * 지도에 그릴 좌표를 솎는 간격(m). 화면에 그리는 용도라 원본 정밀도가 필요 없다 —
 * 20m 로 솎으면 좌표가 절반이 되고(993 → 499), 지도에서 차이가 보이지 않는다.
 * 급커브·거리 계산은 **솎기 전 원본**으로 한다. 그건 숫자가 되어 화면에 찍히는 값이라서다.
 */
const DRAW_TOLERANCE_M = 20;

/**
 * 급커브 판정 하한 속도(km/h). 이 미만인 길은 급커브를 세지 않는다.
 *
 * lib/analyze.ts 는 50 을 쓰는데 여기서는 30 이다. 저쪽은 "고속으로 달리다 만나는 커브"가
 * 위험하다는 판정이고, 이쪽은 **초보가 핸들을 얼마나 감아야 하나**를 본다 —
 * 40km/h 짜리 동네길의 커브도 처음 잡는 사람에게는 연습거리다.
 */
const CURVE_MIN_SPEED = 30;

export type Segment = CalmRoad & {
  /** 편도 거리(km) */
  km: number;
  /** 급커브 수 (편도) */
  curves: number;
  /** 지나는 신호 수 */
  signals: number;
  /** 평균 차로수 */
  lanes: number;
  /** 1 = 첫 연습 · 2 = 신호와 차선 · 3 = 커브까지 */
  level: 1 | 2 | 3;
  /**
   * 지도에 그릴 선들. 링크마다 한 줄이라 **순서를 몰라도 된다** —
   * 도로의 링크들을 하나로 잇자면 F_NODE/T_NODE 가 필요한데 슬림본에 없고,
   * 여러 줄로 그리면 이어붙일 이유 자체가 없어진다.
   */
  paths: LatLng[][];
};

export const LEVEL_LABEL: Record<1 | 2 | 3, string> = {
  1: "첫 연습",
  2: "신호와 차선",
  3: "커브까지",
};

export const LEVEL_HINT: Record<1 | 2 | 3, string> = {
  1: "급커브 없고 신호도 적어요",
  2: "신호를 여러 번 만나요",
  3: "급커브가 있어요",
};

/** 급커브가 있으면 3단계, 없으면 신호 수로 1·2 를 가른다. */
export function levelOf(curves: number, signals: number): 1 | 2 | 3 {
  if (curves > 0) return 3;
  return signals <= QUIET_SIGNALS ? 1 : 2;
}

/**
 * 표준노드링크는 왕복 차로를 **각각 한 줄씩** 담는다. 그대로 더하면 편도 거리가 두 배로 나온다
 * (실제로 그렇게 재서 "일주서로 167km" 가 나왔다 — 그 길은 편도 80km 대다).
 * 급커브도 같은 이유로 양쪽에서 두 번 세어진다.
 */
const 편도 = (양방향: number) => 양방향 / 2;

/**
 * 지금 연습하기 좋은 구간들. 단계 순 → 같은 단계면 차 없는 순.
 *
 * **단계마다 따로 자른다.** 전체에서 상위 N 개를 자르면 3단계가 영원히 안 나온다 —
 * 실제로 그렇게 만들었다가 화면에 1단계 5개·2단계 3개만 뜨고 커브 연습 구간은 한 번도
 * 못 봤다. 1단계가 많은 건 흔한 일이라(집 근처에 조용한 길이 여럿) 전체 자르기로는
 * 아래 단계가 구조적으로 밀린다. 단계별 상한이면 세 단계가 늘 함께 보인다.
 *
 * @param signals 신호기 좌표 (data/jeju-signals.json 의 값들)
 * @param perLevel 단계마다 보여줄 최대 개수
 */
export function practiceSegments(
  index: LinkIndex,
  speeds: Map<string, number>,
  here: LatLng,
  baseline: Baseline,
  signals: LatLng[],
  perLevel = 3,
): Segment[] {
  // 차 없는 길이 먼저다 — 골목·1차로·막힌 길은 calmRoads 가 이미 걸렀다.
  // limit 을 넉넉히 줘야 길이로 자른 뒤에도 단계별로 남는다.
  const calm = calmRoads(index, speeds, here, baseline, 60);
  if (!calm.length) return [];
  const 여유 = new Map(calm.map((c) => [c.road, c]));

  // 반경 안 신호만 미리 추린다 — 818개 전부를 링크 좌표마다 재면 헛일이 대부분이다
  const 가까운신호 = signals.filter((s) => distance(here, s) <= RADIUS_M + SIGNAL_NEAR_M);

  const 도로 = new Map<string, Link[]>();
  for (const l of index.links) {
    const n = l.n?.trim();
    if (!n || !여유.has(n)) continue;
    // calmRoads 와 같은 기준으로 걸러야 한다. 안 그러면 2차로 조각 몇 개로 통과한 도로의
    // 1차로 조각까지 다시 긁어와 "평균 1.3차로" 짜리 골목길이 연습 구간으로 올라온다.
    if ((l.l ?? 0) < MIN_LANES) continue;
    const [lo, la] = l.c[0];
    if (distance(here, [la, lo]) > RADIUS_M) continue;
    const arr = 도로.get(n);
    if (arr) arr.push(l);
    else 도로.set(n, [l]);
  }

  const out: Segment[] = [];
  for (const [road, ls] of 도로) {
    let km = 0;
    let curves = 0;
    let lanes = 0;
    const paths: LatLng[][] = [];
    for (const l of ls) {
      const path: LatLng[] = l.c.map(([lo, la]) => [la, lo]);
      for (let i = 1; i < path.length; i++) km += distance(path[i - 1], path[i]) / 1000;
      curves += sharpCurves(path, () => l.s, CURVE_MIN_SPEED).length;
      lanes += l.l ?? 0;
      paths.push(simplify(path, DRAW_TOLERANCE_M));
    }
    km = 편도(km);
    if (km < LENGTH_KM.min || km > LENGTH_KM.max) continue;

    const signalCount = 가까운신호.filter((s) =>
      ls.some((l) => l.c.some(([lo, la]) => distance(s, [la, lo]) < SIGNAL_NEAR_M)),
    ).length;
    const curveCount = Math.round(편도(curves));

    out.push({
      ...여유.get(road)!,
      km: Math.round(km * 10) / 10,
      curves: curveCount,
      signals: signalCount,
      lanes: Math.round((lanes / ls.length) * 10) / 10,
      level: levelOf(curveCount, signalCount),
      paths,
    });
  }

  // 단계가 낮은 것부터. 같은 단계 안에서는 차가 없는 쪽이 먼저다.
  out.sort((a, b) => a.level - b.level || b.ease - a.ease);

  const 담긴수 = new Map<number, number>();
  return out.filter((s) => {
    const n = (담긴수.get(s.level) ?? 0) + 1;
    담긴수.set(s.level, n);
    return n <= perLevel;
  });
}
