// 제주 신호교차로 좌표화 — node --env-file=.env.local scripts/build-signal-data.mjs
//
// 왜 필요한가 — 비보호 좌회전을 제주 전역에서 판독하려면 어디를 볼지부터 정해야 하는데,
// **비보호는 신호등이 있는 교차로에서만 성립한다** (신호가 없으면 그 말 자체가 성립하지 않는다,
// scripts/left-turn-worklist.mjs 의 판정 규칙과 같다). 제주 교차로 12,440곳 중 신호가 있는 건
// 1,025곳뿐이라, 이걸로 거르면 판독 후보가 10,682 → 3,000건 안팎으로 준다. 판독은 건당 돈이
// 들어서 이 차이가 곧 비용이다.
//
// 원본: data/제주특별자치도_신호기현황_20221216.csv (공공데이터포털 15110599, cp949)
//   컬럼이 연번·주소·기하구조·관리부서 뿐이고 **좌표가 없다.** 그래서 지번주소를 카카오
//   주소검색으로 좌표화한다 (lib/geocode.ts 와 같은 엔드포인트·같은 키).
//
// 단일로는 뺀다 — 교차로가 아니라 횡단보도 신호라 좌회전이라는 개념이 없다.
//
// **이미 좌표를 얻은 주소는 다시 부르지 않는다.** 중간에 끊겨도 이어서 돌리면 된다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const SRC = `${DATA}제주특별자치도_신호기현황_20221216.csv`;
const OUT = `${DATA}jeju-signals.json`;

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";
/** 제주 밖 결과가 섞이지 않게 막는다 (lib/geocode.ts 의 JEJU_RECT 와 같은 값). */
const JEJU_RECT = "126.05,33.05,126.99,33.62";
const SLEEP_MS = 60;

const key = process.env.KAKAO_REST_API_KEY;
if (!key) {
  console.error("KAKAO_REST_API_KEY 없음 — --env-file=.env.local 을 붙이세요");
  process.exit(1);
}

// 공공데이터포털 CSV 는 cp949 다. utf-8 로 읽으면 주소가 통째로 깨져 지오코딩이 전부 실패한다.
const text = new TextDecoder("euc-kr").decode(readFileSync(SRC));
const [head, ...lines] = text.trim().split(/\r?\n/);
const col = head.split(",").map((c) => c.trim());
const rows = lines.map((l) => {
  const v = l.split(",").map((c) => c.trim());
  return Object.fromEntries(col.map((c, i) => [c, v[i]]));
});

/** 교차로만 남긴다. 단일로는 횡단보도 신호라 좌회전 판정 대상이 아니다. */
const 교차로 = rows.filter((r) => r.기하구조 !== "단일로");

const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let 새로 = 0;
let 실패 = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const r of 교차로) {
  const 주소 = r.주소;
  if (done[주소]) continue;

  const q = new URLSearchParams({ query: 주소, rect: JEJU_RECT, size: "1" });
  let doc = null;
  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) doc = (await res.json()).documents?.[0] ?? null;
    else if (res.status === 429) {
      console.error("  429 — 쿼터 초과. 잠시 후 다시 돌리면 이어서 갑니다.");
      break;
    }
  } catch (e) {
    console.error(`  ${주소}: ${e.message}`);
  }

  if (!doc) {
    // **못 찾은 주소를 좌표 없이 넣지 않는다.** 넣으면 엉뚱한 자리에 후보가 생기고,
    // 그건 "없는 것"이 아니라 "틀린 것"이라 훨씬 나쁘다.
    실패++;
  } else {
    done[주소] = {
      lat: +doc.y,
      lng: +doc.x,
      기하구조: r.기하구조,
      관리부서: r.관리부서,
    };
    새로++;
  }
  if (새로 % 50 === 0 && 새로) {
    writeFileSync(OUT, JSON.stringify(done, null, 1) + "\n");
    console.log(`  ${Object.keys(done).length}/${교차로.length}`);
  }
  await sleep(SLEEP_MS);
}

writeFileSync(OUT, JSON.stringify(done, null, 1) + "\n");

const 지형 = {};
for (const v of Object.values(done)) 지형[v.기하구조] = (지형[v.기하구조] ?? 0) + 1;
console.log(`\n신호기 ${rows.length}건 · 교차로 ${교차로.length}건 (단일로 ${rows.length - 교차로.length} 제외)`);
console.log(`좌표 확보 ${Object.keys(done).length}건 · 이번에 ${새로} · 실패 ${실패}`);
console.log(`기하구조: ${JSON.stringify(지형)}`);
console.log(`→ ${OUT}`);
