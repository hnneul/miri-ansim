// 목적지 주변 탐나는전 캐시백 가맹점 — 거리 필터만 한다.
//
// lib/goodprice.ts 와 같은 자리·같은 이유의 파일이다: 임의 목적지를 받으니 목적지별로 미리
// 잘라둘 수 없고, 런타임에 거르는 로직은 데이터 임포트(`@/data/...`) 없이 검증할 수 있는
// 곳에 있어야 한다.
//
// 데이터는 scripts/build-tamna-data.mjs 가 만든다 (공공데이터포털 15157894 + 카카오 주소검색).
// 원본에 좌표가 없어 주소를 지오코딩해 붙인 값이라, 층·호가 아니라 **건물 단위**로 찍힌다.

import { meters } from "./parking";

/**
 * 좌표째로 굳혀둔 가맹점 한 곳 (data/tamna-data.json). 거리는 런타임에 붙인다.
 *
 * 주소는 굳히지 않는다. 카드에 주소를 그리지 않는데(/parking 카드와 같다) 12,000곳어치를
 * 실어 나르면 파일이 두 배가 된다 — 이 파일은 "use client" 화면이 통째로 내려받는다.
 * 어디쯤인지는 "도보 N분"과 지도 핀이 답한다.
 */
export type Shop = {
  name: string;
  kind: string; // 음식점 / 숙박 / 주유
  at: [number, number]; // [위도, 경도]
};

export type TamnaShop = Shop & { distM: number };

export type Nearby = {
  label: string;
  at: [number, number];
  radiusM: number;
  total: number;
  byKind: Record<string, number>;
  shops: TamnaShop[];
};

/** 목록·지도에 찍을 최대 개수. 총계는 전체로 세고 표시만 자른다 (lib/parking.ts 와 같은 규칙). */
const SHOP_CAP = 40;

/**
 * 반경 안 가맹점, 가까운 순.
 *
 * 착한가격업소(417곳)와 달리 여기는 14,000곳이 넘는다. 그래서 반경을 3km 로 두면
 * 제주시내에서 수백 곳이 걸려 지도가 핀으로 덮인다 — 자르는 건 호출부(radiusM)의 몫이고,
 * 여기서는 전체를 훑어 거리만 붙인다. 14,000번 거리 계산은 1ms 도 걸리지 않는다.
 *
 * byKind 는 **자른 뒤가 아니라 반경 안 전체**로 센다. 칩이 목록 길이를 따라 흔들리면
 * 같은 자리에서 칩이 생겼다 사라진다.
 */
export function nearbyTamna(
  label: string,
  at: [number, number],
  shops: Shop[],
  radiusM: number,
): Nearby | null {
  const near: TamnaShop[] = [];
  for (const s of shops) {
    const d = Math.round(meters(at, s.at));
    if (d <= radiusM) near.push({ ...s, distM: d });
  }
  if (!near.length) return null;

  near.sort((a, b) => a.distM - b.distM);
  return {
    label,
    at,
    radiusM,
    total: near.length,
    byKind: near.reduce<Record<string, number>>((o, s) => ({ ...o, [s.kind]: (o[s.kind] ?? 0) + 1 }), {}),
    shops: near.slice(0, SHOP_CAP),
  };
}
