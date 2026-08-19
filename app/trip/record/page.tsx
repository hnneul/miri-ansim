"use client";

// 여행 기록 — 최종 와이어프레임 "여행 기록" 섹션 (Figma 2765:1883).
// TRIP-08-A·08-A-1(기록 작성) → TRIP-09(나의 여행 기록) 두 장이다.
//
// 전에는 앞에 "오늘의 제주 여행 완료!" 축하 화면(Done)을 한 장 더 두었는데 지웠다 —
// 와이어프레임에 없는 화면이었다. 이 섹션에는 TRIP-08-A 와 08-A-1 만 있고 TRIP-08 자체가 없으며,
// 파일 어디에도 대응하는 프레임이 없다. 기록으로 들어가는 문은 목록의 CTA 다
// ("여행 기록하기 버튼 누르면" 3794:2594).
//
// 둘이 한 라우트인 이유는 /trip 과 같다 — 작성 중인 한 덩이(코스·제목·이야기·장소)를 계속 고쳐 쓰는데,
// 라우트를 나누면 그 덩이를 화면마다 다시 실어 날라야 한다.
//
// 들어오는 문은 /trip/course 의 외부 내비 화면이다. 거기서 방금 다녀온 코스의 **요약만** 쿼리로 온다
// (lib/record.ts toRecordQuery). 그 요약이 작성 화면에서 처음부터 골라져 있는 코스가 된다.
// 요약이 없으면 목록만 보여준다 — 링크를 직접 열었거나 저장을 마치고 되돌아온 경우다.
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
  clearPhotos,
  dotted,
  isoToday,
  loadDraft,
  loadPhotos,
  loadRecords,
  parseSummary,
  removeRecord,
  saveDraft,
  savePhotos,
  saveRecord,
  shrinkImage,
  type CourseSummary,
  type TripRecord,
} from "@/lib/record";
import { characterOf, parseProfile } from "@/lib/profile";

/**
 * 사진 한 기록에 최대 몇 장인지.
 * 와이어프레임은 "2 / 10" 이지만 옆 메모에서 20 으로 올렸다 ("너무 많이는 말고 최대 20개로 합시당").
 */
const PHOTO_MAX = 20;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function RecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

type View = "write" | "list" | "detail";

function Record() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const summary = parseSummary(searchParams);
  // 기록 버킷은 익숙함 티어다 (lib/records.db.ts). 프로필이 이미 쿼리로 흘러와서 그대로 읽는다
  const tier = parseProfile(Object.fromEntries(searchParams)).experienceYears;

  // 방금 끝낸 코스가 있으면 그 코스로 기록을 쓰러, 없으면 목록만 (위 첫 주석)
  const [view, setView] = useState<View>(summary ? "write" : "list");
  const [records, setRecords] = useState<TripRecord[]>([]);
  /** 상세로 연 기록. 목록 카드를 누르면 채워진다 (TRIP-09-A) */
  const [opened, setOpened] = useState<TripRecord | null>(null);
  /** 고쳐 쓰는 기록 (상세의 "수정"). 새로 쓸 때는 null 이다 */
  const [editing, setEditing] = useState<TripRecord | null>(null);

  // 서버에서 받아온다 — 첫 그림을 그린 뒤다. 실패하면 빈 목록이라 화면은 그대로 뜬다
  useEffect(() => {
    let 살아있나 = true;
    loadRecords(tier).then((rs) => 살아있나 && setRecords(rs));
    return () => {
      살아있나 = false; // 티어가 바뀌어 다시 부르면 늦게 온 옛 응답이 새 목록을 덮지 않게
    };
  }, [tier]);

  const home = () => router.push(`/home?${searchParams}`);
  const toTrip = () => router.push(`/trip?${searchParams}`);

  /*
   * 카드의 ✕. **서버가 준 목록으로 갈아끼운다** — 화면에서 먼저 지우고 나중에 맞추면,
   * 서버가 거절했을 때 지워진 것처럼 보이다가 새로고침에 되살아난다 (app/safelog/page.tsx 와 같은 규칙).
   *
   * 한 번 묻는 이유: 버킷이 티어 공용이라 남의 기록도 지워지고, 되돌릴 문이 없다.
   */
  async function remove(record: TripRecord) {
    if (!confirm(`"${record.title}" 기록을 지울까요?`)) return;
    const next = await removeRecord(tier, record.id);
    if (next) {
      clearPhotos(record.id); // 사진은 기기에만 있다 — 기록만 지우면 유령이 남는다
      setRecords(next);
    }
  }

  if (view === "write")
    return (
      <Write
        tier={tier}
        summary={summary}
        records={records}
        editing={editing}
        onTrip={toTrip}
        onBack={() => {
          setEditing(null);
          setView("list");
        }}
        onSaved={(next) => {
          setRecords(next);
          setEditing(null);
          setView("list");
        }}
      />
    );

  if (view === "detail" && opened)
    return (
      <Detail
        record={opened}
        onBack={() => setView("list")}
        onEdit={() => {
          setEditing(opened);
          setView("write");
        }}
      />
    );

  return (
    <List
      records={records}
      tier={tier}
      onHome={home}
      onRemove={remove}
      onWrite={() => setView("write")}
      onOpen={(r) => {
        setOpened(r);
        setView("detail");
      }}
    />
  );
}

/** 상태바 + 흰 바탕. 두 화면이 같은 틀을 쓴다 (app/trip/course/page.tsx Frame 과 같은 이유). */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      {children}
    </div>
  );
}

/**
 * 하단 CTA. 주황이 기본이고, ghost 는 흰 바탕에 회색 테두리다
 * (Figma "Travel CTA / Primary" 와 그 아래 홈으로 돌아가기 칸).
 */
function Cta({ label, onClick, ghost }: { label: string; onClick: () => void; ghost?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`mx-6 h-12 shrink-0 rounded-2xl text-[16px] font-medium transition active:scale-[0.98] ${
        ghost ? "border border-[#c4c4c4] bg-white text-[#262626]" : "bg-[#ff7d32] text-white"
      }`}
    >
      {label}
    </button>
  );
}

/* ────────────────────────── TRIP-08-A · 08-A-1 ────────────────────────── */

/**
 * 기록 작성.
 *
 * 코스는 셀렉터로 고른다 (08-A-1). 후보는 세 갈래다 —
 *   최근 여행: 방금 다녀온 코스(요약). 이게 있으면 처음부터 골라져 있다.
 *   지난 여행: 저장해둔 기록에서 코스만 뽑는다. 같은 이름은 한 번만 (같은 코스를 여러 번 다녀올 수 있다).
 * 둘 다 없으면 코스 추천으로 보낸다 (noCourse).
 *
 * "임시 저장"은 초안 하나를 localStorage 에 눌러둔다 (lib/record.ts). 저장을 누르면 지운다 —
 * 안 지우면 다음 기록이 지난번 글로 열린다.
 *
 * **editing 이 있으면 고쳐 쓰는 화면이다** (상세의 "수정"). 같은 id 로 다시 저장하므로 서버에서
 * 덮어쓰이고(records.db insert 의 INSERT OR REPLACE) 목록 자리도 그대로다. 이때는 초안을 안 읽고
 * "임시 저장"도 안 보인다 — 초안은 아직 저장 안 한 새 기록의 것이라, 고쳐 쓰는 글과 섞이면 안 된다.
 */
function Write({
  tier,
  summary,
  records,
  editing,
  onTrip,
  onBack,
  onSaved,
}: {
  tier: number;
  summary: CourseSummary | null;
  records: TripRecord[];
  editing: TripRecord | null;
  onTrip: () => void;
  onBack: () => void;
  onSaved: (next: TripRecord[]) => void;
}) {
  const [course, setCourse] = useState(editing?.course ?? summary?.course ?? "");
  const [route, setRoute] = useState<string[]>(editing?.route ?? summary?.route ?? []);
  const [places, setPlaces] = useState<string[]>(editing?.places ?? summary?.route.slice(1) ?? []);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  /** 오늘의 사진. **기기에만** 남는다 (lib/record.ts 사진 절 주석) */
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => {
    if (editing) setPhotos(loadPhotos(editing.id));
  }, [editing]);

  const [open, setOpen] = useState(false);
  /** 방문 장소의 ＋. 켜져 있으면 그 자리에 입력칸이 뜬다 */
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saved, setSaved] = useState(false);

  // 임시 저장해둔 초안이 있으면 되읽는다. 요약(방금 다녀온 코스)이 초안보다 우선이다 —
  // 지난주 초안 때문에 오늘 코스가 안 골라져 있으면 그게 더 이상하다.
  useEffect(() => {
    if (editing) return; // 고쳐 쓰는 중엔 초안을 안 읽는다 (위 주석)
    const draft = loadDraft();
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    setPhotos(draft.photos);
    if (summary) return;
    setCourse(draft.course);
    setRoute(draft.route);
    setPlaces(draft.places);
  }, [summary]);

  /** 지난 여행 — 지금 고른 코스와 방금 다녀온 코스는 위에 이미 있으므로 뺀다 */
  const past = records
    .filter((r) => r.course !== summary?.course)
    .filter((r, i, all) => all.findIndex((o) => o.course === r.course) === i);

  /**
   * 고를 코스가 하나도 없다 — 목록의 "여행 기록하기"로 들어왔는데 기록도 없는 사람이다.
   * 코스 직접 추가를 없앴으므로(위 메뉴 주석) 여기서 적을 방법이 없다. 빈 메뉴를 보여주는 대신
   * 여행 코스 추천으로 보낸다 (와이어프레임 "여행 기록 x → 여행 코스 추천으로").
   */
  const noCourse = !summary && past.length === 0;

  function pick(name: string, of: { route: string[]; places: string[] }) {
    setCourse(name);
    setRoute(of.route);
    setPlaces(of.places);
    setOpen(false);
  }

  function addName() {
    const name = draftName.trim();
    if (name) setPlaces((p) => (p.includes(name) ? p : [...p, name]));
    setDraftName("");
    setAdding(false);
  }

  /**
   * 고른 사진을 줄여서 담는다. 남은 자리만큼만 받고 나머지는 조용히 버린다 —
   * "20장까지"는 위 숫자가 이미 말하고 있다.
   */
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = PHOTO_MAX - photos.length;
    const shrunk = await Promise.all([...files].slice(0, room).map((f) => shrinkImage(f)));
    setPhotos((p) => [...p, ...shrunk.filter((u): u is string => u !== null)]);
  }

  async function save() {
    const record: TripRecord = {
      // 같은 id 로 저장해야 덮어쓰인다 — 새 id 면 고친 글이 한 장 더 쌓인다
      id: editing?.id ?? Date.now(),
      date: editing?.date ?? summary?.date ?? isoToday(),
      course: course.trim() || "직접 남긴 기록",
      route,
      places,
      title: title.trim() || "제목 없는 기록",
      body: body.trim(),
      km: editing?.km ?? summary?.km ?? 0,
    };
    const next = await saveRecord(tier, record);
    // 사진은 이 기기에만 남는다. 자리가 없으면 기록은 남고 사진만 빠지므로 그 사실을 말해준다
    if (!savePhotos(record.id, photos)) alert("사진이 많아 이 기기에 다 담지 못했어요. 기록은 저장됐어요.");
    clearDraft();
    // 서버가 안 받아줬으면(null) 이번 화면에서만 보여준다 — 목록이 통째로 비는 것보다 낫다.
    // 새로고침하면 사라지는데, 그게 저장 안 됐다는 사실과 맞다 (lib/record.ts saveRecord 주석).
    onSaved(next ?? [record, ...records]);
  }

  const heading = "shrink-0 px-6 text-[14px] leading-normal font-medium text-[#262626]";
  const field = "w-full rounded-[10px] border-[1.5px] bg-white px-[13px] text-[14px] text-[#262626] outline-none";

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
        {/* AppBar — 제목은 뒤로가기 오른쪽에 붙는다 (와이어프레임이 가운데 정렬이 아니다) */}
        <div className="flex h-11 shrink-0 items-center pr-6 pl-[9px]">
          <button onClick={onBack} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center">
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          <h1 className="flex-1 text-[22px] leading-normal font-bold text-[#262626]">
            여행 기록 {editing ? "수정" : "남기기"}
          </h1>
          {/* 눌린 걸 알려주는 자리가 버튼 자신뿐이라 라벨을 잠깐 바꾼다 — 토스트를 띄울 자리가 없다 */}
          {!editing && (
          <button
            onClick={() => {
              saveDraft({ course, route, places, title, body, photos });
              setSaved(true);
              setTimeout(() => setSaved(false), 1600);
            }}
            className="shrink-0 text-[13px] leading-normal font-medium text-[#7d7d7d] transition active:scale-95"
          >
            {saved ? "저장됨" : "임시 저장"}
          </button>
          )}
        </div>

        {/* ── 여행 코스 ── */}
        <h2 className={`${heading} mt-2`}>여행 코스</h2>
        <p className="mt-1 shrink-0 px-6 text-[11px] leading-normal text-[#7d7d7d]">
          최근·지난 여행에서 선택할 수 있어요
        </p>

        <div className="mt-2 shrink-0 px-6">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex h-[52px] w-full items-center rounded-[12px] border-[1.5px] border-[#ff7d32] bg-white pr-3 pl-[13px] text-left"
          >
            {/*
              날짜를 안 쓴다 (피그마 메모: "날짜가 안 나온다면 날짜 다 지우고 하루에 가장 나중에 받은 게 최근으로").
              추천받은 코스가 실제로 **언제 다녀온 여행**인지는 앱이 모른다 — 모르는 걸 날짜처럼 적으면
              사람은 그걸 사실로 읽는다. 대신 "최근 여행"이 가장 나중에 받은 코스 하나를 가리킨다.
            */}
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-[#262626]">
              {course || (noCourse ? "여행기록이 없습니다" : "코스를 골라주세요")}
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
              {noCourse && (
                <>
                  <p className="px-1 pt-1 pb-1.5 text-[12px] leading-5 font-bold text-[#7d7d7d]">최근 여행</p>
                  <p className="px-1 py-2 text-center text-[12px] leading-[18px] text-[#7d7d7d]">
                    여행 기록이 없어 여행기록을 남길수가 없어요
                    <br />
                    여행을 다녀오시는건 어떨까요?
                  </p>
                  <button
                    onClick={onTrip}
                    className="mx-auto mb-1 flex h-[30px] items-center rounded-[15px] bg-[#ff7d32] px-4 text-[13px] font-medium text-white transition active:scale-95"
                  >
                    여행 하러 가기
                  </button>
                </>
              )}

              {summary && (
                <>
                  <p className="px-1 pt-1 pb-1.5 text-[12px] leading-5 font-bold text-[#7d7d7d]">최근 여행</p>
                  <Option
                    on={course === summary.course}
                    title={summary.course}
                    meta={summary.route.join(" → ")}
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
                      meta={r.route.join(" → ")}
                      onClick={() => pick(r.course, { route: r.route, places: r.places })}
                    />
                  ))}
                </>
              )}

              {/*
                "＋ 여행 코스 직접 추가"는 뺐다 (피그마 메모: "없어도 될 것 같아요, 저 여행기록에 뜨는 창은
                갔던 코스만 기록할 수 있게 해놓은 거라서"). 안 다녀온 코스를 손으로 적을 수 있으면
                이 목록이 기록이 아니라 메모장이 된다.
              */}
            </div>
          )}
        </div>

        {/*
          ── 오늘의 사진 ──
          **기기에만 남는다** (lib/record.ts 사진 절). 서버 버킷은 티어 공용이라 남의 사진까지 한 자리에
          쌓이고, 기록 본문의 8KB 상한에도 안 들어간다 — 올릴 자리가 정해지면 그때 옮긴다.
          고른 사진은 720px·JPEG 0.6 으로 줄여 담는다 (원본은 한 장에 localStorage 가 찬다).
        */}
        <div className="mt-6 flex shrink-0 items-center justify-between px-6">
          <h2 className="text-[16px] leading-normal font-medium text-[#262626]">오늘의 사진</h2>
          <span className="text-[12px] leading-normal text-[#7d7d7d]">
            {photos.length} / {PHOTO_MAX}
          </span>
        </div>
        <div className="mt-2 flex shrink-0 gap-[10px] overflow-x-auto px-6 pb-1">
          {/* 추가 칸이 맨 앞이다 (와이어프레임) — 사진이 늘어도 누를 자리가 안 밀린다 */}
          <label className="grid size-[104px] shrink-0 cursor-pointer place-items-center rounded-[14px] bg-[#fff0e6] transition active:scale-95 has-disabled:opacity-40">
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={photos.length >= PHOTO_MAX}
              onChange={(e) => {
                addPhotos(e.target.files);
                e.target.value = ""; // 같은 사진을 다시 골라도 change 가 오게
              }}
              className="sr-only"
            />
            <span aria-hidden className="text-[28px] leading-none text-[#ff7d32]">
              ＋
            </span>
            <span className="mt-1 text-[13px] leading-none font-medium text-[#262626]">사진 추가</span>
          </label>

          {photos.map((src, i) => (
            /* 누르면 뺀다 — 칩과 같은 규칙이라 ✕ 를 따로 안 붙인다 */
            <button
              key={src.slice(-24) + i}
              onClick={() => setPhotos((all) => all.filter((_, n) => n !== i))}
              aria-label={`사진 ${i + 1} 빼기`}
              className="size-[104px] shrink-0 overflow-hidden rounded-[14px] transition active:scale-95"
            >
              <img src={src} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>

        {/* ── 기록 제목 ── */}
        <h2 className={`${heading} mt-6`}>기록 제목</h2>
        <div className="mt-1.5 shrink-0 px-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="애월에서 협재까지, 천천히 달린 하루"
            aria-label="기록 제목"
            className={`${field} h-[52px] border-[#eae7e2] placeholder:text-[#b6b1ab] focus:border-[#ff7d32]`}
          />
        </div>

        {/* ── 여행 이야기 ── */}
        <h2 className={`${heading} mt-5`}>여행 이야기</h2>
        <div className="mt-1.5 shrink-0 px-6">
          <div className="flex h-[116px] flex-col rounded-[12px] border border-[#eae7e2] bg-white px-[13px] pt-3 pb-2.5 focus-within:border-[#ff7d32]">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
              maxLength={BODY_MAX}
              placeholder={"창문을 열자 바다 냄새가 가득했다.\n협재에서 바라본 노을은 오래 기억하고 싶다."}
              aria-label="여행 이야기"
              className="min-h-0 w-full flex-1 resize-none text-[14px] leading-normal text-[#262626] outline-none placeholder:text-[#b6b1ab]"
            />
            <p className="text-right text-[11px] leading-normal text-[#7d7d7d]">
              {body.length} / {BODY_MAX}
            </p>
          </div>
        </div>

        {/* ── 방문 장소 ── */}
        <h2 className={`${heading} mt-5`}>방문 장소</h2>
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 px-6">
          {/* ＋ 가 칩 앞이다 (와이어프레임) — 장소가 늘어도 누를 자리가 제자리에 있다 */}
          {adding ? (
            <NameInput
              value={draftName}
              placeholder="장소 이름"
              onChange={setDraftName}
              onDone={addName}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              onClick={() => {
                setDraftName("");
                setAdding(true);
              }}
              aria-label="방문 장소 추가"
              className="grid size-[35px] shrink-0 place-items-center rounded-full bg-[#fff0e6] text-[19px] leading-none text-[#ff7d32] transition active:scale-95"
            >
              ＋
            </button>
          )}
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

/**
 * 기록 카드 썸네일. localStorage 를 첫 그림 뒤에 읽는다 — 렌더 중에 읽으면 서버가 그린 화면과
 * 달라져 하이드레이션이 어긋난다.
 */
function Thumb({ id }: { id: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => setSrc(loadPhotos(id)[0] ?? null), [id]);

  return (
    <div className="h-[118px] w-[104px] shrink-0 overflow-hidden rounded-[16px] bg-[#fff0e6]">
      {src && <img src={src} alt="" className="size-full object-cover" />}
    </div>
  );
}


/* ────────────────────────── TRIP-09-A ────────────────────────── */

/**
 * 기록 상세. 목록 카드를 누르면 열린다 (와이어프레임 "TRIP-09-A | 여행 기록 상세").
 *
 * 와이어프레임의 감성 조각들 — "제주 여행 3일 차", 에피소드 소제목, 맺음 한 줄, 정류장마다 붙은
 * 라벨("잠시 쉼", "노을") — 은 안 그린다. **앱이 모르는 값이다.** 지어내면 사람은 자기가 쓴 줄 안다.
 * 대신 아는 것만 그 자리에 넣는다: 날짜·코스·제목·사진·경로·이야기·장소·거리.
 * 출발과 도착만 라벨을 붙인다 — 그건 경로 배열이 이미 아는 사실이다.
 */
function Detail({ record, onBack, onEdit }: { record: TripRecord; onBack: () => void; onEdit: () => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => setPhotos(loadPhotos(record.id)), [record.id]);

  const stops = record.route;

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-8">
        {/* 헤더 — 와이어프레임의 ••• 는 안 단다. 지울 문은 목록 카드의 ✕ 하나로 족하다 */}
        <div className="flex h-[44px] shrink-0 items-center pl-[9px]">
          <button onClick={onBack} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center">
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          <h1 className="flex-1 text-[21px] leading-normal font-bold text-[#1f1f1f]">여행 기록</h1>
          {/* 와이어프레임의 ••• 자리다. 열어봐야 한 칸뿐이라 메뉴 대신 그 한 칸을 바로 둔다 */}
          <button
            onClick={onEdit}
            className="mr-6 shrink-0 text-[14px] leading-normal font-medium text-[#6b6b6b] transition active:scale-95"
          >
            수정
          </button>
        </div>

        {/* 히어로 — 첫 사진. 사진이 없으면(다른 기기이거나 안 넣었으면) 코스 색만 남는다 */}
        <div className="relative h-[262px] shrink-0 overflow-hidden bg-[#fff0e6]">
          {photos[0] && <img src={photos[0]} alt="" className="size-full object-cover" />}
          <div className="absolute inset-x-0 bottom-0 h-[115px] bg-gradient-to-b from-transparent to-black/60" />
          <p
            className={`absolute top-[12px] left-[20px] text-[12px] leading-normal font-medium ${
              photos[0] ? "text-white" : "text-[#7d7d7d]"
            }`}
          >
            {dotted(record.date)}
          </p>
          <div className="absolute right-[24px] bottom-[16px] left-[24px]">
            <p className="text-[12px] leading-normal font-bold text-white">{record.course}</p>
            <p className="mt-1.5 text-[24px] leading-[30px] font-bold text-white">{record.title}</p>
          </div>
        </div>

        {/* 사진 줄 — 히어로로 쓴 첫 장 다음부터 */}
        {photos.length > 1 && (
          <div className="mt-[27px] flex shrink-0 gap-[5px] overflow-x-auto px-6">
            {photos.slice(1).map((src, i) => (
              <img
                key={src.slice(-24) + i}
                src={src}
                alt=""
                className="h-[123px] w-[104px] shrink-0 rounded-[2px] object-cover"
              />
            ))}
          </div>
        )}

        {/* 오늘 달린 길 */}
        {stops.length > 1 && (
          <section className="mx-4 mt-6 shrink-0 rounded-[20px] border border-[#eae7e2] bg-white px-[18px] py-4 shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
            <p className="text-[12px] leading-normal font-bold text-[#f04d1a]">오늘 달린 길</p>
            <p className="mt-1.5 text-[17px] leading-[24px] font-bold text-[#1f1f1f]">{stops.join(" → ")}</p>

            <div className="relative mt-6">
              {/* 선을 점 뒤에 깔고, 점은 칸마다 가운데 — 정류장 수가 달라져도 간격이 알아서 벌어진다 */}
              <div className="absolute top-[4.5px] right-[6%] left-[6%] h-[3px] rounded-[2px] bg-[#e0dbd6]" />
              <ol className="relative flex">
                {stops.map((name, i) => (
                  <li key={`${name}-${i}`} className="flex flex-1 flex-col items-center">
                    <span aria-hidden className="size-[12px] rounded-full bg-[#f04d1a]" />
                    <span className="mt-1.5 text-[10px] leading-4 text-[#6b6b6b]">
                      {i === 0 ? "출발" : i === stops.length - 1 ? "도착" : " "}
                    </span>
                    <span className="w-full truncate text-center text-[11px] leading-[18px] font-bold text-[#1f1f1f]">
                      {name}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* 오늘의 에피소드 — 쓴 글 그대로. 줄바꿈을 살려야 쓴 사람이 본 모양으로 보인다 */}
        {record.body && (
          <section className="mt-7 shrink-0 px-[34px]">
            <p className="text-[12px] leading-normal font-bold text-[#f04d1a]">오늘의 에피소드</p>
            <p className="mt-2.5 text-[14px] leading-[22px] whitespace-pre-wrap text-[#6b6b6b]">{record.body}</p>
          </section>
        )}

        {/* 이날 머문 장소 */}
        {record.places.length > 0 && (
          <section className="mx-4 mt-7 shrink-0 rounded-[20px] border border-[#eae7e2] bg-white px-[18px] py-4 shadow-[0_4px_12px_0_rgba(0,0,0,0.05)]">
            <p className="text-[16px] leading-normal font-bold text-[#1f1f1f]">이날 머문 장소</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {record.places.map((p) => (
                <span
                  key={p}
                  className="flex h-[32px] items-center rounded-[16px] border border-[#dbdbdb] px-3.5 text-[11px] font-medium text-[#6b6b6b]"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>
        )}

        <p className="mt-8 shrink-0 text-center text-[11px] leading-normal text-[#6b6b6b]">
          {dotted(record.date)} · 사진 {photos.length}장{record.km > 0 && ` · ${record.km}km`}
        </p>
      </div>
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
function List({
  records,
  tier,
  onHome,
  onRemove,
  onWrite,
  onOpen,
}: {
  records: TripRecord[];
  tier: number;
  onHome: () => void;
  onRemove: (record: TripRecord) => void;
  onWrite: () => void;
  onOpen: (record: TripRecord) => void;
}) {
  const km = records.reduce((n, r) => n + r.km, 0);
  const places = records.reduce((n, r) => n + r.places.length, 0);
  /** 사진 장수. 기기에 있는 것만 센다 (lib/record.ts) — 첫 그림 뒤에 읽어야 하이드레이션이 안 어긋난다 */
  const [shots, setShots] = useState(0);
  useEffect(() => setShots(records.reduce((n, r) => n + loadPhotos(r.id).length, 0)), [records]);

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 items-start justify-between pr-6 pl-[23px]">
          <div className="min-w-0 pt-1">
            <h1 className="text-[28px] leading-9 font-bold tracking-[-0.28px] text-[#262626]">나의 여행 기록</h1>
            {/* 개수는 안 붙인다 — 와이어프레임 문구 그대로다 (기록 수는 아래 카드가 이미 보여준다) */}
            <p className="mt-1.5 text-[14px] leading-[21px] tracking-[-0.14px] text-[#7d7d7d]">
              귤이와 함께한 제주 여행
            </p>
          </div>
          {/* 홈·마이 아바타와 같은 얼굴이다 (lib/profile.ts characterOf) — 한 사람의 프로필이 화면마다 갈리면 안 된다 */}
          <img
            src={characterOf(tier).src}
            alt=""
            className="mt-1 size-[62px] shrink-0 rounded-full object-cover"
          />
        </div>

        <div className="mx-[23px] mt-5 flex h-[82px] shrink-0 items-center justify-between rounded-[18px] bg-[#fff0e6] pr-[26px] pl-[18px]">
          <div>
            <p className="text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">총 여행 거리</p>
            <p className="mt-0.5 text-[22px] leading-[30px] font-bold tracking-[-0.22px] text-[#262626]">{km} km</p>
          </div>
          <p className="text-right text-[14px] leading-[21px] tracking-[-0.14px] text-[#262626]">
            방문 {places}곳 · 사진 {shots}장
          </p>
        </div>

        <h2 className="mt-7 shrink-0 px-[23px] text-[16px] leading-6 font-medium tracking-[-0.16px] text-[#262626]">
          최근 기록
        </h2>

        {records.length === 0 ? (
          /* 빈 자리 한가운데 두 줄만. 테두리 카드를 두르면 기록이 한 장 있는 것처럼 보인다 (와이어프레임도 글자만이다) */
          <p className="grid flex-1 place-content-center px-[23px] text-center text-[12px] leading-[18px] tracking-[-0.12px] text-[#7d7d7d]">
            아직 남긴 기록이 없어요.
            <br />
            여행을 마치면 여기에 하나씩 쌓여요.
          </p>
        ) : (
          <div className="mt-[18px] flex shrink-0 flex-col gap-5 px-[23px] pb-2">
            {records.map((r) => (
              /* 카드를 누르면 상세로 (TRIP-09-A). ✕ 는 그 위에 얹히므로 눌림이 카드까지 안 내려가게 막는다 */
              <button
                key={r.id}
                onClick={() => onOpen(r)}
                className="relative flex h-[150px] w-full items-start gap-[18px] rounded-[20px] border border-[#eae7e2] bg-white p-4 text-left shadow-[0_4px_12px_0_rgba(0,0,0,0.05)] transition active:scale-[0.99]"
              >
                {/* ✕ — 주행 저장 카드와 같은 자리·같은 아이콘이다 (app/safelog/page.tsx). 두 목록이 같은 카드라 규칙도 하나여야 한다 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(r);
                  }}
                  aria-label={`${r.title} 기록 지우기`}
                  className="absolute top-[8px] right-[11px] flex size-[30px] items-center justify-center transition active:scale-[0.9]"
                >
                  <img src="/safelog/icon-close.svg" alt="" className="size-[14px]" />
                </button>
                {/*
                  썸네일은 그 기록의 첫 사진이다. 사진은 기기에만 있으므로(lib/record.ts) 다른 기기에서는
                  빈 칸으로 남는다 — 그 자리를 코스 색으로 채워 카드 모양이 흔들리지 않게 한다.
                */}
                <Thumb id={r.id} />
                {/* pr 은 ✕ 자리다 — 없으면 긴 제목이 버튼 밑으로 들어가 잘린 자리에서 끝난다 */}
                <div className="min-w-0 flex-1 pt-0.5 pr-[26px]">
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
              </button>
            ))}
          </div>
        )}

        <div className="min-h-5 flex-1" />
      </div>

      {/* 기록으로 들어가는 문이 여기다 (와이어프레임 "여행 기록하기 버튼 누르면"). 그 아래가 홈으로 */}
      <Cta label="여행 기록하기" onClick={onWrite} />
      <div className="h-4 shrink-0" />
      <Cta label="홈으로 돌아가기" onClick={onHome} ghost />
      <div className="h-[35px] shrink-0" />
    </Frame>
  );
}
