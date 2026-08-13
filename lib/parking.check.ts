// 주차장 프록시 검증 — node --experimental-strip-types lib/parking.check.ts
//
// 두 가지를 본다:
//   ① 판정 로직이 경계에서 맞는가 (평행주차 확률을 낮게 말하면 초보를 그대로 보내게 된다)
//   ② 프록시를 뒷받침하는 근거가 실제 데이터에 남아 있는가 — 데이터가 갱신돼 노상·노외
//      구획수 분포가 뒤집히면 "노상=평행"이라는 전제가 무너지므로 여기서 먼저 깨져야 한다.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parallelOdds, recommendedSpots, nearestSpots, nearbyParking,
  spotsAround, walkMinutes, isEasyParking, WALK10_M,
  type Parking, type ParkingSpot, type Lot,
} from "./parking.ts";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("../data/parking-data.json", import.meta.url)), "utf8"));

// --- ① 판정 로직 ---
const lot = (type: string, walkM: number): ParkingSpot => ({ name: type + walkM, type, spaces: 10, fee: "무료", walkM, at: [33, 126] });
const make = (onStreet: number, offStreet: number): Parking => ({
  label: "테스트",
  at: [33, 126],
  walkM: 1000,
  total: onStreet + offStreet,
  byType: { 노상: onStreet, 노외: offStreet },
  spots: [...Array(onStreet)].map((_, i) => lot("노상", i * 10)).concat([...Array(offStreet)].map((_, i) => lot("노외", 500 + i * 10))),
});

assert.equal(parallelOdds(make(0, 25)).level, "low"); // 노상 0곳 → 평행 걱정 없음
assert.equal(parallelOdds(make(1, 24)).level, "mixed"); // 한 곳이라도 있으면 low 가 아니다
assert.equal(parallelOdds(make(12, 13)).level, "mixed"); // 48% — 경계 바로 아래
assert.equal(parallelOdds(make(13, 12)).level, "high"); // 52% — 경계 바로 위
assert.equal(parallelOdds(make(1, 1)).level, "high"); // 50% 정확히 → 높은 쪽으로 판정한다
assert.equal(parallelOdds(make(5, 0)).level, "high"); // 전부 노상 = 최악
// 대안이 없으면 "노외를 먼저 보라"고 말하지 않는다 (없는 선택지를 권하면 안 된다)
assert.ok(!parallelOdds(make(5, 0)).detail.includes("먼저"));
assert.ok(parallelOdds(make(5, 1)).detail.includes("먼저"));

// --- 화면 문구 ---
// "노상·노외"는 주차장법 제2조 법령 용어라 일반 운전자가 안 쓰는 말이다.
// 데이터 값과 출처에는 남기되, 사용자가 읽는 문장에는 넣지 않는다.
for (const [on, off] of [[0, 25], [1, 24], [13, 12], [5, 0]] as const) {
  const o = parallelOdds(make(on, off));
  for (const 문장 of [o.headline, o.detail])
    assert.ok(!/노상|노외/.test(문장), `법령 용어가 화면 문구에 샜다: "${문장}"`);
}

// 사실(구획 수·비율)은 문구를 쉽게 풀어도 남아야 한다
const d1312 = parallelOdds(make(13, 12)).detail;
assert.ok(d1312.includes("13곳") && d1312.includes("52%"), "사실이 빠졌다");

// 개수는 유형 합계가 아니라 total 기준 — 부설 등 제3의 유형이 들어와도 노상이 아니면 노상이 아니다
const withOther: Parking = { ...make(2, 0), total: 10, byType: { 노상: 2 } };
assert.equal(parallelOdds(withOther).offStreet, 8);
assert.equal(parallelOdds(withOther).level, "mixed");

// 초보 추천은 노상을 빼고 가까운 순
const rec = recommendedSpots(make(3, 5));
assert.equal(rec.length, 3);
assert.ok(rec.every((s) => s.type !== "노상"), "노상을 추천하면 안 된다");
assert.deepEqual(rec.map((s) => s.walkM), [500, 510, 520]);
assert.equal(recommendedSpots(make(5, 0)).length, 0);

// 경력자 목록은 유형을 안 가린다 — 평행/직각이 상관없는 사람에게 노상을 숨기면
// 가장 가까운 주차장을 빼앗는 셈이다
const near = nearestSpots(make(3, 5));
assert.equal(near.length, 5);
assert.ok(near.some((s) => s.type === "노상"), "경력자에게는 노상도 보여야 한다");
assert.deepEqual(near.map((s) => s.walkM), [0, 10, 20, 500, 510], "가까운 순이 아니다");
// 노상뿐인 목적지에서도 빈손으로 돌려보내지 않는다 (recommendedSpots 는 0곳이 되는 경우)
assert.equal(nearestSpots(make(5, 0)).length, 5);

// --- ② 프록시 근거 (data/parking-data.json) ---
const { 노상: on, 노외: off } = DATA.stats;
assert.ok(off, "노외 표본이 없다");
if (on) {
  // 노상이 노외보다 작은 구획 위주여야 "도로변 몇 칸 = 평행주차"라는 해석이 성립한다
  assert.ok(on.medianSpaces < off.medianSpaces, `노상 중앙값(${on.medianSpaces}면)이 노외(${off.medianSpaces}면)보다 작아야 한다`);
  assert.ok(on.under10Pct > off.under10Pct, "노상이 10면 이하 비중이 더 높아야 한다");
}

/** 두 좌표 사이 미터 (build-parking-data.mjs 와 같은 평면 근사) */
const rad = (deg: number) => (deg * Math.PI) / 180;
const meters = ([la1, lo1]: number[], [la2, lo2]: number[]) =>
  Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

// 목적지별로 굳혀둔 목록은 더 없다 — 임의 목적지를 받으므로 런타임에 거른다.
// 그래서 여기서도 nearbyParking 을 직접 불러 검증한다. 굳혀둔 3구간이 그 중 하나일 뿐이다.
const 목적지 = [
  { id: "seogwipo", label: "서귀포 매일올레시장", at: [33.2502, 126.5632] as [number, number] },
  { id: "seongsan", label: "성산일출봉", at: [33.4581, 126.9425] as [number, number] },
  { id: "hyeopjae", label: "협재해수욕장", at: [33.3943, 126.2397] as [number, number] },
  // 임의 목적지도 돌아야 한다. 제주시청은 1km 안에 177곳(노상 135)으로 판정이 high 로 갈리는
  // 유일한 실데이터 사례다 — 굳혀둔 세 곳은 전부 노외뿐이라 high 경로가 검증되지 않는다.
  { id: "제주시청", label: "제주시청", at: [33.4996, 126.5312] as [number, number] },
];

const 계산 = 목적지.map((d) => [d.id, nearbyParking(d.label, d.at, DATA.spots as Lot[], DATA.walkM)] as const);
assert.ok(
  계산.find(([id]) => id === "제주시청")?.[1]?.byType["노상"],
  "제주시청에 노상주차장이 안 잡힌다 — 데이터나 필터가 바뀌었다",
);

for (const [id, d] of 계산) {
  assert.ok(d, `${id}: 주차장이 하나도 안 잡혔다`);
  assert.ok(d.spots.every((s) => s.walkM <= DATA.walkM), `${id}: 도보 반경 밖 주차장이 섞였다`);

  // 지도에 찍을 좌표 — 결측(위경도 없는 85곳)이 새면 엉뚱한 데 핀이 박힌다
  assert.ok(d.at?.length === 2 && d.at.every(Number.isFinite), `${id}: 목적지 좌표가 없다`);
  for (const s of d.spots) {
    assert.ok(s.at?.length === 2 && s.at.every(Number.isFinite), `${id}/${s.name}: 좌표가 없다`);
    // walkM 은 생성 때 계산한 값이다. 좌표에서 다시 재도 같아야 둘이 어긋나지 않는다.
    const 재계산 = meters(d.at, s.at);
    assert.ok(Math.abs(재계산 - s.walkM) < 2, `${id}/${s.name}: 좌표와 walkM 불일치 (${Math.round(재계산)} vs ${s.walkM})`);
    assert.ok(재계산 <= DATA.walkM, `${id}/${s.name}: 좌표가 반경 밖`);
  }
  assert.deepEqual(d.spots.map((s) => s.walkM), [...d.spots.map((s) => s.walkM)].sort((a, b) => a - b), `${id}: 거리순이 아니다`);
  assert.ok(d.spots.length <= d.total);
  assert.ok(d.spots.every((s) => s.type === "노상" || s.type === "노외"), `${id}: 모르는 주차장유형`);
  if (d.total) parallelOdds(d); // 실데이터로도 던지지 않는다
}

// --- ③ 주차장 찾기 화면(/parking) ---
// 목적지가 없는 화면이라 "반경 안 전부"가 아니라 "지금 보는 곳에서 가까운 몇 곳"을 준다.
// 칩 이름과 실제 기준이 어긋나면 사용자가 거짓말을 읽게 되므로 그 짝을 여기서 묶어둔다.
assert.equal(walkMinutes(WALK10_M), 10, `"도보 10분" 칩 반경(${WALK10_M}m)이 표시 분수와 어긋난다`);
assert.equal(walkMinutes(0), 1, "도보 0분이라고 말하지 않는다");
assert.ok(isEasyParking({ type: "노외" }) && !isEasyParking({ type: "노상" }));

const 시청: [number, number] = [33.4996, 126.5312];
const LOTS = DATA.spots as Lot[];

const 주변 = spotsAround(시청, LOTS);
assert.equal(주변.length, 40, "핀이 개수 상한(SPOT_CAP)에서 안 잘렸다");
assert.deepEqual(주변.map((s) => s.walkM), [...주변.map((s) => s.walkM)].sort((a, b) => a - b), "가까운 순이 아니다");

// "무료" 칩은 혼합을 통과시키면 안 된다 — 돈을 낼 수도 있는 곳을 무료라고 보여주는 셈이다
const 무료 = spotsAround(시청, LOTS, { free: true });
assert.ok(무료.length && 무료.every((s) => s.fee === "무료"), "무료 칩에 유료·혼합이 섞였다");
assert.ok(LOTS.some((s) => s.fee === "혼합"), "혼합 표본이 사라졌다 — 위 검증이 무의미해진다");

// "도보 10분" 칩은 반경 밖을 자른다
assert.ok(spotsAround(시청, LOTS, { walk10: true }).every((s) => s.walkM <= WALK10_M));

// 한적한 곳(한라산 정상)에서도 핀은 뜬다 — 반경이 아니라 개수로 자르는 이유가 이것이다.
// 다만 칩을 켜면 그때는 반경이 기준이라 0곳이 맞다.
const 한라산: [number, number] = [33.3617, 126.5292];
assert.ok(spotsAround(한라산, LOTS).length > 0, "반경 없이도 가까운 주차장은 나와야 한다");
assert.equal(spotsAround(한라산, LOTS, { walk10: true }).length, 0);

// 24시간은 칩이 아니다 — 원본 CSV 1,657곳이 전부 00:00~23:59 라 걸러낼 게 없다.
// 걸러지지 않는 칩을 그려두면 눌러도 아무 일이 없다. 하단 시트 정보 줄에만 남긴다.

console.log("✅ 주차장 평행·직각 프록시 판정 정상");
console.log(`   좌표 있는 주차장 ${DATA.spots.length}곳 · 유형별 구획수:`, DATA.stats);
for (const [id, d] of 계산)
  console.log(`   ${id.padEnd(9)} ${d!.total}곳`, d!.byType, `→ ${parallelOdds(d!).level}`);
