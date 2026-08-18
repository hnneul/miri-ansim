// 여행 기록 저장소 — 서버 전용. app/api/records/route.ts 만 부른다.
//
// **버킷이 익숙함 티어 셋(1·3·10)뿐이다.** 로그인이 없어서 "누구 기록인지"를 티어로 가른다 —
// 왕초보를 고른 사람은 모두 같은 목록을 보고 같은 목록에 쓴다. 시연용이라 이게 오히려 낫다:
// 심사위원이 자기 폰으로 열어도 방금 저장한 기록이 그대로 보인다. 대신 공개 주소라
// 아무나 쓸 수 있다는 뜻이기도 하다 (route.ts 의 크기 제한과 아래 BUCKET_MAX 가 그 방어다).
//
// 왜 SQLite 인가: JSON 파일 하나면 더 짧지만, 두 사람이 동시에 저장하면 읽고-쓰는 사이에
// 서로를 덮어써 한쪽 기록이 사라진다. 시연 도중에 그게 나면 되돌릴 방법이 없다.
// node:sqlite 는 Node 22.5+ 내장이라 새 의존성은 없다 (서버 24.19 확인).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asRecord, type TripRecord } from "./record.ts";

/**
 * DB 파일 자리. **저장소를 앱 폴더 밖에 두는 게 핵심이다** — deploy.sh 가 서버에서
 * `git reset --hard origin/main` 을 돌리는데, 앱 폴더 안에 있으면 배포마다 위험해진다.
 * 홈 아래에 두면 .env.local·gcp-tts.json 과 같은 이유로 배포에 안 씻긴다.
 *
 * RECORDS_DB 는 검증(lib/records.db.check.ts)이 임시 파일을 물릴 때 쓴다.
 */
const FILE = () => process.env.RECORDS_DB ?? join(homedir(), "miri-data", "records.db");

/**
 * 티어 하나에 남겨두는 최대 기록 수. 공개 엔드포인트라 상한이 없으면 디스크가 한없이 자란다.
 * 넘치면 **오래된 것부터 지운다** — 목록이 최신순이라 화면에서 안 보이던 것이 먼저 사라진다.
 */
const BUCKET_MAX = 200;

let db: DatabaseSync | null = null;

/**
 * 첫 호출 때 열고 표를 만든다. 모듈을 읽는 것만으로 디스크를 건드리면 빌드 때도 파일이 생긴다.
 *
 * 기록을 칸별 열이 아니라 json 한 칸에 통째로 넣는다 — 조회가 "티어로 골라 최신순" 하나뿐이라
 * 열을 쪼개도 쓸 데가 없고, 읽을 때 asRecord 가 어차피 모양을 다시 본다 (형이 한 군데에만 산다).
 *
 * WAL 은 읽는 쪽이 쓰는 쪽을 기다리지 않게 한다. 동시 저장이 무서워서 SQLite 를 고른 것이라
 * 이 한 줄까지 켜야 고른 값어치가 나온다.
 */
function open(): DatabaseSync {
  if (db) return db;
  const file = FILE();
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    tier INTEGER NOT NULL,
    id   INTEGER NOT NULL,
    json TEXT    NOT NULL,
    PRIMARY KEY (tier, id)
  )`);
  return db;
}

/** 검증에서 파일을 갈아끼울 때 쓴다. 평소에는 부를 일이 없다. */
export function closeDb(): void {
  db?.close();
  db = null;
}

/** 한 티어의 기록, 최신순. 깨진 칸은 조용히 버린다 (lib/record.ts asRecord 와 같은 규칙). */
export function listByTier(tier: number): TripRecord[] {
  const rows = open().prepare("SELECT json FROM records WHERE tier = ? ORDER BY id DESC").all(tier);
  return rows
    .map((r) => {
      try {
        return asRecord(JSON.parse(String(r.json)));
      } catch {
        return null; // 손으로 고쳐 넣어 JSON 이 깨진 칸
      }
    })
    .filter((r): r is TripRecord => r !== null);
}

/**
 * 넣고 그 티어의 새 목록을 돌려준다. id 가 같으면 덮어쓴다 —
 * 같은 기록을 두 번 보내도(네트워크 재시도) 목록에 쌍둥이가 생기지 않는다.
 */
export function insert(tier: number, record: TripRecord): TripRecord[] {
  const d = open();
  d.prepare("INSERT OR REPLACE INTO records (tier, id, json) VALUES (?, ?, ?)").run(
    tier,
    record.id,
    JSON.stringify(record),
  );
  // 상한을 넘은 만큼 오래된 것부터 지운다 (BUCKET_MAX 주석)
  d.prepare(
    `DELETE FROM records WHERE tier = ?1 AND id NOT IN (
       SELECT id FROM records WHERE tier = ?1 ORDER BY id DESC LIMIT ?2
     )`,
  ).run(tier, BUCKET_MAX);
  return listByTier(tier);
}
