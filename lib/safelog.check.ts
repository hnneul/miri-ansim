// 주행 저장소 — node lib/safelog.check.ts
//
// 여기서 지켜야 할 건 셋이다.
//   ① 티어끼리 안 섞이는가 (버킷이 로그인 대신이다 — records.db.check.ts 와 같은 이유)
//   ② 같은 길을 다시 담을 때 쌓이지 않는가 (쌓이면 요약의 회수·거리가 뻥이 된다)
//   ③ 모양이 아닌 것을 거절하는가 (공개 API 라 아무 값이나 들어온다)

import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 진짜 홈(~/miri-data)을 건드리지 않게 임시 파일을 물린다 — import 보다 먼저 정해야 한다
const dir = mkdtempSync(join(tmpdir(), "miri-drives-"));
process.env.RECORDS_DB = join(dir, "records.db");

const { closeDb, insertDrive, listDrives, removeDrive, setDriveMine } = await import("./records.db.ts");
const { asDrive, thinPath, PATH_MAX, SAME_DRIVE_MS } = await import("./safelog.ts");

const 경로 = [
  [33.47812, 126.36867],
  [33.4535, 126.3105],
  [33.3935, 126.23934],
] as [number, number][];

const 주행 = (id: number, title: string, extra = {}) =>
  asDrive({
    id,
    date: "2026-08-12",
    title,
    mine: false,
    score: 66,
    minutes: 28,
    km: 19,
    slower: 0,
    path: 경로,
    parking: "협재해수욕장 공영주차장",
    reasons: ["20%", "10곳", "확인 안 됨"],
    parkingTags: "입구 넓음 · 지상",
    ...extra,
  })!;

const 지금 = 1_760_000_000_000;

try {
  /* ─────────────── ③ 모양 검사 ─────────────── */
  assert.equal(asDrive(null), null, "빈 값은 기록이 아니다");
  assert.equal(asDrive({ id: 1, title: "가 → 나" }), null, "경로가 없으면 기록이 아니다");
  assert.equal(
    asDrive({ id: 1, title: "가 → 나", path: [[33, 126]] }),
    null,
    "한 점짜리 경로는 지도에 그릴 수 없다 — 기록이 아니다",
  );
  assert.equal(asDrive({ id: 1, title: "  ", path: 경로 }), null, "제목이 비면 기록이 아니다");
  assert.equal(asDrive({ title: "가 → 나", path: 경로 }), null, "id 가 없으면 기록이 아니다");

  // 모자란 네 줄은 "확인 안 됨"으로 채운다 — 화면이 네 줄을 그리고 있다
  const 모자란 = asDrive({ id: 1, title: "가 → 나", path: 경로, reasons: ["2번"] })!;
  assert.deepEqual(모자란.reasons, ["2번", "확인 안 됨", "확인 안 됨"]);
  assert.equal(모자란.slower, 0, "안 준 값은 0 이다");
  assert.equal(모자란.mine, false, "mine 은 true 일 때만 true 다");

  // 좌표는 상한까지만. 양끝은 반드시 남는다
  const 긴경로 = Array.from({ length: 500 }, (_, i) => [33 + i / 10000, 126 + i / 10000] as [number, number]);
  const 솎인 = thinPath(긴경로);
  assert.equal(솎인.length, PATH_MAX, `좌표는 ${PATH_MAX}점으로 솎인다`);
  assert.deepEqual(솎인[0], 긴경로[0], "출발점은 그대로 남는다");
  assert.deepEqual(솎인.at(-1), 긴경로.at(-1), "도착점은 그대로 남는다");

  /* ─────────────── ① 티어 ─────────────── */
  assert.deepEqual(listDrives(1), [], "빈 버킷은 빈 목록이다");

  insertDrive(1, 주행(지금, "애월해안도로 → 협재"));
  insertDrive(3, 주행(지금, "성산일출봉 → 함덕"));

  assert.equal(listDrives(1).length, 1);
  assert.equal(listDrives(3).length, 1);
  assert.equal(listDrives(1)[0].title, "애월해안도로 → 협재", "티어끼리 안 섞인다");
  assert.equal(listDrives(10).length, 0, "안 쓴 티어는 비어 있다");

  // 최신순
  insertDrive(1, 주행(지금 + 1000, "표선 → 성산항"));
  assert.deepEqual(
    listDrives(1).map((d) => d.title),
    ["표선 → 성산항", "애월해안도로 → 협재"],
    "목록은 최신순이다",
  );

  /* ─────────────── ② 같은 길 다시 담기 ─────────────── */
  const 잠시뒤 = insertDrive(1, 주행(지금 + SAME_DRIVE_MS - 1, "애월해안도로 → 협재", { km: 21 }));
  assert.equal(잠시뒤.length, 2, "30분 안에 같은 길을 다시 담으면 쌓이지 않는다");
  assert.equal(잠시뒤.find((d) => d.title === "애월해안도로 → 협재")!.km, 21, "새 값으로 갈아끼운다");

  // 폭은 **마지막으로 담긴 시각**부터 잰다. 방금 갈아끼운 칸이 지금+30분-1 에 있으므로,
  // 그보다 30분을 더 지나야 다른 주행이다 (지금+30분+1초 로 재면 1초 차이라 여전히 같은 주행이다).
  const 한참뒤 = insertDrive(1, 주행(지금 + 2 * SAME_DRIVE_MS, "애월해안도로 → 협재"));
  assert.equal(한참뒤.length, 3, "30분이 지나면 다른 주행이다");

  /* ─────────────── 나만의 길 ─────────────── */
  const 표선 = 지금 + 1000;
  const 담긴 = setDriveMine(1, 표선, true);
  assert.equal(담긴.find((d) => d.id === 표선)!.mine, true, "나만의 길에 담긴다");
  assert.equal(담긴.filter((d) => d.mine).length, 1, "다른 기록은 안 건드린다");

  // 담아둔 길을 다시 달려도 표시가 안 풀린다. 갈아끼우면 **id 가 새것으로 바뀐다**
  const 다시달림 = insertDrive(1, 주행(표선 + SAME_DRIVE_MS - 1, "표선 → 성산항"));
  const 새표선 = 다시달림.find((d) => d.title === "표선 → 성산항")!;
  assert.equal(다시달림.length, 3, "다시 달려도 쌓이지 않는다");
  assert.equal(새표선.mine, true, "갈아끼워도 나만의 길 표시는 살아남는다");
  assert.equal(새표선.id, 표선 + SAME_DRIVE_MS - 1, "갈아끼운 칸은 새 시각을 갖는다");

  assert.equal(setDriveMine(1, 새표선.id, false).find((d) => d.id === 새표선.id)!.mine, false);
  assert.doesNotThrow(() => setDriveMine(1, 99, true), "없는 id 는 조용히 넘어간다");

  /* ─────────────── 빼기 ─────────────── */
  const 뺀뒤 = removeDrive(1, 새표선.id);
  assert.equal(뺀뒤.length, 2, "✕ 는 그 기록만 뺀다");
  assert.ok(!뺀뒤.some((d) => d.id === 새표선.id), "뺀 기록은 목록에 없다");
  assert.equal(removeDrive(1, 새표선.id).length, 2, "없는 id 를 또 빼도 같은 결과다");
  assert.equal(listDrives(3).length, 1, "다른 티어는 안 건드린다");

  console.log("✅ 주행 저장소 — 티어 분리 · 같은 길 갈아끼우기 · 모양 검사 통과");
} finally {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
}
