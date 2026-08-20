// 기록 저장소 — 서버 전용. app/api/records/route.ts 와 app/api/drives/route.ts 만 부른다.
//
// 표가 둘이다: 여행 기록(records)과 주행 저장(drives). 버킷 규칙·상한·파일 자리가 같고
// 무엇보다 **연결이 하나여야 해서** 한 모듈에 둔다 — 파일을 나누면 같은 DB 를 두 번 연다.
//
// **버킷은 브라우저 하나다** (lib/me.ts me()). 로그인이 없어도 "내 기록"이 내 것이 된다.
//
// 예전에는 익숙함 티어 셋(1·3·10)이 버킷이었다 — 왕초보를 고른 사람이 모두 같은 목록을 읽고
// 쓰고 **지웠다**. 시연에서 목록이 차 있다는 이점이 있었지만, "나의 여행 기록" 아래에 남의
// 여행이 뜨고 카드의 ✕ 가 남의 것을 지우는 대가가 더 컸다. 주행 저장은 길 비교에서 내비를
// 한 번만 눌러도 스스로 채워지므로(app/route/page.tsx 담기), 빈 목록으로 시작하는 건
// 여행 기록 하나뿐이다.
//
// 공개 주소라 아무나 쓸 수 있는 건 그대로다 (route.ts 의 크기 제한 + 아래 두 상한이 방어다).
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
 * 버킷 하나에 남겨두는 최대 기록 수. 넘치면 **오래된 것부터 지운다** —
 * 목록이 최신순이라 화면에서 안 보이던 것이 먼저 사라진다.
 */
const BUCKET_MAX = 200;

/**
 * 표 하나의 전체 상한.
 *
 * **버킷이 브라우저별이 되면서 필요해졌다.** 티어 버킷이던 때는 버킷이 셋뿐이라
 * BUCKET_MAX 200 이 곧 총 600행이었는데, 이제는 버킷을 얼마든지 만들 수 있다 —
 * 공개 엔드포인트라 id 를 바꿔가며 부르면 디스크가 한없이 자란다.
 * id 가 저장 시각(ms)이라 오래된 행이 먼저 나간다. rowid 로 세는 건 (owner, id) 가
 * 키라서 id 만으로는 행이 안 집히기 때문이다.
 */
const TOTAL_MAX = 5_000;

/** 표 전체가 상한을 넘은 만큼 오래된 행을 지운다 (TOTAL_MAX 주석) */
function trim(d: DatabaseSync, table: "records" | "drives"): void {
  d.prepare(
    `DELETE FROM ${table} WHERE rowid NOT IN (
       SELECT rowid FROM ${table} ORDER BY id DESC LIMIT ?
     )`,
  ).run(TOTAL_MAX);
}

let db: DatabaseSync | null = null;

/**
 * 첫 호출 때 열고 표를 만든다. 모듈을 읽는 것만으로 디스크를 건드리면 빌드 때도 파일이 생긴다.
 *
 * 기록을 칸별 열이 아니라 json 한 칸에 통째로 넣는다 — 조회가 "주인으로 골라 최신순" 하나뿐이라
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
  /*
   * 옛 스키마(티어 버킷)를 옆으로 치운다. **지우지 않고 이름만 바꾼다** — 시연 중에 담긴
   * 기록이라 버려도 되는 값이지만, 배포가 도는 자리에서 표를 DROP 하는 건 되돌릴 수가 없다.
   * 옮겨 담지 않는 이유는 옛 행에 주인이 없어서다: 어느 브라우저 것인지 알 길이 없다.
   */
  for (const t of ["records", "drives"] as const) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all();
    if (cols.length > 0 && !cols.some((c) => String(c.name) === "owner")) {
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_tier_v1`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    owner TEXT    NOT NULL,
    id   INTEGER NOT NULL,
    json TEXT    NOT NULL,
    PRIMARY KEY (owner, id)
  )`);
  /*
   * 주행 저장. records 와 같은 모양이되 title 을 열로 뽑아 둔다 — 넣기 전에
   * "같은 길을 방금 담았나"를 물어야 해서다 (lib/safelog.ts SAME_DRIVE_MS).
   * json 안을 뒤지려면 칸을 전부 읽어 파싱해야 하는데, 그 질문 하나 때문에 그럴 이유가 없다.
   */
  db.exec(`CREATE TABLE IF NOT EXISTS drives (
    owner TEXT    NOT NULL,
    id    INTEGER NOT NULL,
    title TEXT    NOT NULL,
    json  TEXT    NOT NULL,
    PRIMARY KEY (owner, id)
  )`);
  return db;
}

/** 검증에서 파일을 갈아끼울 때 쓴다. 평소에는 부를 일이 없다. */
export function closeDb(): void {
  db?.close();
  db = null;
}

/** 한 브라우저의 기록, 최신순. 깨진 칸은 조용히 버린다 (lib/record.ts asRecord 와 같은 규칙). */
export function listByOwner(owner: string): TripRecord[] {
  const rows = open().prepare("SELECT json FROM records WHERE owner = ? ORDER BY id DESC").all(owner);
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
 * 넣고 새 목록을 돌려준다. id 가 같으면 덮어쓴다 —
 * 같은 기록을 두 번 보내도(네트워크 재시도) 목록에 쌍둥이가 생기지 않는다.
 */
export function insert(owner: string, record: TripRecord): TripRecord[] {
  const d = open();
  d.prepare("INSERT OR REPLACE INTO records (owner, id, json) VALUES (?, ?, ?)").run(
    owner,
    record.id,
    JSON.stringify(record),
  );
  // 상한을 넘은 만큼 오래된 것부터 지운다 (BUCKET_MAX 주석)
  d.prepare(
    `DELETE FROM records WHERE owner = ?1 AND id NOT IN (
       SELECT id FROM records WHERE owner = ?1 ORDER BY id DESC LIMIT ?2
     )`,
  ).run(owner, BUCKET_MAX);
  trim(d, "records");
  return listByOwner(owner);
}

/** 카드의 ✕. 없는 id 를 지워도 조용히 넘어간다 — 두 번 눌러도 같은 결과여야 한다 (removeDrive 와 같다) */
export function remove(owner: string, id: number): TripRecord[] {
  open().prepare("DELETE FROM records WHERE owner = ? AND id = ?").run(owner, id);
  return listByOwner(owner);
}

/* ─────────────────────────────── 주행 저장 ─────────────────────────────── */

/** 한 브라우저의 주행, 최신순. 깨진 칸은 조용히 버린다 (listByOwner 와 같은 규칙) */
export function listDrives(owner: string): SafeDrive[] {
  const rows = open().prepare("SELECT json FROM drives WHERE owner = ? ORDER BY id DESC").all(owner);
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
 * 담고 새 목록을 돌려준다.
 *
 * **같은 길을 방금 담았으면 새로 쌓지 않고 그 칸을 갈아끼운다** — 길 비교 화면에서 내비를
 * 눌렀다 돌아와 다른 길로 다시 누르는 게 흔한데, 그때마다 쌓이면 요약의 이용 횟수와 이동
 * 거리가 부풀어 화면이 거짓말을 한다 (lib/safelog.ts SAME_DRIVE_MS).
 *
 * 갈아끼울 때 **나만의 길 표시는 살려 둔다.** 담아둔 길을 다시 달렸다고 표시가 풀리면,
 * 사람은 자기가 뭘 잘못 눌러 빠진 줄 안다.
 */
export function insertDrive(owner: string, drive: SafeDrive): SafeDrive[] {
  const d = open();
  const 최근 = d
    .prepare("SELECT id, json FROM drives WHERE owner = ? AND title = ? AND id > ? ORDER BY id DESC LIMIT 1")
    .get(owner, drive.title, drive.id - SAME_DRIVE_MS);

  if (최근) {
    let mine = drive.mine;
    try {
      mine ||= asDrive(JSON.parse(String(최근.json)))?.mine === true;
    } catch {
      /* 깨진 칸이면 새 값 그대로 간다 */
    }
    d.prepare("DELETE FROM drives WHERE owner = ? AND id = ?").run(owner, 최근.id);
    drive = { ...drive, mine };
  }

  d.prepare("INSERT OR REPLACE INTO drives (owner, id, title, json) VALUES (?, ?, ?, ?)").run(
    owner,
    drive.id,
    drive.title,
    JSON.stringify(drive),
  );
  // 상한은 records 와 같다 — 넘친 만큼 오래된 것부터 지운다
  d.prepare(
    `DELETE FROM drives WHERE owner = ?1 AND id NOT IN (
       SELECT id FROM drives WHERE owner = ?1 ORDER BY id DESC LIMIT ?2
     )`,
  ).run(owner, BUCKET_MAX);
  trim(d, "drives");
  return listDrives(owner);
}

/** 카드의 ✕. 없는 id 를 지워도 조용히 넘어간다 — 두 번 눌러도 같은 결과여야 한다 */
export function removeDrive(owner: string, id: number): SafeDrive[] {
  open().prepare("DELETE FROM drives WHERE owner = ? AND id = ?").run(owner, id);
  return listDrives(owner);
}

/**
 * "나만의 길"에 담거나 뺀다. 없는 id 면 아무 일도 안 일어난다.
 * json 을 통째로 다시 쓰는 이유는 형이 한 군데(asDrive)에만 살게 하기 위해서다.
 */
export function setDriveMine(owner: string, id: number, mine: boolean): SafeDrive[] {
  const d = open();
  const row = d.prepare("SELECT json FROM drives WHERE owner = ? AND id = ?").get(owner, id);
  if (row) {
    try {
      const cur = asDrive(JSON.parse(String(row.json)));
      if (cur) {
        d.prepare("UPDATE drives SET json = ? WHERE owner = ? AND id = ?").run(
          JSON.stringify({ ...cur, mine }),
          owner,
          id,
        );
      }
    } catch {
      /* 깨진 칸은 손대지 않는다 — 읽을 때 어차피 버려진다 */
    }
  }
  return listDrives(owner);
}
