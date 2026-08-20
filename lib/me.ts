// 이 브라우저의 기록 주인 id.
//
// **로그인이 없는 앱에서 "내 기록"을 진짜 내 것이게 하는 최소 장치다.** 예전에는 익숙함 티어
// 셋(1·3·10)을 버킷으로 썼는데, 그러면 "왕초보"를 고른 사람이 전부 같은 목록을 읽고 쓰고
// **지웠다** — "나의 여행 기록" 아래에 남의 여행이 뜨고, 카드의 ✕ 가 남의 것을 지웠다.
//
// 익명 사용자에게 신원을 주는 흔한 방법이고, 사실상 "로그인 없는 로그인"이다.
// 대신 한계가 분명하다 (개인정보 처리방침에 그대로 적어 둔다, lib/serviceinfo.ts):
//   · 브라우저마다 다른 사람이다 — 카톡 인앱 브라우저에서 쓴 기록은 사파리에서 안 보인다
//   · 시크릿 모드는 열 때마다 새 사람이고, 창을 닫으면 그 기록은 다시 못 찾는다
//   · 저장소를 지우면 서버의 기록에 닿을 열쇠가 사라진다 (기록 자체는 남지만 주인이 없어진다)
//
// 사진이 이미 이 규칙으로 돌고 있었다 — 기기에만 남는다(lib/record.ts). 목록만 공용이라
// 남의 기록이 사진 없는 카드로 뜨고, 마이 화면의 "사진 N장" 합계에는 남의 장수가 더해졌다.
// 버킷을 브라우저로 옮기면 그 어긋남이 같이 맞는다.

const KEY = "miri.me";

/**
 * id 모양. 서버(app/api/*)가 이걸로 걸러 아무 문자열이나 버킷이 되는 걸 막는다 —
 * 화면과 서버가 같은 판정을 써야 해서 여기 하나만 둔다 (예전 asTier 가 있던 자리와 같은 이유).
 */
export const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 저장소가 막힌 브라우저(시크릿 강경 설정 등)에서 쓸 한 판짜리 id. 새로고침하면 새 사람이 된다 */
let 임시: string | null = null;

/**
 * 이 브라우저의 id. 없으면 만들어 넣는다.
 *
 * **화면을 그리는 중에 부르면 안 된다** — localStorage 는 서버에 없어서 SSR 이 터진다.
 * effect 나 이벤트 핸들러 안에서만 부른다 (부르는 쪽이 전부 그렇게 돼 있다).
 */
export function me(): string {
  try {
    const got = localStorage.getItem(KEY);
    if (got && OWNER_RE.test(got)) return got;
    const made = crypto.randomUUID();
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    // 저장소를 못 쓰는 브라우저. 기록이 다음 방문에 안 이어지지만, 적어도 남과 섞이지는 않는다
    return (임시 ??= crypto.randomUUID());
  }
}

/** id 인지. 서버가 들어온 값을 의심할 때 쓴다 */
export function asOwner(v: unknown): string | null {
  return typeof v === "string" && OWNER_RE.test(v) ? v : null;
}
