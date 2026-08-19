// 경로 위험요인 분석 — 빌드 스크립트와 런타임이 **같은 함수**를 쓴다.
//
// 원래 이 코드는 scripts/build-route-data.mjs 안에만 있었다. 임의 구간을 받으려면
// 요청 때마다 분석해야 하는데, 스크립트와 서버가 각자 계산하면 같은 경로에 다른 숫자가
// 나올 수 있다. 근거 카드가 "동일 입력에서 같은 근거"를 보장해야 하므로 한 곳에 둔다.
//
// 계산하는 것 (전부 표준노드링크 + 경로 좌표에서 나온다):
//   · 급커브   : 경로 좌표의 곡률을 직접 계산. 급커브를 공개하는 데이터셋이 없다.
//                임계값은 도로의 구조·시설 기준에 관한 규칙 제19조 최소 평면곡선반지름.
//   · 좁은 교행: 차로수 1 & 제한속도 50km/h↑ (램프를 빼려고 속도 조건을 함께 건다)
//   · 고속주행 : 제한속도 80km/h↑
//
// 성능 (맥북에어 실측): 링크 5.9MB 파싱 0.03초 + 격자 인덱스 0.01초 + 경로 매칭 114ms.
// 두 경로를 합쳐 0.25초라 요청 때마다 돌려도 된다. 인덱스는 한 번 만들어 재사용한다.

import { distance, sharpCurves, densestCluster, simplifyIdx, WINDING_GAP, type LatLng } from "./curvature.ts";
import type { TurnPoint } from "./unprotected.ts";

/** 슬림 링크 한 줄. scripts/build-link-data.mjs 가 만든다 (원본 속성명을 줄인 것). */
export type Link = {
  /** LINK_ID 표준링크 ID — 제주ITS 실시간 속도를 붙이는 열쇠다 (lib/flow.ts) */
  i: string;
  l: number | null; // LANES 차로수
  s: number | null; // MAX_SPD 제한속도
  n: string | null; // ROAD_NAME 도로명
  c: [number, number][]; // 좌표열 [경도, 위도] — GeoJSON 순서 그대로다
};

/** 격자 셀 크기(도). 제주 크기에서 이 값이면 셀당 링크가 수십 개다. */
const CELL = 0.01;

/** 좌표에 링크를 붙이는 최대 거리. 이 밖이면 미매칭으로 남긴다 — 억지로 붙이지 않는다. */
const MATCH_M = 40;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * 도로명 정리. 표준노드링크는 이름 없는 링크에 빈 문자열뿐 아니라 "-" 도 쓴다.
 * 그대로 두면 근거 카드에 "- 0.5km" 같은 위치가 찍힌다.
 */
const roadName = (n: string | null | undefined) => (n && n.trim() && n.trim() !== "-" ? n.trim() : "(무명)");

export type LinkIndex = {
  links: Link[];
  grid: Map<string, number[]>;
};

const cellKey = (la: number, lo: number) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL)}`;

/**
 * 링크 배열 → 격자 인덱스. 링크가 37,063개라 전수 검색하면 좌표 하나당 수백만 번 비교다.
 * 만드는 데 0.01초라 서버 인스턴스가 뜰 때 한 번 만들어 두면 된다.
 */
export function buildIndex(links: Link[]): LinkIndex {
  const grid = new Map<string, number[]>();
  for (const [idx, f] of links.entries()) {
    if (!f.c?.length) continue;
    for (const k of new Set(f.c.map(([lo, la]) => cellKey(la, lo)))) {
      const cell = grid.get(k);
      if (cell) cell.push(idx);
      else grid.set(k, [idx]);
    }
  }
  return { links, grid };
}

/** 점에서 선분까지의 거리(m). 위도 보정만 넣은 평면 근사 — 제주 크기에선 충분하다. */
function distToSeg(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(rad(p[0]));
  const APx = (p[1] - a[1]) * k, APy = p[0] - a[0];
  const ABx = (b[1] - a[1]) * k, ABy = b[0] - a[0];
  const ab2 = ABx * ABx + ABy * ABy;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
  return Math.hypot(APx - ABx * t, APy - ABy * t) * rad(1) * 6371000;
}

/** 좌표에 가장 가까운 링크. MATCH_M 안에 없으면 null. */
export function matchLink({ links, grid }: LinkIndex, p: LatLng): Link | null {
  const cand = new Set<number>();
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const x of grid.get(cellKey(p[0] + i * CELL, p[1] + j * CELL)) ?? []) cand.add(x);

  let best: number | null = null;
  let bestD = MATCH_M;
  for (const idx of cand) {
    const cs = links[idx].c;
    for (let i = 0; i + 1 < cs.length; i++) {
      const d = distToSeg(p, [cs[i][1], cs[i][0]], [cs[i + 1][1], cs[i + 1][0]]);
      if (d < bestD) { bestD = d; best = idx; }
    }
  }
  return best == null ? null : links[best];
}

/** 카카오 길찾기 응답의 vertexes → [위도, 경도] 좌표열. 도로 경계의 중복 좌표를 걸러낸다. */
export function pathOf(route: {
  sections: { roads: { vertexes: number[] }[] }[];
}): LatLng[] {
  const raw: LatLng[] = [];
  for (const sec of route.sections)
    for (const rd of sec.roads)
      for (let i = 0; i < rd.vertexes.length; i += 2) raw.push([rd.vertexes[i + 1], rd.vertexes[i]]);

  const path: LatLng[] = raw.length ? [raw[0]] : [];
  for (const p of raw.slice(1)) if (distance(path[path.length - 1], p) > 0.5) path.push(p);
  return path;
}

/** 경로 조각 하나. i 는 path 안의 조각 번호다 (path[i] → path[i+1]) — 이어진 구간을 찾는 데 쓴다 */
type Spot = { seg: number; road: string; p: LatLng; i: number };

const sum = (xs: Spot[]) => xs.reduce((s, x) => s + x.seg, 0);

function byRoad(xs: Spot[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x.road] = (o[x.road] || 0) + x.seg;
  return Object.fromEntries(
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(1)]),
  );
}

/**
 * 급커브 구간(연속 좌표 범위)을 spansOf 가 먹는 조각 목록으로 편다.
 *
 * 좁은 교행·고속주행은 링크 속성이라 조각 하나하나가 따로 걸리는데, 급커브는 처음부터
 * **범위**로 나온다 (curvature.ts sharpCurves 의 from~to). 범위를 조각으로 펴 놓으면
 * 세 요인이 같은 함수로 선이 된다 — 요인마다 다른 그리기 코드를 두지 않으려는 것이다.
 */
const 범위조각 = (runs: { from: number; to: number }[], path: LatLng[]): Spot[] =>
  runs.flatMap((r) =>
    Array.from({ length: r.to - r.from }, (_, k) => ({
      seg: 0,
      road: "",
      p: path[r.from + k],
      i: r.from + k,
    })),
  );

/**
 * 지도가 이 축척에서 구분하지 않는 길이. **이어 붙이는 기준과 버리는 기준을 겸한다** —
 * 둘이 같은 판단이기 때문이다: "300m 미만의 차이는 섬 전체를 보는 지도에서 뜻이 없다".
 *
 * 왜 필요한가. 선 굵기가 7px 인데 섬 전체 축척에서는 1px 이 100m 쯤이다. 그래서 **16m 짜리
 * 급커브 하나가 4km 구간과 똑같은 크기의 점으로 찍힌다** — 실측에서 평화로의 급커브 12개 중
 * 8개가 71m 미만이었고, 합쳐서 340m 인 그 여덟이 나머지 2.2km 보다 눈에 더 많이 띄었다.
 * 점으로 보이면 "구간"이 아니라 "지점"으로 읽히는 것도 문제다.
 *
 * **두 가지를 한다.**
 *   잇기 — 이만큼 안에서 다시 시작하면 사이의 멀쩡한 길까지 넣어 한 선으로 만든다.
 *          그 정도로 붙어 있으면 운전자에게는 한 구간이고, 굽은 길 사이 200m 직선을
 *          "여기서 끝났다"고 알려줄 값어치가 없다.
 *   버리기 — 그래도 이보다 짧게 남은 선은 안 그린다. 외딴 커브 하나가 그렇다
 *            (sharpCurves 가 WINDING_GAP 으로 이미 병합하므로 남은 건 진짜로 떨어져 있다).
 *
 * **그래서 그린 길이가 표의 km 와 어긋난다** — 잇는 쪽은 조금 늘리고 버리는 쪽은 조금 줄인다.
 * 실측(516로 급커브)에서 12.5km 중 11.7km(94%)가 남았고, 요인이 작을 때는 더 많이 줄어든다
 * (평화로 좁은 교행 1.8km → 1.6km). 받아들이는 이유: **양은 표가 %로 말하고 지도는 어디인지만
 * 말한다.** 지도에서 길이를 재는 사람은 없고, 점 여덟 개로 340m 를 부풀리는 편이 더 큰 거짓말이다.
 */
const 최소구간_M = 300;

/**
 * 구간을 지도에 그릴 선들.
 *
 * **멀리 떨어진 구간은 잇지 않는다.** 한 선으로 그으면 지나지도 않은 길이 칠해진다 —
 * 실측에서 좁은 구간 13.8km 가 금백조로와 비자림로에 흩어져 있었다.
 *
 * 조각 하나는 path[i] → path[i+1] 이다. 사이가 이어붙임_M 안이면 그 사이 좌표까지 넣어
 * 한 선으로 잇고, 넘으면 선을 끊는다.
 *
 * 지도용이므로 축약한다 — 원본 그대로면 좌표 수천 개가 브라우저로 나간다 (simplify 주석).
 */
/**
 * 원본 좌표 범위 → **그려지는 선에서 잘라낸 좌표**.
 *
 * 여기가 중요하다. 경로선은 전체를 한 번 축약한 결과를 그리는데(Analysis.path), 구간을 원본에서
 * 잘라 따로 축약하면 남는 좌표가 달라진다 — 두 선이 허용오차(30m)만큼 다른 길을 지나고,
 * 가까이서 보면 **경로선 옆에 나란히 그려진 두 번째 줄**로 보인다. 실제로 그렇게 그려졌다.
 * 같은 좌표를 쓰면 기하가 같아서 정확히 덮인다.
 *
 * 구간이 축약 좌표 두 개 사이에 통째로 들어가면 그 둘을 집는다 — 그 선분이 이 축척에서
 * 그 구간을 나타내는 유일한 선이다.
 */
function 그린선(from: number, to: number, 번호: number[], 그린: LatLng[]): LatLng[] {
  let lo = 0;
  while (lo < 번호.length && 번호[lo] < from) lo++;
  let hi = 번호.length - 1;
  while (hi >= 0 && 번호[hi] > to) hi--;
  // 안에 든 축약 좌표가 둘이 안 되면 앞뒤로 감싸는 두 점을 쓴다
  if (hi <= lo) return 그린.slice(Math.max(0, hi), Math.min(그린.length, lo + 1));
  return 그린.slice(lo, hi + 1);
}

function spansOf(xs: Spot[], path: LatLng[], 번호: number[], 그린: LatLng[]): LatLng[][] {
  if (!xs.length) return [];

  // 같은 조각이 두 번 걸릴 수 있다 (급커브 범위를 펴면 겹친다) — 번호로 한 번만 센다
  const 조각 = [...new Set(xs.map((x) => x.i))].sort((a, b) => a - b);

  const 묶음: number[][] = [];
  for (const i of 조각) {
    const 앞 = 묶음.at(-1);
    if (!앞) {
      묶음.push([i]);
      continue;
    }
    let 사이 = 0;
    for (let k = 앞.at(-1)! + 1; k < i; k++) 사이 += distance(path[k], path[k + 1]);
    if (사이 <= 최소구간_M) 앞.push(i);
    else 묶음.push([i]);
  }

  // 묶음 하나 = 첫 조각의 시작부터 마지막 조각의 끝까지 (사이 좌표를 그대로 지나간다)
  const 길이 = (c: LatLng[]) => c.reduce((t, p, i) => (i ? t + distance(c[i - 1], p) : 0), 0);
  return 묶음
    .map((g) => 그린선(g[0], g.at(-1)! + 1, 번호, 그린))
    .filter((c) => c.length >= 2 && 길이(c) >= 최소구간_M);
}

/** 구간의 대표 좌표 — 가장 긴 도로의 중간 지점. 지도 마커를 찍을 자리다. */
function midOf(xs: Spot[]): LatLng | null {
  if (!xs.length) return null;
  const top = Object.keys(byRoad(xs))[0];
  const on = xs.filter((x) => x.road === top);
  return on[Math.floor(on.length / 2)].p;
}

export type Analysis = {
  distanceKm: number;
  durationMin: number;
  path: LatLng[]; // 지도 표시용으로 축약한 좌표
  vertexCount: number;
  matchedKm: number;
  unmatchedKm: number;
  sharpCurve: {
    sections: number;
    km: number;
    windingKm: number;
    windingSections: number;
    exposure: number;
    perKm: number;
    minRadiusM: number | null;
    byRoad: Record<string, number>;
    densest: { at: LatLng; count: number } | null;
    /** 지도에 겹쳐 그릴 선들. 노출(exposure)과 같은 기준인 winding 구간이다 */
    spans: LatLng[][];
  };
  /**
   * spans — 지도에 겹쳐 그릴 선들. at 은 대표 한 점이라 구간 길이를 못 보여준다 (spansOf).
   * **km 와 정확히 맞지 않는다** — 그릴 수 없을 만큼 짧은 건 빠지고 가까운 건 이어 붙는다 (최소구간_M).
   */
  narrow: { km: number; exposure: number; byRoad: Record<string, number>; at: LatLng | null; spans: LatLng[][] };
  highSpeed: { km: number; exposure: number; byRoad: Record<string, number>; at: LatLng | null; spans: LatLng[][] };
  /**
   * 안내 지점을 종류별로 센 것 (카카오 길찾기 sections[].guides).
   *
   * 곡률·차로수는 도로가 어떻게 생겼는지고, 이건 **운전자가 판단해야 하는 지점의 수**다.
   * 초보에게는 뒤쪽이 더 무섭다 — 맞은편 흐름을 끊고 들어가는 좌회전, 진입 순서를 스스로
   * 정해야 하는 회전교차로가 그렇다. 길이가 아니라 횟수라 노출 비율로 환산하지 않는다.
   */
  guides: {
    /** 좌회전 (번) */
    left: number;
    /** 유턴 (번) */
    uTurn: number;
    /** 회전교차로 (곳) */
    roundabout: number;
  };
  /**
   * 좌회전·유턴 지점의 좌표. 그 지점이 비보호인지 물어보려면 좌표가 있어야 한다
   * (lib/unprotected.ts). 회전교차로는 넣지 않는다 — 비보호라는 말이 성립하지 않는다.
   */
  turnPoints: TurnPoint[];
  lanesKm: Record<string, number>;
  speedKm: Record<string, number>;
  /**
   * 도로명별 총 주행거리(km), 긴 순서. 경로 이름을 여기서 뽑는다 —
   * "5.16도로 경유" 같은 이름을 손으로 적으면 임의 구간에서 쓸 수 없고,
   * 데이터가 바뀔 때 조용히 틀린 말이 된다 (지명 하드코딩 금지).
   */
  roadKm: Record<string, number>;
};

/**
 * 카카오 길찾기 응답 하나 → 위험요인 분석.
 *
 * 최밀집 지점의 **지명은 여기서 붙이지 않는다**. 좌표→행정구역 변환이 또 하나의 API 호출이라
 * 순수 함수로 남겨두고, 호출하는 쪽이 필요할 때 붙인다 (지명 하드코딩 금지 원칙은 그대로).
 */
/**
 * 안내 지점 세기.
 *
 * **타입 숫자가 아니라 안내문으로 센다.** 실측(12개 구간)에서 나온 타입은
 * 1 좌회전 · 2 우회전 · 5·6 왼쪽/오른쪽 방향 · 19·27·29 시계방향 표기 · 70·78·80·81 회전교차로 ·
 * 100 출발 · 101 목적지였다. 회전교차로가 70~81 로 흩어져 있고 유턴은 12개 구간에 한 번도
 * 안 나왔다 — 문서 없이 범위를 박으면 못 본 코드에서 조용히 0이 되거나 엉뚱한 걸 센다.
 * 카카오는 안내문을 한국어로 주고("서귀포 방면으로 좌회전", "회전교차로에서 12시 방향"),
 * 그 낱말은 종류마다 겹치지 않는다.
 *
 * "왼쪽 방향"(분기)은 좌회전으로 안 센다. 맞은편 흐름을 끊고 들어가는 동작이 아니라
 * 갈림길에서 왼쪽을 고르는 것뿐이고, 초보가 무서워하는 건 앞쪽이다.
 */
function countGuides(
  sections: {
    roads?: { vertexes?: number[] }[];
    guides?: { guidance?: string; x?: number; y?: number; road_index?: number }[];
  }[],
): Analysis["guides"] & { turnPoints: TurnPoint[] } {
  const out = { left: 0, uTurn: 0, roundabout: 0, turnPoints: [] as TurnPoint[] };
  const all = sections.flatMap((s) => (s.guides ?? []).map((g) => ({ g, s })));
  const 끝 = all[all.length - 1]?.g;

  for (const { g, s } of all) {
    const kind = guideKind(g.guidance ?? "");
    if (!kind) continue;
    out[kind]++;
    // 좌표가 없는 응답(굳혀둔 폴백 데이터 등)에서는 좌표 없이 횟수만 센다
    if (kind === "roundabout" || typeof g.x !== "number" || typeof g.y !== "number") continue;
    if (목적지진입(g, 끝)) continue;
    out.turnPoints.push({
      at: [g.y, g.x],
      bearing: 진입방위(s.roads?.[g.road_index ?? -1]),
    });
  }
  return out;
}

/**
 * 목적지 코앞의 회전인가 — 그렇다면 판독 대상이 아니다.
 *
 * 목적지가 주차장이라 경로 마지막 몇 개 안내가 주차장 진입 동작이다. 맞은편 직진 흐름을
 * 끊고 들어가는 좌회전이 아니라 **비보호라는 말 자체가 성립하지 않는다.** 실측(굳혀둔 경로
 * 71개)에서 미판정 30곳 중 10곳이 이것이었고, 로드뷰를 열어보면 교차로가 아니라 주차장이
 * 찍혀 있었다 (신제주 경로: 안내 7개 중 6번째 "좌회전", 25m 뒤가 목적지).
 *
 * **이걸 빼지 않으면 그 주차장을 목적지로 하는 모든 경로가 영원히 "확인 안 됨"이 된다** —
 * 판독표에 절대 안 들어갈 지점 하나가 경로 전체를 null 로 만든다.
 *
 * 횟수(out[kind])에서는 빼지 않는다. 운전자는 그 좌회전도 실제로 하고, 화면의
 * "좌회전 N번"은 조작 횟수를 말하는 것이라 맞다. 비보호를 묻지 않을 뿐이다.
 */
const 목적지코앞_M = 300;
function 목적지진입(
  g: { x?: number; y?: number },
  끝?: { x?: number; y?: number },
): boolean {
  if (!끝 || typeof 끝.x !== "number" || typeof 끝.y !== "number") return false;
  return distance([g.y!, g.x!], [끝.y, 끝.x]) <= 목적지코앞_M;
}

/**
 * 그 지점으로 **들어가는** 방향 (북=0, 시계방향). 판독표를 방위까지 맞춰 조회하려면 필요하다 —
 * 사거리는 진입 방향마다 비보호 여부가 다르다 (lib/unprotected.ts 의 같은진입_도).
 *
 * guide 의 road_index 가 가리키는 도로가 진입 도로고, 그 마지막 두 정점이 진입 방향이다.
 * scripts/left-turn-worklist.mjs 가 판독 대상을 뽑을 때 쓴 것과 같은 식이라, 판독표에 적힌
 * 방위와 같은 규약으로 나온다.
 *
 * 정점이 모자라거나 road_index 가 없으면 null 이다. **억지로 0(북쪽)을 넣지 않는다** —
 * 틀린 방위로 조회하면 옆 진입의 판정을 맞는 척 집어온다. null 이면 호출하는 쪽이 모른다고 답한다.
 */
function 진입방위(road?: { vertexes?: number[] }): number | null {
  const v = road?.vertexes;
  if (!Array.isArray(v) || v.length < 4) return null;
  const [x1, y1, x2, y2] = v.slice(-4);
  const rad = (d: number) => (d * Math.PI) / 180;
  const φ1 = rad(y1), φ2 = rad(y2), Δλ = rad(x2 - x1);
  const θ = Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
  );
  return Math.round(((θ * 180) / Math.PI + 360) % 360);
}

/**
 * 안내문 한 줄 → 지점 종류. 못 세는 안내문은 null.
 *
 * **세는 쪽과 보러 가는 쪽이 같은 규칙을 써야 한다.** 여기서 센 좌회전을 로드뷰로 하나씩
 * 확인하러 가는데(scripts/left-turn-worklist.mjs), 규칙이 갈라지면 화면의 "좌회전 12번"과
 * 판독 목록의 줄 수가 조용히 어긋난다.
 */
export function guideKind(guidance: string): keyof Analysis["guides"] | null {
  // 회전교차로를 먼저 본다 — "회전교차로에서 왼쪽 9시 방향"이 좌회전으로도 세이면 두 번 센다
  if (guidance.includes("회전교차로")) return "roundabout";
  if (guidance.includes("유턴")) return "uTurn";
  if (guidance.includes("좌회전")) return "left";
  return null;
}

export function analyze(
  route: {
    summary: { distance: number; duration: number };
    sections: {
      roads: { vertexes: number[] }[];
      guides?: { guidance?: string; x?: number; y?: number }[];
    }[];
  },
  index: LinkIndex,
): Analysis {
  const path = pathOf(route);
  const attr = path.map((p) => matchLink(index, p));
  const 총거리 = route.summary.distance;

  // ① 급커브 — 저속 도로의 교차로 회전을 세지 않도록 제한속도 50↑ 구간만.
  //   구간 수는 100m 기준(서로 다른 커브를 합치지 않는다),
  //   노출은 WINDING_GAP 기준(짧은 직선으로 끊긴 굽은 길을 하나로 본다). 다른 질문이다.
  const spd = (i: number) => attr[i]?.s ?? null;
  const curves = sharpCurves(path, spd);
  const winding = sharpCurves(path, spd, 50, WINDING_GAP);
  const windingM = winding.reduce((s, c) => s + c.lengthM, 0);
  const cluster = densestCluster(curves);
  const 안내 = countGuides(route.sections);

  const curveByRoad: Record<string, number> = {};
  for (const c of curves) {
    let near = 0;
    for (let i = 1; i < path.length; i++)
      if (distance(path[i], c.start) < distance(path[near], c.start)) near = i;
    const name = roadName(attr[near]?.n);
    curveByRoad[name] = (curveByRoad[name] || 0) + 1;
  }

  // ② 구간 길이를 링크 속성에 배분
  const byLanes: Record<string, number> = {};
  const bySpd: Record<string, number> = {};
  let matched = 0;
  let unmatched = 0;
  const narrow: Spot[] = [];
  const fast: Spot[] = [];
  const all: Spot[] = [];

  for (let i = 0; i + 1 < path.length; i++) {
    const seg = distance(path[i], path[i + 1]) / 1000;
    const a = attr[i];
    if (!a) { unmatched += seg; continue; }
    matched += seg;
    byLanes[String(a.l)] = (byLanes[String(a.l)] || 0) + seg;
    bySpd[String(a.s)] = (bySpd[String(a.s)] || 0) + seg;
    const road = roadName(a.n);
    all.push({ seg, road, p: path[i], i });
    // 램프를 빼기 위해 제한속도 50↑ 조건을 함께 건다
    if (a.l === 1 && (a.s ?? 0) >= 50) narrow.push({ seg, road, p: path[i], i });
    if ((a.s ?? 0) >= 80) fast.push({ seg, road, p: path[i], i });
  }

  const round1 = (n: number) => +n.toFixed(1);
  const round3 = (n: number) => +n.toFixed(3);

  // 축약을 **한 번만** 한다. 경로선(path)과 위험 구간(spans)이 같은 좌표를 써야
  // 지도에서 정확히 겹친다 (그린선 주석).
  const 그린번호 = simplifyIdx(path);
  const 그린 = 그린번호.map((i) => path[i]);
  const 구간 = (xs: Spot[]) => spansOf(xs, path, 그린번호, 그린);

  return {
    distanceKm: round1(총거리 / 1000),
    durationMin: Math.round(route.summary.duration / 60),
    path: 그린,
    vertexCount: path.length,
    matchedKm: round1(matched),
    unmatchedKm: round1(unmatched),
    sharpCurve: {
      sections: curves.length,
      km: round1(curves.reduce((s, c) => s + c.lengthM, 0) / 1000),
      windingKm: round1(windingM / 1000),
      windingSections: winding.length,
      // 노출 비율 — 요인마다 단위가 달라지면 점수에 크기를 반영할 수 없다.
      // 급커브 조각만 더하면 과소평가된다 (커브 사이 직선도 굽은 길의 일부다).
      exposure: round3(windingM / 총거리),
      perKm: +(curves.length / (총거리 / 1000)).toFixed(2),
      minRadiusM: curves.length ? Math.round(Math.min(...curves.map((c) => c.minRadius))) : null,
      byRoad: Object.fromEntries(Object.entries(curveByRoad).sort((a, b) => b[1] - a[1])),
      densest: cluster && {
        at: cluster.at.map((x) => +x.toFixed(4)) as LatLng,
        count: cluster.count,
      },
      // curves 가 아니라 winding 을 칠한다 — 위 exposure 가 winding 기준이라, curves 를 칠하면
      // 지도에 보이는 양과 표에 적힌 %가 어긋난다 (커브 사이 직선도 굽은 길의 일부다)
      spans: 구간(범위조각(winding, path)),
    },
    narrow: {
      km: round1(sum(narrow)),
      exposure: round3((sum(narrow) * 1000) / 총거리),
      byRoad: byRoad(narrow),
      at: midOf(narrow),
      spans: 구간(narrow),
    },
    highSpeed: {
      km: round1(sum(fast)),
      exposure: round3((sum(fast) * 1000) / 총거리),
      byRoad: byRoad(fast),
      at: midOf(fast),
      spans: 구간(fast),
    },
    guides: { left: 안내.left, uTurn: 안내.uTurn, roundabout: 안내.roundabout },
    turnPoints: 안내.turnPoints,
    lanesKm: Object.fromEntries(Object.entries(byLanes).map(([k, v]) => [k, round1(v)])),
    speedKm: Object.fromEntries(Object.entries(bySpd).map(([k, v]) => [k, round1(v)])),
    roadKm: byRoad(all),
  };
}
