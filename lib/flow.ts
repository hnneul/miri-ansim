// 차 없는 길 — 제주ITS 실시간 교통정보 (api.jejuits.go.kr, 5분 주기)
//
// **왜 혼잡도가 아닌가.** 만들기 전에 하루치 통계를 뽑아 봤다 (getFrafficInfoHourlyStat,
// 2026-08-17 월). 실측속도 ÷ 제한속도가 이렇게 나온다:
//
//   도로       새벽3시  아침8시  낮13시  저녁18시
//   516로       96%     97%     92%     95%
//   평화로       87%     89%     85%     84%
//   일주서로      96%     87%     77%     81%
//   번영로      104%    102%     92%    100%
//   중앙로       63%     60%     50%     51%
//
// 제주 간선은 하루 종일 제한속도의 77~104% 로 흐른다. 피크와 새벽의 차이가 10~19%p 뿐이다.
// "얼마나 막히나"를 화면에 올리면 1년 내내 원활이라 아무 말도 안 하는 칸이 된다.
//
// **그래서 같은 데이터를 뒤집어 쓴다.** 초보가 무서운 건 막히는 게 아니라 옆에 붙는 차라,
// 물어야 할 것은 "얼마나 막히나"가 아니라 **"어느 길에 차가 없나"** 다 (app/calm/page.tsx).
//
// **차 대수는 직접 못 얻는다.** ITS 에 교통량(tfvl)·점유율(ocpy_rate) 필드가 있긴 한데
// 실측으로 289,940건 중 1,439건(0.5%)만 채워져 있고 점유율은 전부 0 이다. 일간 통계 API 는
// 미신청(code not registered)이다. 그래서 속도로 역산한다 — 그 기준선이
// data/road-baseline.json 이다 (scripts/build-road-baseline.mjs).
//
// **카카오가 못 하는 자리라서 붙인다.** 카카오 길찾기는 경로를 알아야 부를 수 있어서
// 목적지가 없는 메인화면에서는 쓸 수 없다. ITS 는 한 번 호출로 제주 전체 링크를 준다.
//
// 실패해도 throw 하지 않는다 — 칸 하나가 비는 것뿐이고, 메인화면은 그대로 떠야 한다.

import { matchLink, type Link, type LinkIndex } from "./analyze.ts";
import type { LatLng } from "@/app/RouteMap";

const ENDPOINT = "http://api.jejuits.go.kr/api/getFrafficInfo";

/**
 * 응답이 1.2MB(12,000링크)다. 메인화면이 이걸 기다리다 멈추면 안 되므로 짧게 끊는다.
 * 실측 2~4초라 두 배쯤 남긴다. 넘기면 흐름 칸만 비고 나머지 화면은 그대로다.
 */
const TIMEOUT_MS = 8000;

/**
 * 집계 주기가 5분이다 (prcn_dt 가 20260818210500 → 21:05:00 처럼 5분 단위로 끊겨 온다).
 * 그 안에 다시 물어도 같은 값이라, 서버 인스턴스마다 한 벌만 들고 있는다.
 * 1.2MB 를 매 요청마다 받으면 메인화면을 여는 값이 너무 비싸다.
 */
const TTL_MS = 5 * 60 * 1000;

/**
 * "지금 내가 달리는 길"을 잡는 반경(m).
 *
 * 더 좁히면 골목에 선 사람이 아무것도 못 받는다 — ITS 커버리지가 제주 전체 링크의 32% 라
 * (간선 위주다) 반경 안에 값이 하나도 없는 일이 쉽게 생긴다. 더 넓히면 한라산 건너편
 * 도로가 "내가 선 길"로 올라온다.
 */
const RADIUS_M = 3000;

/**
 * "차 없는 길"을 찾는 반경(m). 추천이라 내가 선 자리보다 넓게 본다 —
 * 지금 서 있는 3km 안이 전부 막혀 있으면 추천할 게 없는데, 그게 이 화면이 가장 필요한 순간이다.
 * 제주시↔서귀포가 40km 라 10km 는 "차 타고 곧 갈 수 있는 거리" 안쪽이다.
 */
const CALM_RADIUS_M = 10000;

/** 이보다 적은 링크로 도로를 대표하지 않는다 — 한 조각(100m)의 속도는 신호 하나로 흔들린다. */
const MIN_LINKS = 3;

export type Flow = {
  /** 도로명 ("평화로") */
  road: string;
  /** 그 도로의 실측 통행속도 (km/h) */
  kmh: number;
  /** 조회 시각 (Asia/Seoul) — 실시간이라고 적으려면 언제 값인지도 같이 적어야 한다 */
  at: string;
};

type Row = { link_id: string; sped: number; prcn_dt: string };

/** link_id → 실측 속도(km/h). 0 은 값이 아니라 정보없음이라 버린다. */
export function speedMap(rows: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.sped > 0) m.set(String(r.link_id), r.sped);
  return m;
}

/** ITS 시각 표기(20260818210500) → "21:05". 형식이 다르면 null 이다 — 지어내지 않는다. */
export function clockOf(prcn_dt: string | undefined): string | null {
  return /^\d{12}/.test(prcn_dt ?? "") ? `${prcn_dt!.slice(8, 10)}:${prcn_dt!.slice(10, 12)}` : null;
}

let cached: { at: number; speeds: Map<string, number>; clock: string | null } | null = null;

/**
 * 제주 전체 실시간 속도. 실패하면 null — 부르는 쪽은 흐름 칸을 안 그린다.
 *
 * type=L 은 링크 단위 소통정보다 (문서 예시값 그대로).
 */
export async function liveSpeeds() {
  const key = process.env.JEJU_ITS_API_KEY;
  if (!key) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached;

  try {
    const q = new URLSearchParams({ code: key, type: "L" });
    const res = await fetch(`${ENDPOINT}?${q}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // 키가 틀리거나 신청 안 한 API 면 200 에 {"result":"code not registered"} 로 온다 —
    // HTTP 상태로는 안 걸러진다.
    const json: { result?: string; info?: Row[] } = await res.json();
    if (json.result !== "success" || !json.info?.length) throw new Error(json.result ?? "info 없음");

    cached = { at: Date.now(), speeds: speedMap(json.info), clock: clockOf(json.info[0].prcn_dt) };
    return cached;
  } catch {
    return null; // 굳혀둔 값이 없는 종류의 데이터다. 실시간이 아니면 아예 말하지 않는다.
  }
}

/** 위도 보정만 넣은 평면 근사 (lib/analyze.ts distToSeg 와 같은 사상 — 제주 크기에선 충분하다). */
function withinM(a: LatLng, b: LatLng, m: number): boolean {
  const k = Math.cos((a[0] * Math.PI) / 180);
  const dy = (a[0] - b[0]) * 111000;
  const dx = (a[1] - b[1]) * 111000 * k;
  return dx * dx + dy * dy <= m * m;
}

const roadOf = (l: Link) => (l.n && l.n.trim() && l.n.trim() !== "-" ? l.n.trim() : null);

/**
 * 반경 안에서 가장 많이 잡히는 도로 하나와 그 실측 속도. 값이 얇으면 null.
 *
 * 링크 하나가 아니라 도로로 묶는 이유: 100m 짜리 조각 하나의 속도는 신호 하나로 40 이
 * 됐다 20 이 됐다 한다. "지금 평화로가 56km/h" 라야 사람이 쓸 수 있는 말이다.
 *
 * 대표 도로는 반경 안 링크 수가 가장 많은 쪽이다 — 내가 선 링크(matchLink)를 먼저 보되,
 * 그 링크가 이름 없는 골목이면 주변 간선으로 넘어간다.
 *
 * ponytail: 링크 길이 가중이 아니라 산술평균이다. 슬림본에 LENGTH 가 없고(좌표열로 다시
 * 재야 한다), 같은 도로 같은 반경 안에서는 조각 길이 편차가 작다. 도로 하나가 반경 안에서
 * 길이가 크게 들쭉날쭉해지면 그때 좌표열로 가중한다.
 */
function roadsWithin(index: LinkIndex, speeds: Map<string, number>, here: LatLng, radiusM: number) {
  const byRoad = new Map<string, number[]>();
  for (const l of index.links) {
    const kmh = speeds.get(l.i);
    if (kmh == null) continue;
    const road = roadOf(l);
    if (!road) continue;
    // 링크의 첫 좌표만 본다. 반경 판정에 선분 최근접거리까지 갈 정확도가 필요 없다.
    const [lo, la] = l.c[0];
    if (!withinM(here, [la, lo], radiusM)) continue;
    const arr = byRoad.get(road);
    if (arr) arr.push(kmh);
    else byRoad.set(road, [kmh]);
  }
  return byRoad;
}

const mean = (xs: number[]) => Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);

export function flowNear(index: LinkIndex, speeds: Map<string, number>, here: LatLng): Omit<Flow, "at"> | null {
  const byRoad = roadsWithin(index, speeds, here, RADIUS_M);

  // 내가 선 도로가 반경 안에서 충분히 잡히면 그게 답이다 — 주변에 더 긴 도로가 있어도
  // 사람이 궁금한 건 자기가 달리는 길이다.
  const mine = roadOf(matchLink(index, here) ?? ({} as Link));
  const 후보 = mine && (byRoad.get(mine)?.length ?? 0) >= MIN_LINKS ? mine : null;

  const [road, kmhs] = 후보
    ? [후보, byRoad.get(후보)!]
    : ([...byRoad.entries()].filter(([, v]) => v.length >= MIN_LINKS).sort((a, b) => b[1].length - a[1].length)[0] ?? []);
  if (!road || !kmhs) return null;

  return { road, kmh: mean(kmhs) };
}

/**
 * 굳혀둔 링크별 자유속도 — link_id → 차 없을 때 km/h.
 * data/road-baseline.json (scripts/build-road-baseline.mjs 가 만든다).
 */
export type Baseline = Record<string, number>;

export type CalmRoad = {
  road: string;
  /** 지금 실측 속도 (km/h) — 기준선이 있는 링크만 평균낸 값이다 */
  kmh: number;
  /** 차 없을 때 이 길의 속도 (km/h) — 같은 링크들의 굳혀둔 값 */
  free: number;
  /** 여유율 = 지금 ÷ 자유속도. 1 이면 차가 아예 없는 것처럼 흐른다. */
  ease: number;
};

/**
 * 여유율 하한. 이 아래는 "차 없는 길"이 아니라 그냥 막힌 길이라 목록에 올리지 않는다.
 * 평소 낮보다 나은 길만 권한다.
 */
const CALM_MIN_EASE = 0.8;

/**
 * 목록에 올릴 최소 차로수.
 *
 * 왕복 1차로는 이 앱이 이미 **위험요인**으로 세는 조건이라(lib/score.ts narrowRoad),
 * 그걸 "추천"으로 뒤집어 내보내면 앱이 앞뒤로 다른 말을 하게 된다.
 */
export const MIN_LANES = 2;

/**
 * 세부도로(골목)를 이름으로 거른다.
 *
 * 차로수만으로는 안 걸러졌다 — "섭지코지로25번길"·"토평공단로127번길"이 2차로라 그대로
 * 올라왔다. 도로명주소 체계가 이미 격을 나눠 두었으므로 그걸 쓴다:
 * **대로·로는 간선, 길·번길은 그 사이를 잇는 세부도로**다. 차가 없는 건 맞지만
 * 초보에게 "이 길로 가세요" 하고 권할 대상이 아니다.
 */
const 골목 = /길$/;

/**
 * 지금 차가 없는 길. 여유율이 높은 순.
 *
 * **여유율 = 지금 실측 ÷ 그 길의 자유속도**다. 실측 속도만으로는 순위를 못 매긴다 —
 * 애월로는 비어도 22km/h 고 번영로는 비면 57km/h 라, 속도로 줄세우면 간선이 늘 이긴다.
 * 자유속도로 나눠야 "이 길이 지금 얼마나 비어 있나"가 도로끼리 비교된다.
 *
 * **링크마다 짝을 지어 더한다.** 도로 평균끼리 나누면 안 된다 — 실시간은 제주 링크의 32% 만
 * 오고 기준선은 다른 집합이라, 항몽로처럼 빠른 구간과 느린 구간이 섞인 도로에서 분자와 분모가
 * 서로 다른 조각을 보게 된다. 실제로 그렇게 만들었다가 여유율 139% 라는 없는 값이 나왔다.
 * 기준선이 없는 링크는 지금 속도도 함께 버린다 — 그래야 양쪽이 같은 조각을 본다.
 */
export function calmRoads(
  index: LinkIndex,
  speeds: Map<string, number>,
  here: LatLng,
  baseline: Baseline,
  limit = 5,
): CalmRoad[] {
  /** 도로명 → 짝지어진 [지금, 자유속도] 쌍들 */
  const byRoad = new Map<string, { now: number[]; free: number[] }>();
  for (const l of index.links) {
    const kmh = speeds.get(l.i);
    const free = baseline[l.i];
    if (kmh == null || !free) continue; // 한쪽만 있는 링크는 비율을 만들 수 없다
    if ((l.l ?? 0) < MIN_LANES) continue; // 좁은 길은 차가 없어도 권하지 않는다
    const road = roadOf(l);
    if (!road || 골목.test(road)) continue;
    const [lo, la] = l.c[0];
    if (!withinM(here, [la, lo], CALM_RADIUS_M)) continue;
    const a = byRoad.get(road) ?? { now: [], free: [] };
    a.now.push(kmh);
    a.free.push(free);
    byRoad.set(road, a);
  }

  const out: CalmRoad[] = [];
  for (const [road, a] of byRoad) {
    if (a.now.length < MIN_LINKS) continue;
    const kmh = mean(a.now);
    const free = mean(a.free);
    const ease = kmh / free;
    if (ease < CALM_MIN_EASE) continue;
    out.push({ road, kmh, free, ease: Math.round(ease * 100) / 100 });
  }
  return out.sort((a, b) => b.ease - a.ease).slice(0, limit);
}

/** 내 자리의 지금 흐름. 실시간을 못 받거나 주변에 값이 없으면 null. */
export async function flowAt(index: LinkIndex, here: LatLng): Promise<Flow | null> {
  const live = await liveSpeeds();
  if (!live) return null;
  const near = flowNear(index, live.speeds, here);
  return near && { ...near, at: live.clock ?? "" };
}

/** 내 주변에서 지금 차 없는 길. 실시간을 못 받으면 빈 배열 — 화면이 "확인 못 했어요"로 떨어진다. */
export async function calmAt(
  index: LinkIndex,
  here: LatLng,
  baseline: Baseline,
  limit?: number,
): Promise<{ roads: CalmRoad[]; at: string }> {
  const live = await liveSpeeds();
  if (!live) return { roads: [], at: "" };
  return { roads: calmRoads(index, live.speeds, here, baseline, limit), at: live.clock ?? "" };
}
