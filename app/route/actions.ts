"use server";

import { areaAt } from "@/lib/geocode";

// 길 비교 — 카카오 길찾기 두 갈래를 받아 분석하고 부담점수를 매긴다.
//
// 여기서 새로 하는 계산은 없다. lib 에 이미 다 있고(routesFor → scoreRoutes), 이 파일은
// 그걸 화면이 부를 수 있는 자리로 옮겨 놓는 것뿐이다.
//
// **서버여야 하는 이유가 둘이다.** 카카오 REST 키가 서버 전용이고, 도로 링크
// data/jeju-link.json 이 6.7MB 다 — 37,063개 링크를 폰으로 내려보낼 수는 없다.
// 격자 인덱스는 lib/route.ts 의 linkIndex 가 인스턴스마다 한 번만 만든다(파싱 28ms + 격자 14ms).
//
// 음성 대본(radio)은 **두 단계로 준다.** compareRoutes 는 규칙 대본을 즉시 실어 보내고,
// AI 대본은 aiRadio 가 따로 받아온다 — 이유는 aiRadio 주석에 있다.

import { routesFor, type LiveRoute } from "@/lib/route";
import { scoreRoutes, type DriverProfile, type ScoreResult } from "@/lib/score";
import { radioScript, verdict } from "@/lib/briefing";
import { 붙인칸 } from "@/lib/sign";
import { aiSentences, factsOf, type ArrivalFacts, type Facts } from "@/lib/ai";
import { meters, parkingKind, walkMinutes, type Lot } from "@/lib/parking";
import type { Link } from "@/lib/analyze";
import type { LatLng } from "@/app/RouteMap";
import LINKS from "@/data/jeju-link.json";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

export type Compared =
  /** verdicts 는 경로별 한 줄 판정 (lib/briefing.ts). 근거 화면(HOME-03) 제목 밑에 앉는다. */
  | {
      routes: LiveRoute[];
      score: ScoreResult;
      verdicts: Record<string, string>;
      /**
       * 경로별 출발 전 음성 대본. **규칙 기반이라 값이 늘 들어 있다** — 재생 버튼이
       * 화면과 함께 뜨고, 인터넷이 끊겨도 소리가 난다. AI 대본은 aiRadio 가 덮어쓴다.
       */
      radio: Record<string, string[]>;
      /** aiRadio 에 그대로 돌려줄 사실 묶음. 화면에 이미 있는 값들이라 새로 나가는 정보는 없다 */
      facts: Facts;
      at: string;
    }
  /** 화면에 그대로 보여줄 사유. 임의 구간이라 폴백할 데이터가 없다 (lib/route.ts LiveRoutes 주석) */
  | { error: string };

/**
 * 도착지 주차장 — 대본 ⑤칸의 재료.
 *
 * 좌표가 정확히 같은 행을 찾는다. 이름으로 찾지 않는 이유는 원본에 이름도 좌표도 똑같은 행이
 * 15쌍 있어서다 (app/parking/detail/page.tsx 와 같은 방식·같은 이유). 이 좌표는 주차장 화면이
 * 이 데이터에서 그대로 실어 보낸 값이라 부동소수 비교가 어긋나지 않는다.
 *
 * **못 찾아도 정상이다.** 카카오에서 온 주차장(lib/poi.ts)은 이 데이터에 없고 유형·요금도
 * 모른다. 그때는 아는 것만 채우고 주차형태를 null 로 둔다 — 대본이 그 말을 통째로 건너뛴다.
 */
function arrivalOf(
  at: LatLng,
  /** 주차장 이름과 원래 목적지 좌표. 주차장을 안 거쳐 온 흐름이면 없다 */
  dest: { name: string; place: LatLng | null } | undefined,
): ArrivalFacts | undefined {
  if (!dest) return undefined;

  const lot = LOTS.find((l) => l.at[0] === at[0] && l.at[1] === at[1]);
  const kind = lot ? parkingKind(lot) : null;

  return {
    주차장: dest.name,
    // 금액이 아니라 무료/유료만 넘긴다 (lib/ai.ts ArrivalFacts 주석)
    요금: lot?.fee ?? "정보 없음",
    주차형태: kind
      ? { 형태: kind.parallel ? "평행주차" : "직각주차", 확인됨: kind.confirmed }
      : null,
    // 목적지를 모르면(주차장 찾기로 바로 들어온 흐름) 걸어서 몇 분인지도 모른다
    목적지까지도보분: dest.place ? walkMinutes(meters(dest.place, at)) : null,
  };
}

export async function compareRoutes(
  origin: LatLng,
  destination: LatLng,
  profile: DriverProfile,
  /** 도착지 주차장. 없으면 대본이 ⑤칸(도착해서 차를 댈 곳)을 쓰지 않는다 */
  dest?: { name: string; place: LatLng | null; placeName?: string },
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

  const arrival = arrivalOf(destination, dest);

  // 규칙 대본. 계산뿐이라 즉시 나오고, 여기가 비는 경우가 없어야 재생 버튼이 늘 뜬다.
  // 나가기 전에 칸마다 서명을 붙인다 — /api/tts 가 서버가 만든 대본만 읽게 하려는 것이다
  // (lib/sign.ts). 화면은 이 값을 그리지 않고 RouteRadio 로 넘기기만 한다.
  const radio = Object.fromEntries(
    live.routes.map((r) => [
      r.id,
      // 목적지 이름은 주차장 이름이 아니라 원래 고른 곳이다 — 대본 ①이 "오늘은 성산일출봉
      // 가시고" 로 연다. 주차장 이름(dest.name)은 ⑤칸이 따로 쓴다.
      radioScript(
        profile,
        score,
        r,
        live.routes.find((x) => x.id !== r.id) ?? null,
        arrival,
        dest?.placeName,
      ).map(붙인칸),
    ]),
  );

  return {
    routes: live.routes,
    score,
    verdicts,
    radio,
    facts: factsOf(`현위치 → ${dest?.name ?? "도착지"}`, profile, score, live.routes, arrival),
    at: live.at,
  };
}

/**
 * AI 대본. 받으면 규칙 대본을 덮어쓰고, 못 받으면(한도·타임아웃·검증 실패) null 이라 그대로 둔다.
 *
 * **compareRoutes 안에서 부르지 않는다.** 저기는 지도와 경로 카드가 기다리는 자리인데
 * AI 호출은 최대 6초다(lib/ai.ts TIMEOUT_MS). 대본 때문에 화면 전체가 6초 늦게 뜨면
 * 대본이 있는 쪽이 없는 쪽보다 나쁜 화면이 된다. 대본은 늦게 좋아져도 되는 종류다 —
 * 규칙 대본이 이미 재생 가능한 상태로 화면에 앉아 있기 때문이다.
 *
 * 경로 순서(facts.경로 순서 = routes 순서)로 돌려준다. 부르는 쪽이 자기 카드 것만 꺼내 쓴다.
 *
 * 대안이 없는 구간(경로 1개)에서는 부르지 않는다 — 스키마가 경로 두 개를 요구하고,
 * 애초에 비교할 게 없으면 ②칸(왜 이 길인지)이 성립하지 않는다. 규칙 대본이 그 경우를 맡는다.
 */
/**
 * AI 대본을 켠다. 모델이 gpt-5.6-luna 하나로 정해졌고 askModel 의 2단 폴백도 없어졌다 —
 * 껐던 이유(1순위가 잘리고 2순위가 받아 10초)가 그대로 사라졌다.
 *
 * 한 번 부르는 데 10초는 여전하다 — 실측 2026-08-20, lib/ai.smoke.ts 로 초보 9.7초 ·
 * 베테랑 10.4초였고 둘 다 verify 를 통과했다. **화면은 이걸 안 기다린다** (page.tsx 의
 * useEffect). 규칙 대본이 먼저 앉고 AI 대본이 오면 갈아끼운다.
 *
 * 같은 프롬프트는 캐시가 받아친다 — 같은 실측에서 2회차가 0ms 였다. 시연 전에 열어 볼
 * 구간을 한 번씩 미리 열어두면 대본이 즉시 뜨고 호출도 안 나간다. 캐시는 서버 메모리라
 * 배포하면 재시작되며 비므로 **배포 뒤에** 데운다.
 */
const AI_대본 = true;

export async function aiRadio(facts: Facts): Promise<string[][] | null> {
  if (!AI_대본) return null;
  if (facts.경로.length < 2) return null;
  // 규칙 대본과 같은 이유로 여기도 서명을 붙인다 — 화면이 어느 쪽을 쓰든 주소 모양이 같아야 한다
  return (await aiSentences(facts))?.radio?.map((대본) => 대본.map(붙인칸)) ?? null;
}

/**
 * 좌표 → 동네 이름 ("제주시 아라이동"). 주행 저장에 담을 때 출발지 이름으로 쓴다.
 *
 * 검색해서 온 사람은 쿼리에 출발지 이름이 실려 있지만, 현위치에서 바로 길을 본 사람은 그게 없다.
 * 그때 "출발지 → 서귀포매일올레시장"으로 담기면 나중에 목록에서 어디서 떠났는지 알 수 없다.
 * 키가 없거나 못 찾으면 null 이고, 부르는 쪽이 "현재 위치"로 떨어뜨린다.
 *
 * 서버여야 하는 이유는 KAKAO_REST_API_KEY 다 — 브라우저에 내보내면 안 된다 (lib/geocode.ts).
 */
export async function areaOf(lat: number, lng: number): Promise<string | null> {
  return areaAt(lat, lng);
}
