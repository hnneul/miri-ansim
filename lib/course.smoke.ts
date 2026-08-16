// 실제 코스 생성 확인 — node --experimental-strip-types --env-file=.env.local lib/course.smoke.ts
//
// course.check.ts 와 역할이 다르다. 저기는 "짜인 코스가 규칙을 지키는가"를 네트워크 없이 보고,
// 여기는 "카카오가 실제로 쓸 만한 후보를 주는가"를 본다.
//
// 이게 따로 필요한 이유 — 관심 장소의 검색 조건(lib/trip.ts INTERESTS 의 query·code·kinds)은
// 실제 응답을 보고 정한 값이라 카카오 쪽이 바뀌면 조용히 망가진다. 후보가 0곳이 되어도
// buildCourses 는 얌전히 빈 배열을 돌려주므로, 화면에는 그냥 "코스를 못 만들었어요"만 뜬다.
// 검색어를 손봤을 때 여기를 한 번 돌려 후보가 여전히 걸리는지 확인한다.
//
// 키가 필요해 CI에 넣을 수 없다.

import { buildCourses, gatherCandidates } from "./course.ts";
import { DEFAULT_TRIP, INTERESTS, periodLabel, type TripPlan } from "./trip.ts";

/** 이 스모크가 쓰는 하루 상한 (분 단위 검사에도 같은 값을 쓴다) */
const DRIVE_HOURS_TEST = 2;

const plan: TripPlan = {
  ...DEFAULT_TRIP,
  start: "2026-08-14",
  end: "2026-08-16",
  origin: "제주국제공항",
  originAt: [33.507, 126.493],
  interests: [0, 1, 4],
  musts: ["성산일출봉"],
  driveHours: DRIVE_HOURS_TEST,
};

const { candidates, missing } = await gatherCandidates(plan);

console.log(`\n후보 ${candidates.length}곳 · 좌표 못 찾은 곳 ${missing.length}`);
for (const i of plan.interests) {
  const mine = candidates.filter((c) => c.interest === i);
  console.log(`  ${INTERESTS[i].label.padEnd(8)} ${String(mine.length).padStart(2)}곳  ${mine.slice(0, 4).map((c) => c.name).join(", ")}`);
  if (!mine.length) console.log(`    ⚠ 후보가 없다 — query "${INTERESTS[i].query}" / code ${INTERESTS[i].code || "없음"} / kinds ${INTERESTS[i].kinds.join(",")} 를 확인할 것`);
}
if (missing.length) console.log(`  ⚠ 꼭 가고 싶은 곳 중 좌표를 못 받은 곳: ${missing.join(", ")}`);

const courses = buildCourses(plan, candidates);
console.log(`\n${periodLabel(plan)} · 코스 ${courses.length}개`);
for (const c of courses) {
  console.log(`\n[${c.title}]  총 ${Math.round(c.totalM / 1000)}km · ${c.totalMin}분`);
  for (const d of c.days) {
    console.log(`  ${d.date}  운전 ${d.driveMin}분`);
    for (const s of d.stops) console.log(`    ${s.must ? "★" : "·"} ${s.name} (${s.kind}) — ${s.legMin}분 / ${Math.round(s.legM)}m`);
  }

}

// 실제 응답으로도 지켜져야 하는 것 — 여기서 깨지면 화면에 그대로 나간다
for (const c of courses) {
  if (!c.days.flatMap((d) => d.stops).some((s) => s.name.includes("성산일출봉")))
    console.log(`\n⚠ "${c.title}" 에 꼭 가고 싶은 곳이 빠졌다`);
  for (const d of c.days)
    if (d.driveMin > DRIVE_HOURS_TEST * 60 && d.stops.length > 1)
      console.log(`\n⚠ ${d.date} 가 하루 상한(${DRIVE_HOURS_TEST * 60}분)을 넘었다: ${d.driveMin}분 / ${d.stops.length}곳`);
}
