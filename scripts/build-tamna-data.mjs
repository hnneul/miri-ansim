// 탐나는전 캐시백 가맹점 데이터 생성 — node scripts/build-tamna-data.mjs
//
// 출처: 공공데이터포털 15157894 「제주특별자치도_탐나는전 가맹점 데이터」(2026-03-31, 48,081행)
//       https://www.data.go.kr/data/15157894/fileData.do — 이용허락범위 제한 없음
//       원본 CSV 를 data/ 에 그대로 두고 여기서 읽는다 (주차장 CSV 와 같은 방식).
//
// 원본에는 **좌표가 없다.** 주소만 있어서 카카오 로컬 주소검색으로 붙인다 —
// 착한가격업소(build-goodprice-data.mjs)는 출처가 위경도를 줘서 그냥 굳히면 됐지만 여기는 아니다.
//
// 두 번 거른다:
//   · 캐시백 인센티브 가맹점만 (44,815곳) — 이 화면이 파는 건 "여기서 결제하면 10% 돌려받는다"다
//   · 관광객이 렌터카 타고 실제로 들르는 업종만 (14,505곳)
//     전체 21개 업종을 다 찍으면 지도가 학원·철물점·식자재 도매상으로 덮인다.
//
// 중간에 끊겨도 다시 돌리면 이어서 한다 — 이미 좌표를 붙인 주소는 건너뛴다.
// 14,505번 호출이라 처음부터 다시 하면 20분을 버린다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 프로젝트 경로에 한글이 있어 URL.pathname은 못 쓴다 (퍼센트 인코딩이 남는다)
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));
const SRC = `${DATA}제주특별자치도_탐나는전_가맹점_20260331.csv`;
const OUT = `${DATA}tamna-data.json`;
/** 주소 → 좌표 캐시. 굳혀둔 데이터에 주소를 싣지 않으므로(파일이 두 배가 된다) 따로 둔다. */
const CACHE = `${DATA}tamna-geocode.json`;

const KEY = readFileSync(ENV, "utf8")
  .split("\n")
  .find((l) => l.startsWith("KAKAO_REST_API_KEY="))
  ?.split("=")[1]
  ?.trim();
if (!KEY) throw new Error("KAKAO_REST_API_KEY 없음 (.env.local)");

/**
 * 남길 업종 → 화면에 쓸 짧은 이름.
 * 원본 이름("음식점/식음료업")을 그대로 칩에 넣으면 칩 한 개가 화면 폭 절반을 먹는다.
 */
const KINDS = {
  "음식점/식음료업": "음식점",
  "여행/숙박": "숙박",
  "자동차/주유": "주유",
};

/** 동시 호출 수. 카카오 로컬은 초당 제한이 있어 늘리면 429 가 돌아온다. */
const CONCURRENCY = 8;

/** 이 건수마다 중간 저장. 끊겨도 여기까지는 남는다. */
const CHECKPOINT = 500;

/** 제주 바깥 결과는 버린다 (lib/geocode.ts 의 JEJU_RECT 와 같은 범위) */
const inJeju = ([la, lo]) => la > 33.05 && la < 33.62 && lo > 126.05 && lo < 126.99;

/**
 * 따옴표를 아는 최소 CSV 파서. 원본 48,081행 중 21,039행에 따옴표가 있어
 * split(",") 로는 상호명·주소가 잘린다.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""));
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows;
}

/**
 * 주소검색이 먹는 형태로 자른다: "서귀포시 남원읍 태위로 87 1층 만조" → "서귀포시 남원읍 태위로 87".
 * 층·호·상호가 뒤에 붙은 주소가 대부분인데, 그대로 넣으면 검색이 빈손으로 돌아온다.
 * 14,505곳 중 14,491곳이 이 꼴로 잘린다 — 나머지는 좌표를 못 붙이고 버린다.
 *
 * ponytail: 주소검색 한 번만 하고 실패하면 버린다 (주소 11,340건 중 1,125건 실패 → 2,390곳 손실).
 *   대부분 지번주소이거나 신축이라 도로명 DB에 없는 곳이다. 더 건지려면 실패분만
 *   키워드 검색(가맹점명 + 읍면동)으로 한 번 더 부르면 된다 — 1,125회면 1분이다.
 */
const TAIL = /^(.*?(?:로|길|동|리)\s*[0-9]+(?:-[0-9]+)?)/;
const normalize = (addr) => {
  const a = addr.replace("제주특별자치도 ", "").trim();
  return TAIL.exec(a)?.[1] ?? a;
};

/** 카카오 주소검색. 429 는 잠깐 쉬고 다시 — 초당 제한은 기다리면 풀린다. */
async function geocode(query, tries = 3) {
  const q = new URLSearchParams({ query, size: "1" });
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?${q}`, {
      headers: { Authorization: `KakaoAK ${KEY}` },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    if (!res.ok) return null;
    const doc = (await res.json()).documents?.[0];
    if (!doc) return null;
    const at = [+(+doc.y).toFixed(5), +(+doc.x).toFixed(5)];
    return inJeju(at) ? at : null;
  }
  return null;
}

// ── 읽고 거르기 ─────────────────────────────────────────────────────────────
// 원본은 CP949 다. WHATWG 의 "euc-kr" 이 곧 CP949 라 이 이름으로 디코딩된다.
const text = new TextDecoder("euc-kr").decode(readFileSync(SRC));
const [header, ...lines] = parseCsv(text);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

const targets = [];
for (const r of lines) {
  if (r.length < header.length) continue;
  if (r[col["캐시백 인센티브 가맹점 여부"]].trim() !== "Y") continue;
  const kind = KINDS[r[col["가맹점 업종"]].trim()];
  if (!kind) continue;
  targets.push({
    name: r[col["가맹점명"]].trim(),
    kind,
    addr: r[col["가맹점 주소"]].replace("제주특별자치도 ", "").trim(),
    query: normalize(r[col["가맹점 주소"]]),
  });
}
console.log(`거른 뒤 ${targets.length}곳 (캐시백 Y + 음식점·숙박·주유)`);

// ── 이어하기 ────────────────────────────────────────────────────────────────
// 같은 건물에 여러 가맹점이 있어 주소가 겹친다 — 주소 하나당 한 번만 부른다.
let cache = new Map();
if (existsSync(CACHE)) cache = new Map(Object.entries(JSON.parse(readFileSync(CACHE, "utf8"))));
if (cache.size) console.log(`이미 받아둔 좌표 ${cache.size}건은 건너뛴다`);

const queries = [...new Set(targets.map((t) => t.query))].filter((q) => !cache.has(q));
console.log(`부를 주소 ${queries.length}건 (중복 제거)`);

/**
 * 굳혀둔 데이터에는 이름·업종·좌표만 넣는다. 주소는 카드에 그리지 않는데(/parking 카드와 같다)
 * 12,000곳어치를 실으면 파일이 두 배가 된다 — 이 파일은 "use client" 화면이 통째로 내려받는다.
 * 지오코딩 캐시는 다시 돌릴 때만 필요하므로 따로 쓴다.
 */
const save = () => {
  writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache)));
  const shops = targets
    .map((t) => ({ name: t.name, kind: t.kind, at: cache.get(t.query) }))
    .filter((s) => s.at);
  writeFileSync(
    OUT,
    JSON.stringify({
      source: "공공데이터포털 15157894 제주특별자치도_탐나는전 가맹점 데이터 (2026-03-31)",
      note: "캐시백 인센티브 가맹점 중 음식점·숙박·주유. 좌표는 카카오 로컬 주소검색으로 붙였다.",
      total: shops.length,
      shops,
    }),
  );
  return shops.length;
};

let done = 0;
let failed = 0;
const queue = queries.slice();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const q = queue.shift();
      const at = await geocode(q);
      if (at) cache.set(q, at);
      else failed++;
      if (++done % CHECKPOINT === 0) console.log(`  ${done}/${queries.length} (실패 ${failed}) — ${save()}곳 저장`);
    }
  }),
);

const n = save();
console.log(`완료: ${n}곳 저장 (주소 ${queries.length}건 중 ${failed}건 실패) → data/tamna-data.json`);
