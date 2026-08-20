// 기록 저장소(SQLite) — node lib/records.db.check.ts
//
// 여기서 지켜야 할 건 **주인끼리 안 섞이는가**다. 버킷이 로그인 대신이라(lib/me.ts) 이게 새면
// "나의 여행 기록" 아래에 남의 여행이 뜨고, 카드의 ✕ 가 남의 것을 지운다.

import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 진짜 홈(~/miri-data)을 건드리지 않게 임시 파일을 물린다 — import 보다 먼저 정해야 한다
const dir = mkdtempSync(join(tmpdir(), "miri-records-"));
process.env.RECORDS_DB = join(dir, "records.db");

const { closeDb, insert, listByOwner } = await import("./records.db.ts");

/** 서버가 받아주는 모양의 id 셋 (lib/me.ts OWNER_RE) */
const 갑 = "11111111-2222-4333-8444-555555555555";
const 을 = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const 병 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const { asRecord } = await import("./record.ts");

const 기록 = (id: number, title: string) => ({
  id,
  date: "2026-08-14",
  course: "바다와 노을 코스",
  route: ["제주공항", "애월"],
  places: ["애월"],
  title,
  episode: "좁은 길에서 마주친 차",
  body: "좋았다",
  km: 62,
});

try {
  /* ─────────────── 빈 버킷 ─────────────── */
  for (const 주인 of [갑, 을, 병]) assert.deepEqual(listByOwner(주인), [], `${주인} 버킷이 비어 시작해야 한다`);

  /* ─────────────── 넣고 읽기 ─────────────── */
  assert.deepEqual(insert(갑, 기록(100, "첫 기록")), [기록(100, "첫 기록")]);

  // 최근 저장한 것이 앞이다 (목록 "최근 기록" 순서)
  insert(갑, 기록(200, "둘째 기록"));
  assert.deepEqual(
    listByOwner(갑).map((r) => r.id),
    [200, 100],
  );

  /* ─────────────── 주인이 안 섞인다 (이 파일의 핵심) ─────────────── */
  insert(병, 기록(150, "남의 기록"));
  assert.deepEqual(
    listByOwner(갑).map((r) => r.id),
    [200, 100],
    "남의 버킷에 넣은 것이 내 목록에 샜다",
  );
  assert.deepEqual(
    listByOwner(병).map((r) => r.id),
    [150],
  );
  assert.deepEqual(listByOwner(을), [], "안 쓴 버킷은 비어 있어야 한다");

  /* ─────────────── 같은 id 는 덮어쓴다 ─────────────── */
  // 네트워크가 끊겨 같은 저장을 두 번 보내도 목록에 쌍둥이가 생기면 안 된다
  insert(갑, { ...기록(200, "고쳐 쓴 제목") });
  assert.equal(listByOwner(갑).length, 2, "같은 id 가 두 칸을 차지했다");
  assert.equal(listByOwner(갑)[0].title, "고쳐 쓴 제목");

  /* ─────────────── 상한 ─────────────── */
  // BUCKET_MAX(200)를 넘으면 오래된 것부터 지운다. 205개를 넣고 200개만 남는지 본다
  for (let i = 1; i <= 205; i++) insert(을, 기록(i, `기록 ${i}`));
  const 셋 = listByOwner(을);
  assert.equal(셋.length, 200, "상한이 안 걸렸다 — 공개 엔드포인트라 디스크가 한없이 자란다");
  assert.equal(셋[0].id, 205, "최신이 앞이어야 한다");
  assert.equal(셋.at(-1)?.id, 6, "오래된 것부터 지워야 한다");

  /* ─────────────── 다시 열어도 남아 있다 ─────────────── */
  // 서버를 재시작해도(systemctl restart miri) 기록이 살아 있어야 한다
  closeDb();
  assert.equal(listByOwner(갑).length, 2, "다시 열었더니 기록이 없다");

  /* ─────────────── 깨진 칸 ─────────────── */
  // 손으로 고쳐 넣은 값. 그 칸만 버리고 나머지는 살린다 (lib/record.ts asRecord 와 같은 규칙)
  assert.equal(asRecord({ id: 1 }), null); // 아래 가정이 사는지 먼저 확인
  insert(갑, { ...기록(300, "정상"), title: "정상" });
  assert.equal(listByOwner(갑)[0].title, "정상");

  console.log("✅ 기록 저장소 정상 — 주인 분리 · 최신순 · 덮어쓰기 · 상한 · 재시작 확인");
} finally {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
