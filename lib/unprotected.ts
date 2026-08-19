// 좌회전 지점이 비보호인지 — 로드뷰 판독표를 좌표와 진입 방위로 조회한다.
//
// 왜 판독인가 — 제주에는 신호현시 데이터가 없다. 경찰청 교차로계획정보는 서울시만,
// UTIC 신호개방데이터는 인천·대구만 준다. 제주도 C-ITS 오픈API가 교차로별 현시를
// 직진/좌회전으로 나눠 주던 유일한 출처였는데 활용가이드 변경내역상 2026-04-01 자로 종료됐다.
// 표준노드링크 회전정보(TURNINFO)의 비보호좌회전 코드는 전국에 14건뿐이라 빈 칸이고,
// 전국도로안전표지 표준데이터에는 제주가 등록돼 있지 않다. 그래서 로드뷰를 직접 본다
// (scripts/roadview-fetch.py · roadview-judge.py, 사람 판독은 public/roadview-tag.html).
//
// **판독 안 된 지점이 하나라도 있으면 숫자를 안 낸다.** 판독표에 없는 좌회전을 빼고 세면
// "비보호 없음"이 되어 확인한 사실처럼 읽힌다. 모르는 것과 없는 것을 같은 칸에 적지 않는다.

import { distance, type LatLng } from "./curvature.ts";
import 판독표 from "../data/unprotected-left.json" with { type: "json" };

export type Verdict = "비보호" | "보호" | "무신호" | "판단불가";

/** 경로 위의 좌회전 지점 하나. 방위는 못 구할 수 있어 null 을 허용한다. */
export type TurnPoint = { at: LatLng; bearing: number | null };

/**
 * 같은 지점으로 볼 거리(m).
 *
 * 판독표 좌표는 두 출처가 섞여 있다 — 사람 판독은 카카오 안내점, AI 판독은 표준노드링크
 * 노드 중심이다. 실측에서 같은 교차로인데 둘이 28m 까지 벌어졌다. 더 늘리면 도심에서 옆
 * 교차로를 집는다 (중앙로62번길 두 지점이 62m 간격).
 */
const 같은지점_M = 30;

/**
 * 같은 진입으로 볼 방위 차(도).
 *
 * **이 조건이 없으면 사거리에서 엉뚱한 방향의 판정을 집는다.** 한 교차로의 진입 방향은
 * 최대 4개고 방향마다 비보호 여부가 다르다 — 실측에서 보성초교입구교차로는 한 방향이
 * 비보호, 다른 방향이 보호였다. 진입은 90° 간격이라 45° 면 인접 진입과 안 겹친다.
 */
const 같은진입_도 = 45;

const 판독 = Object.values(판독표) as {
  verdict: Verdict | null;
  label: string;
  shotAt: string | null;
  bearing: number | null;
}[];
const 좌표 = Object.keys(판독표).map((k) => {
  const [la, lo] = k.split(",");
  return [Number(la), Number(lo)] as LatLng;
});

/** 두 방위의 각도차 (0~180). */
const 방위차 = (a: number, b: number) => Math.abs(((a - b + 180) % 360) - 180);

/**
 * 좌회전 지점 하나의 판정. 표에 없으면 null.
 *
 * 방위를 못 구한 지점(bearing null)은 거리만으로 찾는다. 그때 같은 좌표에 진입이 여럿이면
 * **가장 가까운 하나를 집는데, 그게 맞는 방향이라는 보장이 없다.** 그래서 아래
 * unprotectedCount 는 그 경우를 세지 않고 모른다고 답한다.
 */
function verdictAt({ at, bearing }: TurnPoint): Verdict | null {
  let best = -1;
  let bestM = Infinity;
  for (let i = 0; i < 좌표.length; i++) {
    const m = distance(at, 좌표[i]);
    if (m > 같은지점_M || m >= bestM) continue;
    const b = 판독[i].bearing;
    if (bearing != null && b != null && 방위차(bearing, b) > 같은진입_도) continue;
    (bestM = m), (best = i);
  }
  return best >= 0 ? 판독[best].verdict : null;
}

/**
 * 경로의 비보호 좌회전 수. **하나라도 모르면 null** — 화면은 그때 "확인 안 됨"으로 적는다.
 *
 * `판단불가`도 모르는 것으로 친다. 로드뷰에서 등화가 안 보였다는 뜻이지 비보호가 아니라는
 * 뜻이 아니다. 방위를 못 구한 지점도 마찬가지다 — 사거리에서 어느 진입인지 특정하지
 * 못하면 그 판정은 다른 방향의 것일 수 있다.
 */
export function unprotectedCount(turnPoints: TurnPoint[]): number | null {
  let n = 0;
  for (const p of turnPoints) {
    if (p.bearing == null) return null;
    const v = verdictAt(p);
    if (v === null || v === "판단불가") return null;
    if (v === "비보호") n++;
  }
  return n;
}

/** 화면 하단 출처 문구. 촬영일이 제각각이라 범위로 적는다. */
export const UNPROTECTED_SOURCE = (() => {
  const 날짜 = 판독
    .filter((x) => x.verdict && x.shotAt)
    .map((x) => x.shotAt!)
    .sort();
  const 범위 = 날짜.length
    ? 날짜[0] === 날짜[날짜.length - 1]
      ? 날짜[0]
      : `${날짜[0]}~${날짜[날짜.length - 1]}`
    : "미상";
  return `카카오맵 로드뷰 판독 (촬영 ${범위}) · 비보호 규제표지와 좌회전 화살표 등화로 판정`;
})();
