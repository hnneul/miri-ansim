// 링크별 자유속도 굳히기 — JEJU_ITS_API_KEY=... node scripts/build-road-baseline.mjs
//
// 무엇을 굳히나: 표준링크마다 **차가 없을 때 이 조각이 얼마나 빠른가**(자유속도)다.
// 제주ITS 시간별 통계(getFrafficInfoHourlyStat)를 평일 7일치 받아 링크별 중앙값으로 만든다.
//
// **왜 도로명이 아니라 링크 단위인가.** 도로명으로 묶었다가 틀린 값이 나왔다 — 항몽로는
// 제한속도 50 구간과 30 구간이 62개 링크에 섞여 있어 도로 평균이 33km/h 인데, 실시간 API 는
// 커버리지(전체 링크의 32%)에 걸린 빠른 구간만 준다. 그래서 지금 46km/h 가 오면 33 으로 나뉘어
// 여유율 139% 라는 없는 숫자가 만들어졌다. **분자와 분모가 같은 링크를 봐야** 비율이 뜻을 갖는다.
//
// **왜 굳히나.** 실시간 API 는 "지금 이 길 34km/h" 까지만 말한다. 34 가 한산한 건지 막힌 건지는
// 그 길이 원래 몇 km/h 인지를 알아야 판정된다 — 애월로는 비어도 22km/h 고, 번영로는 비면
// 57km/h 다. 그 비교 기준이 이 파일이다.
//
// **왜 교통량(tfvl)이 아니라 속도인가.** ITS 가 교통량 필드를 주긴 하는데 실측으로 확인해 보니
// 289,940건 중 1,439건(0.5%)만 채워져 있고, 점유율(ocpy_rate)은 전부 0 이다. 일간 통계 API 는
// 아예 미신청(code not registered)이다. 그래서 차 대수는 직접 얻을 수 없다.
// 대신 낮에 속도가 얼마나 떨어지는지로 역산한다 — 결과가 상식과 맞는다:
// 하위권이 노형로·서광로·연북로(제주시 상습 정체구간), 상위권이 애월해안로·산방로다.
//
// **하루치를 안 쓰는 이유.** 그날 사고 한 건이 링크 하나의 기준선을 통째로 망친다.
// 7일 중앙값이면 하루짜리 이상값은 가운데로 밀려난다 (평균이 아니라 중앙값인 이유이기도 하다).

import { writeFileSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEY = process.env.JEJU_ITS_API_KEY ?? readFileSync(".env.local", "utf8").match(/^JEJU_ITS_API_KEY=(.+)$/m)?.[1].trim();
if (!KEY) {
  console.error("JEJU_ITS_API_KEY 없음 — jejuits.go.kr/open_api 에서 신청 후 .env.local 에");
  process.exit(1);
}

/**
 * 평일 7일. 주말을 빼는 이유: 관광지 도로가 주말에만 막혀서, 섞으면 애월해안로 같은 길이
 * "원래 좀 막히는 길"로 굳는다. 초보가 주말에 더 많이 몰긴 하지만, 그건 기준선이 아니라
 * 실시간 값이 말할 몫이다 — 기준선은 "차 없을 때 이 길의 속도"여야 한다.
 */
const 날짜 = ["20260817", "20260814", "20260813", "20260812", "20260811", "20260810", "20260807"];

/** 자유속도를 재는 시간대. 새벽 3~5시가 제주에서 가장 비는 시각이다. */
const 새벽 = [3, 4, 5];

/**
 * 자유속도 하한(km/h). 이보다 느린 링크는 굳히지 않는다.
 *
 * 여유율만 보면 골목이 1등을 한다 — 새벽 10km/h 인 길은 낮에도 12km/h 라 여유율 120% 다.
 * 차가 없어서가 아니라 원래 좁아서 느린 것이고, 초보에게 권할 길은 더더욱 아니다.
 * "차가 없다"는 말이 성립하려면 **차가 있으면 느려질 수 있는 길**이어야 한다.
 */
const MIN_FREE_KMH = 30;

/** 7일 중 이만큼도 못 받은 링크는 중앙값이 중앙값 노릇을 못 한다. */
const MIN_DAYS = 4;

const DATA = fileURLToPath(new URL("../data/", import.meta.url));

// --- 날짜별 수집: link_id → [하루치 새벽 평균…] ---
const 표본 = new Map();
for (const d of 날짜) {
  const url = `http://api.jejuits.go.kr/api/getFrafficInfoHourlyStat?${new URLSearchParams({ code: KEY, type: "L", statDt: d })}`;
  const json = await (await fetch(url)).json();
  if (json.result !== "success") {
    console.error(`  ${d}: ${json.result} — 건너뛴다`);
    continue;
  }

  // 같은 날 같은 링크의 새벽 세 시각을 먼저 하루치 평균 하나로 접는다.
  // 접지 않고 전부 쌓으면 시각이 많이 잡힌 링크가 중앙값을 좌우한다.
  const 하루 = new Map();
  for (const r of json.info) {
    if (!r.sped) continue; // 0 은 속도가 아니라 정보없음이다
    if (!새벽.includes(+r.stat_dt.slice(8, 10))) continue;
    const k = String(r.link_id);
    const a = 하루.get(k) ?? { n: 0, s: 0 };
    a.n++;
    a.s += r.sped;
    하루.set(k, a);
  }
  for (const [k, a] of 하루) {
    const t = 표본.get(k) ?? [];
    t.push(a.s / a.n);
    표본.set(k, t);
  }
  console.log(`  ${d}: 링크 ${하루.size}개`);
}

/** 중앙값. 하루짜리 이상값(사고·통제)을 가운데로 밀어내는 게 이 함수를 쓰는 이유다. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- 굳히기 ---
// 값 하나(자유속도)뿐이라 { link_id: free } 로 납작하게 둔다 — 객체로 감싸면 파일이 세 배다.
const out = {};
let 버림 = 0;
for (const [id, xs] of 표본) {
  if (xs.length < MIN_DAYS) {
    버림++;
    continue;
  }
  const free = Math.round(median(xs));
  if (free < MIN_FREE_KMH) {
    버림++;
    continue;
  }
  out[id] = free;
}

const OUT = `${DATA}road-baseline.json`;
writeFileSync(OUT, JSON.stringify(out));

// 도로명별로 접어 사람이 읽을 수 있게 요약한다 (굳히는 값 자체는 링크 단위다)
const 도로 = new Map();
for (const f of JSON.parse(readFileSync(`${DATA}jeju_link.geojson`, "utf8")).features) {
  const n = f.properties.ROAD_NAME?.trim();
  const free = out[String(f.properties.LINK_ID)];
  if (!n || n === "-" || !free) continue;
  const a = 도로.get(n) ?? [];
  a.push(free);
  도로.set(n, a);
}
const 요약 = [...도로].filter(([, a]) => a.length >= 20).map(([n, a]) => [n, Math.round(median(a)), a.length]);
요약.sort((x, y) => y[1] - x[1]);

console.log(`\n링크 ${Object.keys(out).length}개 굳힘 (표본 부족·골목으로 버린 링크 ${버림}개) · ${(statSync(OUT).size / 1024).toFixed(0)}KB`);
console.log("\n빌 때 가장 빠른 길 5 (링크 20개 이상인 도로):");
for (const [n, v, c] of 요약.slice(0, 5)) console.log(`  ${n.padEnd(14)} 자유속도 ${String(v).padStart(3)}km/h  (링크 ${c}개)`);
console.log("\n빌 때 가장 느린 길 5:");
for (const [n, v, c] of 요약.slice(-5).reverse()) console.log(`  ${n.padEnd(14)} 자유속도 ${String(v).padStart(3)}km/h  (링크 ${c}개)`);
