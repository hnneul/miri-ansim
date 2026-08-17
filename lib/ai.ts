// 생성형 AI 문장 — 계획서 Core·Supporting 1·2 의 "생성형 AI가 작성한다"
//
// AI가 만드는 것은 문장뿐이다. 숫자·위험요인·추천 결과는 전부 계산이 정하고(lib/score.ts),
// AI는 그 결과를 읽어 한국어로 옮긴다. 그래서 부담점수도 근거 카드의 수치도 AI 때문에
// 흔들리지 않는다 — 근거 카드의 완료 기준이 "동일 입력에서 같은 근거"이기 때문이다.
//
// "확인되지 않은 위험요인은 생성하지 않는다"는 프롬프트로 부탁할 일이 아니라 코드로 막을
// 일이다. 그래서 응답을 verify() 로 거른다: 우리가 데이터를 확보하지 못한 요인을 언급하거나
// 주지 않은 숫자를 쓰면 응답을 버리고 규칙 기반 문장(lib/briefing.ts)으로 떨어진다.
//
// 호출 1회로 네 개를 받는다 — 같은 사실을 네 번 보낼 이유가 없다:
//   summary  근거 카드용 두 경로 차이 1~2문장 (Supporting 1)
//   briefing 운전자 맞춤 해석 2~3문장 — 이 조건에서 이 길이 어떤 길인지 (Supporting 2)
//   verdicts 경로별 판정 한 줄 — 왜 이 길인지 / 왜 이 길이 아닌지 (Core 추천 이유)
//   radio    경로별 **출발 전 음성 안내 대본** 2~5칸 — 눈이 아니라 귀로 듣는 자리다
//
// radio 가 나머지 셋과 다른 점은 매체다. 화면은 숫자를 보여주고(부담점수 42, 좌회전 12번 → 3번)
// 사람은 그걸 눈으로 훑는다. 음성은 그 숫자가 **무슨 뜻인지** 말한다 — "맞은편 차 흐름을 끊고
// 들어가야 하는 순간이 아홉 번 줄어듭니다". 표는 저 문장을 못 쓰고, 음성은 저것만 하면 된다.
// 그래서 화면 문장(verdicts·briefing)을 그대로 읽히지 않는다. 그러면 스크린리더지 안내가 아니다.

import { ACTION, WHY } from "./briefing.ts";
// 타입만 가져온다 — 지워지는 import 라 route.ts(와 그 6.7MB 데이터)를 물지 않는다.
// ai.check.ts 가 node 로 바로 도는 것도 이 덕분이다.
import type { RouteStats } from "./route.ts";
import type { RiskFactor, ScoreResult, DriverProfile } from "./score.ts";
import { COMFORT_THRESHOLD, activeWeights } from "./score.ts";

/**
 * 후보는 **OpenAI 하나**다. 한때 Groq·Gemini 를 예비로 세워뒀는데 그건 무료 한도를 아끼려던
 * 것이고, 팀 크레딧이 붙은 지금은 아낄 대상이 없다. 오히려 값을 치렀다 — 1순위가
 * TIMEOUT_MS 에 잘리고 2순위가 받으면 두 시간이 더해져 화면이 10초를 기다렸다
 * (실측 10,012ms, app/route/actions.ts 주석). 후보를 하나로 두면 6초에서 끊긴다.
 *
 * 별칭이 아니라 버전이 박힌 이름을 쓴다 — 별칭은 모델이 조용히 올라가 문장이 바뀐다.
 *
 * gpt-5.6-luna — 이 화면은 사실을 자연어로 옮기는 일이므로 고가 모델보다 낮은 비용의
 * Luna 가 맞다. 출력은 아래 verify() 가 다시 거른다.
 *
 * 실패하면 캐시(aiSentences)도 규칙 폴백(lib/briefing.ts)도 정상 동작 경로다 —
 * 장식이 아니라 이 앱이 인터넷 없이도 말을 하게 하는 장치다.
 */
const OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** 넘기면 규칙 기반 문장으로 간다. 브리핑이 늦게 뜨는 것보다 안 뜨는 게 낫진 않다. */
const TIMEOUT_MS = 6000;

/**
 * 언급하면 응답을 버리는 말들. 전부 우리가 데이터를 확보하지 못한 요인이다
 * (사고다발·급경사는 요인에서 제외했고, 기상은 Stretch로 미구현).
 * 두 글자 이상만 넣는다 — "비" 처럼 한 글자를 막으면 "비교"·"부담" 같은 정상 문장이 걸린다.
 */
const 금지어 = [
  "사고다발", "사고 다발", "사고이력", "사고 이력", "급경사", "빙판", "결빙",
  "안개", "강풍", "폭우", "적설", "날씨", "기상", "스쿨존", "어린이보호구역",
  "과속단속", "무인단속", "통행료",
];

/**
 * verdicts 는 경로 순서(fast, safe)와 같다 — 부르는 쪽이 자기 카드 것만 꺼내 쓴다.
 *
 * 모델에게는 순서로 받지 않고 {경로 이름, 판정} 쌍으로 받아 이름으로 맞춘다. 순서로 받으면
 * 뒤집혀도 스키마를 통과하고, 그러면 평화로 카드에 5.16도로 설명이 붙는다 — 검증으로
 * 잡을 수 없는 거짓말이다. 한때 A·B 기호를 키로 썼는데, 모델이 그 기호를 문장에도 썼다
 * ("B 경로는 부담점수가 29.4로…"). 화면에 나갈 이름을 그대로 키로 쓰면 그 문제가 없다.
 */
export type AiSentences = {
  summary: string;
  briefing: string[];
  verdicts: string[];
  /** 경로별 대본. 바깥이 경로 순서(verdicts 와 같다), 안이 칸(①오프닝 ②추천이유 ③각오 ④도착 ⑤맺음말) */
  radio: string[][];
};

type RouteFacts = {
  이름: string;
  성격: string;
  소요시간분: number | null;
  거리km: number | null;
  부담점수: number;
  /**
   * 부담이 큰 순서. 요인별 점수는 일부러 넣지 않는다 — 모델이 한쪽 경로의 요인 점수를
   * 다른 경로 요인에 붙이는 걸 봤다("부담점수 28.2점인 좁은 교행 구간(평화로 1.1km)",
   * 28.2는 5.16도로 값이다). 요인 이름이 양쪽에 같으면 어느 가드에도 걸리지 않는다.
   * 요인별 점수는 근거 카드가 계산 결과로 직접 보여주므로 AI가 알 필요도 없다.
   */
  요인: { 이름: string; 수치: string; 비중: string; 부담설명: string; 행동수칙: string }[];
  /**
   * 근거 화면(HOME-03) 비교표와 같은 다섯 줄. 대본 ②(추천 이유)의 실체가 여기서 나온다.
   *
   * 요인만으로 추천 이유를 쓰면 "굽은 길이 많습니다" 수준에서 멈춘다 — 요인은 그 길에 무엇이
   * 있는지를 말할 뿐 **두 길이 어떻게 다른지**를 말하지 못하기 때문이다. "좌회전이 12번에서
   * 3번으로 준다"가 초보에게 훨씬 구체적인 이유고, 그 값은 화면 표가 이미 보여주므로
   * 새 주장이 아니라 옮겨 적는 것이다.
   *
   * 요인과 달리 **0도 담는다**("없음"). 비교에서는 오히려 0 쪽이 요지다 (lib/route.ts RouteStats).
   */
  비교?: {
    좌회전유턴: string;
    회전교차로: string;
    연속급커브: string;
    좁은교행: string;
    고속주행: string;
  };
};

/**
 * 도착지 주차장 — 대본 ④칸의 재료. 주차장을 안 거쳐 온 흐름이면 통째로 없다.
 *
 * 쓸 수 있는 사실이 넷인데 넷 다 주지 않는다. 요금 상세(30분 1000원·1일권)와 규모(총 N면)는
 * **귀로 들어서 할 수 있는 일이 없다** — 화면 카드가 이미 보여주는 값이고, 대본에 넣으면
 * 낭독이 아니라 표 읽기가 된다. 넣는 건 들으면 행동이 달라지는 것뿐이다.
 */
export type ArrivalFacts = {
  주차장: string;
  /** "무료" | "유료" | "혼합" — 금액은 주지 않는다 (위 주석) */
  요금: string;
  /**
   * 주차 형태. **null 이면 대본이 아예 말하지 않는다** — 카카오에서 온 곳은 유형을 모른다.
   * 모르는 걸 지어내지 않는 건 이 프로젝트가 데이터 없는 자리에서 쓰는 규칙이다 (lib/parking.ts).
   *
   * 확인됨=false 는 주차장유형으로 **추정**한 값이다. 추정을 단정으로 바꾸면 안 된다 —
   * 초보에게 평행주차를 직각이라고 알려주는 게 아무 말도 안 하느니만 못하다.
   */
  주차형태: { 형태: "직각주차" | "평행주차"; 확인됨: boolean } | null;
  목적지까지도보분: number | null;
};

export type Facts = {
  구간: string;
  운전자조건: string[];
  추천경로: string;
  편안임계값: number;
  경로: RouteFacts[];
  도착?: ArrivalFacts;
};

/**
 * 계산 결과 → AI에게 줄 사실 묶음. 여기 없는 건 AI도 모른다.
 * 프롬프트 조립을 순수 함수로 떼어놔서 ai.check.ts 가 네트워크 없이 검증한다.
 *
 * 실시간 혼잡 문구는 일부러 넣지 않는다. 캐시 키가 프롬프트인데, 혼잡 문구는
 * "중앙로 3.6km 서행" → "중앙로 4km 서행" 처럼 로드마다 바뀌어서 넣으면 캐시가 거의
 * 안 맞는다. 새로고침 몇 번이 그대로 호출 몇 번이 된다.
 * 소요시간은 추천 이유의 핵심이라 남긴다 — 몇 분 동안은 같은 값이라 캐시가 맞는다.
 * 혼잡은 경로 카드 배지가 이미 보여주므로 문장에서 잃는 게 없다.
 */
export function factsOf(
  label: string,
  profile: DriverProfile,
  result: ScoreResult,
  routes: {
    name: string;
    badge: string;
    durationMin: number | null;
    distanceKm: number | null;
    risks: RiskFactor[];
    /** 없으면 비교표를 안 싣는다 — 대본 ②가 요인만으로 이유를 쓰게 된다 (RouteFacts.비교 주석) */
    stats?: RouteStats;
  }[],
  /** 도착지 주차장. 주차장을 안 거쳐 온 흐름이면 없고, 그때 대본은 ④칸을 쓰지 않는다 */
  arrival?: ArrivalFacts,
): Facts {
  const 점수 = [result.fastScore, result.safeScore];
  const ROUTE_ID = ["fast", "safe"] as const; // routes 배열 순서 = breakdown 의 route 값
  return {
    구간: label,
    운전자조건: activeWeights(profile).map((s) => s.replace(/\s*×.*$/, "")),
    추천경로:
      result.recommendedRoute === "single"
        ? "없음 (두 경로의 부담 차이가 작음)"
        : routes[result.recommendedRoute === "fast" ? 0 : 1].name,
    편안임계값: COMFORT_THRESHOLD,
    경로: routes.map((r, i) => ({
      이름: r.name,
      성격: r.badge,
      소요시간분: r.durationMin,
      거리km: r.distanceKm,
      부담점수: 점수[i],
      요인: r.risks
        .map((k) => ({
          이름: k.label,
          // 위치(도로명·km)는 주지 않는다 — 화면에서는 지도 마커가 그 일을 하고,
          // 프롬프트에서는 모델이 베껴 쓸 수치 문자열만 하나 더 늘린다.
          수치: k.value,
          // 판정에서 쓸 수 있는 유일한 숫자. 이게 없으면 모델이 비율을 말할 근거가 없어
          // "길게 이어집니다"처럼 뭉갠 말만 나온다 — 29%와 3%가 같은 말이 되는 셈이다.
          비중: `경로의 ${Math.round(k.exposure * 100)}%`,
          // 사람이 검토한 평문. 판정(verdicts)의 말투를 여기서 가져간다 —
          // 초보에게 할 말을 모델이 새로 발명하는 것보다, 검토된 문장을 고쳐 쓰는 쪽이 안전하다.
          부담설명: WHY[k.type],
          행동수칙: ACTION[k.type],
          // route 로 먼저 좁힌다. "좁은 교행 구간"처럼 두 경로에 같은 이름이 있으면
          // factor 만으로 찾으면 항상 fast 행이 잡혀 정렬이 뒤집힌다 (실제로 그랬다).
          부담: result.breakdown.find((b) => b.route === ROUTE_ID[i] && b.factor === k.label)?.weighted ?? 0,
        }))
        // 부담이 큰 것부터. 점수는 정렬에만 쓰고 프롬프트에서는 뺀다 (RouteFacts 주석 참고)
        .sort((a, b) => b.부담 - a.부담)
        .map(({ 부담: _, ...쓸것 }) => 쓸것),
      // undefined 면 JSON.stringify 가 키째로 뺀다 — 프롬프트에 "비교: null" 이 안 남는다
      비교: r.stats && 비교표(r.stats),
    })),
    도착: arrival,
  };
}

/**
 * 근거 화면 비교표와 같은 형식으로 편다 (app/route/page.tsx 의 Why rows).
 * 두 곳이 다른 문자열을 쓰면 화면과 음성이 어긋난다 — "12번"과 "12회"가 같은 값이어야 한다.
 */
function 비교표(s: RouteStats): NonNullable<RouteFacts["비교"]> {
  return {
    좌회전유턴: s.turns ? `${s.turns}번` : "없음",
    회전교차로: s.roundabouts ? `${s.roundabouts}곳` : "없음",
    연속급커브: s.sharpCurves ? `${s.sharpCurves}곳` : "없음",
    좁은교행: s.narrow ? `${Math.round(s.narrow * 100)}%` : "없음",
    고속주행: s.highSpeedKm ? `${s.highSpeedKm}km` : "없음",
  };
}

const RULES = `너는 제주 렌터카 초보 운전자에게 경로를 안내하는 도우미다.
아래 사실만 사용해 한국어 문장을 쓴다.

지켜야 할 것:
- 사실에 있는 수치만 쓴다. 새 숫자를 만들거나 반올림하지 않는다.
- 각 경로의 "요인"은 부담이 큰 순서로 나열돼 있다. 요인별 점수는 주지 않았으니 말하지 않는다.
  부담점수는 경로 단위 값(부담점수 필드)만 쓴다.
- 사실에 없는 위험요인(사고 이력, 경사, 날씨, 단속 등)은 언급하지 않는다.
- 운전 조언은 각 요인의 "행동수칙" 문장을 근거로만 말한다. 직접 만들지 않는다.
- 추천경로가 왜 추천인지는 summary 에서 부담점수와 소요시간으로 설명한다.
- verdicts: 경로마다 한 줄, "경로"에는 그 경로의 이름을 그대로 적는다. 추천경로면 왜 이 길인지,
  아니면 왜 이 길이 아닌지. **그 경로의 요인만** 쓴다 (다른 경로의 요인을 붙이면 안 된다).
  운전을 처음 하는 사람에게 말하듯 **두 문장, 80자 안의 평문**. 한 문장으로 끝내지 않는다 —
  왜 그런 길인지까지 말해야 추천 이유가 된다.
  숫자를 쓸 거면 그 요인의 **"비중" 하나만** 쓴다("경로의 29%"). "수치"(급커브 42곳,
  최소 반경 7m 같은 것)는 바로 아래 요인 목록이 이미 보여주므로 옮기지 않는다.
  부담이 가장 큰 요인 하나를 골라 그 "부담설명"을 줄여 쓰고, 추천경로면 그래도 신경 쓸
  곳 하나를 덧붙인다. 조언이 아니라 이 길이 어떤 길인지를 말한다
  ("이렇게 하세요"는 briefing 이 한다).
  예(추천 아님): "굽은 길이 절반 가까이 이어집니다. 커브마다 속도를 줄였다 올리기를
  반복하게 되고, 마주 오는 차를 미리 보기 어렵습니다."
  예(추천): "큰길이라 차선만 지키면 됩니다. 다만 주변 차가 빠른 구간이 길어, 속도를
  맞추려 하지 않는 게 편합니다."
  나쁜 예: "고속주행 구간이 25.4km(제한속도 80km/h)이며 연속 급커브가 17곳으로 부담이 큽니다."
- briefing 의 위험요인과 행동수칙은 **추천경로의 것만** 쓴다. 추천하지 않는 경로의 요인은
  briefing 에 넣지 않는다 (summary 에서 두 경로를 비교하는 것은 괜찮다).
- 존댓말, 담백하게. 감탄사·과장·이모지 금지.

출력:
- summary: 두 경로의 차이를 1~2문장으로. 근거 카드 머리말에 들어간다.
- briefing: **이 운전자에게 이 길이 어떤 길인지** 쉬운 말로 풀어 주는 해석 2~3문장.
  점수를 읊는 자리가 아니다 — "부담점수", "임계값", 점수 숫자는 쓰지 않는다.
  화면이 이미 점수를 큰 글씨로 보여주고, 여기서 알고 싶은 건 "내 조건에서 이 길이 어떠냐"다.
  ① 운전자조건을 사람 말로 바꿔 "~라면"으로 시작해, 추천경로가 어떤 성격의 길인지 한 문장.
     ("운전경력 1년 이하" → "운전을 시작한 지 얼마 안 됐다면", "제주 운전경험 없음" →
      "제주 도로가 처음이라면") 조건이 여러 개면 무거운 것 하나만 쓴다. 조건이 없으면 생략한다.
  ② 그 길에서 부담이 가장 큰 요인 하나를 골라, 실제로 무슨 일이 생기는지 "부담설명"을 줄여 쓴다.
  ③ 그때 어떻게 하면 되는지 "행동수칙"을 줄여 쓴다.
  숫자를 쓸 거면 그 요인의 "비중" 하나만 쓴다("경로의 29%").
  예: "운전을 시작한 지 얼마 안 됐다면 평화로 경유가 편합니다. 큰길이라 차선만 지키면 됩니다.",
      "다만 주변 차가 빠른 구간이 경로의 29%로 이어집니다. 속도를 맞춰야 할 것 같은 압박을 받기 쉽습니다.",
      "무리해서 속도를 맞추지 말고 2차로로 가세요."
- verdicts: [{"경로": "경로 이름", "판정": "두 문장, 80자 안"}, …]. 경로마다 하나씩.
- radio: [{"경로": "경로 이름", "대본": ["①", "②", …]}, …]. 경로마다 하나씩.

  **출발 전에 귀로 듣는 안내다.** 화면은 이미 숫자를 보여줬으니, 여기서는 그 숫자가 **무슨 뜻인지**
  말한다. 위 문장들(summary·briefing·verdicts)을 그대로 옮기지 않는다 — 같은 말을 읽어주면
  안내가 아니라 낭독이다.

  **번호나 기호를 문장에 쓰지 않는다.** 아래 ①②③④ 는 칸의 역할을 설명하려고 붙인 것이지
  문장에 넣으라는 게 아니다. "① 이 길은…" 처럼 쓰면 그대로 소리로 읽힌다.
  머리에 번호·불릿·따옴표 없이 말만 적는다.

  칸마다 역할이 정해져 있다. 순서대로 쓴다:
  ① **누구에게 하는 말인지 짚고, 오늘 어디를 어느 길로 가는지.**
     "운전자조건"을 가정형이 아니라 **단정형으로 호명**한다. 이미 받아둔 정보라 "~라면"으로
     말하면 남 얘기처럼 들린다. 조건이 여럿이면 무거운 것 **둘까지**만 쓴다.
     조건 이름을 그대로 읽지 말고 **사람이 하는 말로 풀어 쓴다** — "운전 경력 1년 미만"은
     입력 화면의 항목 이름이지 사람이 자기 사정을 말하는 방식이 아니다
     ("운전 시작한 지 얼마 안 되셨고, 제주도 처음이시죠").
     조건이 하나도 없으면 호명을 통째로 생략하고 길 얘기부터 한다.

     **도로 이름에는 뜻을 붙인다.** 제주가 처음인 사람에게 "평화로"·"5.16도로"는 아무 뜻이
     없고, 추천된 경로는 화면에 "맞춤 안심 길"로 떠서 이름을 볼 데조차 없다. 그렇다고 이름을
     빼면 안 된다 — 표지판에 도로명이 나오고 들어둔 이름은 거기서 알아본다. 그 경로에서
     부담이 가장 큰 요인을 보고 "○○라는 큰길"·"○○라는 산길"처럼 한 마디를 붙인다.
     예: "운전 시작한 지 얼마 안 되셨고, 제주도 처음이시죠. 오늘은 성산일출봉 가시고, 평화로라는 큰길 타시네요."
  ② **왜 이 길인지.** 다른 경로와 비교해서 말한다 — 여기서만 다른 길을 언급해도 된다.
     **다른 경로를 이름으로 부르지 않는다.** 이름을 모르는 사람에게는 뜻이 없으므로 "다른 길"로
     부르고 그 길의 성격으로 설명한다 ("다른 길은 굽이가 계속 이어지는 산길인데, 이 길은 그게 없어요").
     "저쪽"처럼 가리키는 말도 쓰지 않는다 — 소리만으로는 무엇을 가리키는지 모른다.

     **"비교"의 좌회전·회전교차로를 추천 이유로 쓰지 않는다.** 그 값들은 부담점수에 들어가지
     않아서, 화면이 큰 글씨로 띄운 점수와 음성이 서로 다른 축으로 말하게 된다. 이유는 각
     경로의 "요인"(급커브·좁은 교행·고속주행)에서 고른다 — 다른 길에는 있고 이 길에는 없거나
     훨씬 덜한 요인 하나다.
     - 그 경로가 추천경로일 때: 위와 같이 무엇이 나아지는지 말한다. 소요시간 이득이 있으면 덧붙인다.
     - 추천경로가 **아닐 때: 설득하지 않는다.** 이미 이 길을 고른 사람에게 하는 말이다.
       무엇과 무엇을 맞바꾼 것인지만 짚는다. **나무라지 않는다** — "부담이 큰 길입니다"가 아니라
       "익숙한 분들이 고르는 코스예요"처럼, 같은 사실을 탓하지 않는 말로 쓴다.
       예: "시간은 짧지만 손 갈 데가 좀 있어요." / "손이 좀 가는 길이라, 익숙한 분들이 고르는 코스예요."
     - 추천경로가 "없음"일 때: 두 길이 비슷하다고 말하고 무엇을 맞바꾸는지만 알려준다.
       **판단을 되돌려주지 않는다** — "직접 고르세요" 같은 말은 쓰지 않는다. 고르라고 할 거면
       카드 두 장으로 충분하고, 그 문장은 도와주는 척하는 훈계다 (briefing.ts 못고른말 주석).
  ③ 그래도 **각오할 것 하나**. 그 경로에서 부담이 가장 큰 요인 하나만 골라, 거기서 **뭘 겪는지**
     한 마디와 그때 어떻게 하면 되는지를 "행동수칙"에 맞춰 짧게 쓴다.
     ①에서 길을 "산길"·"큰길"이라고 불렀으면 그 말을 여기서 되풀이하지 않는다.
     그 경로에 요인이 하나도 없으면 **이 칸을 쓰지 않는다**.
     예: "하나만 기억하세요. 커브마다 속도 줄였다 올렸다 하게 돼요. 들어가기 전에 미리 줄이시면 돼요."
  ④ **도착해서 차를 댈 곳.** 사실에 "도착"이 있으면 **반드시 이 칸을 쓴다** — 빼먹지 않는다.
     ("도착"이 아예 없을 때만 이 칸이 없다.)
     주차형태를 반드시 말한다 — 출발 전에 알아야 대는 법을 미리 보고 갈 수 있다.
     초보에게는 평행주차가 길의 급커브보다 무섭고, 그걸 **출발 전에** 알아야 준비할 수 있다.
     이 칸이 이 안내에서 가장 쓸모 있는 자리다.
     "확인됨"이 false 면 **단정하지 않는다**: "~일 가능성이 높아요"로 쓴다.
     주차형태가 없으면(null) 주차 형태를 아예 언급하지 않는다.
     요금은 무료일 때만 "무료예요" 한 마디로 말하고 **금액은 말하지 않는다**.
     예(주차형태 평행·확인됨 false·무료·도보 4분): "도착하면 매일올레시장 공영주차장이에요.
     무료이고, 평행주차일 가능성이 높으니 대는 법만 보고 가세요. 목적지까진 걸어서 4분이에요."
     나쁜 예(주차형태를 빼먹었다): "매일올레시장 공영주차장에 도착하면 도보 4분 정도 필요합니다."
  ⑤ **맺음말.** 늘 "오늘도 안전운전하세요." 한 마디로 끝낸다 — 라디오의 맺음말은 고정이고,
     그 한 마디가 안내가 끝났다는 신호가 된다. 다른 말로 바꾸거나 앞 칸에 붙이지 않는다.

  말투: 라디오 진행자가 옆에서 알려주듯. **"~해요" 체로 통일한다** —
  "~합니다"는 읽는 글의 말투고, 이건 출발 직전에 귀로 듣는 말이다.
  아직 **출발 전**이므로 예고형으로 쓴다 ("중간에 한 번 좁아져요").
  주행 중인 것처럼 쓰지 않는다 (나쁜 예: "곧 5.16도로로 들어갑니다").

  **짧게 끊는다.** 칸마다 **90자 안**, 한 칸은 한두 문장이면 충분하다 — 귀로는 되감을 수 없어서
  길면 그대로 흘려버린다. 낭독이 아니라 옆에서 툭툭 알려주는 말이다.
  숫자는 **칸당 세 개까지**. 눈으로 보는 수치(최소 반경 17m 같은 것)는
  귀로 들어서 쓸 데가 없으니 옮기지 않는다.`;

/** strict 모드는 additionalProperties: false 를 요구한다 */
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    briefing: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
    // 경로 이름을 함께 받아 이름으로 맞춘다 — 순서만 믿으면 뒤집혀도 통과한다 (AiSentences 주석).
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { 경로: { type: "string" }, 판정: { type: "string" } },
        required: ["경로", "판정"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 2,
    },
    // 대본도 경로 이름으로 받는다 (verdicts 와 같은 이유 — 순서만 믿으면 뒤집혀도 통과한다).
    // 칸 수를 2~5로 열어둔 건 ②(추천 접음)·③(요인 없음)·④(주차장 없음)가 빠질 수 있어서다.
    radio: {
      type: "array",
      items: {
        type: "object",
        properties: {
          경로: { type: "string" },
          대본: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
        },
        required: ["경로", "대본"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 2,
    },
  },
  required: ["summary", "briefing", "verdicts", "radio"],
  additionalProperties: false,
} as const;

/**
 * 판정 한 줄의 상한. 두 가지를 다르게 재는데, 실패 모드가 둘이기 때문이다.
 *
 * 처음엔 길이만 80자로 막았다. 그랬더니 모델이 25자짜리("연속 급커브가 많아 속도 조절이
 * 자주 필요합니다.")를 내놓고, 그건 추천 이유라고 부르기엔 너무 얇았다.
 *
 * 실제로 문제였던 건 길이가 아니라 수치 나열이었다: "고속주행 구간이 25.4km(제한속도
 * 80km/h)이며 연속 급커브가 17곳(최소 반경 17m)·굽은 구간 2.5km으로…" — 숫자 다섯 개가
 * 한 문장에 들어가면 바로 아래 요인 목록과 같은 말이 된다. 그래서 숫자 개수를 센다.
 * 길이는 두 문장이 들어갈 만큼 열어두고, 나열만 막는다.
 */
const 판정_최대글자 = 110;
const 판정_최대숫자 = 2;

/**
 * 대본 한 칸의 상한. 판정보다 조금 넉넉한데(110 → 120) 매체가 달라서다 — 판정은 요인 목록 위에
 * 앉는 한 줄이지만 대본 한 칸은 그 자체로 끝나는 한 덩어리다.
 *
 * 그렇다고 더 열어주면 안 된다. 눈으로는 긴 문단을 훑다 되돌아갈 수 있지만 **귀로는 못 되감는다** —
 * 한 칸이 길어지면 지금 어디를 듣고 있는지 놓친다.
 *
 * 처음엔 120 이었다. 실제로 들어보니 그 길이가 낭독처럼 들려서 90 으로 줄였다 —
 * 출발 직전에 듣는 말이라 한 칸이 한 호흡에 끝나야 한다. 규칙 대본(briefing.ts radioScript)이
 * 이 안에서 도는지는 lib/radio.check.ts 가 검사한다.
 */
export const 대본_최대글자 = 90;

/**
 * 대본 한 칸의 숫자 상한. 판정(2)보다 하나 많은데, **우리가 준 문장 자체가 숫자를 쓰기 때문**이다.
 *
 * 처음엔 판정과 같은 2로 뒀다가 실제 응답이 걸렸다:
 *   "경로의 48%로 이어집니다. 무리해서 속도를 맞출 필요는 없고, 1차로보다 2차로가 편합니다."
 * 뒷부분은 ACTION.highSpeed 를 그대로 쓴 것이다 — 사람이 검토해서 넣어둔 행동수칙인데
 * "1차로"·"2차로"가 숫자 둘을 먹는다. 여기에 비중(48%)이 붙으면 셋이 된다.
 *
 * 즉 2는 **모델이 아니라 우리 문장을 거부하는 상한**이었다. 실제로 규칙 대본(briefing.ts
 * radioScript)의 같은 칸도 숫자가 셋이라 이 검증을 통과하지 못했다 — 폴백이 자기 게이트에
 * 걸리는 상태다. lib/radio.check.ts 가 그 관계를 검사한다.
 *
 * 막으려던 건 수치 나열("급커브 42곳, 굽은 구간 12.5km, 최소 반경 7m")이고 그건 넷 이상이다.
 */
export const 대본_최대숫자 = 3;

/**
 * 칸 앞머리의 번호·불릿. **떼어내고 쓴다** — 소리로 나가는 글에서는 "①"이 그대로 읽힌다.
 *
 * 프롬프트로도 말리지만 실제로 어기는 걸 봤다("① 이 길은 평화로를 따라…"). 칸의 역할을
 * ①②③④ 로 설명해 뒀으니 모델이 따라 쓰는 것도 무리는 아니다 — 부탁이 아니라 코드로 막는다.
 * 버리지 않고 떼기만 하는 이유: 내용은 멀쩡한데 머리 기호 하나로 폴백까지 갈 일은 아니다.
 *
 * 숫자 뒤에 **공백을 요구**하는 게 중요하다. `\d+[.)]` 만으로 보면 "5.16도로 경유"의 "5." 가
 * 걸려서 "16도로 경유"가 된다 — 경로 이름이 통째로 망가진다.
 */
const 머리기호 = /^\s*(?:[①②③④⑤⑥]\s*|\d+[.)]\s+|[-•*]\s+)/;

/**
 * 대본에서 상대 경로를 언급해도 되는 칸. ②(추천 이유)는 비교가 곧 내용이라 다른 길을 말해야 한다.
 * summary 를 다른경로만의요인 검사에서 빼주는 것과 같은 판단이다 (아래 verify 주석).
 *
 * 뒤쪽 칸(③④)이 빠져도 이 인덱스는 안 흔들린다 — 앞에서부터 채우기 때문이다. 다만 추천을
 * 접었을 때는 ②가 통째로 비어 이 자리에 ③이 온다. 그때는 추천이 "없음" 이라 어느 경로도
 * 추천 경로가 아니고, 비교를 막을 이유 자체가 약해진다 — 검사를 한 칸 헐겁게 하는 쪽이
 * 버리는 것보다 낫다고 보고 그대로 둔다.
 */
const 비교허용_칸 = 1;

/** 문장에 쓰인 숫자가 전부 프롬프트 안에 있던 것인가 */
function 숫자가사실에있나(text: string, prompt: string): boolean {
  return (text.match(/\d+(\.\d+)?/g) ?? []).every((n) => prompt.includes(n));
}

/**
 * 추천하지 않는 경로에만 있는 요인의 이름·수치.
 *
 * 브리핑은 "선택 경로에서 실제로 확인된 위험요인만" 써야 한다(Supporting 2 완료 기준).
 * 프롬프트로도 지시하지만 실제로 어기는 걸 봤다 — 평화로를 추천하면서 5.16도로의
 * 급커브를 브리핑에 넣었다. 그래서 코드로 막는다.
 *
 * 두 경로에 같이 있는 요인(좁은 교행 구간 등)은 빼야 한다 — 추천 경로에도 있는 요인이니
 * 언급해도 위반이 아니다.
 */
function 다른경로만의요인(facts: Facts, 이름: string): string[] {
  const 이경로 = facts.경로.find((r) => r.이름 === 이름);
  if (!이경로) return []; // 추천이 "없음"(부담 차이 작음)이면 두 경로를 다 말해도 된다
  const 여기있는것 = new Set(이경로.요인.flatMap((f) => [f.이름, f.수치, f.비중]));
  return facts.경로
    .filter((r) => r.이름 !== 이름)
    .flatMap((r) => r.요인)
    .flatMap((f) => [f.이름, f.수치, f.비중])
    .filter((s) => !여기있는것.has(s));
}

/**
 * 응답 검증. 통과하지 못하면 null 을 주고 호출한 쪽이 규칙 기반 문장으로 떨어진다.
 * 여기가 계획서의 "확인되지 않은 위험요인은 생성하지 않는다"를 실제로 지키는 자리다.
 */
export function verify(v: unknown, facts: Facts): AiSentences | null {
  if (typeof v !== "object" || v === null) return null;
  const { summary, briefing, verdicts, radio } = v as Record<string, unknown>;
  if (typeof summary !== "string" || !Array.isArray(briefing)) return null;

  const lines = briefing.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  // 완료 기준이 "2~3개의 짧은 문장"이다. 스키마로도 걸었지만 여기서 한 번 더 본다.
  if (lines.length < 2 || lines.length > 3 || !summary.trim()) return null;

  // 판정을 경로 이름으로 맞춰 경로 순서로 편다 — 순서만 믿으면 뒤집혀도 통과한다.
  // 하나라도 빠지거나 비면 통째로 버린다: 한쪽 카드만 설명이 없는 화면보다
  // 둘 다 규칙 문장으로 떨어지는 쪽이 앞뒤가 맞는다.
  if (!Array.isArray(verdicts)) return null;
  const 이름들 = facts.경로.map((r) => r.이름);
  // 두 경로 이름이 같으면 이름으로 맞출 수 없다 — 같은 문장이 두 카드에 붙는 것보다 폴백이 낫다
  if (new Set(이름들).size !== 이름들.length) return null;
  const 판정 = 이름들.map(
    (이름) =>
      (verdicts as { 경로?: unknown; 판정?: unknown }[]).find((v) => v.경로 === 이름)?.판정,
  );
  if (!판정.every((s): s is string => typeof s === "string" && s.trim().length > 0)) return null;
  if (판정.some((s) => s.trim().length > 판정_최대글자)) return null;
  if (판정.some((s) => (s.match(/\d+(\.\d+)?/g) ?? []).length > 판정_최대숫자)) return null;

  // 대본도 이름으로 맞춰 경로 순서로 편다 (판정과 같은 이유). 한쪽이라도 모양이 어긋나면
  // 통째로 버린다 — 한 카드에서만 재생 버튼이 죽은 화면보다 둘 다 규칙 대본인 쪽이 앞뒤가 맞는다.
  if (!Array.isArray(radio)) return null;
  const 대본 = 이름들.map(
    (이름) => (radio as { 경로?: unknown; 대본?: unknown }[]).find((r) => r.경로 === 이름)?.대본,
  );
  const 칸이성한가 = (d: unknown): d is string[] =>
    Array.isArray(d) &&
    d.length >= 2 &&
    d.length <= 5 &&
    d.every((s) => typeof s === "string" && s.trim().length > 0);
  if (!대본.every(칸이성한가)) return null;
  if (대본.some((d) => d.some((s) => s.trim().length > 대본_최대글자))) return null;
  if (대본.some((d) => d.some((s) => (s.match(/\d+(\.\d+)?/g) ?? []).length > 대본_최대숫자)))
    return null;

  const 전체 = [summary, ...lines, ...판정, ...대본.flat()].join(" ");
  if (금지어.some((w) => 전체.includes(w))) return null;
  if (!숫자가사실에있나(전체, promptOf(facts))) return null;

  // 브리핑에만 적용한다 — summary 는 두 경로를 비교하는 자리다 (Supporting 1)
  const 브리핑 = lines.join(" ");
  if (다른경로만의요인(facts, facts.추천경로).some((w) => 브리핑.includes(w))) return null;

  // 판정은 경로별이라 더 좁게 본다: 그 카드에 다른 길의 요인이 붙으면 안 된다.
  // 이름으로 맞춰 순서 뒤집힘은 막았지만, 모델이 내용을 바꿔 넣는 건 여기서만 걸린다.
  if (facts.경로.some((r, i) => 다른경로만의요인(facts, r.이름).some((w) => 판정[i].includes(w)))) return null;

  // 대본은 칸마다 기준이 다르다. ②는 추천 이유라 비교가 곧 내용이니 summary 취급이고,
  // 나머지 칸은 그 길 얘기만 해야 하니 briefing 취급이다 (비교허용_칸 주석).
  if (
    facts.경로.some((r, i) => {
      const 남의것 = 다른경로만의요인(facts, r.이름);
      return 대본[i].some((s, 칸) => 칸 !== 비교허용_칸 && 남의것.some((w) => s.includes(w)));
    })
  )
    return null;

  return {
    summary: summary.trim(),
    briefing: lines.map((s) => s.trim()),
    verdicts: 판정.map((s) => s.trim()),
    radio: 대본.map((d) => d.map((s) => s.trim().replace(머리기호, ""))),
  };
}

export function promptOf(facts: Facts): string {
  return `${RULES}\n\n[사실]\n${JSON.stringify(facts, null, 1)}`;
}

/**
 * 모델 호출만. 파싱된 원본을 그대로 준다 — verify() 와 떼어놨기 때문에
 * ai.smoke.ts 가 검증에 걸린 응답을 눈으로 볼 수 있다. 폴백만 조용히 뜨는 상태가
 * 가장 잡기 어려운 고장이다.
 */
export async function askModel(prompt: string): Promise<unknown | null> {
  return openai(prompt);
}

/** OpenAI. 실패(한도·타임아웃·파싱)는 전부 null 이고, 부르는 쪽이 규칙 문장으로 간다. */
async function openai(prompt: string): Promise<unknown | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        reasoning_effort: "low",
        max_completion_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "sentences", strict: true, schema: SCHEMA },
        },
      }),
    });
    if (!res.ok) return null;

    const text = (await res.json()).choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 프롬프트 → 결과 캐시. temperature 0 이라 같은 프롬프트에 같은 답이 나오므로
 * 캐싱이 최적화가 아니라 원래 동작이다. 같은 화면을 두 번 그리는 데 두 번 부를 이유가 없다.
 *
 * 프롬프트에 실시간 소요시간·혼잡이 들어가므로 교통이 바뀌면 자연히 다시 부른다 —
 * 낡은 문장을 붙들고 있지 않는다. 서버 메모리라 재시작하면 비는데 그래도 맞다.
 */
const 캐시 = new Map<string, AiSentences>();
const CACHE_MAX = 200;

/**
 * 계획서 Core·Supporting 1·2 의 AI 문장. 실패·지연·검증 실패는 모두 null 이다 —
 * 호출한 쪽은 lib/briefing.ts 의 규칙 기반 문장을 그대로 쓰면 된다.
 */
export async function aiSentences(facts: Facts): Promise<AiSentences | null> {
  const prompt = promptOf(facts);
  const 있던것 = 캐시.get(prompt);
  if (있던것) return 있던것;

  const out = verify(await askModel(prompt), facts);
  if (out) {
    // 오래된 것만 골라 버릴 값어치가 없다 — 통째로 비우고 다시 채운다
    if (캐시.size >= CACHE_MAX) 캐시.clear();
    캐시.set(prompt, out);
  }
  return out;
}
