// 좌회전 지점이 비보호인지 — 로드뷰로 직접 판독한 표를 좌표로 조회한다.
//
// 왜 판독인가 — 제주에는 신호현시 데이터가 없다. 경찰청 교차로계획정보는 서울시만,
// UTIC 신호개방데이터는 인천·대구만 준다. 제주도 C-ITS 오픈API가 교차로별 현시를
// 직진/좌회전으로 나눠 주던 유일한 출처였는데 활용가이드 변경내역상 2026-04-01 자로 종료됐다.
// 그래서 사람이 로드뷰를 보고 하나씩 적었다 (scripts/left-turn-worklist.mjs · public/roadview-tag.html).
//
// **판독 안 된 지점이 하나라도 있으면 숫자를 안 낸다.** 굳혀둔 구간 밖으로 나가면 판독표에
// 없는 좌회전을 지나는데, 그걸 빼고 세면 "비보호 없음"이 되어 확인한 사실처럼 읽힌다.
// 모르는 것과 없는 것을 같은 칸에 적지 않는 게 이 프로젝트의 규칙이다.

import { distance, type LatLng } from "./curvature.ts";
import 판독표 from "../data/unprotected-left.json" with { type: "json" };

export type Verdict = "비보호" | "보호" | "무신호" | "판단불가";

/**
 * 같은 지점으로 볼 거리(m).
 *
 * 판독표의 좌표는 카카오 안내점 좌표 그대로라 경로가 같으면 정확히 일치한다. 30m 는
 * 카카오가 도로 데이터 갱신으로 안내점을 조금 옮겼을 때를 위한 여유다. 더 늘리면
 * 도심에서 옆 교차로를 집는다 — 실측에서 중앙로62번길 두 지점이 62m 떨어져 있었다.
 */
const 같은지점_M = 30;

const 판독 = Object.values(판독표) as {
  verdict: Verdict | null;
  label: string;
  shotAt: string | null;
}[];
const 좌표 = Object.keys(판독표).map((k) => k.split(",").map(Number) as LatLng);

/** 경로 위 좌회전 지점 하나의 판정. 표에 없으면 null. */
function verdictAt(at: LatLng): Verdict | null {
  let best = -1;
  let bestM = Infinity;
  for (let i = 0; i < 좌표.length; i++) {
    const m = distance(at, 좌표[i]);
    if (m < bestM) (bestM = m), (best = i);
  }
  return bestM <= 같은지점_M ? 판독[best].verdict : null;
}

/**
 * 경로의 비보호 좌회전 수. **하나라도 모르면 null** — 화면은 그때 "확인 안 됨"으로 적는다.
 *
 * `판단불가`도 모르는 것으로 친다. 로드뷰에서 등화가 안 보였다는 뜻이지 비보호가 아니라는
 * 뜻이 아니다.
 */
export function unprotectedCount(turnPoints: LatLng[]): number | null {
  let n = 0;
  for (const at of turnPoints) {
    const v = verdictAt(at);
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
  return `카카오맵 로드뷰 육안 판독 (촬영 ${범위}) · 비보호 규제표지와 좌회전 화살표 등화로 판정`;
})();
