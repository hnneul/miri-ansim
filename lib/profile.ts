// 프로필 ↔ URL 쿼리 변환. 온보딩(/onboarding)·메인화면(/home)·마이(/profile)가 공유한다.
//
// 프로필을 URL에 담는 이유: 결과 링크를 그대로 공유·재현할 수 있고, 새로고침에도
// 안 날아간다. 대신 URL은 사용자가 손으로 고칠 수 있는 입력이므로 값 검증이 필수다 —
// 여기가 유일한 신뢰 경계다.

import { EXP_LABEL, type DriverProfile, type RiskType } from "./score.ts";
import type { LatLng } from "@/app/RouteMap";

/**
 * 값이 없거나 URL이 망가졌을 때 되돌아갈 프로필.
 * 부담이 가장 큰 쪽(초보·저빈도·경차)으로 잡는다 — 모르는 값을 "익숙한 운전자"로 가정하면
 * 가중치가 빠져 위험이 과소 계상된다. 안전은 보수적인 쪽으로 틀리는 게 맞다.
 */
export const DEFAULT_PROFILE: DriverProfile = {
  experienceYears: 1,
  drivingFrequency: "low",
  jejuExperience: false,
  vehicleSize: "compact",
  timeOfDay: "day",
};

/** 폼 선택지 = 허용값. 화면에 없는 값이 URL로 들어오면 받지 않는다. */
export const OPTIONS = {
  experienceYears: [1, 3, 10],
  drivingFrequency: ["low", "medium", "high"],
  vehicleSize: ["compact", "sedan", "suv"],
  timeOfDay: ["day", "night"],
} as const;

/**
 * 값 → 화면에 쓰는 말. 마이 화면(app/profile)이 URL에서 읽은 값을 되읽어 준다.
 */
export const LABELS = {
  /** 익숙함 티어. 점수 가중치와 같은 말을 써야 해서 lib/score.ts 것을 그대로 가져온다 */
  experienceYears: EXP_LABEL,
  // drivingFrequency 는 화면에 안 쓴다 — 익숙함 티어가 같은 대답을 이미 보여준다 (app/profile)
  vehicleSize: { compact: "경차", sedan: "중형", suv: "대형" },
  timeOfDay: { day: "주간", night: "야간" },
};

/**
 * 프로필 아바타. 파일명이 experienceYears 값(OPTIONS)이라 매핑이 표 하나로 끝난다 —
 * 익숙함 티어(EXP_LABEL 왕초보·초보·익숙)마다 그림이 갈린다: 풋귤이 겁먹은 얼굴로 라바콘 옆에 앉아 있고,
 * 다음은 감귤이 핸들을 잡고, 마지막은 노란 귤이 열쇠를 들고 선다 (Figma "프로필 별 이미지" 4122:596).
 * alt 는 티어 이름을 그대로 읽어 준다 — 그림이 뜻하는 건 과일 종류가 아니라 운전 익숙함이라
 * "씨앗/새싹" 같은 별명은 화면 어디에도 안 적혀 있어 스크린리더에서만 겉돈다.
 * 원형 아바타가 뜨는 세 자리가 같이 쓴다: 마이 화면(app/profile), 메인화면(app/home) 오른쪽 위
 * 마이 버튼, 여행 기록 머리글(app/trip/record). 한 사람의 프로필이 화면마다 갈리면 안 된다.
 * 배경이 그려진 정사각 PNG 라 원을 꽉 채우게 object-cover 로 담는다 — 뒤에 색을 깔 필요가 없다.
 * 배경을 지운 컷(같은 섹션 아래줄)도 있지만 안 쓴다, 세 자리 다 배경 있는 원형 아바타라
 * 두 벌을 둘 이유가 없다.
 */
export const CHARACTERS: Record<number, { src: string; alt: string; tier: string }> = {
  1: { src: "/character/exp1.png", alt: "왕초보 캐릭터", tier: "1년 이하" },
  3: { src: "/character/exp3.png", alt: "초보 캐릭터", tier: "2~5년" },
  10: { src: "/character/exp10.png", alt: "익숙 캐릭터", tier: "5년 이상" },
};

/** 허용값 밖이면 왕초보 쪽으로 떨어뜨린다 (DEFAULT_PROFILE 과 같은 방향 — 모르면 부담 큰 쪽) */
export const characterOf = (experienceYears: number) => CHARACTERS[experienceYears] ?? CHARACTERS[1];

/**
 * 부담 유형 — 온보딩 4단계(여러 개 선택)에서 고르는 값.
 * 고른 인덱스를 쿼리 hard=0,4 로 실어 세 곳에 쓴다: 마이 화면에 되보여 주고,
 * CONCERN_RISK 로 실제 데이터가 있는 위험 타입에 매핑해 점수 가중치에 태우며,
 * 길 비교의 AI 대본에도 사용한다.
 * short 는 카드 한 줄에 넣을 짧은 말이다 ("어려움: 좁은 길 · 주차").
 *
 * **라벨에 숫자를 넣지 않는다.** 프롬프트에 그대로 실리는데, AI 검증(lib/ai.ts
 * 숫자가사실에있나)이 프롬프트에 있는 숫자를 사실로 치므로 모델이 그걸 문장에 쓸 수 있다.
 */
export const CONCERNS = [
  { label: "좁은 골목길", desc: "차가 마주 오면 불안해요", short: "좁은 길" },
  { label: "복잡한 교차로", desc: "차선 선택이 어려워요", short: "교차로" },
  { label: "급경사·굽은 길", desc: "오르막·커브가 부담돼요", short: "경사·커브" },
  { label: "어두운 길", desc: "가로등이 적으면 긴장돼요", short: "야간" },
  { label: "주차 어려운 곳", desc: "공간이 좁으면 부담돼요", short: "주차" },
  { label: "해당 없음", desc: "특별히 부담 없어요", short: "없음" },
];

/**
 * 부담 유형(CONCERNS 인덱스) → 실제 점수 데이터가 있는 위험 타입.
 * 복잡한 교차로·급경사·주차는 현재 경로 점수 데이터가 없어 억지로 다른 값에 붙이지 않는다.
 * 어두운 길은 조명 데이터가 없어 곡률로 대신하므로, 급커브가 있을 때만 가중치가 적용된다.
 */
export const CONCERN_RISK: Record<number, RiskType[]> = {
  0: ["narrowRoad"],
  2: ["sharpCurve"],
  3: ["sharpCurve"],
};

/** 고른 부담 유형 인덱스들 → 위험 타입 목록(중복 제거). 대응 없는 유형(주차·없음)은 자연히 빠진다. */
export const fearedRisksOf = (concerns: number[]): RiskType[] => [
  ...new Set(concerns.flatMap((i) => CONCERN_RISK[i] ?? [])),
];

/** ?key=value&key=value 형태에서 같은 키가 여러 번 오면 첫 값을 쓴다. 결과 페이지도 같은 규칙을 쓴다. */
export const oneOf = (sp: Record<string, string | string[] | undefined>, k: string) =>
  Array.isArray(sp[k]) ? sp[k][0] : sp[k];

/** URL 쿼리 → 프로필. 값이 없거나 허용 목록 밖이면 기본값으로 되돌린다. */
export function parseProfile(sp: Record<string, string | string[] | undefined>): DriverProfile {
  const pick = <T extends readonly (string | number)[]>(k: string, allowed: T, fallback: unknown) => {
    const raw = oneOf(sp, k);
    const v = typeof allowed[0] === "number" ? Number(raw) : raw;
    return ((allowed as readonly unknown[]).includes(v) ? v : fallback) as T[number];
  };

  // 긴장되는 길 → 위험 타입. 비면 키째 뺀다 — DEFAULT_PROFILE 에도 이 키가 없어, 빈 쿼리와
  // 부담 유형 없는 왕복이 프로필과 그대로 deepEqual 로 맞는다 (profile.check.ts 신뢰 경계 테스트).
  const feared = fearedRisksOf(parseConcerns(sp));

  return {
    experienceYears: pick("exp", OPTIONS.experienceYears, DEFAULT_PROFILE.experienceYears),
    drivingFrequency: pick("freq", OPTIONS.drivingFrequency, DEFAULT_PROFILE.drivingFrequency),
    // 불리언은 "true"만 참으로 본다 — 오타가 "경험 있음"으로 새면 부담을 과소 계상한다
    jejuExperience: oneOf(sp, "jeju") === "true",
    vehicleSize: pick("car", OPTIONS.vehicleSize, DEFAULT_PROFILE.vehicleSize),
    timeOfDay: pick("time", OPTIONS.timeOfDay, DEFAULT_PROFILE.timeOfDay),
    ...(feared.length ? { fearedRisks: feared } : {}),
  };
}

const profileParams = (profile: DriverProfile) => ({
  exp: String(profile.experienceYears),
  freq: profile.drivingFrequency,
  jeju: String(profile.jejuExperience),
  car: profile.vehicleSize,
  time: profile.timeOfDay,
});

/** 프로필만 → "?exp=1&freq=low&..." — 온보딩(/onboarding)이 고른 값을 메인화면(/home)에 넘길 때 쓴다. */
export function toProfileQuery(profile: DriverProfile, concerns: number[] = []): string {
  const params = new URLSearchParams(profileParams(profile));
  // 안 고르면 키째 빼서 URL 을 짧게 둔다 — parseConcerns 가 없는 키를 빈 배열로 읽는다
  if (concerns.length) params.set("hard", concerns.join(","));
  return `?${params}`;
}

/**
 * URL 쿼리 → 부담 유형 인덱스. parseProfile 과 같은 이유로 여기가 신뢰 경계다 —
 * 정수 아닌 값·범위 밖·중복은 버린다. 화면 순서대로 보이게 정렬한다.
 */
export function parseConcerns(sp: Record<string, string | string[] | undefined>): number[] {
  const raw = oneOf(sp, "hard");
  if (!raw) return [];
  // 숫자만 남기고 나서 Number 를 태운다 — Number("") 도 Number(" ") 도 0 이라
  // "hard=1," 의 꼬리 쉼표가 인덱스 0("좁은 골목길")으로 새어 안 고른 값이 화면에 뜬다.
  const picked = raw
    .split(",")
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((i) => i < CONCERNS.length);
  return [...new Set(picked)].sort((a, b) => a - b);
}

/** 프로필 + 구간 → "?exp=1&freq=low&..." */
export function toQuery(profile: DriverProfile, scenarioId: string): string {
  return `?${new URLSearchParams({ route: scenarioId, ...profileParams(profile) })}`;
}

/**
 * 프로필 + 출발지 + 목적지 텍스트 → "?originText=..&dest=..&exp=1&...". 임의 구간용.
 * 출발지는 직접 입력한 지명 또는 현재 위치 좌표를 받을 수 있다.
 */
export function toCustomQuery(profile: DriverProfile, origin: LatLng | string, destination: string): string {
  const originParams: Record<string, string> =
    typeof origin === "string"
      ? { originText: origin }
      : { originLat: String(origin[0]), originLng: String(origin[1]) };
  return `?${new URLSearchParams({ ...originParams, dest: destination, ...profileParams(profile) })}`;
}
