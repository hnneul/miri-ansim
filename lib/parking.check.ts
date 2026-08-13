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
  spotsAround, mergeSpots, walkMinutes, isEasyParking, parkingKind, feeText, feeDetail, WALK10_M, REACH_M,
  type Parking, type ParkingSpot, type Lot,
} from "./parking.ts";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("../data/parking-data.json", import.meta.url)), "utf8"));

// --- ① 판정 로직 ---
const lot = (type: string, walkM: number): ParkingSpot => ({ name: type + walkM, addr: null, type, spaces: 10, fee: "무료", walkM, at: [33, 126] });
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
// 카카오에서 온 곳은 유형을 모른다 — 모르는 걸 "쉽다"고 단언하면 안 된다
assert.ok(!isEasyParking({ type: "" }), "유형을 모르는 주차장에 주차 쉬움 배지가 붙는다");

// 위성 태깅(data/parking-tags.json)은 프록시를 덮어쓴다 — 직접 본 값이 간접 추론보다 낫다
assert.deepEqual(parkingKind({ type: "노외" }), { parallel: false, confirmed: false });
assert.deepEqual(parkingKind({ type: "노상" }), { parallel: true, confirmed: false });
assert.equal(parkingKind({ type: "" }), null, "모르는 곳은 판정하지 않는다");
// 프록시와 반대로 태깅된 경우가 이 기능의 존재 이유다 — 태그가 이겨야 한다
assert.deepEqual(parkingKind({ type: "노상", parallel: false }), { parallel: false, confirmed: true });
assert.deepEqual(parkingKind({ type: "노외", parallel: true }), { parallel: true, confirmed: true });
assert.ok(isEasyParking({ type: "노상", parallel: false }), "직각으로 확인된 노상이 어렵다고 나온다");
assert.ok(!isEasyParking({ type: "노외", parallel: true }), "평행으로 확인된 노외가 쉽다고 나온다");
// 카카오에서 온 곳도 태깅되면 판정이 선다 (유형은 여전히 모른다)
assert.deepEqual(parkingKind({ type: "", parallel: false }), { parallel: false, confirmed: true });

// 두 출처 합치기 — 같은 주차장이면 정보가 더 많은 공공 쪽을 남긴다
const 공공: ParkingSpot = { name: "시청 앞", addr: "제주시 동광로", type: "노상", spaces: 24, fee: "유료", walkM: 100, at: [33.4996, 126.5312] };
const 카카오同 : ParkingSpot = { name: "제주시청 공영주차장", addr: "제주시 동광로", source: "카카오", type: "", spaces: null, fee: null, walkM: 100, at: [33.49962, 126.53122] }; // 약 2m 차이
const 카카오別: ParkingSpot = { name: "성산일출봉 주차장", addr: "서귀포시 성산읍", source: "카카오", type: "", spaces: null, fee: null, walkM: 50, at: [33.4581, 126.9425] };

const 합친 = mergeSpots([공공], [카카오同, 카카오別]);
assert.equal(합친.length, 2, "좌표가 겹치는 주차장이 두 번 들어갔다");
assert.ok(!합친.some((s) => s.name === "제주시청 공영주차장"), "이름이 달라도 같은 좌표면 공공 쪽만 남아야 한다");
assert.deepEqual(합친.map((s) => s.walkM), [50, 100], "합친 뒤 가까운 순이 아니다");
// 30m 밖이면 옆 주차장이다 — 삼키면 안 된다
assert.equal(mergeSpots([공공], [{ ...카카오同, at: [33.4999, 126.5312] }]).length, 2);
// 이름이 같으면 좌표가 더 벌어져도 같은 곳으로 본다 (큰 주차장은 입구/한가운데 차이가 크다)
assert.equal(mergeSpots([공공], [{ ...카카오同, name: "시청 앞", at: [33.5006, 126.5312] }]).length, 1, "이름이 같은 큰 주차장이 두 번 들어갔다");
// 다만 이름이 같아도 300m 밖이면 남긴다 ("○○리 주차장"처럼 흔한 이름이 있다)
assert.equal(mergeSpots([공공], [{ ...카카오同, name: "시청 앞", at: [33.505, 126.5312] }]).length, 2);

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

// 걸어갈 수 없는 곳은 아예 안 준다. 성산일출봉에서 10km 밖 세화리 주차장이 "도보 160분"으로
// 목록에 올라온 적이 있다 — 빈 목록보다 나쁘다 (화면이 빈 이유는 말로 알린다).
assert.ok(spotsAround(시청, LOTS).every((s) => s.walkM <= REACH_M), "걸어갈 수 없는 거리가 섞였다");
const 한라산: [number, number] = [33.3617, 126.5292];
assert.equal(spotsAround(한라산, LOTS).length, 0, "한라산 정상 도보 30분 안에 주차장이 잡힌다");

// 요금·주소 표시 — "유료" 한 단어가 아니라 얼마인지, 이름이 번지뿐일 때 어디인지가 나와야 한다
assert.equal(feeText({ fee: "무료" }), "무료");
assert.equal(feeText({ fee: "유료", rate: { baseMin: 30, baseWon: 1000, addMin: 15, addWon: 500, dayWon: 10000 } }), "30분 1,000원");
assert.equal(feeText({ fee: "혼합", rate: { baseMin: 30, baseWon: 1000, addMin: 15, addWon: 500, dayWon: null } }), "일부 유료 · 30분 1,000원");
assert.equal(feeText({ fee: "유료" }), "유료", "요금을 모르면 지어내지 않는다");
assert.equal(feeDetail({}), null);
assert.equal(
  feeDetail({ rate: { baseMin: 30, baseWon: 1000, addMin: 15, addWon: 500, dayWon: 10000 } }),
  "이후 15분마다 500원 · 1일권 10,000원",
);

// 실데이터: 유료·혼합에는 요금이, 모든 곳에는 주소가 있어야 화면에서 줄이 비지 않는다
const 유료 = LOTS.filter((s) => s.fee !== "무료");
assert.ok(유료.length > 100, "유료·혼합 표본이 사라졌다");
assert.ok(유료.every((s) => s.rate), "유료인데 요금이 없는 곳이 있다");
assert.ok(LOTS.every((s) => s.fee === "무료" || !feeText(s).includes("유료") || s.fee === "혼합"), "유료인데 금액을 못 편 곳이 있다");
assert.ok(LOTS.every((s) => s.addr), "주소가 빠진 주차장이 있다");
assert.ok(LOTS.every((s) => !/^제주특별자치도/.test(s.addr!) && !/\s\d/.test(s.addr!)), "주소에 도 이름이나 번지가 남았다");
assert.equal(LOTS.find((s) => s.name === "이도일동 1307")?.addr, "제주시 이도일동");

// 운영시간은 어디에도 안 쓴다 — 원본 CSV 1,657곳이 전부 00:00~23:59 이고 유료 117곳도 그렇다.
// 유료 주차장이 24시간 개방일 리 없으니 그 컬럼은 운영시간이 아니라 미입력 기본값으로 본다.
// 그래서 굳혀둔 데이터(parking-data.json)에도 운영시간 필드를 넣지 않았다.

console.log("✅ 주차장 평행·직각 프록시 판정 정상");
console.log(`   좌표 있는 주차장 ${DATA.spots.length}곳 · 유형별 구획수:`, DATA.stats);
for (const [id, d] of 계산)
  console.log(`   ${id.padEnd(9)} ${d!.total}곳`, d!.byType, `→ ${parallelOdds(d!).level}`);
