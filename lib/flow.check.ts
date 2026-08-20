// 차 없는 길 검증 — node --experimental-strip-types lib/flow.check.ts
//
// 네트워크를 타지 않는다. 검증할 게 ITS 가 응답하느냐가 아니라, 받은 값을 어떻게
// 내 자리에 붙이느냐이기 때문이다:
//   ① 0 을 속도로 세지 않는가 (0 은 정보없음이다 — 세면 "0km/h 정체"가 만들어진다)
//   ② 반경 밖 도로를 "내 주변"으로 올리지 않는가 (한라산 건너편이 올라오면 거짓말이다)
//   ③ 조각 몇 개로 도로를 대표하지 않는가 (신호 하나에 흔들리는 값이다)
//   ④ "차 없는 길" 순위가 속도가 아니라 여유율로 매겨지는가 (속도로 줄세우면 간선이 늘 이긴다)
//
// 픽스처의 link_id·sped 형태는 실제 응답에서 확인한 것이다 (lib/flow.ts 주석 참고).

import assert from "node:assert";
import { buildIndex, type Link } from "./analyze.ts";
import { speedMap, clockOf, flowNear, calmRoads, type Baseline } from "./flow.ts";
import { flowLabel } from "./traffic.ts";

// --- ① 속도 맵 ---

assert.deepEqual(
  [...speedMap([{ link_id: "4050021604", sped: 38, prcn_dt: "" }]).entries()],
  [["4050021604", 38]],
);
// 0 은 속도가 아니라 정보없음이다 — 담으면 평균을 끌어내려 없는 정체를 만든다
assert.equal(speedMap([{ link_id: "4050021604", sped: 0, prcn_dt: "" }]).size, 0);

// --- ② 조회 시각 ---

assert.equal(clockOf("20260818210500"), "21:05");
assert.equal(clockOf(undefined), null); // 없으면 지어내지 않는다
assert.equal(clockOf("2026"), null); // 형식이 다르면 읽지 않는다

// --- ③ 내 주변 흐름 ---

// 제주시청(33.4996, 126.5312) 부근에 도로를 깐다. 경도 0.01도 ≈ 930m, 위도 0.01도 ≈ 1.1km.
const 시청: [number, number] = [33.4996, 126.5312];

/** 링크 한 줄. c 는 GeoJSON 순서 [경도, 위도] 다. */
const link = (i: string, n: string | null, la: number, lo: number): Link => ({
  i,
  n,
  l: 2,
  s: 60,
  c: [
    [lo, la],
    [lo + 0.0005, la],
  ],
});

// 시청 바로 위에 평화로 3조각, 3km 밖(위도 +0.05 ≈ 5.5km)에 번영로 3조각
const links: Link[] = [
  link("A1", "평화로", 33.4996, 126.5312),
  link("A2", "평화로", 33.4997, 126.5322),
  link("A3", "평화로", 33.4998, 126.5332),
  link("F1", "번영로", 33.5496, 126.5312),
  link("F2", "번영로", 33.5497, 126.5322),
  link("F3", "번영로", 33.5498, 126.5332),
];
const index = buildIndex(links);

// 반경 밖 도로는 올라오지 않는다 — 번영로가 100km/h 로 달려도 내 주변 이야기가 아니다
const speeds = new Map([
  ["A1", 54],
  ["A2", 56],
  ["A3", 58],
  ["F1", 100],
  ["F2", 100],
  ["F3", 100],
]);
assert.deepEqual(flowNear(index, speeds, 시청), { road: "평화로", kmh: 56 });

// 조각이 MIN_LINKS(3) 미만이면 대표하지 않는다 — 값이 있어도 말하지 않는다
assert.equal(flowNear(index, new Map([["A1", 54]]), 시청), null);

// 값이 하나도 없으면 null (ITS 커버리지 밖에 선 경우)
assert.equal(flowNear(index, new Map(), 시청), null);

// 이름 없는 링크("-", null)는 도로로 세지 않는다 — 근거 카드에 "- 56km/h" 가 찍히면 안 된다
const 무명 = buildIndex([
  link("N1", "-", 33.4996, 126.5312),
  link("N2", null, 33.4997, 126.5322),
  link("N3", "", 33.4998, 126.5332),
]);
assert.equal(flowNear(무명, new Map([["N1", 40], ["N2", 40], ["N3", 40]]), 시청), null);

// 내가 선 도로가 우선이다 — 주변에 링크가 더 많은 도로가 있어도 자기가 달리는 길을 말한다
const 겹침 = buildIndex([
  link("M1", "516로", 33.4996, 126.5312), // 시청 바로 위
  link("M2", "516로", 33.4997, 126.5314),
  link("M3", "516로", 33.4998, 126.5316),
  ...[0, 1, 2, 3, 4].map((k) => link(`B${k}`, "일주동로", 33.5006 + k * 0.0001, 126.5352)),
]);
const 겹침속도 = new Map([
  ["M1", 44], ["M2", 46], ["M3", 45],
  ["B0", 30], ["B1", 30], ["B2", 30], ["B3", 30], ["B4", 30],
]);
assert.deepEqual(flowNear(겹침, 겹침속도, 시청), { road: "516로", kmh: 45 });

// --- ④ 차 없는 길 ---

// 느린 길이 이길 수 있어야 한다. 애월로는 22km/h 로 자유속도(22)를 꽉 채워 달리고,
// 번영로는 50km/h 로 두 배 넘게 빠르지만 자유속도(57)의 88% 다 — 지금 차가 없는 쪽은 애월로다.
// km/h 로 줄세우면 번영로가 이겨서 "차 없는 길"이 거짓말이 된다.
const 비교 = buildIndex([
  link("S1", "애월로", 33.4996, 126.5312),
  link("S2", "애월로", 33.4997, 126.5314),
  link("S3", "애월로", 33.4998, 126.5316),
  link("F1", "번영로", 33.5, 126.532),
  link("F2", "번영로", 33.5001, 126.5322),
  link("F3", "번영로", 33.5002, 126.5324),
]);
// 기준선은 링크 단위다 — 도로 평균끼리 나누면 실시간과 다른 조각을 보게 된다
const 기준선: Baseline = { S1: 22, S2: 22, S3: 22, F1: 57, F2: 57, F3: 57 };
const 지금 = new Map([
  ["S1", 22], ["S2", 22], ["S3", 22],
  ["F1", 50], ["F2", 50], ["F3", 50],
]);
assert.deepEqual(
  calmRoads(비교, 지금, 시청, 기준선).map((r) => r.road),
  ["애월로", "번영로"],
);
// 여유율은 지금 ÷ 자유속도다 — 50/57 = 0.88
assert.equal(calmRoads(비교, 지금, 시청, 기준선).find((r) => r.road === "번영로")?.ease, 0.88);

// 여유율 하한(0.8) 아래는 "차 없는 길"이 아니라 막힌 길이라 목록에서 빠진다.
// 애월로 10/22 = 0.45, 번영로 40/57 = 0.70 — 둘 다 걸린다.
const 막힘 = new Map([["S1", 10], ["S2", 10], ["S3", 10], ["F1", 40], ["F2", 40], ["F3", 40]]);
assert.deepEqual(calmRoads(비교, 막힘, 시청, 기준선).map((r) => r.road), []);

// 기준선에 없는 링크는 건너뛴다 — 나눌 자유속도가 없으면 비율을 만들 수 없다
assert.deepEqual(calmRoads(비교, 지금, 시청, { S1: 22, S2: 22, S3: 22 }).map((r) => r.road), ["애월로"]);

// 짝이 안 맞는 링크는 지금 속도도 같이 버린다. F1 만 기준선이 있으면 번영로는 링크 1개라
// MIN_LINKS(3) 미달로 빠진다 — 남은 한 조각으로 도로 전체를 대표하지 않는다.
assert.deepEqual(
  calmRoads(비교, 지금, 시청, { S1: 22, S2: 22, S3: 22, F1: 57 }).map((r) => r.road),
  ["애월로"],
);

// limit 을 넘겨 자르지 않는다
assert.equal(calmRoads(비교, 지금, 시청, 기준선, 1).length, 1);

// 골목은 차가 아무리 없어도 권하지 않는다 — 이름이 "길"로 끝나면 세부도로다.
// (차로수만으로는 안 걸러진다. 실제로 2차로짜리 "섭지코지로25번길"이 1등으로 올라왔었다.)
const 골목판 = buildIndex([
  link("G1", "섭지코지로25번길", 33.4996, 126.5312),
  link("G2", "한림서길", 33.4997, 126.5314),
  link("G3", "환해장성로729번길", 33.4998, 126.5316),
]);
assert.deepEqual(
  calmRoads(골목판, new Map([["G1", 40], ["G2", 40], ["G3", 40]]), 시청, { G1: 40, G2: 40, G3: 40 }),
  [],
);

// 왕복 1차로도 뺀다 — 이 앱이 위험요인(narrowRoad)으로 세는 조건을 추천으로 뒤집지 않는다
const 좁은길 = buildIndex(
  ["N1", "N2", "N3"].map((i, k) => ({ ...link(i, "한적로", 33.4996 + k * 0.0001, 126.5312), l: 1 })),
);
assert.deepEqual(calmRoads(좁은길, new Map([["N1", 40], ["N2", 40], ["N3", 40]]), 시청, { N1: 40, N2: 40, N3: 40 }), []);

// --- ⑤ 문구는 traffic.ts 와 같은 잣대를 쓴다 (두 화면이 다른 말을 하면 안 된다) ---

assert.equal(flowLabel(flowNear(index, speeds, 시청)!.kmh), null); // 56 — 중간이라 할 말이 없다
assert.equal(flowLabel(82), "82km/h로 빠르게 흐름");
assert.equal(flowLabel(45), "45km/h로 느긋하게 흐름");

console.log("✅ 차 없는 길 정상");
console.log("   0km/h → 정보없음으로 버림 · 반경 3km 밖 제외 · 3조각 미만 도로는 대표하지 않음");
console.log("   내가 선 도로 우선, 이름 없는 골목이면 주변 간선으로");
console.log("   순위는 km/h 가 아니라 여유율(지금 ÷ 자유속도) — 느린 길도 비어 있으면 이긴다");
console.log("   여유율은 링크끼리 짝지어 낸다 (도로 평균끼리 나누면 139% 같은 값이 나온다)");
console.log("   골목(이름이 \"길\"로 끝남)·왕복 1차로는 차가 없어도 목록에 안 올린다");
