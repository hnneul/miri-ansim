// 주행 저장 — 와이어프레임 "주행 저장" 섹션(Figma 2606:846)이 쓰는 데이터.
//
// 여행 기록(lib/record.ts)과 **같은 저장소·같은 버킷**을 쓴다 (/api/drives → lib/records.db.ts).
// 익숙함 티어 셋이 버킷이라 같은 티어를 고른 사람은 어느 기기로 들어와도 같은 목록을 본다.
// 티어 판정도 거기 asTier 하나를 그대로 쓴다 — 판정이 두 벌이면 한쪽만 느슨해진다.
//
// **여행 기록과 다른 점은 담기는 순간이다.** 여행 기록은 사람이 글을 써서 저장을 누르지만,
// 주행 저장은 길 비교 화면에서 **외부 내비로 넘길 때 자동으로** 담긴다. 우리가 아는 건
// "내비로 넘어갔다"까지고 진짜 달렸는지는 웹앱이 알 수 없다 — 내비를 열자마자 껐어도 남는다.
// 그래서 빼는 문(✕)이 화면에 있다: 넉넉히 담고 아니면 빼는 구조다.
//
// 서버 응답도 URL 도 전부 사용자가 손댈 수 있는 입력이다. 여기가 신뢰 경계라 읽을 때마다
// 모양을 확인하고 안 맞으면 그 칸을 버린다. **서버도 같은 asDrive 를 쓴다** (app/api/drives).

import type { LatLng } from "@/app/RouteMap";
import { isoToday } from "./record.ts";

/**
 * 담긴 주행 한 건.
 *
 * score 는 lib/score.ts 의 **추천점수**다 — 높을수록 좋다. 담을 때 계산된 값을 그대로 굳혀
 * 넣는다: 프로필을 바꿨다고 작년에 달린 길이 갑자기 편해졌다고 말하면 안 된다
 * (app/safelog/page.tsx 의 같은 주석).
 */
export type SafeDrive = {
  /** 담은 시각(ms). 목록 정렬 키 겸 id — 여행 기록과 같은 규칙이다 */
  id: number;
  /** YYYY-MM-DD */
  date: string;
  /** "출발 → 도착". 상세 화면 지도 양끝 이름도 여기서 갈라 쓴다 */
  title: string;
  /** "나만의 길"에 담아뒀나 — 두 번째 탭이 이것만 추린다 */
  mine: boolean;
  score: number;
  minutes: number;
  km: number;
  /** 짧은 길보다 몇 분 더 걸렸나 (화면이 부르는 이름 — app/route/page.tsx 기본이름). 0 이면 화면이 그 말을 뺀다 */
  slower: number;
  /** 그 주행에서 실제로 달린 길. 상세 화면 지도가 이걸 그린다 */
  path: LatLng[];
  /** 댄 주차장 (길의 도착지가 곧 주차장이다) */
  parking: string;
  /** "왜 안심 길이었나요?" 세 줄의 값. 라벨은 화면이 들고 있고 값만 온다 */
  reasons: [string, string, string];
  /** 주차장 한 줄평 */
  parkingTags: string;
};

/**
 * 경로 좌표 상한. 카카오가 주는 좌표열은 400~700점인데 342px 짜리 카드 안 지도라
 * 그보다 촘촘해도 눈에 안 보이고, 공개 API 의 몸통 상한(8KB)만 잡아먹는다.
 */
export const PATH_MAX = 40;

/**
 * 좌표를 PATH_MAX 개 안팎으로 솎는다. 양끝은 반드시 남긴다 — 출발·도착 점이 지도에 찍히는
 * 자리라 그게 밀리면 선 끝과 점이 어긋난다.
 */
export function thinPath(path: LatLng[], max = PATH_MAX): LatLng[] {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => path[Math.round(i * step)]);
}

/**
 * 같은 주행으로 볼 시간 폭(ms).
 *
 * 길 비교 화면에서 내비를 눌렀다가 돌아와 다른 길로 다시 누르는 건 흔하다. 그때마다 쌓이면
 * 요약이 "4회 118km"라고 뻥을 친다 — **같은 출발→도착이 이 안에 또 오면 새 기록이 아니라
 * 방금 것을 고쳐 담은 것으로 본다.** 30분이면 길을 고르다 마음을 바꾸는 시간은 넉넉히 덮고,
 * 같은 길을 하루에 두 번 달리는 경우와는 안 겹친다.
 */
export const SAME_DRIVE_MS = 30 * 60 * 1000;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown, or = 0) => (typeof v === "number" && Number.isFinite(v) ? v : or);

/** 좌표 한 점인지. [위도, 경도] 두 칸짜리 숫자 배열만 통과한다 */
const asPoint = (v: unknown): LatLng | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : null;

/**
 * 한 칸이 주행 기록인지. 하나라도 모양이 다르면 그 칸을 버린다.
 * 서버가 받은 몸통을 검사할 때도 이걸 쓴다 (app/api/drives/route.ts).
 *
 * **경로가 두 점 미만이면 기록이 아니다** — 상세 화면이 지도에 그릴 게 없고, 축척을 맞출
 * 범위도 안 나온다 (app/RouteMap.tsx setBounds).
 */
export function asDrive(v: unknown): SafeDrive | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;

  const title = str(d.title);
  if (title === null || !title.trim()) return null;
  if (typeof d.id !== "number" || !Number.isFinite(d.id)) return null;

  const path = Array.isArray(d.path)
    ? d.path.map(asPoint).filter((p): p is LatLng => p !== null)
    : [];
  if (path.length < 2) return null;

  // 세 줄이 아니면 모자란 칸을 "확인 안 됨"으로 채운다 — 라벨은 화면이 셋을 그리고 있어서
  // 값이 둘만 오면 마지막 줄이 빈칸으로 남는다. 모르는 것은 모른다고 적는 게 이 화면 규칙이다.
  const raw = Array.isArray(d.reasons) ? d.reasons : [];
  const reasons = Array.from({ length: 3 }, (_, i) => str(raw[i]) ?? "확인 안 됨") as SafeDrive["reasons"];

  return {
    id: d.id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(d.date) ?? "") ? (d.date as string) : isoToday(),
    title,
    mine: d.mine === true,
    score: num(d.score),
    minutes: num(d.minutes),
    km: num(d.km),
    slower: Math.max(0, num(d.slower)),
    path: thinPath(path),
    parking: str(d.parking) ?? "",
    reasons,
    parkingTags: str(d.parkingTags) ?? "",
  };
}

/* ─────────────────────────────── 화면 ↔ 서버 ─────────────────────────────── */

const API = "/api/drives";

/** 서버가 준 목록을 걸러 낸다. 깨진 칸은 조용히 버린다 */
const asList = (raw: unknown): SafeDrive[] =>
  Array.isArray(raw) ? raw.map(asDrive).filter((d): d is SafeDrive => d !== null) : [];

/**
 * 한 티어의 주행, 최신순. **서버가 죽어도 빈 목록으로 돌아온다** —
 * 화면이 뻗는 대신 "주행 저장 기록이 없어요"가 뜬다 (lib/record.ts loadRecords 와 같은 대가).
 */
export async function loadDrives(tier: number): Promise<SafeDrive[]> {
  try {
    const res = await fetch(`${API}?t=${tier}`);
    return res.ok ? asList(await res.json()) : [];
  } catch {
    return [];
  }
}

/**
 * 담고 그 티어의 새 목록을 돌려준다. 못 담았으면 null 이다.
 *
 * **페이지를 떠나면서 부르는 자리가 있다** (길 비교 → 외부 내비). 그때는 keepalive 로 보내야
 * 브라우저가 문서를 버리면서 요청까지 끊지 않는다. 이걸 빼면 "가끔 기록이 안 남는" 버그가 된다.
 */
export async function saveDrive(
  tier: number,
  drive: SafeDrive,
  opts: { keepalive?: boolean } = {},
): Promise<SafeDrive[] | null> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, drive }),
      keepalive: opts.keepalive,
    });
    return res.ok ? asList(await res.json()) : null;
  } catch {
    return null;
  }
}

/** 목록에서 뺀다 (카드의 ✕). 새 목록을 돌려주고, 실패하면 null 이다 */
export async function removeDrive(tier: number, id: number): Promise<SafeDrive[] | null> {
  try {
    const res = await fetch(`${API}?t=${tier}&id=${id}`, { method: "DELETE" });
    return res.ok ? asList(await res.json()) : null;
  } catch {
    return null;
  }
}

/** "나만의 길"에 담거나 뺀다. 새 목록을 돌려주고, 실패하면 null 이다 */
export async function setMine(tier: number, id: number, mine: boolean): Promise<SafeDrive[] | null> {
  try {
    const res = await fetch(API, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, id, mine }),
    });
    return res.ok ? asList(await res.json()) : null;
  } catch {
    return null;
  }
}
