"use client";

// 여행 기록 남기기 — 와이어프레임 TRIP-08-A · 08-A-1. 여행 완료(/trip/complete)에서 넘어온다.
// 방금 돈 코스를 기본으로 집어 두고, 사진·제목·이야기를 채워 "여행 기록 저장하기"로 목록(/trip/records)에 남긴다.
//
// 저장소는 아직 없다 — 이 화면은 입력만 살아 있는 목업이다. 코스는 "여행 코스" 셀렉터로 최근·지난
// 여행에서 고르거나(08-A-1) 접힌 채 요약만 보여준다(08-A). 사진은 실제로 골라 미리보기까지 되지만
// (blob URL) 어디에도 저장되진 않는다. 코스 이름·경로는 쿼리로 넘어오면 그 값을, 없으면 샘플을 쓴다.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";

type Course = { date: string; name: string; route: string };

/** 지난 여행(샘플). 저장소가 붙으면 여기를 실제 기록으로 갈아끼운다. */
const PAST: Course[] = [
  { date: "2026.07.02", name: "오름과 숲길 코스", route: "성산 → 비자림" },
  { date: "2026.05.18", name: "동쪽 바다 드라이브", route: "함덕 → 월정리" },
];

const PLACES = ["애월해안도로", "협재해수욕장", "금능해변"];

export default function TripRecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

function Record() {
  const router = useRouter();
  const params = useSearchParams();
  const suffix = params.toString() ? `?${params}` : "";

  // 최근 여행 = 방금 돈 코스. 쿼리로 넘어오면 그 값, 없으면 와이어프레임 샘플.
  const recent: Course = {
    date: params.get("date") || "2026.08.14",
    name: params.get("course") || "바다와 노을 코스",
    route: params.get("route") || "제주공항 → 애월 → 협재 → 금능",
  };
  const options = [recent, ...PAST];

  const [pick, setPick] = useState(0); // options 안의 고른 코스
  const [open, setOpen] = useState(false); // 코스 셀렉터 열림
  const [title, setTitle] = useState("애월에서 협재까지, 천천히 달린 하루");
  const [story, setStory] = useState("창문을 열자 바다 냄새가 가득했다.\n협재에서 바라본 노을은 오래 기억하고 싶다.");
  const [photos, setPhotos] = useState<string[]>(["/trip/photo-sunset.png", "/trip/photo-sea.png"]);
  const fileRef = useRef<HTMLInputElement>(null);
  const sel = options[pick];

  // 직접 고른 사진은 blob URL 이라, 화면을 떠날 때 만들어 둔 것만 되돌려 준다(누수 방지).
  useEffect(() => {
    return () => photos.forEach((p) => p.startsWith("blob:") && URL.revokeObjectURL(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((f) => URL.createObjectURL(f));
    if (picked.length) setPhotos((prev) => [...prev, ...picked].slice(0, 10));
    e.target.value = ""; // 같은 파일을 다시 골라도 onChange 가 다시 울리게
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />

      {/* 헤더 — 뒤로 · 제목 · 임시 저장(장식) */}
      <div className="flex h-[52px] shrink-0 items-center px-[20px]">
        <button onClick={() => router.back()} aria-label="뒤로" className="-ml-1 shrink-0 pr-1 transition active:scale-90">
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="#262626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 1 1 9l8 8" />
          </svg>
        </button>
        <h1 className="ml-3 text-[20px] leading-[26px] font-bold text-[#262626]">여행 기록 남기기</h1>
        <span className="ml-auto text-[13px] text-[#9e9e9e]">임시 저장</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[23px] pb-6">
        {/* 여행 코스 — 접힌 셀렉터. 열면 최근·지난 여행에서 고른다 */}
        <p className="mt-2 shrink-0 text-[16px] leading-[22px] font-bold text-[#262626]">여행 코스</p>
        <p className="mt-1 shrink-0 text-[13px] leading-[19px] text-[#7d7d7d]">최근·지난 여행에서 선택하거나 직접 추가할 수 있어요</p>

        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`mt-3 flex shrink-0 items-center justify-between rounded-2xl border-2 px-4 py-[9px] text-left transition ${
            open ? "border-[#ff7d32] bg-[#fff5ee]" : "border-[#eae7e2] bg-white"
          }`}
        >
          <span className="min-w-0">
            <span className="block text-[12px] leading-[17px] text-[#7d7d7d]">{sel.date}</span>
            <span className="block truncate text-[16px] leading-[22px] font-bold text-[#262626]">{sel.name}</span>
          </span>
          <Chevron up={open} />
        </button>

        {open && (
          <div className="mt-2 shrink-0 overflow-hidden rounded-2xl border border-[#eae7e2] bg-white p-2 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
            <p className="px-3 pt-2 pb-1 text-[13px] font-bold text-[#7d7d7d]">최근 여행</p>
            <Option course={options[0]} selected={pick === 0} onPick={() => (setPick(0), setOpen(false))} />
            <p className="px-3 pt-3 pb-1 text-[13px] font-bold text-[#7d7d7d]">지난 여행</p>
            {PAST.map((c, i) => (
              <Option key={i} course={c} compact selected={pick === i + 1} onPick={() => (setPick(i + 1), setOpen(false))} />
            ))}
            <button
              onClick={() => setOpen(false)}
              className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[15px] font-bold text-[#ff7d32] transition active:bg-[#fff5ee]"
            >
              <span className="text-[18px] leading-none">+</span> 여행 코스 직접 추가
            </button>
          </div>
        )}

        {/* 오늘의 사진 — 추가 타일 + 미리보기. 가로로 넘치면 스크롤한다 */}
        <div className="mt-6 flex shrink-0 items-center justify-between">
          <p className="text-[16px] leading-[22px] font-bold text-[#262626]">오늘의 사진</p>
          <p className="text-[13px] text-[#9e9e9e]">{photos.length} / 10</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
        <div className="mt-3 flex shrink-0 gap-[10px] overflow-x-auto pb-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex size-[104px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#fff0e6] text-[#ff7d32] transition active:scale-[0.97]"
          >
            <span className="text-[30px] leading-none">+</span>
            <span className="text-[13px] leading-none font-medium">사진 추가</span>
          </button>
          {photos.map((src, i) => (
            <div key={i} className="size-[104px] shrink-0 overflow-hidden rounded-2xl bg-[#f0eeeb]">
              <img src={src} alt="" className="size-full object-cover" />
            </div>
          ))}
        </div>

        {/* 기록 제목 */}
        <p className="mt-6 shrink-0 text-[16px] leading-[22px] font-bold text-[#262626]">기록 제목</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={40}
          placeholder="오늘 하루에 이름을 붙여 주세요"
          className="mt-3 h-[52px] shrink-0 rounded-2xl border border-[#eae7e2] bg-white px-4 text-[15px] text-[#262626] outline-none placeholder:text-[#b8b2aa] focus:border-[#ff7d32]"
        />

        {/* 여행 이야기 */}
        <p className="mt-6 shrink-0 text-[16px] leading-[22px] font-bold text-[#262626]">여행 이야기</p>
        <div className="mt-3 shrink-0 rounded-2xl border border-[#eae7e2] bg-white px-4 pt-3 pb-2 focus-within:border-[#ff7d32]">
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="오늘 하루를 돌아보며 남기고 싶은 이야기를 적어 주세요"
            className="w-full resize-none text-[15px] leading-[23px] text-[#262626] outline-none placeholder:text-[#b8b2aa]"
          />
          <p className="text-right text-[12px] text-[#9e9e9e]">{story.length} / 500</p>
        </div>

        {/* 방문 장소 — 샘플 칩. "+"는 아직 자리만 잡아둔다(저장소가 없다) */}
        <p className="mt-6 shrink-0 text-[16px] leading-[22px] font-bold text-[#262626]">방문 장소</p>
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-[10px]">
          {PLACES.map((p) => (
            <span key={p} className="rounded-full bg-[#fff5ee] px-4 py-2 text-[13px] font-medium text-[#262626]">
              {p}
            </span>
          ))}
          <span aria-hidden className="grid size-[34px] place-items-center rounded-full border border-[#ff7d32] text-[18px] leading-none text-[#ff7d32]">
            +
          </span>
        </div>

        {/* 안내 한 줄 */}
        <div className="mt-4 flex shrink-0 items-center gap-2 rounded-xl bg-[#f6f4f1] px-4 py-3">
          <Pin />
          <p className="text-[12px] leading-[18px] text-[#7d7d7d]">TIP. 오늘 하루를 돌아보며 페이지를 기록해주세요</p>
        </div>
      </div>

      <button
        onClick={() => router.push(`/trip/records${suffix}`)}
        className="mx-[23px] mt-2 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-bold text-white transition active:scale-[0.98]"
      >
        여행 기록 저장하기
      </button>
      <div className="h-[34px] shrink-0" />
    </div>
  );
}

/** 코스 셀렉터 항목. 고른 것은 주황 체크 + 연한 주황 바탕, 지난 여행은 compact 로 한 단 작게. */
function Option({ course, selected, compact, onPick }: { course: Course; selected: boolean; compact?: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${selected ? "bg-[#fff0e6]" : "active:bg-[#f6f4f1]"}`}
    >
      {!compact && (
        <span className={`w-5 shrink-0 text-center text-[16px] font-bold ${selected ? "text-[#ff7d32]" : "text-transparent"}`}>✓</span>
      )}
      <span className="min-w-0">
        <span className={`block truncate font-bold text-[#262626] ${compact ? "text-[15px] leading-[20px]" : "text-[16px] leading-[22px]"}`}>
          {course.name}
        </span>
        <span className="block truncate text-[13px] leading-[18px] text-[#9e9e9e]">
          {course.date} · {course.route}
        </span>
      </span>
    </button>
  );
}

/** 접었다 폈다 하는 화살표 */
function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="#ff7d32"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ml-2 shrink-0 transition-transform ${up ? "" : "rotate-180"}`}
    >
      <path d="M4 11l5-5 5 5" />
    </svg>
  );
}

/** 안내 줄 앞의 작은 핀 */
function Pin() {
  return (
    <svg width="12" height="15" viewBox="0 0 12 15" fill="#ff7d32" className="shrink-0">
      <path d="M6 0a6 6 0 0 0-6 6c0 4.2 6 9 6 9s6-4.8 6-9a6 6 0 0 0-6-6Z" />
      <circle cx="6" cy="6" r="2.2" fill="#fff" />
    </svg>
  );
}
