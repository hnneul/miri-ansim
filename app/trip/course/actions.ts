"use server";

// 코스 생성 — 화면(page.tsx)이 부르는 자리.
//
// 여기서 새로 하는 계산은 없다. lib/course.ts 에 다 있고(gatherCandidates → buildCourses),
// 이 파일은 그걸 화면이 부를 수 있는 자리로 옮겨 놓는 것뿐이다 (app/route/actions.ts 와 같은 모양).
//
// **서버여야 하는 이유**는 카카오 REST 키가 서버 전용이라서다 — 후보 검색도 지오코딩도
// 브라우저에서 직접 못 부른다 (lib/poi.ts · lib/geocode.ts).

import { buildCourses, gatherCandidates, type Course } from "@/lib/course";
import { geocodePlace } from "@/lib/geocode";
import { parseTrip, type TripPlan } from "@/lib/trip";

export type Made =
  | { plan: TripPlan; courses: Course[]; missing: string[] }
  | { error: string };

export async function makeCourses(query: Record<string, string | string[]>): Promise<Made> {
  const parsed = parseTrip(query);

  /*
    좌표 없이 이름만 온 경우를 살려준다. 위저드는 늘 좌표를 같이 싣지만, 이 화면의 URL 은
    통째로 공유·수정될 수 있어서 ?origin=성산일출봉 만 남은 링크가 들어올 수 있다.
    이름을 좌표로 바꾸는 건 어차피 여기서 하는 일이라 한 번 더 부르면 된다.
  */
  let plan = parsed;
  if (!plan.originAt && plan.origin) {
    const found = await geocodePlace(plan.origin);
    if (!("error" in found)) plan = { ...plan, originAt: found.coord };
  }
  if (!plan.originAt) return { error: "출발 위치를 찾지 못했어요. 다시 골라주세요." };

  const { candidates, missing } = await gatherCandidates(plan);
  if (!candidates.length) return { error: "조건에 맞는 장소를 찾지 못했어요. 관심 장소를 더 골라보세요." };

  const courses = buildCourses(plan, candidates);
  // 후보는 있는데 코스가 안 나오는 건 하루 운전 시간이 너무 짧을 때다 —
  // 무엇을 바꾸면 되는지까지 말해야 사용자가 되돌아가서 고칠 수 있다
  if (!courses.length) return { error: "하루 운전 시간 안에 갈 수 있는 곳이 없어요. 시간을 늘려보세요." };

  return { plan, courses, missing };
}
