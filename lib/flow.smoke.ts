// 차 없는 길 실데이터 확인 — node --experimental-strip-types lib/flow.smoke.ts
//
// flow.check.ts 와 나누는 이유: 저쪽은 픽스처로 계산을 검증하고, 이쪽은 **제주ITS 가
// 아직 우리가 아는 모양으로 응답하는가**를 본다. 네트워크와 키를 탄다.
//
// 무엇이 깨지면 여기서 잡히나:
//   · 응답 스키마 변경 (link_id·sped·prcn_dt 이름이 바뀌면 전 지점이 "값 없음")
//   · 키 만료·미승인 ({"result":"code not registered"})
//   · 커버리지 축소 (간선에서 값이 사라지면 칸이 늘 비게 된다)
//
// 커버리지는 원래 완전하지 않다 — 제주 전체 링크의 32% 이고 간선 위주다.
// 516로 산중처럼 값이 없는 자리가 있는 게 정상이다.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildIndex, type Link } from "./analyze.ts";
import { flowAt, calmAt, type Baseline } from "./flow.ts";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
if (!existsSync(`${DATA}jeju-link.json`)) {
  console.log("⏭  data/jeju-link.json 없음 — node scripts/build-link-data.mjs 먼저");
  process.exit(0);
}
if (!process.env.JEJU_ITS_API_KEY) {
  // .env.local 은 Next 가 읽는 파일이라 여기선 직접 집어 온다 (dotenv 를 들이지 않는다)
  const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const 키 = env.match(/^JEJU_ITS_API_KEY=(.+)$/m)?.[1].trim();
  if (!키) {
    console.log("⏭  JEJU_ITS_API_KEY 없음 — jejuits.go.kr/open_api 에서 신청");
    process.exit(0);
  }
  process.env.JEJU_ITS_API_KEY = 키;
}

const index = buildIndex(JSON.parse(readFileSync(`${DATA}jeju-link.json`, "utf8")) as Link[]);
const baseline: Baseline = existsSync(`${DATA}road-baseline.json`)
  ? JSON.parse(readFileSync(`${DATA}road-baseline.json`, "utf8"))
  : {};
if (!Object.keys(baseline).length) {
  console.log("⏭  data/road-baseline.json 없음 — node scripts/build-road-baseline.mjs 먼저");
  process.exit(0);
}

/** 섬을 고루 찍는다 — 시내·공항·간선·산중·남쪽·동쪽. 한 군데만 보면 커버리지 구멍을 놓친다. */
const 자리: [string, [number, number]][] = [
  ["제주시청", [33.4996, 126.5312]],
  ["제주공항", [33.507, 126.493]],
  ["평화로 한복판", [33.373, 126.356]],
  ["516로 산중", [33.362, 126.558]],
  ["서귀포시청", [33.254, 126.56]],
  ["성산일출봉", [33.458, 126.942]],
];

let 받은곳 = 0;
for (const [이름, p] of 자리) {
  const [f, c] = await Promise.all([flowAt(index, p), calmAt(index, p, baseline, 3)]);
  if (f || c.roads.length) 받은곳++;
  const 선길 = f ? `${f.road} ${f.kmh}km/h` : "값 없음";
  const 한산 = c.roads.map((r) => `${r.road} ${(r.ease * 100).toFixed(0)}%`).join(" · ") || "없음";
  console.log(`  ${이름.padEnd(13)} 선 길: ${선길.padEnd(20)} 차 없는 길: ${한산}`);
}

// 전 지점이 빈손이면 커버리지 문제가 아니라 API·키가 죽은 것이다 — 그건 조용히 넘기면 안 된다.
if (받은곳 === 0) {
  console.error("\n❌ 6곳 전부 값 없음 — 키·응답 스키마를 확인할 것 (lib/flow.ts fetchSpeeds)");
  process.exit(1);
}
console.log(`\n✅ ${받은곳}/6 지점에서 실시간 수신 (기준선 도로 ${Object.keys(baseline).length}개)`);
console.log("   값 없는 자리는 정상이다 — ITS 커버리지가 제주 전체 링크의 32%(간선 위주)다");
