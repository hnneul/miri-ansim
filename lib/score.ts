// 주행 추천점수 엔진 — PLAN.md §5
// 결정론적: 같은 입력이면 언제나 같은 출력. AI는 이 결과를 문장으로 옮길 뿐 재계산하지 않는다.
//
// **안쪽은 부담(낮을수록 좋음), 바깥은 추천점수(높을수록 좋음)다.**
// 요인을 더해 부담을 쌓는 계산도, 어느 길을 추천할지 고르는 분기도 전부 부담으로 한다.
// 뒤집는 자리는 아래 추천점수() 한 곳뿐이고, ScoreResult 로 나가는 순간부터는 추천점수다.
// 안쪽까지 뒤집지 않는 이유는 그 함수 주석에 적었다.

export type DriverProfile = {
  experienceYears: number;
  drivingFrequency: "low" | "medium" | "high";
  jejuExperience: boolean;
  vehicleSize: "compact" | "sedan" | "suv";
  timeOfDay: "day" | "night";
};

/**
 * 점수에 실리는 위험요인. **여기 있는 것은 전부 실제 경로에서 나온다** (lib/route.ts risksOf).
 *
 * 한동안 사고다발지(15) · 급경사(8) · 복잡한 교차로(6)가 여기 함께 적혀 있었다.
 * 자리만 잡아두고 데이터를 못 채운 값들이라 실제 경로에서는 한 번도 나오지 않았는데,
 * 점수표·브리핑 문구 네 벌·마이 화면·검증 더미까지 다섯 군데를 따라다녔다.
 * 폐기 사유는 lib/scenario.ts 머리말에 남겼다 — 되살릴 때 그 판단부터 다시 본다.
 */
export type RiskType = "sharpCurve" | "narrowRoad" | "highSpeed";

export type RiskFactor = {
  type: RiskType;
  label: string;
  location: string;
  coord: [number, number];
  value: string;
  /**
   * 이 요인이 경로에서 차지하는 비율 (0~1).
   * 부담은 노출 길이에 비례한다 — 좁은 길 13.1km와 1.6km가 같은 점수가 되면 안 된다.
   * 요인마다 단위가 다르면(개수 vs km) 비교가 불가능하므로 전부 연장 비율로 통일한다.
   */
  exposure: number;
  source: string; // ★ 필수 — 출처 없으면 데이터에 못 들어감
  /**
   * 이 요인이 실제로 깔린 구간 — 지도에 경로선 위로 겹쳐 그릴 선들 (lib/analyze.ts spansOf).
   *
   * coord 하나만 있을 때는 지도가 그걸 그리지도 않았고, 그렸어도 "여기 한 군데"로 읽혔다 —
   * 실측에서 좁은 구간은 13.8km 였고 두 도로에 흩어져 있었다. 그래서 점이 아니라 선 여러 개다.
   *
   * **선택이다.** 검증용 더미 요인에는 없다 — 없으면 지도가 그냥 안 그린다.
   * 실제 경로에서는 세 요인 다 실린다 (lib/route.ts risksOf).
   */
  spans?: [number, number][][];
};

export type ScoreResult = {
  recommendedRoute: "fast" | "safe" | "single";
  /**
   * 추천을 접은 이유. **single 이 성격이 다른 두 경우를 뭉치고 있어서** 필요하다.
   *
   *   alone   — 비교할 상대가 없다. 대안 경로가 접힌 구간이라 카드가 한 장뿐이다.
   *   tie     — 부담이 사실상 같다 (5% 이내). 고를 것도 없다.
   *   unclear — 차이는 있는데(추천점수로 32 vs 43) 단정할 만큼은 아니다. 시간과 맞바꿔야 한다.
   *
   * **alone 을 tie 로 뭉치면 안 된다.** 부르는 쪽이 같은 경로를 양쪽에 넣어 오므로
   * (app/route/actions.ts) 차이가 0이라 tie 로 떨어지는데, 그러면 화면과 대본이 길이 한 장인
   * 자리에서 "두 길의 부담이 거의 같습니다"라고 말한다 — 없는 길을 있다고 하는 문장이다.
   *
   * 이걸 안 남기면 화면이 둘을 같은 문장으로 말하게 되고, 실제로 그랬다 —
   * 뚜렷이 다른 두 점수를 두고 "부담이 비슷합니다"라고 적고 있었다. 추천이 있으면 null 이다.
   */
  noPick: "alone" | "tie" | "unclear" | null;
  /** 추천점수 — **높을수록 권할 만한 길**이다. 아래 breakdown 의 요인 점수와 방향이 반대다 */
  fastScore: number;
  safeScore: number;
  reasons: string[];
  // PLAN.md §4 그대로. factor는 RiskFactor.label이며,
  // 근거 카드는 이 이름으로 Route.risks를 되짚어 위치·수치·출처를 가져온다.
  // **여기 점수는 뒤집지 않는다 — 추천점수에서 깎인 몫(감점)이라 클수록 나쁜 게 맞다.**
  // 급커브가 부담스럽다는 사실은 총점을 어느 방향으로 세든 그대로다.
  // 점수는 기본 × 노출 × 프로필 세 요소의 곱이므로 셋을 따로 담는다 —
  // weighted 하나만 주면 근거 카드가 곱셈식을 복원할 수 없다.
  breakdown: {
    route: "fast" | "safe";
    factor: string;
    base: number;
    exposure: number; // 노출 배수 (기준 노출 대비)
    multiplier: number; // 프로필 가중치
    weighted: number;
  }[];
};

/** 기준 노출(20%)에서의 점수. 실제 노출이 그보다 크면 점수도 커진다. */
export const BASE_SCORE: Record<RiskType, number> = {
  sharpCurve: 12,
  narrowRoad: 10,
  highSpeed: 5,
};

/** 판정 분기가 쓰는 값 — **부담** 기준이다 (이하면 편안) */
export const COMFORT_THRESHOLD = 50;

/**
 * 빠른 길이 실제로 빠를 때, **안심 길이 이만큼은 덜 부담스러워야** 추천을 받는다.
 * 0.8 = 부담 20% 감소.
 *
 * 0.7(30% 감소)이었는데 너무 빡셌다. 제주공항→매일올레시장 실측이 부담 66 대 52 로
 * 14점(21%) 차인데도 문턱을 못 넘어 "추천 없음"으로 떨어졌다 — 100점 만점에 14점이면
 * 화면에서 한눈에 갈리는 차이인데 앱만 판단을 미룬 셈이었다. 그렇게 되면 추천 배지도
 * "맞춤" 이름도 거의 안 뜬다.
 *
 * 더 낮추지는 않는다. 이 값이 작아질수록 "조금 덜 부담스러운 쪽"을 추천이라 부르게 되고,
 * 그건 아래 무의미한차이(5%) 규칙이 막으려던 것과 같은 잘못이다.
 */
export const SAFE_MARGIN = 0.8;

/**
 * 두 경로의 부담이 "사실상 같다"고 볼 차이 (큰 쪽 대비 비율).
 * 0.1점 차이를 "저부담"이라 부르면 사용자는 없는 차이를 믿고 길을 고른다
 * (실측: 공항→성산 35.9 vs 36). 마이 화면의 계산 기준 페이지도 이 값을 읽어 적는다.
 */
export const TIE_RATIO = 0.05;

/**
 * 화면이 "높음/낮음"을 가르는 값 — **추천점수** 기준이다 (이상이면 높음).
 *
 * 같은 선을 반대편에서 본 것이라 지금은 숫자가 우연히 50으로 같다. 그렇다고 화면에서
 * COMFORT_THRESHOLD 를 그대로 쓰면, 편안 임계값을 45로 옮기는 날 화면만 조용히 틀린다.
 */
export const RECOMMEND_THRESHOLD = 100 - COMFORT_THRESHOLD;

/**
 * 노출 비율 20%를 기준 1.0으로 본다.
 * 상·하한을 두는 이유: 노출 2%짜리 요인이 0.1배로 사라지면 근거 카드에서 없는 것처럼 보이고,
 * 반대로 100% 노출이 5배가 되면 한 요인이 총점을 독점한다.
 */
export const EXPOSURE_REFERENCE = 0.2;
const EXPOSURE_MIN = 0.25;
const EXPOSURE_MAX = 2.5;

/**
 * 요인별 노출 상한. **고속주행만 1.0으로 눌러둔다.**
 *
 * 노출 비례는 "오래 노출될수록 더 부담"을 전제한다. 좁은 길·급커브는 그게 맞다 —
 * 교행 13km가 1.6km보다 확실히 힘들다. 고속주행은 반대다. 큰길은 오래 달릴수록
 * 오히려 적응하고, 부담은 달린 거리가 아니라 합류하는 횟수에 붙는다.
 *
 * 제주에는 고속도로가 없어서 제한속도 80 링크는 657개뿐이고 그게 전부 평화로·애조로·
 * 중산간서로·한창로다 — 신호도 보행자도 없는 넓은 길이다. 그런데 이 길들을 타면 경로의
 * 절반을 차지하니 노출배수가 상한 2.5에 붙어, 왕초보 기준 24점이 깎이고 있었다.
 * 실측에서 평화로 경유 경로들이 그 한 요인 때문에 43~66점까지 떨어졌고, 산방산은
 * 부담이 COMFORT_THRESHOLD 를 넘겨 추천 배지 자체가 사라졌다.
 *
 * **0으로 만들지는 않는다.** 왕초보가 80km/h 흐름에 처음 끼어드는 부담은 실재한다.
 * 없애면 근거 카드에서 줄이 사라져 "왜 이 경로인지"를 설명하지 못한다.
 * 상한 1.0 은 "빠른 길을 탄다"는 사실에 기준 노출만큼 한 번 값을 매긴다는 뜻이다.
 */
export const EXPOSURE_CAP: Partial<Record<RiskType, number>> = { highSpeed: 1 };

export const exposureFactor = (exposure: number, type: RiskType) =>
  Math.min(
    EXPOSURE_CAP[type] ?? EXPOSURE_MAX,
    Math.max(EXPOSURE_MIN, exposure / EXPOSURE_REFERENCE),
  );

/**
 * 프로필 가중치(곱). 차량 크기는 좁은 교행로에만 걸린다 — 차가 크다고 급커브가 더 위험하진 않다.
 *
 * vehicleSize는 차종이 아니라 차폭 구간이다 — "suv"는 대형(쏘렌토 1.90m급 이상)을 뜻한다.
 * 차종으로 나누면 역전이 생긴다: 캐스퍼(경형 SUV) 1.60m < 쏘나타(중형 세단) 1.86m.
 * 입력 화면의 라벨과 근거 카드 문구가 이 의미를 따라야 한다.
 *
 * 고속주행은 경력이 쌓이면 부담이 크게 줄지만 0이 되지는 않는다.
 * 요인을 아예 제거하면 근거 카드가 한 줄로 비어 "왜 이 경로인지"를 설명하지 못한다.
 */
/**
 * 초보 판정. 가중치와 주차 안내가 같은 기준을 써야 한다 —
 * 임계값을 양쪽에 따로 박아두면 한쪽만 바뀌어 화면이 서로 다른 말을 한다.
 */
export const isNovice = (p: DriverProfile) => p.experienceYears <= 1;

/**
 * 익숙함 티어 — 온보딩 1단계가 묻는 자기 인식이다. 키는 OPTIONS.experienceYears 의 세 값.
 *
 * 전에는 이 자리가 isNovice 불리언이라 초보(3)와 익숙(10)이 점수상 완전히 같았다.
 * 셋으로 나눠 물어놓고 둘로만 계산하면 가운데를 고른 사람은 고른 값이 아무 데도 안 쓰인다.
 *
 * **1.0 아래로 내리지 않는다.** 익숙하다고 부담이 사라지는 게 아니라 그 사람이 기준이 될 뿐이다.
 * 전역 할인을 주면 실제로 위험한 길이 익숙한 사람에게만 조용히 안전해 보인다 —
 * 경력으로 깎는 건 고속주행 하나뿐이고, 그건 아래에서 요인별로 건다.
 */
export const EXP_WEIGHT: Record<number, number> = { 1: 1.6, 3: 1.2, 10: 1 };

/** 티어 이름. 근거 카드와 마이 화면(lib/profile.ts LABELS)이 같은 말을 쓰도록 여기 하나만 둔다. */
export const EXP_LABEL: Record<number, string> = { 1: "왕초보", 3: "초보", 10: "익숙" };

/** 허용값 밖이면 왕초보 쪽으로 (lib/profile.ts characterOf 와 같은 규칙 — 모르면 부담 큰 쪽) */
export const expWeightOf = (p: DriverProfile) => EXP_WEIGHT[p.experienceYears] ?? EXP_WEIGHT[1];

/**
 * drivingFrequency 는 여기서 안 쓴다. 온보딩이 빈도를 따로 묻지 않고 티어 한 문항에서
 * 함께 정하므로, 곱하면 같은 대답 하나가 두 번 걸려 맨 아래 티어만 ×1.69 로 부푼다.
 * 그 값은 이제 브리핑 말투에만 쓴다 (lib/briefing.ts 조건말).
 */
function weight(type: RiskType, p: DriverProfile): number {
  let w = expWeightOf(p);
  if (!p.jejuExperience) w *= 1.2;
  if (p.timeOfDay === "night") w *= 1.15;
  if (type === "narrowRoad" && p.vehicleSize === "suv") w *= 1.4;
  if (type === "highSpeed" && p.experienceYears > 1) w *= 0.4;
  return w;
}

/** 근거 카드 머리말용 — 지금 켜져 있는 가중치 조건 목록 */
export function activeWeights(p: DriverProfile): string[] {
  const out: string[] = [];
  // 숙련은 ×1 이라 적지 않는다 — 곱해도 안 변하는 줄은 근거가 아니다
  const ew = expWeightOf(p);
  if (ew !== 1) out.push(`익숙함 ${EXP_LABEL[p.experienceYears] ?? EXP_LABEL[1]} ×${ew}`);
  if (!p.jejuExperience) out.push("제주 운전경험 없음 ×1.2");
  if (p.timeOfDay === "night") out.push("야간 주행 ×1.15");
  if (p.vehicleSize === "suv") out.push("대형 차량 ×1.4 (좁은 교행로에만)");
  if (p.experienceYears > 1) out.push("경력 1년 초과 ×0.4 (고속주행에만)");
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function scoreRoute(risks: RiskFactor[], p: DriverProfile) {
  const rows = risks.map((r) => {
    const base = BASE_SCORE[r.type];
    const exposure = round2(exposureFactor(r.exposure, r.type));
    const multiplier = round2(weight(r.type, p));
    return {
      factor: r.label,
      base,
      exposure,
      multiplier,
      weighted: round1(base * exposure * multiplier),
    };
  });
  // 합계는 반올림된 값들의 합 — 근거 카드의 숫자가 총점과 어긋나지 않게
  return { total: round1(rows.reduce((s, r) => s + r.weighted, 0)), rows };
}

/**
 * 경로 하나의 **부담**. 화면에 나가는 추천점수가 아니다 — 낮을수록 좋은 값이고,
 * 고르는 쪽(routesFor)이 최솟값을 집는다. 뒤집을 이유가 없어 그대로 둔다.
 *
 * 후보가 셋일 때 어느 것을 "안심 길" 자리에 앉힐지 고르는 데 쓴다 (lib/route.ts routesFor).
 * 아래 scoreRoutes 는 **두 개를 받아 비교**하는 함수라, 셋 중 하나를 고르는 일에는 못 쓴다.
 * 순위는 프로필에 따라 바뀐다 — 초보는 급커브 가중치가 커서 같은 두 길의 순서가 뒤집힌다.
 */
export const burdenOf = (risks: RiskFactor[], p: DriverProfile) =>
  scoreRoute(risks, p).total;

/**
 * 부담 → 추천점수. **뒤집는 자리는 여기 하나뿐이다.**
 *
 * 아래 scoreRoutes 의 비교식은 계속 부담으로 본다. 안쪽까지 뒤집으면 비율로 쓴 두 규칙이
 * 뜻을 잃기 때문이다 — 부담 20% 감소(`safe < fast * SAFE_MARGIN`)는 추천점수 공간에서 상수 비율이
 * 아니고, "큰 값의 5% 이내면 같다"는 규칙은 축이 뒤집히면 판정이 정확히 반대로 뒤집힌다
 * (부담 80 vs 84 는 같다고 보는데, 추천점수 20 vs 16 은 다르다고 본다 — 같은 4점 차이다).
 * 그 두 상수를 다시 정하는 건 점수 이름을 바꾸는 일과 별개다.
 *
 * 반올림이 필요하다: 100 - 22.3 은 77.69999999999999 다.
 * 위험요인이 없으면 100점이고 상한을 눌러두지 않는다 — "확인된 부담 요인 없음"이 그 뜻이다.
 */
const 추천점수 = (부담: number) => Math.max(0, round1(100 - 부담));

type RouteInput = { risks: RiskFactor[]; durationMin: number | null };

export function scoreRoutes(
  profile: DriverProfile,
  fastRoute: RouteInput,
  safeRoute: RouteInput,
): ScoreResult {
  const fast = scoreRoute(fastRoute.risks, profile);
  const safe = scoreRoute(safeRoute.risks, profile);

  // 최단거리 경로가 시간까지 이득인가.
  // 제주공항→서귀포 올레시장 실측에서는 5.16도로가 오히려 5분 느려 항상 false다.
  const fastIsQuicker =
    fastRoute.durationMin != null &&
    safeRoute.durationMin != null &&
    fastRoute.durationMin < safeRoute.durationMin;

  // 양쪽이 **같은 객체**면 비교할 상대가 없는 것이다 — 대안이 접힌 구간에서 부르는 쪽이
  // 한 장을 두 자리에 넣는다 (app/route/actions.ts). 받은 것만 보고 아는 사실이라
  // 여기서 판단한다: 값이 같은 두 경로(tie)와 길이 하나인 것(alone)은 다른 말이다.
  const 홀로 = fastRoute === safeRoute;

  const 무의미한차이 =
    Math.abs(fast.total - safe.total) <=
    Math.max(fast.total, safe.total) * TIE_RATIO;

  // PLAN.md §5 추천 규칙.
  // 시간 이득이 없으면 부담이 큰 경로를 추천할 근거 자체가 없다 —
  // 임계값 분기는 "시간을 얻는 대신 부담을 감수한다"는 교환을 전제로 하기 때문이다.
  //
  // 시간 이득이 없을 때 safe 를 그냥 추천하면 안 된다: 그건 "safe 자리에는 언제나 부담이 낮은
  // 경로가 온다"를 전제한다. 실측에서 부담 36점 경로가 35.9점 경로를 제치고 추천으로 떴다 —
  // 점수를 계산해 놓고 안 보는 분기였다. 여기서도 부담이 낮은 쪽을 직접 고른다.
  //
  // (지금은 lib/route.ts routesFor 가 후보 셋 중 부담 최저를 safe 자리에 앉히므로 대체로 참이지만,
  //  그건 그쪽의 사정이다. 이 함수는 받은 두 개만 보고 판단한다 — 부르는 쪽을 믿지 않는다.)
  const recommendedRoute = 무의미한차이
    ? "single"
    : !fastIsQuicker
      ? safe.total < fast.total
        ? "safe"
        : "fast"
      : fast.total <= COMFORT_THRESHOLD
        ? "fast"
        : safe.total < fast.total * SAFE_MARGIN
          ? "safe"
          : "single";

  const top = [...fast.rows]
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 2);
  const gap =
    fastRoute.durationMin != null && safeRoute.durationMin != null
      ? fastRoute.durationMin - safeRoute.durationMin
      : null;

  // 여기서부터는 바깥에 보일 값이라 추천점수로 말한다 (판정은 위에서 부담으로 이미 끝났다)
  const fastScore = 추천점수(fast.total);
  const safeScore = 추천점수(safe.total);

  const lead = 홀로
    ? `대안 경로가 없는 구간 (추천점수 ${safeScore})`
    : 무의미한차이
    ? `두 경로의 추천점수 차이가 작음 (${fastScore} / ${safeScore})`
    : !fastIsQuicker
      ? gap != null
        ? `최단거리 경로가 ${gap}분 더 걸림 — 시간 이득이 없음 (추천점수 ${fastScore})`
        : `최단거리 경로에 시간 이득이 없음 (추천점수 ${fastScore})`
      : recommendedRoute === "fast"
        ? `빠른 경로 추천점수 ${fastScore} — 추천 임계값 ${RECOMMEND_THRESHOLD} 이상`
        : recommendedRoute === "safe"
          ? `빠른 경로 추천점수 ${fastScore} — 임계값 ${RECOMMEND_THRESHOLD} 미만`
          : `두 경로의 추천점수 차이가 작음 (${fastScore} / ${safeScore})`;

  // 요인 점수는 감점이라 뒤집지 않는다 (breakdown 주석 참고)
  const reasons = [lead, ...top.map((r) => `${r.factor} -${r.weighted}점`)];

  return {
    recommendedRoute,
    noPick:
      recommendedRoute !== "single"
        ? null
        : 홀로
          ? "alone"
          : 무의미한차이
            ? "tie"
            : "unclear",
    fastScore,
    safeScore,
    reasons,
    breakdown: [
      ...fast.rows.map((r) => ({ route: "fast" as const, ...r })),
      ...safe.rows.map((r) => ({ route: "safe" as const, ...r })),
    ],
  };
}
