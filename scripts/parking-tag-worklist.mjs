// 위성 태깅 대상 목록 만들기 —
//   node --env-file=.env.local --experimental-strip-types scripts/parking-tag-worklist.mjs
//
// 왜 필요한가 — 지금 화면의 "주차 쉬움"은 `주차장유형(노상/노외)`으로 추정한 값이다.
// 도로변에 칸을 그렸으면 평행일 확률이 높다는 간접 추론이라, 개별 주차장에서는 얼마든지 틀린다.
// 위성사진으로 구획을 직접 보면 그 추정이 사실로 바뀐다. 다만 사람 눈이 필요한 일이라
// 1,572곳을 다 볼 수는 없다 — **초보 관광객이 실제로 갈 곳부터** 본다.
//
// 우선순위: 카카오 관광명소(AT4) 반경 500m 안 + 구획수 많은 순.
//   · 관광지 근처 — 이 앱을 쓰는 사람이 실제로 대는 곳이다
//   · 구획수 많은 순 — 한 곳을 보면 더 많은 사람의 판단이 바뀐다
//
// 결과는 data/parking-tags.json 에 `parallel: null` 스켈레톤으로 쓴다. 사람이 링크를 열어
// 보고 true(평행) / false(직각)로 채우면, 다음 빌드에서 그 값이 프록시를 덮어쓴다.
// **이미 채워둔 값은 건드리지 않는다** — 다시 돌려도 새 대상만 추가된다.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${DATA}parking-tags.json`;

/** 관광명소에서 이 거리 안이면 "그 관광지 주차장"으로 본다. 도보 7분쯤이다. */
const NEAR_M = 500;

/** 한 번에 늘릴 태깅 대상 수. 사람이 앉은자리에 끝낼 만한 양으로 끊는다. */
const BATCH = 40;

const SOURCES = [
  "제주특별자치도_제주시_주차장정보_20260416.csv",
  "제주특별자치도_서귀포시_주차장정보_20260416.csv",
];

/** 제주 바운딩 박스 (lib/geocode.ts 와 같은 값) */
const JEJU_RECT = "126.05,33.05,126.99,33.62";

/** 카카오 카테고리 코드 — AT4 = 관광명소 */
const SIGHT = "AT4";

/** 따옴표 안의 쉼표를 살리는 최소 CSV 파서 (build-parking-data.mjs 와 같은 것) */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const rad = (d) => (d * Math.PI) / 180;
const meters = ([la1, lo1], [la2, lo2]) =>
  Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

const key = process.env.KAKAO_REST_API_KEY;
if (!key) {
  console.error("KAKAO_REST_API_KEY 가 없습니다. --env-file=.env.local 를 붙여 실행하세요.");
  process.exit(1);
}

/** 제주 관광명소. 카카오는 한 질의에 45곳(3페이지)까지 준다 — 우선순위 목록에는 그걸로 충분하다. */
async function sights() {
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const q = new URLSearchParams({ category_group_code: SIGHT, rect: JEJU_RECT, size: "15", page: String(page) });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) throw new Error(`카카오 관광명소 검색 실패 (HTTP ${res.status})`);
    const body = await res.json();
    found.push(...(body.documents ?? []).map((d) => ({ name: d.place_name, at: [+d.y, +d.x] })));
    if (body.meta?.is_end) break;
  }
  return found;
}

const lots = SOURCES.flatMap((f) => parseCsv(readFileSync(`${DATA}${f}`, "utf8").replace(/^﻿/, "")))
  .map((r) => ({
    id: r.주차장관리번호.trim(),
    name: r.주차장명.trim(),
    type: r.주차장유형,
    spaces: /^\d+$/.test(r.주차구획수?.trim() ?? "") ? +r.주차구획수 : 0,
    at: [+r.위도, +r.경도],
  }))
  .filter((l) => Number.isFinite(l.at[0]) && Number.isFinite(l.at[1]) && !(l.at[0] === 0 && l.at[1] === 0));

const 관광지 = await sights();
console.log(`관광명소 ${관광지.length}곳 기준으로 주변 ${NEAR_M}m 주차장을 고릅니다.`);

// 한 주차장이 여러 관광지에 걸릴 수 있다 — 가장 가까운 관광지 이름만 남긴다
const 후보 = new Map();
for (const lot of lots) {
  for (const s of 관광지) {
    const d = meters(s.at, lot.at);
    if (d > NEAR_M) continue;
    const prev = 후보.get(lot.id);
    if (!prev || d < prev.distM) 후보.set(lot.id, { ...lot, near: s.name, distM: Math.round(d) });
  }
}

const 기존 = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const 남은 = [...후보.values()]
  .filter((l) => typeof 기존[l.id]?.parallel !== "boolean") // 이미 채운 건 건드리지 않는다
  .sort((a, b) => b.spaces - a.spaces);

const 이번 = 남은.slice(0, BATCH);
const out = { ...기존 };
for (const l of 이번) {
  out[l.id] = {
    // 사람이 채울 칸. true = 평행(연석 옆), false = 직각(칸에 맞춰 대는 것)
    parallel: 기존[l.id]?.parallel ?? null,
    name: l.name,
    near: `${l.near} ${l.distM}m`,
    spaces: l.spaces,
    추정: l.type === "노상" ? "평행" : "직각", // 지금 프록시가 뭐라고 하는지 — 위성으로 확인할 대상이다
    /*
      링크를 셋 준다. 하나로 안 되는 경우가 실제로 있어서다.

      roadview 를 맨 앞에 둔다 — 평행/직각 판독에는 위에서 내려다보는 것보다 눈높이가 낫다.
      연석 옆에 그은 흰 선은 위성에서 차에 가려 안 보이는데, 로드뷰에서는 차가 어느 방향으로
      서 있는지가 그대로 보인다. 그게 곧 답이다.

      kakao 는 스카이뷰 버튼을 눌러야 하지만 제주 사진이 구글보다 최신인 곳이 있다.
      google 은 /place/ 를 앞에 붙여야 핀이 찍힌다 — /@ 만 쓰면 화면 가운데만 맞추고 마커가
      없어서, 이름이 "함덕리 1002-83" 같은 번지일 때 어느 부지가 그 주차장인지 알 수가 없다.
      (위성 타일이 검게 뜨는 환경이 있다. 그때는 앞의 둘을 쓴다.)
    */
    roadview: `https://map.kakao.com/link/roadview/${l.at[0]},${l.at[1]}`,
    kakao: `https://map.kakao.com/link/map/${encodeURIComponent(l.name)},${l.at[0]},${l.at[1]}`,
    satellite: `https://www.google.com/maps/place/${l.at[0]},${l.at[1]}/@${l.at[0]},${l.at[1]},19z/data=!3m1!1e3`,
  };
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

const 채운수 = Object.values(out).filter((v) => typeof v.parallel === "boolean").length;
console.log(`관광지 주변 주차장 ${후보.size}곳 중 ${이번.length}곳을 이번 목록에 추가했습니다 → data/parking-tags.json`);
console.log(`  채워진 것 ${채운수}곳 / 남은 것 ${Object.keys(out).length - 채운수}곳`);
console.log("  parallel 을 true(평행)·false(직각)로 채운 뒤 build-parking-data.mjs 를 다시 돌리세요.");
for (const l of 이번.slice(0, 5)) console.log(`   · ${l.name} (${l.near} ${l.distM}m, ${l.spaces}면, 추정 ${l.type === "노상" ? "평행" : "직각"})`);
