// 기록 저장소 — 서버 전용. app/api/records/route.ts 와 app/api/drives/route.ts 만 부른다.
//
// 표가 둘이다: 여행 기록(records)과 주행 저장(drives). 버킷 규칙·상한·파일 자리가 같고
// 무엇보다 **연결이 하나여야 해서** 한 모듈에 둔다 — 파일을 나누면 같은 DB 를 두 번 연다.
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
import { asDrive, SAME_DRIVE_MS, type SafeDrive } from "./safelog.ts";

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
  /*
   * 주행 저장. records 와 같은 모양이되 title 을 열로 뽑아 둔다 — 넣기 전에
   * "같은 길을 방금 담았나"를 물어야 해서다 (lib/safelog.ts SAME_DRIVE_MS).
   * json 안을 뒤지려면 칸을 전부 읽어 파싱해야 하는데, 그 질문 하나 때문에 그럴 이유가 없다.
   */
  db.exec(`CREATE TABLE IF NOT EXISTS drives (
    tier  INTEGER NOT NULL,
    id    INTEGER NOT NULL,
    title TEXT    NOT NULL,
    json  TEXT    NOT NULL,
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

/** 카드의 ✕. 없는 id 를 지워도 조용히 넘어간다 — 두 번 눌러도 같은 결과여야 한다 (removeDrive 와 같다) */
export function remove(tier: number, id: number): TripRecord[] {
  open().prepare("DELETE FROM records WHERE tier = ? AND id = ?").run(tier, id);
  return listByTier(tier);
}

/* ─────────────────────────────── 주행 저장 ─────────────────────────────── */

/** 한 티어의 주행, 최신순. 깨진 칸은 조용히 버린다 (listByTier 와 같은 규칙) */
export function listDrives(tier: number): SafeDrive[] {
  const rows = open().prepare("SELECT json FROM drives WHERE tier = ? ORDER BY id DESC").all(tier);
  return rows
    .map((r) => {
      try {
        return asDrive(JSON.parse(String(r.json)));
      } catch {
        return null;
      }
    })
    .filter((d): d is SafeDrive => d !== null);
}

/**
 * 담고 그 티어의 새 목록을 돌려준다.
 *
 * **같은 길을 방금 담았으면 새로 쌓지 않고 그 칸을 갈아끼운다** — 길 비교 화면에서 내비를
 * 눌렀다 돌아와 다른 길로 다시 누르는 게 흔한데, 그때마다 쌓이면 요약의 이용 횟수와 이동
 * 거리가 부풀어 화면이 거짓말을 한다 (lib/safelog.ts SAME_DRIVE_MS).
 *
 * 갈아끼울 때 **나만의 길 표시는 살려 둔다.** 담아둔 길을 다시 달렸다고 표시가 풀리면,
 * 사람은 자기가 뭘 잘못 눌러 빠진 줄 안다.
 */
export function insertDrive(tier: number, drive: SafeDrive): SafeDrive[] {
  const d = open();
  const 최근 = d
    .prepare("SELECT id, json FROM drives WHERE tier = ? AND title = ? AND id > ? ORDER BY id DESC LIMIT 1")
    .get(tier, drive.title, drive.id - SAME_DRIVE_MS);

  if (최근) {
    let mine = drive.mine;
    try {
      mine ||= asDrive(JSON.parse(String(최근.json)))?.mine === true;
    } catch {
      /* 깨진 칸이면 새 값 그대로 간다 */
    }
    d.prepare("DELETE FROM drives WHERE tier = ? AND id = ?").run(tier, 최근.id);
    drive = { ...drive, mine };
  }

  d.prepare("INSERT OR REPLACE INTO drives (tier, id, title, json) VALUES (?, ?, ?, ?)").run(
    tier,
    drive.id,
    drive.title,
    JSON.stringify(drive),
  );
  // 상한은 records 와 같다 — 넘친 만큼 오래된 것부터 지운다
  d.prepare(
    `DELETE FROM drives WHERE tier = ?1 AND id NOT IN (
       SELECT id FROM drives WHERE tier = ?1 ORDER BY id DESC LIMIT ?2
     )`,
  ).run(tier, BUCKET_MAX);
  return listDrives(tier);
}

/** 카드의 ✕. 없는 id 를 지워도 조용히 넘어간다 — 두 번 눌러도 같은 결과여야 한다 */
export function removeDrive(tier: number, id: number): SafeDrive[] {
  open().prepare("DELETE FROM drives WHERE tier = ? AND id = ?").run(tier, id);
  return listDrives(tier);
}

/**
 * "나만의 길"에 담거나 뺀다. 없는 id 면 아무 일도 안 일어난다.
 * json 을 통째로 다시 쓰는 이유는 형이 한 군데(asDrive)에만 살게 하기 위해서다.
 */
export function setDriveMine(tier: number, id: number, mine: boolean): SafeDrive[] {
  const d = open();
  const row = d.prepare("SELECT json FROM drives WHERE tier = ? AND id = ?").get(tier, id);
  if (row) {
    try {
      const cur = asDrive(JSON.parse(String(row.json)));
      if (cur) {
        d.prepare("UPDATE drives SET json = ? WHERE tier = ? AND id = ?").run(
          JSON.stringify({ ...cur, mine }),
          tier,
          id,
        );
      }
    } catch {
      /* 깨진 칸은 손대지 않는다 — 읽을 때 어차피 버려진다 */
    }
  }
  return listDrives(tier);
}
