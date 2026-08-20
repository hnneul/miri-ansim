"use server";

// 차 없는 길 — 지금 내 주변에서 차가 가장 적게 다니는 도로들.
//
// 서버여야 하는 이유는 /route, /around 와 같다: 도로 링크 판(data/jeju-link.json)이 6.7MB 라
// 폰으로 내려보낼 수 없다. 격자 인덱스는 lib/route.ts 의 linkIndex 가 인스턴스마다 한 번만
// 만들고, 길 비교 화면과 그 한 벌을 나눠 쓴다.
//
// 실시간 속도(제주ITS)는 lib/flow.ts 안에서 5분 캐시된다 — 이 화면과 메인화면이 같은
// 한 벌을 본다. 두 화면이 다른 시각의 값을 보여주면 "지금"이라는 말이 무너진다.

import { calmAt, liveSpeeds, flowAt, type Baseline, type Flow } from "@/lib/flow";
import { practiceSegments, type Segment } from "@/lib/practice";
import { linkIndex } from "@/lib/route";
import type { Link } from "@/lib/analyze";
import type { LatLng } from "@/lib/curvature";
import LINKS from "@/data/jeju-link.json";
import BASELINE from "@/data/road-baseline.json";
import SIGNALS from "@/data/jeju-signals.json";

/**
 * 단계마다 보여줄 최대 개수. 전체 상한이 아니라 **단계별** 상한이다 —
 * 전체로 자르면 1단계가 많을 때 3단계가 화면에 영영 안 나온다 (lib/practice.ts 주석).
 * 셋이면 세 단계를 합쳐 최대 아홉 장이라 한 화면에서 훑을 만하다.
 */
const PER_LEVEL = 3;

/** 신호기 좌표만 뽑아 둔다 — 818곳이라 요청마다 다시 훑을 이유가 없다. */
const SIGNAL_PTS: LatLng[] = Object.values(SIGNALS as Record<string, { lat: number; lng: number }>).map((s) => [
  s.lat,
  s.lng,
]);

export type CalmNear = {
  /** 지금 연습하기 좋은 구간. 단계 순 → 같은 단계면 차 없는 순. 단계마다 최대 PER_LEVEL 개 */
  segments: Segment[];
  /** 지금 내가 선 길 — 목록과 견줄 기준점이다. 커버리지 밖이면 null */
  here: Flow | null;
  /** 조회 시각 (Asia/Seoul). 빈 문자열이면 실시간을 못 받았다는 뜻 */
  at: string;
};

export async function calmNear(lat: number, lng: number): Promise<CalmNear> {
  const index = linkIndex(LINKS as Link[]);
  const here: LatLng = [lat, lng];
  // 셋이 같은 5분 캐시를 보므로 ITS 왕복은 한 번이다 (lib/flow.ts liveSpeeds)
  const [live, calm, flow] = await Promise.all([
    liveSpeeds(),
    calmAt(index, here, BASELINE as Baseline, 1),
    flowAt(index, here),
  ]);
  return {
    segments: live ? practiceSegments(index, live.speeds, here, BASELINE as Baseline, SIGNAL_PTS, PER_LEVEL) : [],
    here: flow,
    at: calm.at,
  };
}
