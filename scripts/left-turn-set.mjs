// 판독 결과 적기 —
//   node --experimental-strip-types scripts/left-turn-set.mjs 덕수1교차로 비보호 2026-03-09 비보호표지
//
// data/unprotected-left.json 을 손으로 고치면 두 가지가 샌다. 칸이 54개라 맞는 블록을 찾다
// 엉뚱한 데 적기 쉽고, 실제로 쉼표 하나 잘못 들어가 파일이 깨진 적이 있다. 이름으로 찾아 넣는다.
//
// 이름이 여럿 걸리면(같은 이름의 지점이 둘 이상) 안 적고 후보를 보여준다 — 아무 데나 적는 것보다
// 낫다. 그때는 좌표 키를 그대로 첫 인자로 준다.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../data/unprotected-left.json", import.meta.url));
const 값 = ["비보호", "보호", "무신호", "판단불가"];

/**
 * 무엇을 보고 그렇게 정했나. **결론만 남기면 나중에 재검증할 때 무엇부터 다시 볼지 모른다.**
 * 표지를 직접 본 건 확정이고, 등화만 보고 정한 건 다시 볼 후보다 — 실측에서 저해상도 화면의
 * 등 칸 수를 잘못 세어 3구로 읽었다가 확대하니 4구였던 적이 있다(남문사거리).
 */
const 근거 = ["비보호표지", "등화3구", "등화4구", "신호없음"];

const [찾을것, verdict, shotAt, basis] = process.argv.slice(2);
if (!찾을것 || !값.includes(verdict) || (basis && !근거.includes(basis))) {
  console.error(`사용법: <이름 또는 좌표키> <${값.join("|")}> [촬영일 YYYY-MM-DD] [${근거.join("|")}]`);
  process.exit(1);
}

const d = JSON.parse(readFileSync(OUT, "utf8"));
const keys = d[찾을것] ? [찾을것] : Object.keys(d).filter((k) => d[k].label === 찾을것);

if (!keys.length) {
  console.error(`"${찾을것}" 을 못 찾았습니다.`);
  process.exit(1);
}
if (keys.length > 1) {
  console.error(`"${찾을것}" 이 ${keys.length}곳입니다 — 좌표 키로 지정하세요:`);
  for (const k of keys) console.error(`  ${k}  (진입 ${d[k].bearing}°, ${d[k].guidance})`);
  process.exit(1);
}

const [k] = keys;
d[k].verdict = verdict;
if (shotAt) d[k].shotAt = shotAt;
// 안 주면 지우지 않고 그대로 둔다 — 촬영일만 고치러 다시 부르는 일이 있다
if (basis) d[k].basis = basis;
else d[k].basis ??= null;
writeFileSync(OUT, JSON.stringify(d, null, 2) + "\n");

const v = Object.values(d);
console.log(`${d[k].label} → ${verdict} (촬영 ${d[k].shotAt ?? "미기록"}, 근거 ${d[k].basis ?? "미기록"})`);
const 판정 = v.filter((x) => x.verdict);
console.log(`  판정 ${판정.length} / ${v.length}곳 · 근거 미기록 ${판정.filter((x) => !x.basis).length}곳`);
