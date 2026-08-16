// 비보호 좌회전 판독 대상 목록 만들기 —
//   node --env-file=.env.local --experimental-strip-types scripts/left-turn-worklist.mjs
//   node --env-file=.env.local --experimental-strip-types scripts/left-turn-worklist.mjs \
//     시내 33.507,126.493 33.51278,126.52830        ← 새 구간을 받아 캐시하고 목록에 더한다
//
// 왜 필요한가 — 화면의 "좌회전 · 유턴 N번"은 횟수만 맞다. 그중 몇 곳이 비보호인지는 모른다
// (app/route/page.tsx Why 주석). 제주도 C-ITS 신호현시 API가 교차로별 현시를 직진/좌회전으로
// 나눠 줬는데 활용가이드 변경내역상 2026-04-01 자로 종료됐다. 남은 길은 로드뷰로 직접 보는 것이다.
// **비보호 좌회전 교차로에는 "비보호" 규제표지가 붙어 있어서 눈으로 확정된다** — 신호현시의
// 부재로 추론하는 것보다 오히려 근거가 강하다.
//
// 카카오를 다시 부르지 않는다. build-route-data.mjs 가 받아둔 data/route-{DISTANCE,TIME}.json
// 을 읽는다. 굳혀둔 구간(공항→올레시장)의 응답이고, **화면이 세는 것과 같은 응답을 봐야**
// 표의 숫자와 판독 목록의 줄 수가 맞는다. 판정 규칙도 lib/analyze.ts 의 guideKind 를 그대로 쓴다.
//
// 결과는 data/unprotected-left.json 에 verdict: null 스켈레톤으로 쓴다. 사람이 로드뷰를 열어
// "비보호" / "보호" / "판단불가" 로 채운다. **이미 채워둔 값은 건드리지 않는다** —
// 다시 돌려도 새 지점만 추가된다 (parking-tag-worklist.mjs 와 같은 규칙).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { guideKind } from "../lib/analyze.ts";

// 프로젝트 경로에 한글이 있어 URL.pathname은 못 쓴다 (build-route-data.mjs 와 같은 이유)
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${DATA}unprotected-left.json`;

/** 출발시각을 고정해야 같은 구간에서 같은 경로가 나온다 (build-route-data.mjs 와 같은 값). */
const DEPARTURE = "202607281000";

/**
 * 새 구간 받아오기 — `<이름> <출발 lat,lng> <도착 lat,lng>`.
 *
 * 굳혀둔 구간(공항→올레시장)은 시외 도로라 좌회전이 4곳뿐이었고 비보호가 하나도 없었다.
 * 비보호는 시내에서 나온다 — 그래서 구간을 늘릴 수 있어야 한다.
 * 받은 응답은 route-<이름>-<priority>.json 으로 캐시한다. **한 번 받으면 다시 안 부른다** —
 * 카카오는 출발시각을 고정해도 도로 데이터가 갱신되면 경로가 바뀌는데, 그러면 이미 판독해 둔
 * 지점이 목록에서 사라진다.
 */
async function 구간받기([이름, from, to]) {
  const key = process.env.KAKAO_REST_API_KEY;
  const 나온것 = [];
  // lib/route.ts PRIORITIES 와 같은 셋이다. 화면이 RECOMMEND 경로도 내놓는데 그 경로의
  // 좌회전만 안 보면 목록에 구멍이 남는다.
  for (const priority of ["DISTANCE", "TIME", "RECOMMEND"]) {
    const file = `route-${이름}-${priority}.json`;
    나온것.push(file);
    if (existsSync(`${DATA}${file}`)) continue;
    if (!key) throw new Error("KAKAO_REST_API_KEY 없음 — --env-file=.env.local 을 붙이세요");
    const [oLat, oLng] = from.split(","), [dLat, dLng] = to.split(",");
    const q = new URLSearchParams({
      origin: `${oLng},${oLat}`, // 카카오는 경도,위도 순서다
      destination: `${dLng},${dLat}`,
      priority,
      departure_time: DEPARTURE,
      road_details: "true",
      alternatives: "false",
    });
    const res = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) throw new Error(`${이름} ${priority}: HTTP ${res.status} ${await res.text()}`);
    writeFileSync(`${DATA}${file}`, JSON.stringify(await res.json()));
    console.log(`받았습니다 → data/${file}`);
  }
  return 나온것;
}

if (process.argv.length > 2) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error("인자는 셋입니다: <이름> <출발 lat,lng> <도착 lat,lng>");
    process.exit(1);
  }
  await 구간받기(args);
}

/**
 * 캐시된 카카오 응답 전부. route-data.json 은 build-route-data.mjs 가 만든 **결과물**이지
 * 카카오 응답이 아니라 뺀다 — 넣으면 guides 가 없어 조용히 0곳이 된다.
 */
const SOURCES = readdirSync(DATA)
  .filter((f) => /^route-.+\.json$/.test(f) && f !== "route-data.json")
  .sort();

/** 우리가 보러 가는 종류. 회전교차로는 비보호라는 말 자체가 성립하지 않아 뺀다. */
const 볼것 = new Set(["left", "uTurn"]);

const rad = (d) => (d * Math.PI) / 180;

/**
 * 진입 방위각 (북=0, 시계방향). 로드뷰를 열자마자 이 방향을 보게 하려고 쓴다.
 *
 * 안 돌려주면 지점마다 마우스로 시야를 찾느라 시간이 다 간다 — 판독 자체보다 오래 걸린다.
 * 카카오 로드뷰 setViewpoint 의 pan 도 같은 규약(북=0, 시계방향)이라 값을 그대로 넘긴다.
 */
function bearing([x1, y1], [x2, y2]) {
  const φ1 = rad(y1), φ2 = rad(y2), Δλ = rad(x2 - x1);
  const θ = Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
  );
  return Math.round(((θ * 180) / Math.PI + 360) % 360);
}

/**
 * 그 지점으로 **들어가는** 방향. guide 의 road_index 가 가리키는 도로가 진입 도로고,
 * 그 마지막 두 정점이 곧 진입 방향이다. 실측에서 이 도로는 정점 2개짜리 짧은 조각이었고
 * 끝점은 guide 좌표에서 30~80m 앞이었다 — 교차로 직전이라 방향을 보기에 맞다.
 *
 * 정점이 모자라거나 road_index 가 범위를 벗어나면 null 이다. 그때는 방향 없이 열고
 * 사람이 직접 돌린다 — 억지로 0(북쪽)을 넣으면 엉뚱한 데를 보여주면서 맞는 척한다.
 */
function 진입방위(road) {
  const v = road?.vertexes;
  if (!Array.isArray(v) || v.length < 4) return null;
  return bearing([v[v.length - 4], v[v.length - 3]], [v[v.length - 2], v[v.length - 1]]);
}

/** 좌표 5자리 ≈ 1m. 두 경로가 같은 교차로를 지나면 여기서 한 줄로 합쳐진다. */
const idOf = (y, x) => `${y.toFixed(5)},${x.toFixed(5)}`;

const 기존 = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const out = { ...기존 };
let 새로 = 0;

for (const file of SOURCES) {
  const path = `${DATA}${file}`;
  if (!existsSync(path)) {
    console.error(`${file} 이 없습니다 — 먼저 node scripts/build-route-data.mjs 를 돌리세요.`);
    process.exit(1);
  }
  const route = JSON.parse(readFileSync(path, "utf8")).routes?.[0];
  for (const section of route?.sections ?? []) {
    for (const g of section.guides ?? []) {
      const kind = guideKind(g.guidance ?? "");
      if (!볼것.has(kind)) continue;

      const id = idOf(g.y, g.x);
      const 경유 = out[id]?.경유 ?? [];
      if (!경유.includes(file)) 경유.push(file);
      // out 은 기존을 복사해 시작한다 — 여기 없으면 "기존에도 없고 이번 회차에도 아직 없다"는 뜻이다.
      // 기존만 보면 두 경로가 같은 교차로를 지날 때 한 곳을 두 번 센다.
      if (!out[id]) 새로++;

      out[id] = {
        // 사람이 채울 칸: "비보호" | "보호" | "무신호" | "판단불가"
        //
        // **무신호는 비보호가 아니다.** 비보호는 신호등이 있는 교차로에서 좌회전 현시만
        // 없는 것이고, 신호등이 아예 없으면 그 말 자체가 성립하지 않는다. 실측에서
        // 중앙로62번길 두 곳이 그랬다 — 하나로 뭉치면 "비보호 N곳"이 틀린 말이 된다.
        //
        // **판단불가를 남기는 게 요점이다** — 안 보이는 걸 "보호"로 적으면 확인한 사실처럼 읽힌다.
        verdict: 기존[id]?.verdict ?? null,
        // 로드뷰 촬영 연월(YYYY-MM). 사진이 몇 년 전이면 그 사이 신호가 개편됐을 수 있다.
        // 판정만 남기고 이 값을 비우면 언제 기준의 사실인지 알 수 없어진다 (RiskFactor.source 와 같은 이유).
        shotAt: 기존[id]?.shotAt ?? null,
        label: g.name || section.roads?.[g.road_index]?.name || "(이름없음)",
        guidance: g.guidance,
        kind,
        bearing: 진입방위(section.roads?.[g.road_index]),
        경유,
        // 카카오의 /link/roadview/ 는 쓰지 않는다 — 로드뷰로 들어가지 않고 지도만 그 좌표로 옮긴다.
        // 키는 URL 로 붙여야 해서 아래 콘솔 출력에서 완성한다 (data/ 에 키를 남기지 않는다).
        tag: `/roadview-tag.html?lat=${g.y}&lng=${g.x}&bearing=${진입방위(section.roads?.[g.road_index]) ?? ""}&label=${encodeURIComponent(g.name || "")}`,
      };
    }
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

const 전체 = Object.keys(out);
const 채운수 = 전체.filter((k) => out[k].verdict !== null).length;
console.log(`판독 대상 ${전체.length}곳 (이번에 추가 ${새로}곳) → data/unprotected-left.json`);
console.log(`  채워진 것 ${채운수}곳 / 남은 것 ${전체.length - 채운수}곳`);
// 열 링크를 여기서 완성한다. 키는 파일에 안 남기고 실행할 때만 붙인다 (parking-tag.html 과 같은 이유).
const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
console.log(
  KEY
    ? "\n남은 것 — 링크를 열고 verdict 를 비보호/보호/판단불가 로 채우세요 (촬영일은 화면이 알려줍니다):"
    : "\n남은 것 (NEXT_PUBLIC_KAKAO_MAP_KEY 가 없어 링크를 못 만듭니다 — --env-file=.env.local 을 붙이세요):",
);
for (const k of 전체.filter((k) => out[k].verdict === null)) {
  console.log(`   · ${out[k].label} — ${out[k].guidance} (진입 ${out[k].bearing ?? "?"}°)`);
  if (KEY) console.log(`     http://localhost:3000${out[k].tag}&key=${KEY}`);
}
