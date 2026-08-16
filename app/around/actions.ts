"use server";

// 주변 탐나는전 — 반경 안 가맹점만 골라 돌려준다.
//
// **여기가 서버여야 하는 이유는 데이터 크기 하나다.** data/tamna-data.json 이 11,912곳 838KB 인데,
// 화면(page.tsx)이 "use client" 라 거기서 import 하면 그게 통째로 폰으로 내려갔다 — 실측으로
// 클라이언트 청크 안에서 838KB 를 차지했다. 돌려주는 건 많아야 40곳(SHOP_CAP)이라 4KB 쯤이다.
//
// (app/route/actions.ts 가 jeju-link.json 6.7MB 를 서버에 두는 것과 같은 이유·같은 모양이다.
// 카카오 키 때문이 아니라 크기 때문이라는 점만 다르다.)
//
// 거르는 로직은 lib/tamna.ts 에 그대로 있다. 여기는 데이터를 붙여주는 자리다.

import { nearbyTamna, type Nearby, type Shop } from "@/lib/tamna";
import TAMNA from "@/data/tamna-data.json";

const SHOPS = TAMNA.shops as Shop[];

export type Around = Nearby & {
  /**
   * 지도 축척에 쓸 거리 — **업종 칩과 무관하게** 반경 안에서 가장 먼(=마지막으로 찍히는) 곳까지.
   *
   * 화면이 따로 계산할 수가 없다. 데이터가 여기 있으니 같이 실어 보낸다.
   * "너무 당기지 않기"(MIN_FIT_M)는 지도 쪽 사정이라 화면이 맡는다.
   */
  fitM: number;
};

export async function tamnaAround(
  label: string,
  at: [number, number],
  radiusM: number,
  kind?: string | null,
): Promise<Around | null> {
  const near = nearbyTamna(label, at, SHOPS, radiusM, kind);
  if (!near) return null;

  /*
   * fitM 은 칩을 거르기 **전** 목록에서 나와야 한다 — 칩을 누를 때마다 축척이 널을 뛰면
   * 지도가 보고 있던 동네를 잃는다. 칩이 걸려 있을 때만 한 번 더 훑는데, 11,912번 거리
   * 계산이 1ms 도 안 되므로(lib/tamna.ts nearbyTamna 주석) 아껴서 얻을 게 없다.
   */
  const 전체 = (kind ? nearbyTamna(label, at, SHOPS, radiusM) : near) ?? near;
  return { ...near, fitM: 전체.shops[전체.shops.length - 1].distM };
}
