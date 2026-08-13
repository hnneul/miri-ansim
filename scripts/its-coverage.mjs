// ITS 커버리지 확인 — ITS_API_KEY=... node scripts/its-coverage.mjs
//
// 붙일지 말지를 정하려고 한 번 돌리는 스크립트다. 빌드에도 배포에도 들어가지 않는다.
// 두 가지를 묻는다. 키가 하나라 같이 돈다:
//   ① 소통정보 — 제주 표준링크를 몇 개나 주는가 (실측 속도)
//   ② CCTV    — 우리가 안내하는 도로 위에 카메라가 있는가 ("지금 차 없음"을 사진으로 보이는 길)
// 둘 다 5.16로·평화로에 안 걸리면 붙일 이유가 없다 — 카카오 traffic_state 가 이미 같은
// 자리를 채우고 있고, 커버리지가 얇은 실측값을 섞으면 "정보없음"이 늘 뿐이다.
//
// 제주는 표준노드링크상 국도·고속도로가 0개고 전부 지방도·시군도다. 국가 ITS 는 고속도로·
// 국도 위주라 ①이 빈손일 가능성이 높다 — 그래도 확인은 한 번 하고 넘어간다. 빈손이면
// 제주도 자체 API(data.go.kr 15093668, 표준노드링크 기반 교통량·점유율)로 간다.
//
// 파라미터·필드는 its.go.kr/opendata 문서에서 확인했다(2026-08-14). 두 군데가 함정이다:
//   · trafficInfo 는 bbox 가 type=all 일 때만 먹는다. ex/its 로 부르려면 routeNo·drcType 이
//     필수라 제주를 좌표로 훑을 수 없다. 그래서 소통정보는 type=all 한 번만 부른다.
//   · 출력에 linkId 와 linkNo 가 같이 있다. "link" 를 포함하는 키로 잡으면 linkNo(일련번호)를
//     집어서 매칭이 전부 실패한다. 정확히 일치하는 키를 먼저 본다.

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

const url = (service, extra) =>
  `https://openapi.its.go.kr:9443/${service}?${new URLSearchParams({
    apiKey: KEY,
    getType: "json",
    minX: BBOX.minX,
    maxX: BBOX.maxX,
    minY: BBOX.minY,
    maxY: BBOX.maxY,
    ...extra,
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

/** 정확히 일치하는 키가 먼저다 — linkId 를 찾는데 linkNo 가 걸리면 매칭이 통째로 실패한다. */
const keyOf = (o, 이름) =>
  Object.keys(o).find((k) => k.toLowerCase() === 이름) ?? Object.keys(o).find((k) => k.toLowerCase().includes(이름));

/**
 * 후보 파라미터를 다 던져보고 제일 많이 주는 응답을 쓴다.
 * type 이 'all'·'its'·'ex' 중 뭘 받는지 문서로 확인하지 못해서 고르는 대신 물어본다.
 */
async function 가장많이주는(service, 후보들) {
  let rows = [];
  let 쓴것 = null;
  for (const extra of 후보들) {
    const 이름 = new URLSearchParams(extra).toString();
    try {
      const res = await fetch(url(service, extra));
      if (!res.ok) {
        console.log(`  ${이름}: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const got = items(json);
      // 0건이면 응답 앞부분을 같이 찍는다 — 대개 여기에 거절 사유(키·파라미터)가 들어 있다
      console.log(`  ${이름}: ${got.length}건` + (got.length ? "" : ` ${JSON.stringify(json).slice(0, 300)}`));
      if (got.length > rows.length) {
        rows = got;
        쓴것 = 이름;
      }
    } catch (e) {
      console.error(`  ${이름}: ${e.message}`);
      if (/certificate/i.test(e.message))
        console.error("   ↳ 인증서 문제면 NODE_TLS_REJECT_UNAUTHORIZED=0 으로 한 번만 확인 (붙일 때는 제대로 잡는다)");
    }
  }
  if (rows.length) {
    console.log(`  [첫 항목 원문] ${쓴것}`);
    console.log(" ", rows[0]);
  }
  return rows;
}

// --- ① 소통정보 (집계주기 5분) ---
// type=all 만 부른다 — ex/its 는 routeNo 가 필수라 좌표로 훑는 이 확인에 못 쓴다.
console.log("── 소통정보 ──");
const rows = await 가장많이주는("trafficInfo", [{ type: "all" }]);

const K = rows.length ? { link: keyOf(rows[0], "linkid"), speed: keyOf(rows[0], "speed") } : {};
if (rows.length && !K.link)
  console.error("  ⚠ linkId 키가 없다 — 위 원문을 보고 직접 지정할 것");

// --- ② 우리 표준노드링크와 대조 ---
const GEO = fileURLToPath(new URL("../data/jeju_link.geojson", import.meta.url));
const 도로 = new Map(); // LINK_ID → ROAD_NAME
const 관심점 = []; // [경도, 위도, 도로명] — CCTV 를 도로에 붙일 때 쓴다
for (const f of JSON.parse(readFileSync(GEO, "utf8")).features) {
  const name = f.properties.ROAD_NAME?.trim() || "(무명)";
  도로.set(String(f.properties.LINK_ID), name);
  if (관심도로.includes(name)) for (const [lo, la] of f.geometry?.coordinates ?? []) 관심점.push([lo, la, name]);
}

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

// --- ③ 소통정보 판정 ---
const 매칭 = rows.length - 미매칭;
console.log(`\n응답 ${rows.length}건 · 제주 링크 매칭 ${매칭} · 미매칭 ${미매칭}`);
console.log(`제주 전체 링크 ${도로.size}개 중 ${((매칭 / 도로.size) * 100).toFixed(1)}% 커버`);

const 평균 = (a) => (K.speed && a.v ? ` · 평균 ${Math.round(a.v / a.n)}km/h` : "");

console.log("\n관심 도로:");
for (const n of 관심도로) {
  const a = 응답.get(n);
  const t = 전체.get(n) ?? 0;
  const 꼬리 = a ? 평균(a) : t ? "  ❌ 소통정보 없음" : "  (표준노드링크에 이 이름이 없다 — 이름 확인)";
  console.log(`  ${n.padEnd(9)} ${String(a?.n ?? 0).padStart(4)}/${String(t).padStart(4)} 링크${꼬리}`);
}

if (응답.size) {
  console.log("\n응답이 많은 도로 상위 15:");
  for (const [n, a] of [...응답].sort((x, y) => y[1].n - x[1].n).slice(0, 15))
    console.log(`  ${n.padEnd(13)} ${String(a.n).padStart(4)}링크${평균(a)}`);
}

// --- ④ CCTV — "지금 차 없음"을 사진으로 보이려면 카메라가 그 도로 위에 있어야 한다 ---
//
// cctvType 3 = 정지영상. 우리가 원하는 건 이것뿐이다 — <img> 한 줄이면 끝이고,
// 초보에게 "지금 이 길"을 숫자 없이 보여준다. (1·4 는 HLS 스트리밍, 2·5 는 mp4)
// cctvInfo 는 trafficInfo 와 달리 bbox 에 type 제약이 없다. all 이 안 받으면 its·ex 로 떨어진다.
console.log("\n── CCTV (정지영상) ──");
const cams = await 가장많이주는(
  "cctvInfo",
  ["all", "its", "ex"].map((type) => ({ type, cctvType: 3 })),
);

if (cams.length) {
  const C = {
    x: keyOf(cams[0], "coordx"),
    y: keyOf(cams[0], "coordy"),
    name: keyOf(cams[0], "cctvname"),
    url: keyOf(cams[0], "cctvurl"),
  };

  /** 카메라를 도로에 붙이는 한계 거리. 폴 위치가 도로 중심선에서 조금 떨어져 찍힌다. */
  const 붙는거리m = 150;
  // 제주 위도(33.4°) 기준 1도당 미터. 최근접 판정에만 쓰므로 이 근사로 충분하다.
  const M = { lo: 92900, la: 111000 };

  const 카메라 = new Map(); // 도로명 → [{ name, url }]
  for (const c of cams) {
    // 문서 예제의 좌표에 세미콜론이 붙어 있다("127.12361;"). Number 면 NaN 이라 전부 버려진다.
    const lo = parseFloat(c[C.x]);
    const la = parseFloat(c[C.y]);
    if (!Number.isFinite(lo) || !Number.isFinite(la)) continue;

    let 최소 = Infinity;
    let 붙은도로 = null;
    for (const [plo, pla, name] of 관심점) {
      const dx = (plo - lo) * M.lo;
      const dy = (pla - la) * M.la;
      const d = dx * dx + dy * dy;
      if (d < 최소) {
        최소 = d;
        붙은도로 = name;
      }
    }
    if (Math.sqrt(최소) > 붙는거리m) continue; // 관심 도로에서 멀면 우리 경로 밖이다

    const arr = 카메라.get(붙은도로) ?? [];
    arr.push({ name: c[C.name], url: c[C.url] });
    카메라.set(붙은도로, arr);
  }

  console.log(`\n제주 CCTV ${cams.length}대 · 관심 도로 ${붙는거리m}m 안 ${[...카메라.values()].flat().length}대`);
  for (const n of 관심도로) {
    const arr = 카메라.get(n);
    console.log(`  ${n.padEnd(9)} ${String(arr?.length ?? 0).padStart(3)}대` + (arr ? `  예: ${arr[0].name} ${arr[0].url}` : "  ❌"));
  }
}
