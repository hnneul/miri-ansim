"use client";

// 여행 기록 — 최종 와이어프레임 "여행 기록" 섹션 (Figma 2765:1883).
// TRIP-08(여행 완료) → TRIP-08-A·08-A-1(기록 작성) → TRIP-09(나의 여행 기록) 세 장이다.
//
// 셋이 한 라우트인 이유는 /trip 과 같다 — 작성 중인 한 덩이(코스·제목·이야기·장소)를 계속 고쳐 쓰는데,
// 라우트를 나누면 그 덩이를 화면마다 다시 실어 날라야 한다.
//
// 들어오는 문은 /trip/course 의 외부 내비 화면이다. 거기서 방금 다녀온 코스의 **요약만** 쿼리로 온다
// (lib/record.ts toRecordQuery). 요약이 없으면 완료 화면을 건너뛰고 목록만 보여준다 — 링크를 직접
// 열었거나 저장을 마치고 되돌아온 경우다.
//
// 색은 /trip 플로우 토큰을 쓴다 (accent #ff7d32). 와이어프레임의 08-A-1 두 장만 홈 계열(#ff5914)로
// 그려져 있는데, 같은 흐름 안에서 화면마다 주황이 달라지는 게 더 어색해 한쪽으로 맞췄다.
//
// 좌표는 390x844 를 옮기되 절대배치는 안 쓴다 — .phone 이 노트북에서 844 보다 낮아질 수 있다
// (app/onboarding/page.tsx 와 같은 이유).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";
import {
  BODY_MAX,
  clearDraft,
  dotted,
  isoToday,
  loadDraft,
  loadRecords,
  parseSummary,
  saveDraft,
  saveRecord,
  type CourseSummary,
  type TripRecord,
} from "@/lib/record";

/** 사진 한 기록에 최대 몇 장인지 (와이어프레임 "2 / 10") */
const PHOTO_MAX = 10;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function RecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

type View = "done" | "write" | "list";

function Record() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const summary = parseSummary(searchParams);

  // 방금 끝낸 코스가 있으면 완료 화면부터, 없으면 목록만 (위 첫 주석)
  const [view, setView] = useState<View>(summary ? "done" : "list");
  const [records, setRecords] = useState<TripRecord[]>([]);

  // localStorage 는 서버에 없다 — 첫 그림을 그린 뒤에 읽는다
  useEffect(() => setRecords(loadRecords()), []);

  const home = () => router.push(`/home?${searchParams}`);

  if (view === "done" && summary) return <Done onSave={() => setView("write")} onSkip={home} />;

  if (view === "write")
    return (
      <Write
        summary={summary}
        records={records}
        onBack={() => setView(summary ? "done" : "list")}
        onSaved={(next) => {
          setRecords(next);
          setView("list");
        }}
      />
    );

  return <List records={records} onHome={home} />;
}

/** 상태바 + 흰 바탕. 세 화면이 같은 틀을 쓴다 (app/trip/course/page.tsx Frame 과 같은 이유). */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      {children}
    </div>
  );
}

/** 주황 CTA. 세 화면의 하단 버튼이 같은 모양이다 (Figma "Travel CTA / Primary"). */
function Cta({ label, onClick, tone = "accent" }: { label: string; onClick: () => void; tone?: "accent" | "muted" }) {
  return (
    <button
      onClick={onClick}
      className={`mx-6 h-12 shrink-0 rounded-2xl text-[16px] font-medium transition active:scale-[0.98] ${
        tone === "accent" ? "bg-[#ff7d32] text-white" : "bg-[#d6d6d6] text-[#262626]"
      }`}
    >
      {label}
    </button>
  );
}

/* ─────────────────────────────── TRIP-08 ─────────────────────────────── */

/**
 * 여행 완료.
 *
 * 말풍선 꼬리는 CSS 삼각형이다 — 파일 하나 붙일 만한 그림이 아니고, 색이 말풍선과 늘 같아야 해서
 * 한 군데(border-b-*)만 고치면 되는 편이 낫다.
 */
function Done({ onSave, onSkip }: { onSave: () => void; onSkip: () => void }) {
  return (
    <Frame>
      <h1 className="mt-[91px] shrink-0 px-6 text-center text-[28px] leading-9 font-bold tracking-[-0.28px] text-[#262626]">
        오늘의 제주 여행 완료!
      </h1>
      <p className="mt-[18px] shrink-0 px-6 text-center text-[14px] leading-[21px] tracking-[-0.14px] text-[#7d7d7d]">
        귤이랑 같이 오늘의 순간을 간직하러 떠날래요?
      </p>

      {/* 배경이 그려진 그림이라 원을 꽉 채운다 — 컷아웃이 아니라서 뒤에 색을 깔 필요가 없다 (app/profile 과 같다) */}
      <img
        src="/character/record-done.png"
        alt="공원에 서 있는 귤이"
        className="mx-auto mt-[57px] size-[189px] shrink-0 rounded-full border border-[#fc7f35] object-cover"
      />

      <div className="relative mx-[41px] mt-8 flex h-[62px] shrink-0 items-center justify-center rounded-[20px] bg-[#fff0e6]">
        <span
          aria-hidden
          className="absolute -top-[11px] left-1/2 size-0 -translate-x-1/2 border-x-[13px] border-b-[12px] border-x-transparent border-b-[#fff0e6]"
        />
        <p className="text-[16px] leading-6 font-medium tracking-[-0.16px] text-[#262626]">
          “오늘 여행, 정말 멋졌어요!”
        </p>
      </div>

      <div className="min-h-[40px] flex-1" />

      <Cta label="여행 기록에 저장" onClick={onSave} />
      <div className="h-[10px] shrink-0" />
      <Cta label="저장 안할래요" onClick={onSkip} tone="muted" />
      <div className="h-[35px] shrink-0" />
    </Frame>
  );
}

/* ────────────────────────── TRIP-08-A · 08-A-1 ────────────────────────── */

/**
 * 기록 작성.
 *
 * 코스는 셀렉터로 고른다 (08-A-1). 후보는 세 갈래다 —
 *   최근 여행: 방금 다녀온 코스(요약). 이게 있으면 처음부터 골라져 있다.
 *   지난 여행: 저장해둔 기록에서 코스만 뽑는다. 같은 이름은 한 번만 (같은 코스를 여러 번 다녀올 수 있다).
 *   직접 추가: 위 둘에 없는 코스. 앱을 안 거치고 다녀온 날이 기록의 절반이라 이 문이 필요하다.
 *
 * "임시 저장"은 초안 하나를 localStorage 에 눌러둔다 (lib/record.ts). 저장을 누르면 지운다 —
 * 안 지우면 다음 기록이 지난번 글로 열린다.
 */
function Write({
  summary,
  records,
  onBack,
  onSaved,
}: {
  summary: CourseSummary | null;
  records: TripRecord[];
  onBack: () => void;
  onSaved: (next: TripRecord[]) => void;
}) {
  const [course, setCourse] = useState(summary?.course ?? "");
  const [route, setRoute] = useState<string[]>(summary?.route ?? []);
  const [places, setPlaces] = useState<string[]>(summary?.route.slice(1) ?? []);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [open, setOpen] = useState(false);
  /** 셀렉터의 "＋ 여행 코스 직접 추가"와 방문 장소의 ＋. 열려 있으면 그 자리에 입력칸이 뜬다 */
  const [adding, setAdding] = useState<"course" | "place" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saved, setSaved] = useState(false);

  // 임시 저장해둔 초안이 있으면 되읽는다. 요약(방금 다녀온 코스)이 초안보다 우선이다 —
  // 지난주 초안 때문에 오늘 코스가 안 골라져 있으면 그게 더 이상하다.
  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    if (summary) return;
    setCourse(draft.course);
    setRoute(draft.route);
    setPlaces(draft.places);
  }, [summary]);

  /** 지난 여행 — 지금 고른 코스와 방금 다녀온 코스는 위에 이미 있으므로 뺀다 */
  const past = records
    .filter((r) => r.course !== summary?.course)
    .filter((r, i, all) => all.findIndex((o) => o.course === r.course) === i);

  function pick(name: string, of: { route: string[]; places: string[] }) {
    setCourse(name);
    setRoute(of.route);
    setPlaces(of.places);
    setOpen(false);
  }

  function addName() {
    const name = draftName.trim();
    if (!name) return setAdding(null);
    if (adding === "course") pick(name, { route: [], places: [] });
    else setPlaces((p) => (p.includes(name) ? p : [...p, name]));
    setDraftName("");
    setAdding(null);
  }

  function save() {
    const next = saveRecord({
      id: Date.now(),
      date: summary?.date ?? isoToday(),
      course: course.trim() || "직접 남긴 기록",
      route,
      places,
      title: title.trim() || "제목 없는 기록",
      body: body.trim(),
      km: summary?.km ?? 0,
    });
    clearDraft();
    onSaved(next);
  }

  const heading = "shrink-0 px-6 text-[14px] leading-normal font-bold text-[#262626]";
  const field = "w-full rounded-[10px] border-[1.5px] bg-white px-[13px] text-[14px] text-[#262626] outline-none";

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
        {/* AppBar — 제목은 뒤로가기 오른쪽에 붙는다 (와이어프레임이 가운데 정렬이 아니다) */}
        <div className="flex h-11 shrink-0 items-center pr-6 pl-[9px]">
          <button onClick={onBack} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center">
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          <h1 className="flex-1 text-[22px] leading-normal font-bold text-[#262626]">여행 기록 남기기</h1>
          {/* 눌린 걸 알려주는 자리가 버튼 자신뿐이라 라벨을 잠깐 바꾼다 — 토스트를 띄울 자리가 없다 */}
          <button
            onClick={() => {
              saveDraft({ course, route, places, title, body });
              setSaved(true);
              setTimeout(() => setSaved(false), 1600);
            }}
            className="shrink-0 text-[13px] leading-normal font-medium text-[#7d7d7d] transition active:scale-95"
          >
            {saved ? "저장됨" : "임시 저장"}
          </button>
        </div>

        {/* ── 여행 코스 ── */}
        <h2 className={`${heading} mt-2`}>여행 코스</h2>
        <p className="mt-1 shrink-0 px-6 text-[11px] leading-normal text-[#7d7d7d]">
          최근·지난 여행에서 선택하거나 직접 추가할 수 있어요
        </p>

        <div className="mt-2 shrink-0 px-6">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex h-[52px] w-full items-center rounded-[12px] border-[1.5px] border-[#ff7d32] bg-white pr-3 pl-[13px] text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-[#7d7d7d]">
                {dotted(summary?.date ?? isoToday())}
              </span>
              <span className="block truncate text-[14px] leading-5 font-medium text-[#262626]">
                {course || "코스를 골라주세요"}
              </span>
            </span>
            <span
              aria-hidden
              className={`shrink-0 text-[22px] leading-none text-[#7d7d7d] transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
            >
              ›
            </span>
          </button>

          {open && (
            <div className="mt-2 rounded-[14px] border border-[#eae7e2] bg-white p-[9px] shadow-[0_6px_16px_0_rgba(0,0,0,0.12)]">
              {summary && (
                <>
                  <p className="px-1 pt-1 pb-1.5 text-[12px] leading-5 font-bold text-[#7d7d7d]">최근 여행</p>
                  <Option
                    on={course === summary.course}
                    title={summary.course}
                    meta={`${dotted(summary.date)} · ${summary.route.join(" → ")}`}
                    onClick={() => pick(summary.course, { route: summary.route, places: summary.route.slice(1) })}
                  />
                </>
              )}

              {past.length > 0 && (
                <>
                  <p className="px-1 pt-2.5 pb-1 text-[12px] leading-5 font-bold text-[#7d7d7d]">지난 여행</p>
                  {past.map((r) => (
                    <Option
                      key={r.id}
                      on={course === r.course}
                      title={r.course}
                      meta={`${dotted(r.date)} · ${r.route.join(" → ")}`}
                      onClick={() => pick(r.course, { route: r.route, places: r.places })}
                    />
                  ))}
                </>
              )}

              {adding === "course" ? (
                <NameInput
                  value={draftName}
                  placeholder="코스 이름"
                  onChange={setDraftName}
                  onDone={addName}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <button
                  onClick={() => {
                    setDraftName("");
                    setAdding("course");
                  }}
                  className="mt-1.5 h-6 w-full rounded-[8px] bg-[#f7f7f7] px-2.5 text-left text-[12px] leading-5 font-bold text-[#ff7d32]"
                >
                  ＋&nbsp; 여행 코스 직접 추가
                </button>
              )}
            </div>
          )}
        </div>

        {/*
          ── 오늘의 사진 ──
          사진은 아직 못 넣는다. 자리는 남기되 흐리게 두고 못 누르게 막는다 —
          눌리는데 아무 일도 없으면 시연에서 더 나쁘다 (app/home/page.tsx Quick 의 죽은 칸과 같은 규칙).
          ponytail: <input type="file"> + 캔버스로 줄여 data URL 로 저장하면 된다. 목록 카드 썸네일도
          그때 같이 살아난다 (List 의 빈 칸).
        */}
        <div className="mt-6 flex shrink-0 items-center justify-between px-6">
          <h2 className="text-[16px] leading-normal font-medium text-[#262626]">오늘의 사진</h2>
          <span className="text-[12px] leading-normal text-[#7d7d7d]">0 / {PHOTO_MAX}</span>
        </div>
        <div className="mt-2 shrink-0 px-6 opacity-40" aria-disabled>
          <div className="grid size-[104px] place-items-center rounded-[14px] bg-[#fff0e6]">
            <span aria-hidden className="text-[28px] leading-none text-[#ff7d32]">
              ＋
            </span>
            <span className="mt-1 text-[13px] leading-none font-medium text-[#262626]">사진 추가</span>
          </div>
        </div>

        {/* ── 기록 제목 ── */}
        <h2 className={`${heading} mt-6`}>기록 제목</h2>
        <div className="mt-1.5 shrink-0 px-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="애월에서 협재까지, 천천히 달린 하루"
            aria-label="기록 제목"
            className={`${field} h-12 border-[#eae7e2] placeholder:text-[#b6b1ab] focus:border-[#ff7d32]`}
          />
        </div>

        {/* ── 여행 이야기 ── */}
        <h2 className={`${heading} mt-5`}>여행 이야기</h2>
        <div className="mt-1.5 shrink-0 px-6">
          <div className="rounded-[12px] border border-[#eae7e2] bg-white px-[13px] pt-3 pb-2.5 focus-within:border-[#ff7d32]">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
              maxLength={BODY_MAX}
              placeholder={"창문을 열자 바다 냄새가 가득했다.\n협재에서 바라본 노을은 오래 기억하고 싶다."}
              aria-label="여행 이야기"
              className="h-[68px] w-full resize-none text-[14px] leading-normal text-[#262626] outline-none placeholder:text-[#b6b1ab]"
            />
            <p className="text-right text-[11px] leading-normal text-[#7d7d7d]">
              {body.length} / {BODY_MAX}
            </p>
          </div>
        </div>

        {/* ── 방문 장소 ── */}
        <h2 className={`${heading} mt-5`}>방문 장소</h2>
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 px-6">
          {places.map((p) => (
            <button
              key={p}
              onClick={() => setPlaces((all) => all.filter((o) => o !== p))}
              aria-label={`${p} 빼기`}
              className="h-[34px] rounded-[17px] bg-[#fff0e6] px-3.5 text-[12px] font-medium text-[#262626] transition active:scale-95"
            >
              {p}
            </button>
          ))}
          {adding === "place" ? (
            <NameInput
              value={draftName}
              placeholder="장소 이름"
              onChange={setDraftName}
              onDone={addName}
              onCancel={() => setAdding(null)}
            />
          ) : (
            <button
              onClick={() => {
                setDraftName("");
                setAdding("place");
              }}
              aria-label="방문 장소 추가"
              className="grid size-[35px] shrink-0 place-items-center rounded-full bg-[#fff0e6] text-[19px] leading-none text-[#ff7d32] transition active:scale-95"
            >
              ＋
            </button>
          )}
        </div>

        <p className="mx-6 mt-5 shrink-0 rounded-[12px] bg-[#f7f7f7] px-3.5 py-2.5 text-[13px] leading-normal text-[#262626]">
          📍 TIP. 오늘 하루를 돌아보며 페이지를 기록해주세요
        </p>
      </div>

      <Cta label="여행 기록 저장하기" onClick={save} />
      <div className="h-[35px] shrink-0" />
    </Frame>
  );
}

/** 코스 선택 메뉴 한 줄. 고른 줄만 배경과 체크가 붙는다. */
function Option({ on, title, meta, onClick }: { on: boolean; title: string; meta: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left ${on ? "bg-[#fff0e6]" : "bg-white"}`}
    >
      <span aria-hidden className={`w-4 shrink-0 text-[16px] leading-none font-bold text-[#ff7d32] ${on ? "" : "opacity-0"}`}>
        ✓
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] leading-[19px] text-[#262626] ${on ? "font-bold" : "font-medium"}`}>
          {title}
        </span>
        <span className="block truncate text-[10px] leading-4 text-[#7d7d7d]">{meta}</span>
      </span>
    </button>
  );
}

/** 코스·장소를 직접 적는 칸. 엔터로 넣고 Esc 로 접는다 — 버튼 두 개를 더 두지 않으려고. */
function NameInput({
  value,
  placeholder,
  onChange,
  onDone,
  onCancel,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone();
        if (e.key === "Escape") onCancel();
      }}
      className="h-[34px] min-w-0 flex-1 rounded-[17px] border-[1.5px] border-[#ff7d32] bg-white px-3.5 text-[12px] text-[#262626] outline-none placeholder:text-[#b6b1ab]"
    />
  );
}

/* ─────────────────────────────── TRIP-09 ─────────────────────────────── */

/**
 * 나의 여행 기록.
 *
 * 합계는 저장된 기록에서 그때그때 더한다 — 따로 세어두면 기록을 지웠을 때 안 맞는다.
 * "사진 N장"은 안 적는다. 사진을 못 넣는데 늘 0장이라고 적으면 안 쌓이는 칸을 설명하는 줄이 된다
 * (app/profile 이 운전 경력 줄을 뺀 것과 같은 판단).
 */
function List({ records, onHome }: { records: TripRecord[]; onHome: () => void }) {
  const km = records.reduce((n, r) => n + r.km, 0);
  const places = records.reduce((n, r) => n + r.places.length, 0);

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 items-start justify-between pr-6 pl-[23px]">
          <div className="min-w-0 pt-1">
            <h1 className="text-[28px] leading-9 font-bold tracking-[-0.28px] text-[#262626]">나의 여행 기록</h1>
            <p className="mt-1.5 text-[14px] leading-[21px] tracking-[-0.14px] text-[#7d7d7d]">
              귤이와 함께한 제주 여행 {records.length}개
            </p>
          </div>
          <img src="/character/avatar-my.png" alt="" className="mt-1 size-[62px] shrink-0 rounded-full object-cover" />
        </div>

        <div className="mx-[23px] mt-5 flex h-[82px] shrink-0 items-center justify-between rounded-[18px] bg-[#fff0e6] pr-[26px] pl-[18px]">
          <div>
            <p className="text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">총 여행 거리</p>
            <p className="mt-0.5 text-[22px] leading-[30px] font-bold tracking-[-0.22px] text-[#262626]">{km} km</p>
          </div>
          <p className="text-right text-[14px] leading-[21px] tracking-[-0.14px] text-[#262626]">방문 {places}곳</p>
        </div>

        <h2 className="mt-[108px] shrink-0 px-[23px] text-[16px] leading-6 font-medium tracking-[-0.16px] text-[#262626]">
          최근 기록
        </h2>

        {records.length === 0 ? (
          <p className="mx-[23px] mt-[18px] shrink-0 rounded-[20px] border border-[#eae7e2] bg-white px-5 py-8 text-center text-[13px] leading-5 text-[#7d7d7d]">
            아직 남긴 기록이 없어요.
            <br />
            여행을 마치면 여기에 하나씩 쌓여요.
          </p>
        ) : (
          <div className="mt-[18px] flex shrink-0 flex-col gap-5 px-[23px] pb-2">
            {records.map((r) => (
              <div
                key={r.id}
                className="flex h-[150px] items-start gap-[18px] rounded-[20px] border border-[#eae7e2] bg-white p-4 shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]"
              >
                {/* 썸네일 자리. 사진 기능이 붙기 전까지는 코스 색만 남는다 (Write 의 사진 칸 주석) */}
                <div className="h-[118px] w-[104px] shrink-0 rounded-[16px] bg-[#fff0e6]" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">{dotted(r.date)}</p>
                  <p className="mt-2.5 truncate text-[16px] leading-6 font-medium tracking-[-0.16px] text-[#262626]">
                    {r.title}
                  </p>
                  <p className="mt-1.5 truncate text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">
                    {r.course}
                  </p>
                  <p className="mt-3.5 text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">
                    {r.places.length}곳{r.km > 0 && ` · ${r.km}km`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="min-h-5 flex-1" />
      </div>

      <Cta label="홈으로 돌아가기" onClick={onHome} />
      <div className="h-[55px] shrink-0" />
    </Frame>
  );
}
