// 주행 저장 읽기·쓰기. 저장은 lib/records.db.ts 가 하고 여기는 문지기만 본다.
// 여행 기록(app/api/records/route.ts)과 같은 모양·같은 규칙이다 — 다른 건 담기는 값뿐이다.
//
// **로그인이 없다.** 버킷은 브라우저가 스스로 만든 id 하나다 (lib/me.ts). 공개 주소이므로
// 들어오는 값은 전부 의심한다 — 크기, 주인 id 모양, 기록 모양 셋을 여기서 본다.
//
// 라우트 핸들러는 기본이 캐시 안 됨이다 (Next 16 문서 15-route-handlers.md "Caching").
// GET 이 방금 담은 주행을 못 보고 옛 목록을 돌려주면 안 되므로 그 기본에 기대고 아무것도 안 켠다.

import { asOwner } from "@/lib/me";
import { asDrive } from "@/lib/safelog";
import { insertDrive, listDrives, removeDrive, setDriveMine } from "@/lib/records.db";

/**
 * 받는 몸통의 최대 바이트.
 *
 * 여행 기록(8KB)보다 크다 — 주행 하나에 경로 좌표 40점이 실린다. 한 점이 "[33.47812,126.36867]"
 * 라 900바이트쯤이고, 나머지 칸을 다 더해도 2KB 를 넘기 어렵다. 16KB 면 넉넉하면서도
 * 공개 POST 로 수 MB 를 밀어 넣어 디스크를 채우는 길은 그대로 막힌다.
 */
const BODY_MAX_BYTES = 16_000;

/** 몸통을 읽어 JSON 으로. 크면 413, 깨졌으면 400 을 그대로 돌려준다 */
async function body(request: Request): Promise<unknown | Response> {
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) return new Response(null, { status: 413 });
  try {
    return JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
}

/** GET /api/drives?o=<id> — 그 브라우저의 주행, 최신순 */
export async function GET(request: Request) {
  const owner = asOwner(new URL(request.url).searchParams.get("o"));
  if (owner === null) return new Response(null, { status: 400 });
  return Response.json(listDrives(owner));
}

/** POST /api/drives — { owner, drive } 를 담고 그 주인의 새 목록을 돌려준다 */
export async function POST(request: Request) {
  const parsed = await body(request);
  if (parsed instanceof Response) return parsed;

  const { owner: o, drive: v } = (parsed ?? {}) as { owner?: unknown; drive?: unknown };
  const owner = asOwner(o);
  // 화면이 쓰는 것과 **같은** 검사다 (lib/safelog.ts asDrive). 서버용을 따로 두면 한쪽만 느슨해진다
  const drive = asDrive(v);
  if (owner === null || drive === null) return new Response(null, { status: 400 });

  return Response.json(insertDrive(owner, drive));
}

/** DELETE /api/drives?o=<id>&id=… — 카드의 ✕ */
export async function DELETE(request: Request) {
  const q = new URL(request.url).searchParams;
  const owner = asOwner(q.get("o"));
  const id = Number(q.get("id"));
  if (owner === null || !Number.isFinite(id)) return new Response(null, { status: 400 });

  return Response.json(removeDrive(owner, id));
}

/** PATCH /api/drives — { owner, id, mine } 로 "나만의 길"을 담거나 뺀다 */
export async function PATCH(request: Request) {
  const parsed = await body(request);
  if (parsed instanceof Response) return parsed;

  const { owner: o, id, mine } = (parsed ?? {}) as { owner?: unknown; id?: unknown; mine?: unknown };
  const owner = asOwner(o);
  if (owner === null || typeof id !== "number" || !Number.isFinite(id) || typeof mine !== "boolean") {
    return new Response(null, { status: 400 });
  }

  return Response.json(setDriveMine(owner, id, mine));
}
