// 판독 결과 → 앱이 읽는 판독표 — node scripts/build-unprotected.mjs
//
// roadview-judge.py 가 낸 제주 전역 판독(4,464건)과 사람이 로드뷰로 직접 본 54곳을 합쳐
// data/unprotected-left.json 을 만든다.
//
// **키에 진입 방위가 들어간다** — 여기가 이전 판과 갈라지는 지점이다. 사거리는 진입 방향이
// 4개고 방향마다 비보호 여부가 다르다(실측: 보성초교입구교차로는 한 방향 비보호, 다른 방향 보호).
// 예전 키는 "위도,경도" 라 한 교차로에 한 줄뿐이었고, 굳혀둔 경로만 다룰 땐 그래도 됐다.
// 전역으로 넓히면 같은 좌표에 최대 4줄이 생겨 키가 충돌한다.
//
// **사람 판독이 AI 판독을 이긴다.** 사람은 표지를 직접 봤고 AI 는 사진을 봤다. 그리고
// 사람 판독 54곳은 정확도를 재는 정답지라, AI 값으로 덮으면 잣대가 사라진다.
//
// AI 판독의 한계를 basis 에 남긴다 — 나중에 무엇을 다시 볼지 정하려면 근거의 출처가 필요하다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const CACHE = "/Users/haneul/Desktop/초보운전자 프로젝트/roadview-cache/";
const OUT = `${DATA}unprotected-left.json`;

const 판독 = JSON.parse(readFileSync(`${CACHE}final-verdicts.json`, "utf8"));
const 사진 = new Map(
  JSON.parse(readFileSync(`${CACHE}index.json`, "utf8")).map((o) => [o.key, o.shots?.[0] ?? null]),
);
const 기존 = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

/** 키 = "위도,경도,진입방위". 좌표 5자리 ≈ 1m. */
const keyOf = (lat, lng, bearing) => `${(+lat).toFixed(5)},${(+lng).toFixed(5)},${Math.round(bearing)}`;

const out = {};

// ① AI 판독 4,464건
for (const o of 판독) {
  out[keyOf(o.lat, o.lng, o.bearing)] = {
    verdict: o.verdict,
    shotAt: 사진.get(o.key) ?? null,
    label: o.label,
    guidance: null, // 카카오 안내문이 아니라 표준노드링크에서 뽑은 지점이다
    kind: "left",
    bearing: Math.round(o.bearing),
    // 2차(gpt-5.4)가 다시 본 건과 1차(mini)만 본 건을 구분해 둔다. 1차 단독은 비보호를
    // 과하게 잡는 경향이 실측됐다(476곳 중 375곳이 2차에서 기각).
    basis: o.stage === "2차" ? "AI판독-재확인" : "AI판독",
    confidence: o.confidence ?? null,
  };
}

// ② 사람 판독 — 나중에 써서 AI 값을 덮는다
let 사람 = 0;
for (const [k, v] of Object.entries(기존)) {
  if (!v.verdict || v.bearing == null) continue; // 미판정이거나 방위 없는 줄은 버린다
  const [lat, lng] = k.split(",");
  out[keyOf(lat, lng, v.bearing)] = { ...v, bearing: Math.round(v.bearing) };
  사람++;
}

writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

const n = {};
for (const v of Object.values(out)) n[v.verdict] = (n[v.verdict] ?? 0) + 1;
console.log(`판독표 ${Object.keys(out).length.toLocaleString()}줄 (AI ${판독.length.toLocaleString()} + 사람 ${사람})`);
console.log(" ", n);
console.log(`→ ${OUT}`);
