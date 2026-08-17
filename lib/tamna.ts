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
 * 실어 나르면 파일이 두 배가 된다. 어디쯤인지는 "도보 N분"과 지도 핀이 답한다.
 *
 * 이 파일은 서버에만 있다 (app/around/actions.ts). 한때 "use client" 화면이 통째로
 * 내려받았는데, 클라이언트 청크에서 838KB 를 차지하는 게 실측으로 확인돼 서버로 옮겼다.
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

/**
 * 목록·지도에 찍을 최대 개수. 총계는 전체로 세고 표시만 자른다 (lib/parking.ts 와 같은 규칙).
 *
 * 40 과 20 을 오가다 20 으로 정했다. 축척은 **마지막 한 곳까지 담도록** 잡히므로(fitM)
 * 값을 줄이면 그 바깥 테두리가 안으로 당겨져 지도도 같이 당겨지고, 핀 사이가 벌어진다.
 * 제주시청 1km 안 823곳을 스무 곳으로 자르는 셈이지만, 정확한 개수는 어차피 이 화면이
 * 답할 수 있는 게 아니다 — 지도가 할 일은 "이 동네에 깔려 있다"까지다.
 *
 * 줄이려면 여기서 줄여야 한다. 지도만 자르고 목록에 40 을 두면 축척이 여전히 40 기준이라
 * 정작 뭉치는 건 그대로다.
 */
const SHOP_CAP = 20;

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
  /**
   * 업종 칩. **자르기 전에** 걸러야 한다 — 자른 뒤에 거르면 가까운 20곳이 전부 음식점인 동네에서
   * "숙박"을 눌렀을 때 머리글은 49곳이라 적고 목록은 텅 빈다 (실제로 그랬다).
   */
  kind?: string | null,
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
    shops: (kind ? near.filter((s) => s.kind === kind) : near).slice(0, SHOP_CAP),
  };
}
