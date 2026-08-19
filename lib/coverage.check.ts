// 판독표 적용률 — node --experimental-strip-types lib/coverage.check.ts
//
// 화면의 "확인 안 됨"이 무엇 때문인지 가른다. 두 원인이 같은 화면 문구로 합쳐져 있어서
// 나누지 않으면 무엇을 더 판독해야 할지 알 수 없다.
//   · 표에 없음   판독 자체를 안 한 지점 (후보를 신호교차로로 좁힌 몫)
//   · 판단불가    판독은 했는데 표지도 등화도 안 보인 지점
// 앞은 더 판독하면 줄고, 뒤는 사진을 더 구해야 준다.
//
// 굳혀둔 카카오 응답(data/route-*.json)으로 잰다. gitignore 대상이라 없으면 건너뛴다.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, buildIndex, type Link } from "./analyze.ts";
import { distance } from "./curvature.ts";
import 판독표 from "../data/unprotected-left.json" with { type: "json" };

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
if (!existsSync(`${DATA}jeju-link.json`)) {
  console.log("⏭  data/jeju-link.json 없음 — node scripts/build-link-data.mjs 먼저");
  process.exit(0);
}

const 표 = 판독표 as Record<string, { verdict: string | null; bearing: number | null }>;
const 줄 = Object.entries(표).map(([k, v]) => {
  const [la, lo] = k.split(",").map(Number);
  return { at: [la, lo] as [number, number], b: v.bearing, verdict: v.verdict };
});
const 방위차 = (a: number, b: number) => Math.abs(((a - b + 180) % 360) - 180);

const idx = buildIndex(JSON.parse(readFileSync(`${DATA}jeju-link.json`, "utf8")) as Link[]);
const files = readdirSync(DATA).filter((x) => /^route-.+\.json$/.test(x) && x !== "route-data.json");

let 표에없음 = 0, 판단불가 = 0, 정상 = 0, 방위없음 = 0;
for (const f of files) {
  const route = JSON.parse(readFileSync(`${DATA}${f}`, "utf8")).routes?.[0];
  if (!Array.isArray(route?.sections)) continue;
  for (const p of analyze(route, idx).turnPoints) {
    if (p.bearing == null) { 방위없음++; continue; }
    let best: { verdict: string | null } | null = null;
    let bm = Infinity;
    for (const r of 줄) {
      const m = distance(p.at, r.at);
      if (m > 30 || m >= bm) continue;
      if (r.b != null && 방위차(p.bearing, r.b) > 45) continue;
      bm = m;
      best = r;
    }
    if (!best) 표에없음++;
    else if (best.verdict === "판단불가") 판단불가++;
    else 정상++;
  }
}

const 계 = 표에없음 + 판단불가 + 정상 + 방위없음;
if (!계) {
  console.log("⏭  굳혀둔 경로 응답 없음 (gitignore 대상) — 적용률 측정 건너뜀");
  process.exit(0);
}
const pct = (n: number) => `${((n / 계) * 100).toFixed(0)}%`;
console.log(`경로 ${files.length}개의 좌회전 지점 ${계}곳`);
console.log(`  판정됨      ${정상}곳 (${pct(정상)})`);
console.log(`  표에 없음   ${표에없음}곳 (${pct(표에없음)})  ← 판독 안 한 지점`);
console.log(`  판단불가    ${판단불가}곳 (${pct(판단불가)})  ← 판독했는데 안 보임`);
console.log(`  방위없음    ${방위없음}곳 (${pct(방위없음)})`);
