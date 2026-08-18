// 여행 기록 읽기·쓰기. 저장은 lib/records.db.ts 가 하고 여기는 문지기만 본다.
//
// **로그인이 없다.** 익숙함 티어 셋(1·3·10)이 버킷이라 같은 티어를 고른 사람은 모두 같은
// 목록을 읽고 쓴다 (lib/records.db.ts 첫 주석). 공개 주소이므로 들어오는 값은 전부 의심한다 —
// 크기, 티어, 기록 모양 셋을 여기서 본다.
//
// 라우트 핸들러는 기본이 캐시 안 됨이다 (Next 16 문서 15-route-handlers.md "Caching").
// GET 이 새 기록을 못 보고 옛 목록을 돌려주면 안 되므로 그 기본에 기대고 아무것도 안 켠다.

import { asRecord, asTier } from "@/lib/record";
import { insert, listByTier } from "@/lib/records.db";

/**
 * 받는 몸통의 최대 바이트. 기록 하나는 제목·이야기(500자)·장소 몇 개라 넉넉잡아 8KB 다.
 * 이걸 안 두면 공개 POST 로 수 MB 를 밀어 넣어 서버 메모리와 디스크를 채울 수 있다.
 * 자르지 않고 413 으로 되돌린다 — 잘라 저장하면 사용자는 다 저장된 줄 안다.
 */
const BODY_MAX_BYTES = 8_000;

/** GET /api/records?t=1 — 그 티어의 기록, 최신순 */
export async function GET(request: Request) {
  const tier = asTier(new URL(request.url).searchParams.get("t"));
  if (tier === null) return new Response(null, { status: 400 });
  return Response.json(listByTier(tier));
}

/** POST /api/records — { tier, record } 를 넣고 그 티어의 새 목록을 돌려준다 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  const { tier: t, record: r } = (body ?? {}) as { tier?: unknown; record?: unknown };
  const tier = asTier(t);
  // 화면이 쓰는 것과 **같은** 검사다 (lib/record.ts asRecord). 서버용을 따로 두면 한쪽만 느슨해진다
  const record = asRecord(r);
  if (tier === null || record === null) return new Response(null, { status: 400 });

  return Response.json(insert(tier, record));
}
