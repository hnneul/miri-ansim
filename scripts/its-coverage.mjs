// ITS 소통정보 커버리지 확인 — ITS_API_KEY=... node scripts/its-coverage.mjs
//
// 붙일지 말지를 정하려고 한 번 돌리는 스크립트다. 빌드에도 배포에도 들어가지 않는다.
// 묻는 것은 하나다: 국가교통정보센터 소통정보가 제주 표준링크를 몇 개나 주고,
// 그게 우리가 실제로 안내하는 도로(5.16로·평화로)에 걸리는가.
// 안 걸리면 붙일 이유가 없다 — 카카오 traffic_state 가 이미 같은 자리를 채우고 있고,
// 커버리지가 얇은 실측값을 섞으면 "정보없음"이 늘 뿐이다.
//
// 응답 필드 이름은 문서 대신 응답에서 찾는다. openapi.its.go.kr 개발자센터가 지금 닫혀
// 있어 파라미터·필드명을 원문으로 확인하지 못했다. 그래서 ① type 은 세 값을 다 던져보고
// ② 배열은 응답 어디에 있든 찾아내고 ③ 링크ID·속도 키는 이름으로 잡는다.
// 첫 항목을 통째로 찍으므로, 추측이 틀렸으면 그 출력에 바로 보인다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEY = process.env.ITS_API_KEY;
if (!KEY) {
  console.error("ITS_API_KEY 없음 — its.go.kr/opendata 에서 발급 후 환경변수로 준다");
  process.exit(1);
}

/** build-link-data.mjs 가 전국 원본을 자를 때 쓴 제주 bbox 그대로. 같은 범위를 물어야 비교가 된다. */
const BBOX = { minX: 126.14, minY: 33.1, maxX: 126.98, maxY: 33.6 };

/** 이 도로들에 안 걸리면 붙일 이유가 없다 — 굳혀둔 3구간이 지나는 길이다. */
// 이름은 표준노드링크 표기 그대로다 — "1100도로"가 아니라 "1100로"로 들어 있다.
const 관심도로 = ["516로", "평화로", "1100로", "일주동로", "일주서로", "번영로", "남조로", "비자림로"];

const url = (type) =>
  `https://openapi.its.go.kr:9443/trafficInfo?${new URLSearchParams({
    apiKey: KEY,
    type,
    getType: "json",
    minX: BBOX.minX,
    maxX: BBOX.maxX,
    minY: BBOX.minY,
    maxY: BBOX.maxY,
  })}`;

/** 응답 어딘가의 배열을 찾는다 — body.items 인지 body.items.item 인지 확인 못 했다. */
function items(json) {
  const q = [json];
  while (q.length) {
    const v = q.shift();
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") q.push(...Object.values(v));
  }
  return [];
}

const keyOf = (o, 조각) => Object.keys(o).find((k) => k.toLowerCase().includes(조각));

// --- ① 어느 type 이 제주를 주는가 ---
let rows = [];
let 쓴type = "";
for (const type of ["all", "its", "ex"]) {
  try {
    const res = await fetch(url(type));
    if (!res.ok) {
      console.log(`type=${type}: HTTP ${res.status}`);
      continue;
    }
    const json = await res.json();
    const got = items(json);
    // 0건이면 응답 앞부분을 같이 찍는다 — 대개 여기에 거절 사유(키·파라미터)가 들어 있다
    console.log(`type=${type}: ${got.length}건` + (got.length ? "" : ` ${JSON.stringify(json).slice(0, 300)}`));
    if (got.length > rows.length) {
      rows = got;
      쓴type = type;
    }
  } catch (e) {
    console.error(`type=${type}: ${e.message}`);
    if (/certificate/i.test(e.message))
      console.error("  ↳ 인증서 문제면 NODE_TLS_REJECT_UNAUTHORIZED=0 으로 한 번만 확인 (붙일 때는 제대로 잡는다)");
  }
}
if (!rows.length) {
  console.error("\n어떤 type 도 데이터를 주지 않았다. 키 승인 상태부터 확인.");
  process.exit(1);
}

console.log(`\n[첫 항목 원문] type=${쓴type}`);
console.log(rows[0]);

const K = { link: keyOf(rows[0], "link"), speed: keyOf(rows[0], "speed") };
if (!K.link) {
  console.error("\n링크ID로 보이는 키가 없다 — 위 원문을 보고 K.link 를 직접 지정할 것");
  process.exit(1);
}

// --- ② 우리 표준노드링크와 대조 ---
const GEO = fileURLToPath(new URL("../data/jeju_link.geojson", import.meta.url));
const 도로 = new Map(); // LINK_ID → ROAD_NAME
for (const f of JSON.parse(readFileSync(GEO, "utf8")).features)
  도로.set(String(f.properties.LINK_ID), f.properties.ROAD_NAME?.trim() || "(무명)");

const 전체 = new Map(); // 도로명 → 제주에 있는 링크 수
for (const n of 도로.values()) 전체.set(n, (전체.get(n) ?? 0) + 1);

const 응답 = new Map(); // 도로명 → { n: 링크 수, v: 속도 합 }
let 미매칭 = 0;
for (const r of rows) {
  // 미매칭 = 제주 밖 링크이거나, 우리 판(2026-07-16)에 없는 ID다. 후자면 판을 갱신해야 한다.
  const name = 도로.get(String(r[K.link]));
  if (!name) {
    미매칭++;
    continue;
  }
  const a = 응답.get(name) ?? { n: 0, v: 0 };
  a.n++;
  a.v += Number(K.speed ? r[K.speed] : 0) || 0;
  응답.set(name, a);
}

// --- ③ 판단에 필요한 숫자만 ---
const 매칭 = rows.length - 미매칭;
console.log(`\n응답 ${rows.length}건 · 제주 링크 매칭 ${매칭} · 미매칭 ${미매칭}`);
console.log(`제주 전체 링크 ${도로.size}개 중 ${((매칭 / 도로.size) * 100).toFixed(1)}% 커버`);

const 평균 = (a) => (K.speed && a.v ? ` · 평균 ${Math.round(a.v / a.n)}km/h` : "");

console.log("\n── 관심 도로 ──");
for (const n of 관심도로) {
  const a = 응답.get(n);
  const t = 전체.get(n) ?? 0;
  const 꼬리 = a ? 평균(a) : t ? "  ❌ 소통정보 없음" : "  (표준노드링크에 이 이름이 없다 — 이름 확인)";
  console.log(`${n.padEnd(9)} ${String(a?.n ?? 0).padStart(4)}/${String(t).padStart(4)} 링크${꼬리}`);
}

console.log("\n── 응답이 많은 도로 상위 15 ──");
for (const [n, a] of [...응답].sort((x, y) => y[1].n - x[1].n).slice(0, 15))
  console.log(`${n.padEnd(13)} ${String(a.n).padStart(4)}링크${평균(a)}`);
