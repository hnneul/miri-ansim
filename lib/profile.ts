// 프로필 ↔ URL 쿼리 변환. 온보딩(/onboarding)·메인화면(/home)·마이(/profile)가 공유한다.
//
// 프로필을 URL에 담는 이유: 결과 링크를 그대로 공유·재현할 수 있고, 새로고침에도
// 안 날아간다. 대신 URL은 사용자가 손으로 고칠 수 있는 입력이므로 값 검증이 필수다 —
// 여기가 유일한 신뢰 경계다.

import { EXP_LABEL, type DriverProfile } from "./score.ts";
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
 * 경력이 씨앗(1년 이하) → 새싹(2~5년) → 감귤(5년 이상)로 자란다.
 * 메인화면 히어로(app/home)와 결과 화면 프로필 메뉴(app/ProfileMenu.tsx)가 같이 쓴다.
 * 배경을 지운 PNG라(scripts/cutout.swift) 원 안에서 캐릭터만 뜬다 — 비율이 서로 달라 object-contain 으로 담는다.
 */
export const CHARACTERS: Record<number, { src: string; alt: string; tier: string }> = {
  1: { src: "/character/exp1.png", alt: "씨앗 캐릭터", tier: "1년 이하" },
  3: { src: "/character/exp3.png", alt: "새싹 캐릭터", tier: "2~5년" },
  10: { src: "/character/exp10.png", alt: "감귤 캐릭터", tier: "5년 이상" },
};

/** 허용값 밖이면 초보 쪽으로 떨어뜨린다 (DEFAULT_PROFILE 과 같은 방향) */
export const characterOf = (experienceYears: number) => CHARACTERS[experienceYears] ?? CHARACTERS[1];

/**
 * 부담 유형 — 온보딩 4단계(여러 개 선택)에서 고르는 값.
 * 점수에는 아직 안 들어가서 DriverProfile 에 자리가 없다. 그래서 프로필 값과 따로,
 * 고른 인덱스만 쿼리 hard=0,4 로 실어 마이 화면(app/profile)에 되보여 준다.
 * short 는 카드 한 줄에 넣을 짧은 말이다 ("어려움: 좁은 길 · 주차").
 * ponytail: 점수에 반영하려면 lib/score.ts 가중치에 값을 뚫고 DriverProfile 로 옮긴다.
 */
export const CONCERNS = [
  { label: "좁은 골목길", desc: "차가 마주 오면 불안해요", short: "좁은 길" },
  { label: "복잡한 교차로", desc: "차선 선택이 어려워요", short: "교차로" },
  { label: "급경사·굽은 길", desc: "오르막·커브가 부담돼요", short: "경사·커브" },
  { label: "어두운 길", desc: "가로등이 적으면 긴장돼요", short: "야간" },
  { label: "주차 어려운 곳", desc: "공간이 좁으면 부담돼요", short: "주차" },
  { label: "해당 없음", desc: "특별히 부담 없어요", short: "없음" },
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

  return {
    experienceYears: pick("exp", OPTIONS.experienceYears, DEFAULT_PROFILE.experienceYears),
    drivingFrequency: pick("freq", OPTIONS.drivingFrequency, DEFAULT_PROFILE.drivingFrequency),
    // 불리언은 "true"만 참으로 본다 — 오타가 "경험 있음"으로 새면 부담을 과소 계상한다
    jejuExperience: oneOf(sp, "jeju") === "true",
    vehicleSize: pick("car", OPTIONS.vehicleSize, DEFAULT_PROFILE.vehicleSize),
    timeOfDay: pick("time", OPTIONS.timeOfDay, DEFAULT_PROFILE.timeOfDay),
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
