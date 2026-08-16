// 대본 서명 — /api/tts 가 **서버가 만든 대본만** 읽게 막는다.
//
// 그 주소는 인증이 없다. Edge 를 쓰던 동안은 한도가 없어서 열려 있어도 잃을 게 없었지만,
// 생성형 음성은 글자 수로 값을 매긴다 — 배포된 주소를 찾은 사람이 아무 글이나 밀어넣으면
// 그대로 청구된다. 글자수 상한은 한 번의 크기만 막지 횟수를 못 막는다.
//
// 그래서 대본을 내려보낼 때 서명을 같이 붙이고, 합성 전에 그 서명을 다시 계산해 맞춰본다.
// 비밀키는 서버에만 있으므로 남이 새 글에 서명을 만들 수 없다.
//
// **서명된 대본은 다시 부를 수 있다.** 화면을 한 번 연 사람은 자기 대본 네 칸의 서명을
// 갖게 되고 그건 계속 쓸 수 있다. 다만 같은 글은 캐시에 걸려 두 번 만들지 않으므로
// (app/api/tts/route.ts 의 캐시) 값이 더 나가지 않는다. 유효기간을 붙이지 않은 이유다.
import { createHmac, timingSafeEqual } from "node:crypto";

/** 주소에 실리는 값이라 짧게 자른다. 64비트면 찍어서 맞힐 수 있는 크기가 아니다. */
export const 서명길이 = 16;

/**
 * 대본 칸 앞에 서명을 붙인 꼴. `<서명 16자>.<대본>` 이다.
 *
 * 배열을 하나 더 들고 다니는 대신 문자열 안에 넣는다. 대본은 actions.ts → page.tsx →
 * RouteRadio 로 두 번 건너가는데, 짝이 되는 서명 배열을 같이 태우면 그 길의 타입이 전부
 * 바뀐다. 붙여 보내면 **쓰는 곳 한 군데**(RouteRadio)만 떼어 쓰면 된다.
 *
 * 길이가 고정이라 대본에 점이 들어 있어도 자르는 자리가 흔들리지 않는다.
 */
export const 붙인칸 = (칸: string) => `${서명(칸)}.${칸}`;

function 비밀키(): string {
  const k = process.env.TTS_SIGN_SECRET;
  // 없으면 조용히 통과시키지 않는다 — 그러면 막은 줄 알고 열어둔 채로 배포된다
  if (!k) throw new Error("TTS_SIGN_SECRET 이 없다");
  return k;
}

export function 서명(글: string): string {
  return createHmac("sha256", 비밀키()).update(글).digest("hex").slice(0, 서명길이);
}

/** 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다 */
export function 서명맞나(글: string, 받은것: string | null): boolean {
  if (!받은것 || 받은것.length !== 서명길이) return false;
  try {
    return timingSafeEqual(Buffer.from(서명(글)), Buffer.from(받은것));
  } catch {
    return false;
  }
}
