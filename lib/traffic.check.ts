// 실시간 교통 집계 검증 — node --experimental-strip-types lib/traffic.check.ts
//
// 네트워크를 타지 않는다. 검증할 게 카카오 응답을 받아오는 일이 아니라,
// 받은 응답을 어떻게 읽느냐이기 때문이다:
//   ① 혼잡 상태 코드를 거리로 옳게 합치는가 (원활·정보없음을 혼잡으로 세면 없는 정체를 만든다)
//   ② 실시간 안내가 검증된 경로를 벗어났는지 판정하는가 (벗어난 걸 놓치면 다른 길의
//      급커브를 이 길의 근거로 보여주게 된다)
//
// 픽스처의 traffic_state 값은 실제 응답에서 확인한 것이다 (lib/traffic.ts 주석 참고).

import assert from "node:assert";
import { congestionOf, congestionLabel, driftedFrom, flowSpeed, flowLabel } from "./traffic.ts";

const road = (name: string, km: number, traffic_state?: number, traffic_speed?: number) => ({
  name,
  distance: km * 1000,
  traffic_state,
  traffic_speed,
});

// --- ① 혼잡 집계 ---

// 원활(4)·정보없음(0)·상태 누락은 혼잡이 아니다
assert.deepEqual(congestionOf([road("평화로", 50, 4), road("공항로", 1, 0), road("무명", 1)]), {
  jamKm: 0,
  slowKm: 0,
  topRoad: null,
});

// 정체(1)·지체(2)는 jam, 서행(3)은 slow — 같은 도로 조각들은 합산된다
assert.deepEqual(
  congestionOf([road("평화로", 1.5, 1), road("평화로", 0.5, 2), road("평화로", 2, 3), road("중산간서로", 1, 4)]),
  { jamKm: 2, slowKm: 2, topRoad: "평화로" },
);

// topRoad 는 막히는 거리가 가장 긴 도로다 — 조각 수가 아니라 거리로 뽑는다
assert.equal(
  congestionOf([road("516로", 0.2, 3), road("516로", 0.2, 3), road("한북로", 3, 3)]).topRoad,
  "한북로",
);

// 이름 없는 조각만 막혀도 거리는 세고, 도로명만 비운다
assert.deepEqual(congestionOf([road("", 2, 1)]), { jamKm: 2, slowKm: 0, topRoad: null });

// --- ② 카드 문구 ---

// 1km 미만은 말하지 않는다 (신호 대기로도 잡히는 길이)
assert.equal(congestionLabel({ jamKm: 0.4, slowKm: 0.9, topRoad: "평화로" }), null);
// 정체가 서행보다 크면 정체를 말한다
assert.equal(congestionLabel({ jamKm: 2.1, slowKm: 1.2, topRoad: "평화로" }), "평화로 2.1km 정체");
// 서행이 더 크면 서행 쪽 거리를 말한다 — jamKm 을 섞어 부풀리지 않는다
assert.equal(congestionLabel({ jamKm: 0.5, slowKm: 4.2, topRoad: "516로" }), "516로 4.2km 서행");
// 도로명을 못 얻어도 거리는 알려준다
assert.equal(congestionLabel({ jamKm: 3, slowKm: 0, topRoad: null }), "3km 정체");

// --- ③ 경로 이탈 판정 ---

assert.equal(driftedFrom(43.0, 43.0), false); // 같은 길
assert.equal(driftedFrom(44.8, 43.0), false); // +4.2% — 실시간 경로가 조금 다른 건 늘 있다
assert.equal(driftedFrom(45.5, 43.0), true); // +5.8% — 다른 길로 안내됐다
assert.equal(driftedFrom(38.0, 43.0), true); // 짧아진 것도 이탈이다 (방향은 상관없다)
assert.equal(driftedFrom(43.0, null), false); // 비교 대상이 없으면 판정하지 않는다

// --- ④ 통행속도 ---

// 속도가 하나도 안 실려 오면 지어내지 않는다
assert.equal(flowSpeed([road("평화로", 10, 4)]), null);
// 0 은 속도가 아니라 정보없음이다 — 나누면 Infinity 가 되어 전체를 망친다
assert.equal(flowSpeed([road("평화로", 10, 4, 0)]), null);
// 같은 속도면 그 속도 그대로
assert.equal(flowSpeed([road("평화로", 5, 4, 80), road("평화로", 5, 4, 80)]), 80);
// 총거리÷총시간이다. 10km@80 + 10km@20 은 산술평균 50 이 아니라 32 다 —
// 앞 구간 7.5분 + 뒤 구간 30분 = 37.5분에 20km 를 간 것이다. 산술평균을 쓰면 정체가 묻힌다.
assert.equal(flowSpeed([road("평화로", 10, 4, 80), road("평화로", 10, 1, 20)]), 32);
// 속도 없는 조각은 거리에서도 빠진다 (모르는 구간을 평균에 섞지 않는다)
assert.equal(flowSpeed([road("평화로", 10, 4, 60), road("무명", 10, 4)]), 60);

// --- ⑤ 흐름 문구 ---

assert.equal(flowLabel(null), null); // 모르면 말하지 않는다
assert.equal(flowLabel(82), "82km/h로 빠르게 흐름"); // 초보에게는 경고다
assert.equal(flowLabel(70), "70km/h로 빠르게 흐름"); // 경계 위
assert.equal(flowLabel(69), null); // 경계 아래 — 중간 속도는 할 말이 없다
assert.equal(flowLabel(56), null);
assert.equal(flowLabel(45), "45km/h로 느긋하게 흐름"); // 이 앱이 하려는 말
assert.equal(flowLabel(35), "35km/h로 느긋하게 흐름"); // 경계
assert.equal(flowLabel(34), null); // 아래는 느긋한 게 아니라 막힌 것 — congestionOf 가 말한다

console.log("✅ 실시간 교통 집계·이탈 판정·통행속도 정상");
console.log("   혼잡 코드: 1·2 → 정체, 3 → 서행, 4·0·누락 → 세지 않음");
console.log(`   이탈 임계: 검증 거리와 5% 초과 차이`);
console.log(`   흐름 문구: 70km/h↑ 빠름 · 35~55km/h 느긋 · 그 사이는 말하지 않음`);
