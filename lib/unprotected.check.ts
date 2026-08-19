// node --experimental-strip-types lib/unprotected.check.ts
//
// 이 파일이 지키는 건 둘이다.
//   ① **모르는 것과 없는 것이 섞이지 않는가.** 판독표에 없는 좌회전을 지나면 0 이 아니라
//      null 이어야 한다. 여기가 무너지면 화면이 "비보호 없음"이라고 확인한 척한다.
//   ② **진입 방위가 맞는 줄을 집는가.** 판독표가 제주 전역으로 늘면서 한 교차로에 진입
//      방향별로 최대 4줄이 생겼고, 방향마다 판정이 다르다. 좌표만 보면 옆 진입의 판정을
//      맞는 척 집어온다.

import assert from "node:assert";
import { unprotectedCount, type TurnPoint } from "./unprotected.ts";
import type { LatLng } from "./curvature.ts";
import 판독표 from "../data/unprotected-left.json" with { type: "json" };

/** 판독표의 한 줄을 그대로 조회 대상으로 만든다 (키 = "위도,경도,방위"). */
function 지점(key: string): TurnPoint {
  const [la, lo, b] = key.split(",").map(Number);
  return { at: [la, lo] as LatLng, bearing: b };
}
const 표 = 판독표 as Record<string, { verdict: string | null; bearing: number | null; label?: string }>;
const 첫번째 = (v: string) => Object.keys(표).find((k) => 표[k].verdict === v)!;

const 비보호 = 지점(첫번째("비보호"));
const 보호 = 지점(첫번째("보호"));
const 무신호 = 지점(첫번째("무신호"));
const 판단불가 = 지점(첫번째("판단불가"));
const 바다: TurnPoint = { at: [33.9, 126.9], bearing: 0 }; // 표에 없는 좌표

assert.equal(unprotectedCount([]), 0, "좌회전이 없으면 0이다 — 모르는 게 아니라 없는 것이다");
assert.equal(unprotectedCount([비보호]), 1);
assert.equal(unprotectedCount([보호]), 0, "보호만 지나면 확인된 0");
assert.equal(unprotectedCount([무신호]), 0, "무신호는 비보호가 아니다");
assert.equal(unprotectedCount([비보호, 보호, 무신호]), 1);

// ① 모르는 것은 끝까지 모른다
assert.equal(unprotectedCount([바다]), null, "표에 없는 지점 → 모른다");
assert.equal(unprotectedCount([판단불가]), null, "판단불가 → 모른다");
assert.equal(
  unprotectedCount([비보호, 바다]),
  null,
  "하나만 몰라도 전체가 null — 아는 것만 세면 과소집계가 사실처럼 읽힌다",
);

// 30m 밖은 다른 지점이다. 중앙로62번길 두 지점이 62m 떨어져 있어 이 경계가 실제로 걸린다.
assert.equal(
  unprotectedCount([{ ...비보호, at: [비보호.at[0] + 0.00036, 비보호.at[1]] }]),
  null,
  "40m 떨어지면 그 지점으로 안 본다",
);

// ② 방위 — 여기가 전역 판독표에서 새로 생긴 요점이다.
//
// 진입마다 판정이 갈리는 실제 교차로를 쓴다. 처음엔 아무 비보호 지점이나 골라 90° 돌려
// null 이 나오길 기대했는데, 그 교차로(영락2)는 네 진입이 전부 비보호라 90° 돌려도 1 이
// 맞았다. **판정이 같은 교차로로는 방위 조건을 검증할 수 없다.**
const 갈리는교차로 = "외도초교앞삼거리";
const 갈림 = Object.keys(표).filter((k) => (표[k] as { label?: string }).label === 갈리는교차로);
assert.ok(갈림.length >= 2, `${갈리는교차로} 가 판독표에 없다 — 픽스처를 다시 고를 것`);
const 갈림_비보호 = 지점(갈림.find((k) => 표[k].verdict === "비보호")!);
const 갈림_보호 = 지점(갈림.find((k) => 표[k].verdict === "보호")!);

assert.equal(unprotectedCount([갈림_비보호]), 1, "비보호 진입 → 1");
assert.equal(
  unprotectedCount([갈림_보호]),
  0,
  "같은 교차로라도 보호 진입이면 0 — 좌표만 보면 옆 진입의 비보호를 집는다",
);
assert.equal(
  unprotectedCount([{ ...갈림_비보호, bearing: (갈림_비보호.bearing! + 90) % 360 }]),
  null,
  "90° 다른 진입은 이 교차로에 없다 → 모른다",
);
assert.equal(
  unprotectedCount([{ ...갈림_비보호, bearing: (갈림_비보호.bearing! + 20) % 360 }]),
  1,
  "20° 차이는 같은 진입으로 본다 (안내점과 노드 좌표가 조금 어긋나는 몫)",
);
assert.equal(
  unprotectedCount([{ ...갈림_비보호, bearing: null }]),
  null,
  "방위를 못 구하면 모른다 — 사거리에서 어느 진입인지 특정 못 하면 옆 방향 판정을 집는다",
);

// 같은 좌표에 진입이 여럿인 교차로가 실제로 있는지 — 없으면 위 검증이 헛돈다
const 좌표별 = new Map<string, number>();
for (const k of Object.keys(표)) {
  const c = k.split(",").slice(0, 2).join(",");
  좌표별.set(c, (좌표별.get(c) ?? 0) + 1);
}
const 다중 = [...좌표별.values()].filter((n) => n > 1).length;
assert.ok(다중 > 0, "한 좌표에 진입이 여럿인 교차로가 없다 — 방위 조건이 무의미해진다");

console.log(
  `✅ 비보호 조회 정상 — 판독표 ${Object.keys(표).length.toLocaleString()}줄 · ` +
    `진입 여럿인 교차로 ${다중.toLocaleString()}곳 · 모르는 것(null)과 없는 것(0)이 안 섞인다`,
);
