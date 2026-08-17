"use server";

// 코스 생성 — TRIP-05(생성 중)에서 부른다. 후보 수집(카카오 로컬)과 지오코딩이 서버 전용 키를
// 쓰므로 화면(클라이언트)은 여기를 거친다 (app/home/actions.ts·app/destination/actions.ts 와 같은 이유).
//
// 계산은 lib/course.ts 가 한다 — 여기서는 쿼리를 계획으로 되읽어 넘기고, 결과(직렬화 가능한
// 순수 객체)를 그대로 돌려준다. AI 는 아직 코스 이름을 안 짓는다(모델 미정) — 화면이 규칙으로 채운다.

import { parseTrip } from "@/lib/trip";
import { gatherCandidates, buildCourses, type Course } from "@/lib/course";

export type CoursePlan = { courses: Course[]; missing: string[] };

/**
 * 쿼리 문자열 → 추천 코스. 문자열로 받는 이유: must 처럼 같은 키가 여러 번 오는 값을
 * Object.fromEntries 로 접으면 마지막 하나만 남는다 (parseTrip 은 배열을 기대한다).
 */
export async function planCourses(query: string): Promise<CoursePlan> {
  const sp = new URLSearchParams(query);
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    record[key] = all.length > 1 ? all : all[0];
  }

  const plan = parseTrip(record);
  const { candidates, missing } = await gatherCandidates(plan);
  const courses = buildCourses(plan, candidates);
  return { courses, missing };
}
