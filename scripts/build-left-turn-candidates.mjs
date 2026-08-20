// 비보호 판독 후보 만들기 — node scripts/build-left-turn-candidates.mjs
//
// 제주 전역에서 비보호 좌회전을 판독하려면 "어디를 볼지"를 먼저 정해야 한다. 교차로 진입방향은
// 22,254개인데 판독은 건당 돈이 들어서, 볼 필요 없는 곳을 먼저 쳐낸다. 두 번 거른다:
//
//   ① 좌회전이 실제로 가능한 진입만 — 진입 링크 기준 -45°~-135° 로 빠지는 링크가 있어야 한다.
//      T자 교차로의 좌회전 없는 진입, 일방통행이 여기서 절반 넘게 걸러진다.
//      TURNINFO 의 좌회전금지(011)도 뺀다.
//   ② 신호교차로만 — **비보호는 신호등이 있는 교차로에서만 성립한다.** 무신호 교차로는
//      비보호가 아니라 그냥 무신호다 (lib/unprotected.ts 의 Verdict 구분과 같다).
//      data/jeju-signals.json (build-signal-data.mjs) 을 반경 안에서 붙인다.
//
// 반경은 손으로 고르지 않았다. 신호기 좌표가 지번주소 중심이라 교차로 중심에서 얼마든지
// 벗어날 수 있어서, **이미 사람이 판독해 둔 지점(data/unprotected-left.json)을 정답지로 두고**
// 신호 있는 곳이 몇 개나 후보에 들어오는지 반경별로 재서 정한다. 놓치면 그 지점은 영영
// 판독되지 않고 화면에 "확인 안 됨"으로 남는다.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));


const RADII = [50, 100, 150, 200, 300];

const rad = (d) => (d * Math.PI) / 180;
/** 두 좌표 방위각 (북=0, 시계방향). scripts/left-turn-worklist.mjs 와 같은 규약. */
function bearing([x1, y1], [x2, y2]) {
  const φ1 = rad(y1), φ2 = rad(y2), Δλ = rad(x2 - x1);
  const θ = Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
  );
  return ((θ * 180) / Math.PI + 360) % 360;
}
/** 제주 위도 기준 근사. 반경 판정에만 쓰므로 이걸로 충분하다. */
const M = { lo: 92900, la: 111000 };
const dist = (a, b) => Math.hypot((a[1] - b[1]) * M.lo, (a[0] - b[0]) * M.la);

// --- 표준노드링크 ---
const links = JSON.parse(readFileSync(`${DATA}jeju_link.geojson`, "utf8")).features;
const nodes = new Map(
  JSON.parse(readFileSync(`${DATA}jeju_node.geojson`, "utf8")).features.map((f) => [
    f.properties.NODE_ID,
    { p: f.properties, c: f.geometry.coordinates },
  ]),
);

// 좌회전금지 — TURNINFO.dbf 를 CSV 로 뽑아둔 것이 있으면 쓴다 (없으면 그냥 건너뛴다).
let 금지 = new Set();
try {
  const csv = readFileSync(`${DATA}turninfo.csv`, "utf8").trim().split(/\r?\n/);
  const h = csv[0].split(",");
  const [ni, si, ei, ti] = ["NODE_ID", "ST_LINK", "ED_LINK", "TURN_TYPE"].map((c) => h.indexOf(c));
  for (const l of csv.slice(1)) {
    const v = l.split(",");
    if (v[ti] === "011") 금지.add(`${v[ni]}|${v[si]}|${v[ei]}`);
  }
} catch {
  // gitignore 대상이다. 필요하면 표준노드링크 배포본에서 뽑는다:
  //   ogr2ogr -f CSV data/turninfo.csv "<배포본>/TURNINFO.dbf"
  // 없어도 후보가 조금 늘 뿐이라 멈추지 않는다.
  console.log("(turninfo.csv 없음 — 좌회전금지 필터 생략)");
}

const 들어옴 = new Map(); // NODE_ID → [{id, bearing, name}]
const 나감 = new Map();
const deg = new Map();
for (const f of links) {
  const p = f.properties, c = f.geometry.coordinates;
  if (c.length < 2) continue;
  for (const n of [p.F_NODE, p.T_NODE]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  push(들어옴, p.T_NODE, { id: String(p.LINK_ID), b: bearing(c[c.length - 2], c[c.length - 1]), name: p.ROAD_NAME });
  push(나감, p.F_NODE, { id: String(p.LINK_ID), b: bearing(c[0], c[1]) });
}

// --- 신호교차로 ---
const signals = Object.values(JSON.parse(readFileSync(`${DATA}jeju-signals.json`, "utf8")));

// --- 좌회전 가능 진입 ---
const 교차로 = [...nodes.keys()].filter((k) => nodes.get(k).p.NODE_TYPE === "101" && (deg.get(k) ?? 0) >= 3);
const 좌회전 = [];
for (const k of 교차로) {
  const n = nodes.get(k);
  for (const i of 들어옴.get(k) ?? []) {
    const out = (나감.get(k) ?? []).find((o) => {
      const rel = (o.b - i.b + 360) % 360;
      return rel >= 225 && rel <= 315 && !금지.has(`${k}|${i.id}|${o.id}`);
    });
    if (!out) continue;
    좌회전.push({
      node: k,
      lat: +n.c[1].toFixed(5),
      lng: +n.c[0].toFixed(5),
      bearing: Math.round(i.b),
      label: (n.p.NODE_NAME || i.name || "(이름없음)").trim(),
      기하: null,
    });
  }
}

// --- 반경별 재현율 — 사람이 판독해 둔 지점을 정답지로 쓴다 ---
const 판독표 = JSON.parse(readFileSync(`${DATA}unprotected-left.json`, "utf8"));
const 정답 = Object.entries(판독표)
  .filter(([, v]) => v.verdict === "보호" || v.verdict === "비보호")
  .map(([k, v]) => ({ c: k.split(",").map(Number), label: v.label }));

console.log(`교차로 ${교차로.length.toLocaleString()} · 좌회전 가능 진입 ${좌회전.length.toLocaleString()}`);
console.log(`신호교차로 좌표 ${signals.length}\n`);
// 반경은 **신호교차로 커버리지**로 고른다. 처음엔 위 정답지(11곳)의 재현율로 골랐는데
// 어느 반경에서도 11/11 이 나와 변별력이 없었고, 그대로 50m 를 택했다면 신호교차로의
// 62% 만 보고 끝냈을 것이다. 정답지가 작고 간선 편향이라 생긴 착시다.
// 놓친 교차로는 판독표에 안 들어가고 화면에 영영 "확인 안 됨" 으로 남는다.
const TARGET = 0.8;

console.log("반경별 — 후보 수 / 신호교차로 커버리지 / 정답지 재현율");

let 최종 = null;
for (const R of RADII) {
  const 붙음 = 좌회전.filter((c) =>
    signals.some((s) => dist([c.lat, c.lng], [s.lat, s.lng]) <= R),
  );
  // 후보를 하나라도 가진 신호교차로의 비율. 이게 실제로 우리가 보게 될 범위다.
  const 커버 = signals.filter((s) =>
    붙음.some((c) => dist([c.lat, c.lng], [s.lat, s.lng]) <= R),
  ).length;
  const 노드 = new Set(붙음.map((c) => `${c.lat},${c.lng}`));
  const hit = 정답.filter((g) =>
    [...노드].some((k) => dist(g.c, k.split(",").map(Number)) <= 60),
  ).length;
  const pct = 커버 / signals.length;
  console.log(
    `  ${String(R).padStart(4)}m  후보 ${String(붙음.length).padStart(6)}건` +
      `   커버 ${String(커버).padStart(3)}/${signals.length} (${(pct * 100).toFixed(0)}%)` +
      `   재현 ${hit}/${정답.length}`,
  );
  if (pct >= TARGET && !최종) 최종 = { R, 붙음, 커버 };
}

if (!최종) {
  console.error(`\n⚠ 어느 반경에서도 커버리지 ${TARGET * 100}% 를 못 넘는다 — RADII 를 늘릴 것`);
  process.exit(1);
}

// 기하구조를 붙여둔다 (4지형/3지형 — 나중에 진입 수 검산에 쓴다)
for (const c of 최종.붙음) {
  const s = signals.reduce((b, s) => {
    const d = dist([c.lat, c.lng], [s.lat, s.lng]);
    return d < b.d ? { d, s } : b;
  }, { d: Infinity, s: null });
  c.기하 = s.s?.기하구조 ?? null;
  c.key = `${c.lat},${c.lng}`;
}

writeFileSync(`${DATA}left-turn-candidates.json`, JSON.stringify(최종.붙음, null, 1) + "\n");
console.log(`\n채택 반경 ${최종.R}m · 후보 ${최종.붙음.length.toLocaleString()}건 → data/left-turn-candidates.json`);
const per = 12612;
const t = 최종.붙음.length * per;
console.log(`예상 — 사진 6장 ${(t / 1e6).toFixed(0)}M 토큰 $${((t * 0.97 * 2.5 + t * 0.03 * 15) / 1e6).toFixed(0)}` +
  ` · 사진 3장 $${((t / 2 * 0.97 * 2.5 + t / 2 * 0.03 * 15) / 1e6).toFixed(0)}`);
