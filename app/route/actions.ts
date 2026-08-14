"use server";

// 길 비교 — 카카오 길찾기 두 갈래를 받아 분석하고 부담점수를 매긴다.
//
// 여기서 새로 하는 계산은 없다. lib 에 이미 다 있고(routesFor → scoreRoutes), 이 파일은
// 그걸 화면이 부를 수 있는 자리로 옮겨 놓는 것뿐이다.
//
// **서버여야 하는 이유가 둘이다.** 카카오 REST 키가 서버 전용이고, 도로 링크
// data/jeju-link.json 이 6.7MB 다 — 37,063개 링크를 폰으로 내려보낼 수는 없다.
// 격자 인덱스는 lib/route.ts 의 linkIndex 가 인스턴스마다 한 번만 만든다(파싱 28ms + 격자 14ms).

import { routesFor, type LiveRoute } from "@/lib/route";
import { scoreRoutes, type DriverProfile, type ScoreResult } from "@/lib/score";
import { verdict } from "@/lib/briefing";
import type { Link } from "@/lib/analyze";
import type { LatLng } from "@/app/RouteMap";
import LINKS from "@/data/jeju-link.json";

export type Compared =
  /** verdicts 는 경로별 한 줄 판정 (lib/briefing.ts). 근거 화면(HOME-03) 제목 밑에 앉는다. */
  | { routes: LiveRoute[]; score: ScoreResult; verdicts: Record<string, string>; at: string }
  /** 화면에 그대로 보여줄 사유. 임의 구간이라 폴백할 데이터가 없다 (lib/route.ts LiveRoutes 주석) */
  | { error: string };

export async function compareRoutes(
  origin: LatLng,
  destination: LatLng,
  profile: DriverProfile,
): Promise<Compared> {
  // 프로필을 넘긴다 — 후보 셋 중 어느 것이 "안심 길" 자리에 앉을지가 프로필을 탄다 (routesFor 주석)
  const live = await routesFor(origin, destination, LINKS as Link[], profile);
  if ("error" in live) return live;

  /*
   * 대안이 없으면 routesFor 가 한 장만 준다. 그때는 같은 경로를 양쪽에 넣는다 —
   * scoreRoutes 가 "차이가 무의미하다"로 보고 recommendedRoute 를 single 로 돌려주므로,
   * 화면은 추천 배지 없이 한 장만 그리게 된다. 없는 선택지를 만들지 않는 쪽이다.
   */
  const fast = live.routes.find((r) => r.id === "fast") ?? live.routes[0];
  const safe = live.routes.find((r) => r.id === "safe") ?? live.routes[0];
  const score = scoreRoutes(profile, fast, safe);

  // 판정 문장은 경로마다 다르다 — 상대 경로의 소요시간을 함께 봐야 나오는 문장이라 여기서 만든다.
  const verdicts = Object.fromEntries(
    live.routes.map((r) => [r.id, verdict(score, r, r.id === "fast" ? safe : fast)]),
  );

  return { routes: live.routes, score, verdicts, at: live.at };
}
