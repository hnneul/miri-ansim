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

export type RiskType =
  | "accidentZone"
  | "sharpCurve"
  | "narrowRoad"
  | "steepSlope"
  | "complexJunction"
  | "highSpeed";

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
};

export type ScoreResult = {
  recommendedRoute: "fast" | "safe" | "single";
  /**
   * 추천을 접은 이유. **single 이 성격이 다른 두 경우를 뭉치고 있어서** 필요하다.
   *
   *   tie     — 부담이 사실상 같다 (5% 이내). 고를 것도 없다.
   *   unclear — 차이는 있는데(추천점수로 32 vs 43) 단정할 만큼은 아니다. 시간과 맞바꿔야 한다.
   *
   * 이걸 안 남기면 화면이 둘을 같은 문장으로 말하게 되고, 실제로 그랬다 —
   * 뚜렷이 다른 두 점수를 두고 "부담이 비슷합니다"라고 적고 있었다. 추천이 있으면 null 이다.
   */
  noPick: "tie" | "unclear" | null;
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
  accidentZone: 15,
  sharpCurve: 12,
  narrowRoad: 10,
  steepSlope: 8,
  complexJunction: 6,
  highSpeed: 5,
};

/** 판정 분기가 쓰는 값 — **부담** 기준이다 (이하면 편안) */
export const COMFORT_THRESHOLD = 50;

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

export const exposureFactor = (exposure: number) =>
  Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, exposure / EXPOSURE_REFERENCE));

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
const EXP_WEIGHT: Record<number, number> = { 1: 1.6, 3: 1.2, 10: 1 };

/** 티어 이름. 근거 카드와 마이 화면(lib/profile.ts LABELS)이 같은 말을 쓰도록 여기 하나만 둔다. */
export const EXP_LABEL: Record<number, string> = { 1: "왕초보", 3: "초보", 10: "익숙" };

/** 허용값 밖이면 왕초보 쪽으로 (lib/profile.ts characterOf 와 같은 규칙 — 모르면 부담 큰 쪽) */
const expWeightOf = (p: DriverProfile) => EXP_WEIGHT[p.experienceYears] ?? EXP_WEIGHT[1];

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
    const exposure = round2(exposureFactor(r.exposure));
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
 * 뜻을 잃기 때문이다 — 부담 30% 감소(`safe < fast * 0.7`)는 추천점수 공간에서 상수 비율이
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

  // 부담이 사실상 같으면 어느 쪽도 추천하지 않는다. 0.1점 차이를 "저부담"이라 부르면
  // 사용자는 없는 차이를 믿고 길을 고른다 (실측: 공항→성산 35.9 vs 36).
  const 무의미한차이 =
    Math.abs(fast.total - safe.total) <=
    Math.max(fast.total, safe.total) * 0.05;

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
        : safe.total < fast.total * 0.7
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

  const lead = 무의미한차이
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
      recommendedRoute !== "single" ? null : 무의미한차이 ? "tie" : "unclear",
    fastScore,
    safeScore,
    reasons,
    breakdown: [
      ...fast.rows.map((r) => ({ route: "fast" as const, ...r })),
      ...safe.rows.map((r) => ({ route: "safe" as const, ...r })),
    ],
  };
}
