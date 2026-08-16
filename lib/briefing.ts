// 운전자 맞춤 해석 · 경로별 판정 — PLAN.md §3 ④
//
// 폴백 경로다. AI 없이 계산 결과만으로 문장을 조립하므로 인터넷이 끊겨도 동작한다.
// AI 연동 시에는 이 함수가 실패·지연 시의 대체 경로가 된다.

// 도착지 주차장 사실은 AI 프롬프트용으로 ai.ts 가 정의한다. 여기서는 **타입만** 가져온다 —
// ai.ts 는 이 파일의 ACTION·WHY 를 값으로 가져가므로 값으로 맞물면 순환이 되고,
// import type 은 지워지므로 이 파일은 여전히 네트워크 없이 node 로 바로 돈다.
import type { ArrivalFacts } from "./ai.ts";
import {
  isNovice,
  type DriverProfile,
  type RiskFactor,
  type RiskType,
  type ScoreResult,
} from "./score.ts";

// 요인 종류별 대응 행동.
// 이 문장들은 출처가 필요 없다 — 위험요인의 존재를 주장하는 게 아니라
// 그 종류에 대한 일반 안전운전 수칙이기 때문이다. (§5 원칙)
//
// lib/ai.ts 가 프롬프트에 그대로 실어 보낸다. AI에게 안전 조언을 창작하게 하지 않고
// 사람이 검토한 문구를 주는 쪽이 안전하다 — 틀린 운전 조언은 틀린 숫자보다 위험하다.
export const ACTION: Record<RiskType, string> = {
  accidentZone: "사고가 잦은 곳이니 앞차와의 거리를 평소보다 넉넉히 두세요.",
  sharpCurve:
    "커브에 들어가기 전에 미리 속도를 줄이고, 커브 안에서는 브레이크를 밟지 않는 것이 안전합니다.",
  narrowRoad: "맞은편 차가 오면 넓은 곳에서 미리 기다렸다가 교행하세요.",
  steepSlope:
    "긴 내리막에서는 엔진브레이크를 함께 쓰고 풋브레이크만으로 버티지 마세요.",
  complexJunction:
    "교차로에 들어가기 전에 갈 방향의 차로를 미리 잡아두면 급한 차선 변경을 피할 수 있습니다.",
  highSpeed:
    "주변 차가 빨라도 무리해서 속도를 맞출 필요는 없습니다. 1차로보다 2차로가 편합니다.",
};

/**
 * 요인 종류별 — 이 길에서 실제로 무슨 일이 생기는가.
 *
 * ACTION 이 "어떻게 하라"면 이건 "왜 힘든가"다. 근거 카드가 원래 곱셈식(기본 × 노출 × 조건)을
 * 먼저 보여줬는데, 이 앱을 쓰는 이유는 점수 검산이 아니라 길을 모르기 때문이다 —
 * 필요한 건 "28.2점이 어떻게 나왔나"가 아니라 "저기 들어가면 뭐가 기다리나"다.
 *
 * ACTION 과 같은 이유로 출처가 필요 없다: 위험요인의 존재를 주장하는 게 아니라
 * 그 종류의 성격을 말하는 것이다. 요인이 거기 있다는 근거는 risk.source 가 댄다.
 */
export const WHY: Record<RiskType, string> = {
  accidentZone: "사고가 반복되는 지점이라 앞차가 갑자기 서는 일이 잦습니다.",
  sharpCurve:
    "커브마다 속도를 줄였다 올리기를 반복하게 됩니다. 커브 안에서는 앞이 보이지 않아 마주 오는 차나 서 있는 차를 미리 볼 수 없습니다.",
  narrowRoad:
    "차로가 하나뿐이라 마주 오는 차가 있으면 한쪽이 비켜서야 합니다. 관광버스나 트럭을 만나면 후진해서 넓은 곳까지 물러나야 할 수도 있습니다.",
  steepSlope: "내리막이 길어 브레이크만 밟고 내려가면 제동이 점점 밀립니다.",
  complexJunction:
    "차로가 갈라지는 곳이 많아 안내를 한 번 놓치면 급하게 차선을 바꾸게 됩니다.",
  highSpeed:
    "주변 차가 80km/h로 달려서, 속도를 맞춰야 할 것 같은 압박을 받기 쉽습니다.",
};

/**
 * 받침 유무로 조사를 고른다 — "좁은 교행 구간이"는 맞고 "연속 급커브이"는 틀리다.
 * 요인 이름이 데이터에서 오니 문장을 조립할 때 골라야 한다 (한글 음절은 0xAC00 부터
 * 28개씩 종성이 돌고, 나머지가 0이면 받침이 없다). 한글이 아니면 "가"로 둔다.
 */
function 이가(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? "이" : "가";
}

/**
 * 경로 한 개에 대한 판정 한 줄 — AI 문장(lib/ai.ts 의 verdicts)을 못 받았을 때 쓴다.
 *
 * 점수를 읊지 않는다. 이 문장이 앉는 자리는 부담점수를 이미 큰 글씨로 보여준 카드를
 * 눌러서 들어온 팝업의 머리말이고, 초보가 알고 싶은 건 "그래서 어떤 길이냐"다.
 *
 * WHY 문장을 그대로 쓰지도 않는다 — 바로 아래 요인 목록이 같은 문장을 이미 보여준다.
 * 여기서는 어느 요인이 제일 큰지만 가리키고 비켜준다.
 *
 * 추천 경로가 항상 점수까지 낮은 건 아니다(시간 이득을 함께 보므로) — 그래서 "더 낮다"고
 * 단정하지 않는다. lib/score.ts 의 추천 규칙을 그대로 옮기지 않으려는 것이다.
 */
/**
 * 추천을 접었을 때 할 말.
 *
 * **"익숙한 길로 가세요"라고 쓰면 안 된다.** 이 앱의 기본 프로필이 경력 1년·제주 처음이고
 * (lib/profile.ts DEFAULT_PROFILE), 익숙한 길이 없어서 여기까지 온 사람들이다.
 * 없는 걸 가리키는 조언은 조언이 아니다.
 *
 * 그리고 두 경우를 갈라 말한다. 예전에는 한 문장이 둘을 덮어서, 68점과 57점을 두고
 * "부담이 비슷합니다"라고 적고 있었다 — 16% 차이를 비슷하다고 부른 것이다 (score.ts noPick).
 *
 *   tie     — 고를 것이 없다. 그러면 남는 축은 시간뿐이다. 그건 말해줄 값어치가 있다.
 *   unclear — 부담과 시간을 맞바꿔야 한다. **여기서는 아무 말도 안 한다.**
 *
 * unclear 에 "부담을 줄이려면 15분을 더 써야 합니다. 직접 고르세요" 같은 줄을 달아뒀었다.
 * 두 카드가 이미 15분과 12점을 나란히 보여주고 있어서 그 문장은 카드를 읽어 옮긴 것뿐이었고,
 * 뒤에 붙은 "직접 고르세요"는 판단을 떠넘기는 훈계였다. 앱이 못 고르는 자리에서 할 수 있는
 * 정직한 일은 카드 두 장을 나란히 두고 비켜서는 것이다 — 빈 문자열은 "할 말 없음"이고,
 * 부르는 쪽이 그때 줄을 안 그린다 (app/route/page.tsx).
 */
function 못고른말(result: ScoreResult): string {
  return result.noPick === "tie"
    ? "두 길의 부담이 거의 같습니다. 그러면 소요시간이 짧은 쪽이 낫습니다."
    : "";
}

export function verdict(
  result: ScoreResult,
  route: {
    id: "fast" | "safe";
    risks: RiskFactor[];
    durationMin: number | null;
  },
  /** 상대 경로. 추천 이유는 결국 비교라서 한쪽만 보고는 쓸 수 없다 (소요시간만 쓴다). */
  other: { durationMin: number | null },
): string {
  if (result.recommendedRoute === "single") return 못고른말(result);

  // 부담이 가장 큰 요인. breakdown 을 route 로 먼저 좁힌다 — 요인 이름이 양쪽에 같으면
  // factor 만으로 찾다가 다른 경로 행이 잡힌다 (lib/ai.ts factsOf 와 같은 함정이다).
  const 최대 = result.breakdown
    .filter((b) => b.route === route.id)
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => route.risks.find((r) => r.label === b.factor))
    .find((r): r is RiskFactor => !!r);

  const 몫 = 최대 && `경로의 ${Math.round(최대.exposure * 100)}%`;
  const 분 =
    route.durationMin != null && other.durationMin != null
      ? other.durationMin - route.durationMin
      : null;

  // "초보에게는"을 붙이지 않는다 — 이 함수는 프로필을 받지 않고, 부담점수가 이미
  // 프로필을 반영한 값이다. 경력 3년 화면에서 "초보에게는"이 뜨는 걸 봤다.
  if (result.recommendedRoute === route.id) {
    const 앞 =
      분 != null && 분 > 0
        ? `다른 길보다 ${분}분 빠르고 부담도 적어 이 길을 추천합니다.`
        : "두 경로 중 부담이 적어 이 길을 추천합니다.";
    return 최대
      ? `${앞} 그래도 ${최대.label}${이가(최대.label)} ${몫}를 차지하니 그 구간만 신경 쓰세요.`
      : 앞;
  }
  const 뒤 =
    분 != null && 분 < 0 ? ` 게다가 다른 길보다 ${-분}분 더 걸립니다.` : "";
  return 최대
    ? `${최대.label}${이가(최대.label)} ${몫}를 차지해 부담이 큰 길입니다.${뒤}`
    : `이 길은 추천하지 않습니다.${뒤}`;
}

/**
 * 근거 화면(HOME-03)의 굵은 한 줄 — 이 길을 고르면 **무엇과 무엇을 맞바꾸는가**.
 *
 * verdict() 와 나눠 쓴다. 저건 요인 이름과 비율까지 말하는 설명문인데(경로 카드 옆에 앉는 자리라
 * 표가 없다), 여기는 바로 아래에 비교표가 통째로 붙어 있다 — "고속주행 구간이 47%를 차지하니"는
 * 표의 그 줄을 소리 내어 읽는 것뿐이고, 카드 한 줄에 넣으면 세 줄로 접혀 표보다 무거워진다.
 *
 * 말투가 "~해요"인 것도 이 줄뿐이다. 화면 글은 "~합니다"체지만(verdict·briefing) 여기는
 * 와이어프레임이 정한 문구 모양을 그대로 따른다 — 짧게 끊어 말을 거는 자리다.
 */
export function tradeoff(
  /** lib/score.ts 의 추천 결과 그대로. "single" 은 **추천을 접었다**는 뜻이다 */
  pick: ScoreResult["recommendedRoute"],
  route: { id: "fast" | "safe"; durationMin: number | null },
  other: { durationMin: number | null } | null,
): string {
  // 비교할 상대가 없으면 맞바꿀 것도 없다
  if (!other || route.durationMin == null || other.durationMin == null) return "";

  /*
   * 추천을 접었으면 아무 말도 안 한다. 여기에 boolean(recommended)만 받았더니 "추천이 아니다"와
   * "추천 자체가 없다"가 한 갈래로 뭉쳐서, 못 고른 구간에서 두 길 중 하나를 나무라고 있었다.
   * 무슨 말을 할지는 못고른말() 이 정하고 비교 화면이 그걸 그린다 — 여기서 다시 정하지 않는다.
   */
  if (pick === "single") return "";

  const 분 = other.durationMin - route.durationMin; // 양수면 이 길이 빠르다

  if (pick === route.id)
    return 분 > 0
      ? `빠른 길보다 ${분}분 빠르고, 부담도 적어요`
      : 분 < 0
        ? `빠른 길보다 ${-분}분 더, 대신 훨씬 편해요`
        : "시간은 같은데 부담이 더 적어요";

  /*
   * 추천하지 않은 길을 고른 사람에게 하는 말이다 — 되돌리려 하지 않는다 (radioScript ②와 같은 규칙).
   * 이 길이 더 느리기까지 하면 시간 얘기를 아예 꺼내지 않는다. 바로 아래 줄이 "58분 → 67분"으로
   * 이미 보여주고 있어서, 글로 한 번 더 짚으면 고른 사람을 나무라는 말이 된다.
   */
  return 분 > 0
    ? `${분}분 빠르지만, 긴장할 구간이 더 많아요`
    : "긴장할 구간이 더 많은 길이에요";
}

type RouteLike = {
  name: string;
  risks: RiskFactor[];
  durationMin: number | null;
};

/**
 * 프로필을 사람 말 한 조각으로. activeWeights 는 계산 근거("운전경력 1년 이하 ×1.3")라
 * 해석 문장에 그대로 쓸 수 없다 — 가중치 목록은 근거 자리에서 이미 그 일을 한다.
 *
 * 조건이 여러 개여도 하나만 쓴다. 한국어에서 절을 이어 붙이면("운전을 시작한 지 얼마 안 됐고
 * 제주 운전이 처음이고 밤이라면") 문장만 길어지고 어느 조건이 무거운지도 흐려진다.
 * 순서는 가중치가 큰 것부터다 (lib/score.ts 의 weight).
 */
function 조건말(p: DriverProfile): string {
  if (isNovice(p)) return "운전을 시작한 지 얼마 안 됐다면";
  if (p.drivingFrequency === "low") return "요즘 운전을 자주 하지 않았다면";
  if (!p.jejuExperience) return "제주 도로가 처음이라면";
  if (p.vehicleSize === "suv") return "차가 큰 편이라면";
  if (p.timeOfDay === "night") return "밤에 달린다면";
  return ""; // 경력자·주간·소형차 — 굳이 붙일 조건이 없다
}

/**
 * 운전자 맞춤 해석 2~3문장 — AI 문장(lib/ai.ts 의 briefing)을 못 받았을 때 쓴다.
 *
 * 점수와 임계값을 읊지 않는다. 이 문장이 앉는 자리는 부담점수를 이미 큰 글씨로 보여주는
 * 화면이고, 여기서 알고 싶은 건 "50점을 넘었다"가 아니라 "내 조건에서 이 길이 어떤 길이냐"다.
 * 세 문장이 각각 누구에게 어떤 길인지 · 거기서 무슨 일이 생기는지 · 그러면 어떻게 하는지다.
 *
 * risk.value는 쓰지 않는다 — 아직 "미확보"라 문장에 넣으면 거짓이 된다.
 */
export function briefing(
  profile: DriverProfile,
  result: ScoreResult,
  routes: { fast: RouteLike; safe: RouteLike },
): string[] {
  const { recommendedRoute: pick } = result;
  const target = pick === "safe" ? "safe" : "fast"; // 실제로 달릴 경로를 설명한다
  const name = { fast: routes.fast.name, safe: routes.safe.name };
  const 조건 = 조건말(profile);
  const 앞 = 조건 ? `${조건} ` : "";

  // 시간 차이는 남긴다 — 점수와 달리 설명 없이 바로 아는 정보다
  const gap =
    routes.fast.durationMin != null && routes.safe.durationMin != null
      ? routes.fast.durationMin - routes.safe.durationMin
      : null;
  const 빠른분 = gap == null ? null : target === "safe" ? gap : -gap;

  // 추천은 lib/score.ts 한 곳에서만 정한다 — 여기서 시간·점수를 다시 보고 갈라선 안 된다.
  // 못 고른 말은 한 곳에서만 만든다 (위 못고른말). unclear 면 빈 문자열이라 조건말도 안 붙인다 —
  // "운전을 시작한 지 얼마 안 됐다면 " 만 덩그러니 남으면 문장이 아니다.
  const 못고른 = pick === "single" ? 못고른말(result) : "";
  const lead =
    pick === "single"
      ? 못고른 && `${앞}${못고른}`
      : `${앞}두 경로 중에서는 ${name[target]}${이가(name[target])} 편합니다.` +
        (빠른분 != null && 빠른분 > 0 ? ` ${빠른분}분 빠르기도 합니다.` : "");

  // §4 breakdown은 factor(이름)만 담으므로 Route.risks에서 원본을 되짚는다.
  // 하나만 고른다 — 신경 쓸 곳을 둘 알려주면 둘 다 흐려진다. 나머지는 경로 카드가 보여준다.
  const top = result.breakdown
    .filter((r) => r.route === target)
    .sort((a, b) => b.weighted - a.weighted)
    .map((r) => routes[target].risks.find((x) => x.label === r.factor))
    .find((r): r is RiskFactor => !!r);

  // lead 가 비면(unclear) 빼고 준다 — 빈 문단 하나가 앞에 붙는 것보다 없는 편이 낫다
  if (!top) return [lead, `${name[target]}에는 확인된 위험요인이 없습니다.`].filter(Boolean);

  const loc = top.location.trim();
  const 어디 = loc && loc !== "-" ? `${loc}의 ` : "";
  return [
    lead,
    `${name[target]}에서 가장 신경 쓸 곳은 ${어디}${top.label}입니다. 경로의 ${Math.round(top.exposure * 100)}%를 차지합니다.`,
    // WHY 는 두 문장인 것도 있다 — 첫 문장이 "무슨 일이 생기는가"고 나머지는 경로 카드가 보여준다
    `${WHY[top.type].match(/^.*?\./)?.[0] ?? WHY[top.type]} ${ACTION[top.type]}`,
  ].filter(Boolean);
}


// --- 출발 전 음성 안내 대본 (lib/ai.ts 의 radio 를 못 받았을 때) ---
//
// 여기 문장들은 화면 문장(위 verdict·briefing)과 **말투가 다르다.** 위는 읽는 글이라 "~합니다"고,
// 여기는 출발 직전에 귀로 듣는 말이라 "~해요"다. 조수석에 앉은 아는 사람이 알려주는 톤이다.
// 짧게 끊는 것도 같은 이유다 — 귀로는 되감을 수 없어서 한 덩어리가 길면 놓친다.

/**
 * 운전자를 **직접 호명하는** 말 ("운전 경력 1년 미만, 제주는 처음이시죠").
 *
 * 위 조건말() 과 다르다. 저건 "~라면" 가정형이라 읽는 글에 맞고, 여기는 이미 프로필을 받아둔
 * 사람에게 거는 말이라 단정형이 맞다 — 가정형으로 말을 걸면 남 얘기처럼 들린다.
 *
 * 그리고 **둘까지** 쓴다. 조건말이 하나만 고르는 건 절을 이어 붙이면 문장이 길어져서인데,
 * 여기는 명사구를 쉼표로 나열하는 형태라 둘이어도 짧다. 셋부터는 호명이 아니라 목록이 된다.
 *
 * 조각이 전부 **명사구**여야 한다. "요즘 운전은 뜸하고" 같은 연결어미로 적었더니
 * "…뜸하고이시죠"가 나왔다. 그리고 전부 **받침으로 끝나야** "이시죠"가 붙는다
 * (받침이 없으면 "시죠"여야 한다) — 아래 다섯 개가 다 그런지는 radio.check.ts 가 본다.
 *
 * 순서는 가중치 순(lib/score.ts weight)이 **아니다.** 경력과 빈도가 둘 다 ×1.3 이라 그대로
 * 두면 "운전 경력 1년 미만, 운전은 오랜만"이 뽑히는데, 둘 다 경력 얘기라 한 번 말한 걸
 * 두 번 말하는 셈이 된다. 겹치지 않는 축이 먼저 오게 경력 → 지역 → 빈도 순으로 둔다.
 */
function 호명말(p: DriverProfile): string {
  const 조각 = [
    isNovice(p) && "운전 경력 1년 미만",
    !p.jejuExperience && "제주는 처음",
    p.drivingFrequency === "low" && "운전은 오랜만",
    p.vehicleSize === "suv" && "차는 큰 편",
    p.timeOfDay === "night" && "밤 운전",
  ].filter((s): s is string => !!s);

  // 경력자·주간·소형차라 걸리는 조건이 없으면 호명하지 않는다. 없는 조건을 지어내느니
  // 길 얘기로 바로 들어가는 편이 낫다.
  return 조각.length ? `${조각.slice(0, 2).join(", ")}이시죠.` : "";
}

/**
 * 요인 종류별 — 이 길이 **어떤 길인가** (대본 ①칸).
 *
 * WHY 와 다르다. WHY 는 "거기서 무슨 일이 생기는가"라 길고, 여기는 길의 인상 한 마디다.
 * ACTION·WHY 와 같은 이유로 출처가 필요 없다 — 그 종류의 길이 어떤 느낌인지를 말할 뿐이고,
 * 이 길에 그게 있다는 근거는 risk.source 가 댄다.
 */
/**
 * 요인 종류별 — 그래서 **어떻게 하면 되는지** (대본 ③칸).
 *
 * 위 ACTION 을 그대로 못 쓴다. 저건 화면(근거 카드)이 함께 쓰는 문구라 "~합니다" 체이고
 * 길다 — 소리로 내면 낭독처럼 들린다. 여기는 옆에서 툭 알려주는 한 마디여야 한다.
 * ACTION 을 고치면 화면 글까지 말투가 바뀌므로 건드리지 않고 짧은 판을 따로 둔다.
 *
 * 내용은 ACTION 과 **같은 말이어야 한다.** 다르게 적으면 화면과 음성이 서로 다른 운전 조언을
 * 하게 된다 — 틀린 운전 조언은 틀린 숫자보다 위험하다(ACTION 주석).
 */
const 행동: Record<RiskType, string> = {
  accidentZone: "앞차와 거리를 평소보다 넉넉히 두세요.",
  sharpCurve: "커브 들어가기 전에 미리 속도를 줄이세요.",
  narrowRoad: "마주 오는 차가 있으면 넓은 데서 미리 기다렸다 지나가세요.",
  steepSlope: "긴 내리막에선 엔진브레이크를 같이 쓰세요.",
  complexJunction: "갈 방향 차로를 미리 잡아두세요.",
  highSpeed: "주변 차 속도에 무리해서 맞추지 마세요. 2차로가 편해요.",
};

const 성격: Record<RiskType, string> = {
  accidentZone: "차가 갑자기 서는 구간이 있어요.",
  sharpCurve: "굽이가 이어지는 산길이에요.",
  narrowRoad: "중간중간 폭이 좁아져요.",
  steepSlope: "내리막이 길게 이어져요.",
  complexJunction: "차로가 갈라지는 데가 많아요.",
  highSpeed: "큰길 위주라 주변 차가 빨라요.",
};

/**
 * 그 경로에서 부담이 가장 큰 요인.
 *
 * breakdown 을 route 로 먼저 좁혀야 한다 — 요인 이름이 양쪽에 같으면(좁은 교행 구간 등)
 * factor 만으로 찾다가 늘 fast 행이 잡힌다. 실제로 그렇게 틀렸던 자리다.
 *
 * ponytail: verdict() 와 briefing() 이 같은 일을 각자 인라인으로 한다. 그쪽이 손대는 중이라
 * 건드리지 않았다 — 정리할 때 셋 다 이 함수로 모으면 된다.
 */
function 최대요인(
  result: ScoreResult,
  id: "fast" | "safe",
  risks: RiskFactor[],
): RiskFactor | undefined {
  return result.breakdown
    .filter((b) => b.route === id)
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => risks.find((r) => r.label === b.factor))
    .find((r): r is RiskFactor => !!r);
}

/** 대본 ④칸 — 도착해서 차를 댈 곳. */
function 도착말(a: ArrivalFacts): string {
  const 조각: string[] = [];
  // 금액은 말하지 않는다. 귀로 들어서 할 수 있는 일이 없고 화면 카드가 이미 보여준다.
  조각.push(a.요금 === "무료" ? `${a.주차장}은 무료예요.` : `${a.주차장}에 대시면 돼요.`);
  if (a.주차형태)
    조각.push(
      // 확인됨=false 는 주차장유형으로 **추정**한 값이다. 단정하면 초보에게 정반대 방법을
      // 가르치게 된다 — 화면(app/parking/detail)이 쓰는 세기와 같은 말로 맞춘다.
      a.주차형태.확인됨
        ? `${a.주차형태.형태} 자리라 대는 법 미리 보고 가세요.`
        : `${a.주차형태.형태}일 가능성이 높으니 대는 법 미리 보고 가세요.`,
    );
  if (a.목적지까지도보분 != null) 조각.push(`목적지까진 걸어서 ${a.목적지까지도보분}분이에요.`);
  return 조각.join(" ");
}

type RadioRoute = RouteLike & { id: "fast" | "safe" };

/**
 * 출발 전 음성 안내 대본 3~4칸 — AI 대본(lib/ai.ts 의 radio)을 못 받았을 때 쓴다.
 *
 * 칸 구성은 AI 쪽과 같다: ①성격 ②추천이유 ③각오할것 ④도착.
 * 같아야 재생 컴포넌트가 어느 쪽이 왔는지 모르고도 같은 하이라이트를 그린다.
 *
 * 대본이 AI 것보다 밋밋한 건 맞다. 이 함수의 일은 AI만큼 잘 쓰는 게 아니라
 * **인터넷이 끊겨도 소리가 나게** 하는 것이다.
 */
export function radioScript(
  profile: DriverProfile,
  result: ScoreResult,
  route: RadioRoute,
  /** 상대 경로. 없으면(대안 없는 구간) ②는 비교 없이 이 길 얘기만 한다 */
  other: RadioRoute | null,
  /** 도착지 주차장. 없으면 ④칸을 쓰지 않는다 — 모르는 걸 지어내지 않는다 */
  arrival?: ArrivalFacts,
): string[] {
  const top = 최대요인(result, route.id, route.risks);

  /*
   * ① 누구에게 하는 말인지 + 이 길이 어떤 길인지.
   *
   * 이름에서 "경유"를 떼고 "타고"로 잇는다. 이름이 "평화로 경유" 꼴이라 그대로 쓰면
   * "평화로 경유로 가는 길"이 되고, 뗀 뒤에 "로"를 붙이면 "평화로로"가 된다 —
   * 도로 이름은 대개 -로 로 끝나서 조사를 붙이는 길이 다 어색하다. "타고"는 받침을 안 탄다.
   */
  const 길이름 = route.name.replace(/\s*경유$/, "");
  const 호명 = 호명말(profile);
  const 첫칸 =
    `${호명 ? `${호명} ` : ""}${길이름} 타고 갈게요. ` +
    (top ? 성격[top.type] : "특별히 신경 쓸 구간은 없어요.");

  // 상대보다 몇 분 빠른가. 양수면 이 길이 빠르다 (verdict 의 부호와 같다)
  const 분 =
    route.durationMin != null && other?.durationMin != null
      ? other.durationMin - route.durationMin
      : null;

  // ② 왜 이 길인지. 추천 여부로 세 갈래다 (lib/ai.ts RULES 의 radio ②와 같은 규칙).
  let 둘째칸: string;
  if (result.recommendedRoute === "single")
    // tie 와 unclear 를 가르는 규칙은 한 곳에서만 정한다 (못고른말). 다만 저건 읽는 글 말투라
    // 여기서는 같은 뜻을 듣는 말로 다시 쓴다. unclear 는 화면과 똑같이 **아무 말도 안 한다** —
    // 빈 칸은 아래에서 빠지므로 대본이 한 칸 짧아진다.
    둘째칸 =
      result.noPick === "tie" ? "두 길이 비슷해요. 그럼 시간이 짧은 쪽이 나아요." : "";
  else if (result.recommendedRoute === route.id)
    둘째칸 =
      분 != null && 분 > 0
        ? `긴장할 구간이 적어서 이 길로 골랐어요. ${분}분 빠르기도 해요.`
        : "긴장할 구간이 적어서 이 길로 골랐어요.";
  // 추천하지 않은 길을 고른 사람에게 하는 말이다. **되돌리려 하지 않는다** —
  // 이미 고르고 출발하려는 참이고, 여기서 설득하면 남는 건 불안뿐이다.
  // "부담이 크다"고 하지 않고 "익숙한 사람에게 맞다"고 한다: 같은 사실인데 나무라지 않는다.
  else
    둘째칸 =
      분 != null && 분 > 0
        ? `시간은 짧지만 긴장 구간이 더 많아요. ${분}분 아끼는 대신이에요.`
        : "익숙한 운전자에게 알맞은 선택이에요.";

  return [
    첫칸,
    둘째칸,
    // ③ 각오할 것 하나. "왜 힘든가"는 ①이 이미 한 마디로 말했으니 되풀이하지 않고
    // 어떻게 하면 되는지만 남긴다 — 귀로는 짧은 쪽이 남는다.
    ...(top ? [행동[top.type]] : []),
    ...(arrival ? [도착말(arrival)] : []),
  ].filter(Boolean);
}
