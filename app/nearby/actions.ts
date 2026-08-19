"use server";

// 지금 나한테 편한 곳 — 관광지를 부담·시간·정체로 줄 세운다 (lib/spots.ts).
//
// 서버여야 하는 이유가 둘이다. 카카오 REST 키가 서버 전용이고, 도로 링크
// data/jeju-link.json 이 7.4MB 다 — 운전 부담을 내려면 경로를 표준노드링크에 맞춰
// 분석해야 하는데 그 판을 폰으로 내려보낼 수는 없다 (app/route/actions.ts 와 같은 이유).
//
// 격자 인덱스는 lib/route.ts 의 linkIndex 가 인스턴스마다 한 번만 만들고, 길 비교 화면과
// 그 한 벌을 나눠 쓴다.

import { rankSpots, type Ranked, type Spot } from "@/lib/spots";
import { linkIndex } from "@/lib/route";
import type { DriverProfile } from "@/lib/score";
import type { Link } from "@/lib/analyze";
import type { LatLng } from "@/lib/curvature";
import LINKS from "@/data/jeju-link.json";
import SPOTS from "@/data/spots.json";

export async function nearbySpots(lat: number, lng: number, profile: DriverProfile): Promise<Ranked[]> {
  const here: LatLng = [lat, lng];
  return rankSpots(here, profile, SPOTS as Spot[], linkIndex(LINKS as Link[]));
}
