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
import { me } from "@/lib/me";
import {
  BODY_MAX,
  EPISODE_MAX,
  clearPhotos,
  dotted,
  isoToday,
  loadDrafts,
  loadPhotos,
  loadRecords,
  parseSummary,
  removeDraft,
  removeRecord,
  saveDraft,
  savePhotos,
  saveRecord,
  savedAt,
  shrinkImage,
  RECORD_KEYS,
  type CourseSummary,
  type Draft,
  type TripRecord,
} from "@/lib/record";
import { characterOf, parseProfile } from "@/lib/profile";

/**
 * 코스 셀렉터의 "지난 여행"에 몇 줄까지 보여줄지.
 *
 * 기록은 한 브라우저에 200개까지 쌓이는데(lib/records.db.ts BUCKET_MAX) 다 펼치면 메뉴가 화면을 아래로
 * 뚫고 내려가 사진·제목 칸을 덮는다 (8개에서 이미 474px 였다). 코스를 고르는 사람이 찾는 건 최근
 * 것들이고, 더 옛날 코스를 또 가고 싶으면 그 아래 "여행 하러 가기"가 있다.
 */
const PAST_MAX = 5;

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
  // 카드에 앉히는 캐릭터를 고르는 값이다 (characterOf). **버킷과는 상관이 없다** —
  // 예전에는 이 값이 버킷이기도 했는데 그건 아래 나 로 갈라졌다
  const tier = parseProfile(Object.fromEntries(searchParams)).experienceYears;

  /*
    기록 버킷은 **이 브라우저**다 (lib/me.ts). me() 가 localStorage 를 보므로 그리는 중에는
    못 부른다 — effect 로 한 번 받아 두고, 받기 전에는 목록을 안 읽는다.
  */
  const [나, set나] = useState<string | null>(null);
  useEffect(() => set나(me()), []);

  /*
    방금 끝낸 코스가 있으면 그 코스로 기록을 쓰러, 없으면 목록만 (위 첫 주석).
    write=1 은 코스 추천에서 뒤로 나온 길이다 — 쓰다 만 자리로 돌아와야 해서 작성 화면을 편다
    (쓰던 글은 초안으로 남겨뒀다, Write 의 goTrip).
  */
  const [view, setView] = useState<View>(summary || searchParams.get("write") === "1" ? "write" : "list");
  const [records, setRecords] = useState<TripRecord[]>([]);
  /** 상세로 연 기록. 목록 카드를 누르면 채워진다 (TRIP-09-A) */
  const [opened, setOpened] = useState<TripRecord | null>(null);
  /** 지울지 묻고 있는 기록. 물음 창(Confirm)이 이걸 보고 뜬다 */
  const [asking, setAsking] = useState<TripRecord | null>(null);
  /** 고쳐 쓰는 기록 (상세의 "수정"). 새로 쓸 때는 null 이다 */
  const [editing, setEditing] = useState<TripRecord | null>(null);
  /** 임시 저장해둔 글들 (기기에만, lib/record.ts). 목록 맨 위 "작성 중인 기록" 이 이걸 그린다 */
  const [drafts, setDrafts] = useState<Draft[]>([]);
  /** 이어 쓰는 초안. 새로 쓰면 null 이라 화면이 빈 채로 열린다 — 지난 초안이 저절로 올라오지 않는다 */
  const [draft, setDraft] = useState<Draft | null>(null);

  // 서버에서 받아온다 — 첫 그림을 그린 뒤다. 실패하면 빈 목록이라 화면은 그대로 뜬다
  useEffect(() => {
    let 살아있나 = true;
    if (!나) return;
    loadRecords(나).then((rs) => {
      if (!살아있나) return;
      setRecords(rs);
      /*
        홈 카드에서 왔으면(open=<id>) 그 기록의 상세를 편다. 목록이 서버에서 온 뒤에야 알 수 있어서
        여기서 연다 — 그 사이 기록이 지워졌으면 못 찾으니 목록이 그대로 남는다.
      */
      const id = Number(searchParams.get("open"));
      const 열것 = Number.isFinite(id) ? rs.find((r) => r.id === id) : undefined;
      if (열것) {
        setOpened(열것);
        setView("detail");
      }
    });
    return () => {
      살아있나 = false; // 늦게 온 옛 응답이 새 목록을 덮지 않게
    };
  }, [나, searchParams]);

  /*
    초안은 localStorage 라 첫 그림 뒤에 읽는다. draft=<초안 id> 로 들어오면 그 초안을 이어 쓴다 —
    코스 추천(/trip)에 다녀오는 길이 그 쿼리를 물고 온다 (app/trip/page.tsx back).

    **"d" 가 아니다** — 그 이름은 기록 날짜가 쓰고 있다 (lib/record.ts toRecordQuery: d=2026-08-20).
    겹쳐 썼을 때 코스에서 "기록하기"로 들어오면 toRecordQuery 가 d 를 날짜로 덮어써서
    쓰던 초안 id 가 사라졌다 — 이어 쓰려고 왔는데 빈 작성 화면이 열렸다.
  */
  useEffect(() => {
    const list = loadDrafts();
    setDrafts(list);
    const id = Number(searchParams.get("draft"));
    const found = Number.isFinite(id) ? list.find((d) => d.id === id) : undefined;
    if (found) setDraft(found);
  }, [searchParams]);

  /**
   * 홈으로. **기록 흐름의 값을 여기서 끊는다** (lib/record.ts RECORD_KEYS).
   * 안 끊으면 홈 URL 에 코스 요약이 눌어붙고, 홈의 "여행 기록 ＋" 가 그걸 돌려줘서
   * 목록 대신 작성 화면이 열린다. write·draft·back 도 같이 뺀다 — 도착지에서 쓸 데가 없다.
   */
  const home = () => {
    const q = new URLSearchParams(searchParams);
    for (const k of [...RECORD_KEYS, "write", "draft", "back"]) q.delete(k);
    router.push(`/home?${q}`);
  };
  /**
   * 코스 추천으로. **어디서 왔는지 알려준다** — 그래야 거기서 뒤로 나올 때 홈이 아니라 여기로 돌아온다
   * (app/trip/page.tsx back). 잘못 눌렀을 때 되돌아올 길이 없으면 쓰던 기록이 통째로 날아간다.
   */
  const toTrip = (draftId: number) => {
    const q = new URLSearchParams(searchParams);
    // "from" 이 아니다 — 거긴 여행 **시작일**이 쓰는 이름이라(lib/trip.ts toTripQuery)
    // 덮어쓰면 고른 날짜가 "record" 로 바뀌어 기간이 통째로 날아간다
    q.set("back", "record");
    if (draftId) q.set("draft", `${draftId}`); // 돌아왔을 때 이 초안으로 이어 쓴다 (위 주석 — "d" 는 날짜다)
    router.push(`/trip?${q}`);
  };

  /*
   * 카드의 ✕. **서버가 준 목록으로 갈아끼운다** — 화면에서 먼저 지우고 나중에 맞추면,
   * 서버가 거절했을 때 지워진 것처럼 보이다가 새로고침에 되살아난다 (app/safelog/page.tsx 와 같은 규칙).
   *
   * 한 번 묻는 이유: 되돌릴 문이 없다. 사진까지 같이 사라진다.
   */
  async function remove(record: TripRecord) {
    const next = await removeRecord(me(), record.id);
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
        draft={draft}
        onTrip={toTrip}
        onDrafts={setDrafts}
        /*
          고쳐 쓰다 나가면 **그 기록의 상세로** 되돌린다 — 상세에서 들어온 문이라 목록으로 떨어지면
          읽던 자리를 다시 찾아 들어가야 한다. 새로 쓰던 중이면 목록이 맞다 (거기서 왔다).
        */
        onBack={() => {
          const 고치던 = editing;
          setEditing(null);
          setDraft(null);
          setView(고치던 ? "detail" : "list");
        }}
        onSaved={(next) => {
          setRecords(next);
          // 저장까지 마쳤으면 고친 내용이 반영된 기록으로 상세를 다시 연다 (opened 는 고치기 전 값이다)
          const 고친 = editing ? (next.find((r) => r.id === editing.id) ?? null) : null;
          if (고친) setOpened(고친);
          setEditing(null);
          setDraft(null);
          setView(고친 ? "detail" : "list");
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
    /* 물음 창이 화면 전체를 덮되 **폰 안에서만** 덮게 — 이 상자가 그 기준점이다 */
    <div className="relative flex min-h-0 flex-1 flex-col">
      <List
        records={records}
        drafts={drafts}
        tier={tier}
        onHome={home}
        onRemove={setAsking}
        onWrite={() => setView("write")}
        onOpen={(r) => {
          setOpened(r);
          setView("detail");
        }}
        onOpenDraft={(d) => {
          setDraft(d);
          setView("write");
        }}
        onRemoveDraft={(id) => setDrafts(removeDraft(id))}
      />

      {asking && (
        <Confirm
          title={`"${asking.title}" 기록을 지울까요?`}
          body="지운 기록은 되돌릴 수 없어요."
          onCancel={() => setAsking(null)}
          onOk={() => {
            const 지울것 = asking;
            setAsking(null);
            remove(지울것);
          }}
        />
      )}
    </div>
  );
}

/**
 * 물음 창. 브라우저 confirm() 대신 쓴다 — 그건 폰 밖(브라우저)에서 뜨고 글꼴·버튼이 앱과 따로 논다.
 * 여기서는 화면을 어둡게 덮고 가운데 흰 상자로 묻는다.
 *
 * 되돌릴 수 없는 일에만 쓴다 (기록 지우기). 초안 지우기까지 물으면 매번 두 번 눌러야 해서
 * 오히려 성가시다 — 초안은 다시 쓰면 되는 글이다.
 */
function Confirm({
  title,
  body,
  onCancel,
  onOk,
}: {
  title: string;
  body: string;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/35 px-8">
      {/* 어둠막을 눌러도 닫힌다 — 창 밖을 누르는 건 "아니오"와 같은 뜻이다 */}
      <button aria-label="닫기" onClick={onCancel} className="absolute inset-0" />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-[280px] rounded-[18px] bg-white px-5 pt-6 pb-4 text-center shadow-[0_12px_32px_0_rgba(0,0,0,0.18)]"
      >
        <p className="text-[15px] leading-[22px] font-bold break-keep text-[#262626]">{title}</p>
        <p className="mt-2 text-[13px] leading-5 text-[#7d7d7d]">{body}</p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            /*
              흰 버튼의 호버는 **중립 회색**이다 (#f7f7f7, TIP 상자와 같은 색).
              옅은 주황으로 하면 옆의 주황 버튼과 같은 무게로 보인다 — 이 앱에서 주황은
              "이걸 누르세요"라는 뜻이라, 되돌릴 수 없는 쪽(지우기)이 눈에 덜 띄면 안 된다.
            */
            className="h-11 flex-1 rounded-[12px] border border-[#eae7e2] bg-white text-[14px] font-medium text-[#262626] transition hover:bg-[#f7f7f7] active:scale-[0.98]"
          >
            취소
          </button>
          <button
            onClick={onOk}
            className="h-11 flex-1 rounded-[12px] bg-[#ff7d32] text-[14px] font-medium text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            지우기
          </button>
        </div>
      </div>
    </div>
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
        // 흰 CTA 도 같은 규칙 — 바로 위에 주황 CTA 가 앉아 있다 (Confirm 의 취소 버튼 주석)
        ghost ? "border border-[#c4c4c4] bg-white text-[#262626] hover:bg-[#f7f7f7]" : "bg-[#ff7d32] text-white hover:bg-[#ff6114]"
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
  draft,
  onTrip,
  onDrafts,
  onBack,
  onSaved,
}: {
  tier: number;
  summary: CourseSummary | null;
  records: TripRecord[];
  editing: TripRecord | null;
  draft: Draft | null;
  onTrip: (draftId: number) => void;
  onDrafts: (next: Draft[]) => void;
  onBack: () => void;
  onSaved: (next: TripRecord[]) => void;
}) {
  const 처음 = editing ?? draft;
  const [course, setCourse] = useState(처음?.course ?? summary?.course ?? "");
  const [route, setRoute] = useState<string[]>(처음?.route ?? summary?.route ?? []);
  const [places, setPlaces] = useState<string[]>(처음?.places ?? summary?.route.slice(1) ?? []);
  const [title, setTitle] = useState(처음?.title ?? "");
  /** 이야기 소제목 (와이어프레임 상세의 "좁은 해안도로에서 마주친 뜻밖의 정체"). 안 적어도 된다 */
  const [episode, setEpisode] = useState(처음?.episode ?? "");
  const [body, setBody] = useState(처음?.body ?? "");
  /** 지금 이어 쓰는 초안의 id. 임시 저장을 처음 누르는 순간 생긴다 */
  const [draftId, setDraftId] = useState<number | null>(draft?.id ?? null);
  /** 오늘의 사진. **기기에만** 남는다 (lib/record.ts 사진 절 주석) */
  const [photos, setPhotos] = useState<string[]>(draft?.photos ?? []);
  useEffect(() => {
    if (editing) setPhotos(loadPhotos(editing.id));
  }, [editing]);

  const [open, setOpen] = useState(false);
  /** 방문 장소의 ＋. 켜져 있으면 그 자리에 입력칸이 뜬다 */
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saved, setSaved] = useState(false);
  /**
   * 서버가 기록을 안 받았다. **이걸 안 두면 저장된 척하고 넘어간다** —
   * saveRecord 가 null 을 줘도 화면에서만 목록에 얹어 보여줬고(`next ?? [record, ...records]`),
   * 사람은 저장된 줄 알고 나갔다가 새로고침에서 글이 사라진 걸 나중에야 알았다.
   * 사진이 안 담긴 건 알려주면서 글이 통째로 안 담긴 건 아무 말도 안 하고 있었다.
   */
  const [저장실패, set저장실패] = useState(false);

  /** 지난 여행 — 지금 고른 코스와 방금 다녀온 코스는 위에 이미 있으므로 뺀다 */
  const past = records
    .filter((r) => r.course !== summary?.course)
    .filter((r, i, all) => all.findIndex((o) => o.course === r.course) === i)
    .slice(0, PAST_MAX);

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
      episode: episode.trim(),
      body: body.trim(),
      km: editing?.km ?? summary?.km ?? 0,
    };
    set저장실패(false);
    const next = await saveRecord(me(), record);

    /*
     * 서버가 안 받았으면 **여기서 멈춘다.**
     *
     * 전에는 `next ?? [record, ...records]` 로 화면에만 얹고 목록으로 넘겼다. 그러면 방금 쓴 글이
     * 맨 위에 보이니까 사람은 저장된 줄 알고 나가고, 새로고침에서야 사라진 걸 안다 — 그때는
     * 쓴 글이 이미 없다. 조용히 지는 것 중에 제일 나쁜 종류다.
     *
     * 대신 **초안으로 눌러두고** 작성 화면에 남는다. 다시 눌러보게 하려면 쓰던 글이 살아 있어야 한다.
     */
    if (!next) {
      keepDraft();
      return set저장실패(true);
    }

    // 사진은 이 기기에만 남는다. 자리가 없으면 기록은 남고 사진만 빠지므로 그 사실을 말해준다
    if (!savePhotos(record.id, photos)) alert("사진이 많아 이 기기에 다 담지 못했어요. 기록은 저장됐어요.");
    // 기록이 됐으니 초안 자리는 비운다 — 안 지우면 목록 위에 같은 글이 초안으로 남는다
    if (draftId !== null) onDrafts(removeDraft(draftId));
    onSaved(next);
  }

  /**
   * 지금 쓰던 걸 초안으로 담는다. 처음이면 id 를 만들고, 이어 쓰는 중이면 그 자리에 덮어쓴다.
   * 담긴 id 를 돌려준다 — "여행 하러 가기"가 그 id 를 물고 나가야 돌아왔을 때 이어 쓸 수 있다.
   */
  function keepDraft(): number {
    const id = draftId ?? Date.now();
    setDraftId(id);
    const next = saveDraft({ id, course, route, places, title, episode, body, photos });
    if (next) onDrafts(next);
    else alert("임시 저장할 자리가 부족해요. 사진을 몇 장 빼고 다시 눌러주세요.");
    return id;
  }

  /*
    "여행 하러 가기" — 라벨 줄 오른쪽 끝에 앉는다. 목록에 없는 길로 가는 유일한 문이라(직접 추가를
    없앴다) 메뉴를 열자마자 보여야 하고, 제 줄을 하나 차지하면 목록이 그만큼 밀린다.
  */
  const goTrip = (
    <button
      onClick={() => {
        // 쓰던 글을 초안으로 눌러두고 나간다 — 돌아오면 그 초안으로 이어 쓴다 (부모의 d 쿼리).
        // 고쳐 쓰는 중이면 안 남긴다 (초안은 아직 저장 안 한 새 기록의 것이다)
        onTrip(editing ? 0 : keepDraft());
      }}
      className="flex h-[26px] shrink-0 items-center rounded-[13px] bg-[#ff7d32] px-3 text-[12px] font-medium text-white transition active:scale-95"
    >
      여행 하러 가기
    </button>
  );

  const heading = "shrink-0 px-6 text-[14px] leading-normal font-medium text-[#262626]";
  const field = "w-full rounded-[10px] border-[1.5px] bg-white px-[13px] text-[14px] text-[#262626] outline-none";

  return (
    <Frame>
      {/*
        AppBar 는 스크롤 밖이다 — 안에 두면 아래로 내려갈수록 뒤로·임시 저장이 화면 위로 사라진다.
        제목은 뒤로가기 오른쪽에 붙는다 (와이어프레임이 가운데 정렬이 아니다).
      */}
      <div className="flex h-11 shrink-0 items-center pr-6 pl-[9px]">
        <button onClick={onBack} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90">
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
        <h1 className="flex-1 text-[22px] leading-normal font-bold text-[#262626]">
          여행 기록 {editing ? "수정" : "남기기"}
        </h1>
        {/* 눌린 걸 알려주는 자리가 버튼 자신뿐이라 라벨을 잠깐 바꾼다 — 토스트를 띄울 자리가 없다 */}
        {!editing && (
          <button
            onClick={() => {
              keepDraft();
              setSaved(true);
              setTimeout(() => setSaved(false), 1600);
            }}
            className="shrink-0 text-[13px] leading-normal font-medium text-[#7d7d7d] transition active:scale-95"
          >
            {saved ? "저장됨" : "임시 저장"}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
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
              {course || (noCourse ? "고를 코스가 없어요" : "코스를 골라주세요")}
            </span>
            <span
              aria-hidden
              className={`shrink-0 text-[22px] leading-none text-[#7d7d7d] transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
            >
              ›
            </span>
          </button>

          {open && (
            <div className="mt-2 max-h-[260px] overflow-y-auto rounded-[14px] border border-[#eae7e2] bg-white p-[9px] shadow-[0_6px_16px_0_rgba(0,0,0,0.12)]">
              {/*
                "여행 하러 가기"가 목록 **위**다. 아래에 두면 지난 여행이 다섯 줄만 돼도 스크롤 밖으로
                밀려 안 보인다 — 목록에 없는 길로 가는 유일한 문이라 열자마자 보여야 한다.
                (＋ 직접 추가를 없앤 자리를 이 버튼이 대신한다.)
              */}

              {noCourse && (
                <>
                  <MenuLabel text="최근 여행" right={goTrip} />
                  <p className="px-1 py-2 text-center text-[12px] leading-[18px] text-[#7d7d7d]">
                    {/* "여행기록"·"남길수가"·"다녀오시는건" 이 붙어 있었다. 앱 전체 표기는 "여행 기록" 이다 */}
                    아직 다녀온 코스가 없어 고를 것이 없어요.
                    <br />
                    먼저 여행을 다녀오시는 건 어떨까요?
                  </p>
                </>
              )}

              {summary && (
                <>
                  <MenuLabel text="최근 여행" right={goTrip} />
                  <Option
                    on={course === summary.course}
                    title={summary.course}
                    meta={summary.route.join(" → ")}
                    onClick={() =>
                      pick(summary.course, {
                        route: summary.route,
                        places: summary.route.slice(1),
                      })
                    }
                  />
                </>
              )}

              {past.length > 0 && (
                <>
                  {/* 버튼은 첫 라벨 줄에만 — 최근 여행이 위에 있으면 거기 이미 붙어 있다 */}
                  <MenuLabel text="지난 여행" right={summary ? null : goTrip} top={!!summary} />
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

                대신 "여행 하러 가기"를 **코스가 있든 없든** 둔다. 직접 추가를 없앤 이상 목록에 없는 길은
                다녀오는 것 말고 방법이 없고, 그 문이 코스가 하나도 없을 때만 열리면 두 번째 기록부터는
                길이 막힌 것처럼 보인다.
              */}
            </div>
          )}
        </div>

        {/*
          ── 오늘의 사진 ──
          **기기에만 남는다** (lib/record.ts 사진 절). 기록 본문의 8KB 상한에 안 들어가고 올릴 자리도
          정해진 게 없다 — 그 자리가 생기면 그때 옮긴다.
          고른 사진은 720px·JPEG 0.6 으로 줄여 담는다 (원본은 한 장에 localStorage 가 찬다).
        */}
        <div className="mt-6 flex shrink-0 items-center justify-between px-6">
          <h2 className="text-[16px] leading-normal font-medium text-[#262626]">오늘의 사진</h2>
          <span className="text-[12px] leading-normal text-[#7d7d7d]">
            {photos.length} / {PHOTO_MAX}
          </span>
        </div>
        <div className="mt-2 flex shrink-0 gap-[10px] overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        {/*
          소제목은 안 적어도 되는 칸이다 — 상세에서 "오늘의 에피소드" 아래 굵은 한 줄이 되고,
          비워두면 그 줄 없이 이야기만 그려진다 (와이어프레임 TRIP-09-A).
        */}
        <div className="mt-1.5 shrink-0 px-6">
          <input
            value={episode}
            onChange={(e) => setEpisode(e.target.value.slice(0, EPISODE_MAX))}
            maxLength={EPISODE_MAX}
            placeholder="소제목 (선택) - 좁은 해안도로에서 마주친 정체"
            aria-label="이야기 소제목"
            className={`${field} h-11 border-[#eae7e2] placeholder:text-[#b6b1ab] focus:border-[#ff7d32]`}
          />
        </div>
        <div className="mt-2 shrink-0 px-6">
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
          {/* 이모지 글자였다 — 기기마다 다른 그림이 나와 파일로 옮겼다 (app/trip/page.tsx Tile 주석) */}
          <img src="/trip/field-must.png" alt="" className="mr-1 inline-block size-4 align-[-2px] object-contain" />
          TIP. 오늘 하루를 돌아보며 페이지를 기록해주세요
        </p>
      </div>

      <div className="flex shrink-0 flex-col bg-white pt-3">
        {/*
          저장이 안 됐다는 사실과 **쓴 글은 살아 있다**는 사실을 같이 말한다 —
          앞엣것만 말하면 방금 쓴 글이 날아간 줄 알고 화면을 떠난다.
        */}
        {저장실패 && (
          <p className="mx-6 mb-2 shrink-0 text-center text-[12px] leading-normal text-rose-600">
            지금은 저장하지 못했어요. 쓰던 글은 임시 저장해 뒀으니 잠시 뒤 다시 눌러주세요.
          </p>
        )}
        <Cta label="여행 기록 저장하기" onClick={save} />
        <div className="h-[35px] shrink-0" />
      </div>
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
 * 와이어프레임의 감성 조각들 — "제주 여행 3일 차", 맺음 한 줄, 정류장마다 붙은 라벨("잠시 쉼",
 * "노을") — 은 안 그린다. **앱이 모르는 값이다.** 지어내면 사람은 자기가 쓴 줄 안다.
 * 에피소드 소제목만은 작성 화면에서 직접 받는다 (사람이 쓴 값이면 그려도 된다).
 * 대신 아는 것만 그 자리에 넣는다: 날짜·코스·제목·사진·경로·이야기·장소·거리.
 * 출발과 도착만 라벨을 붙인다 — 그건 경로 배열이 이미 아는 사실이다.
 */
function Detail({ record, onBack, onEdit }: { record: TripRecord; onBack: () => void; onEdit: () => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => setPhotos(loadPhotos(record.id)), [record.id]);

  const stops = record.route;

  return (
    <Frame>
      {/*
        헤더는 스크롤 밖이다 — 안에 두면 히어로 사진과 함께 위로 밀려 올라가, 긴 글을 읽는 중에
        뒤로·수정으로 나갈 문이 사라진다. 와이어프레임의 ••• 는 안 단다 (지울 문은 목록 카드의 ✕).
      */}
      <div className="flex h-[44px] shrink-0 items-center bg-white pl-[9px]">
        <button onClick={onBack} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90">
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

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-8">
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

        {/*
          사진 줄 — **히어로로 쓴 첫 장도 같이 넣는다.** 위 사진은 제목에 가려 절반만 보이므로,
          여기서 원본을 다시 볼 수 있어야 한다. 여러 장이면 아래로 쌓지 않고 옆으로 민다
          (세로로 쌓으면 사진 스무 장에 화면이 한없이 길어진다). 스크롤 막대는 숨긴다 —
          폰에는 없는 물건이다 (globals.css 의 .phone 과 같은 이유).
        */}
        {photos.length > 0 && (
          <div className="mt-[27px] flex shrink-0 gap-[5px] overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {photos.map((src, i) => (
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
        {(record.body || record.episode) && (
          <section className="mt-7 shrink-0 px-[34px]">
            <p className="text-[12px] leading-normal font-bold text-[#f04d1a]">오늘의 에피소드</p>
            {/* 소제목은 안 적었으면 그 줄째 없다 — 빈 줄이 남으면 뭔가 빠진 것처럼 보인다 */}
            {record.episode && (
              <p className="mt-1.5 text-[14px] leading-[22px] font-bold text-[#1f1f1f]">{record.episode}</p>
            )}
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

/** 코스 선택 메뉴의 구분 라벨. 오른쪽에 버튼 하나를 같은 줄에 태울 수 있다. */
function MenuLabel({ text, right, top }: { text: string; right?: React.ReactNode; top?: boolean }) {
  return (
    /* 아래 여백을 넉넉히 — 알약 버튼이 라벨 줄에 앉아 줄 자체가 두꺼워졌다. 6px 이면 첫 코스가 버튼에 붙는다 */
    <div className={`flex items-center justify-between px-1 pb-3 ${top ? "pt-3" : "pt-1.5"}`}>
      <p className="text-[12px] leading-5 font-bold text-[#7d7d7d]">{text}</p>
      {right}
    </div>
  );
}

/**
 * 코스 선택 메뉴 한 줄. 고른 줄은 **배경만** 바뀐다 — 체크 표시는 안 붙인다.
 * 체크 자리를 비워두면 글이 그만큼 안으로 밀려 위 라벨과 왼쪽 끝이 안 맞는다.
 */
function Option({ on, title, meta, onClick }: { on: boolean; title: string; meta: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex w-full items-center rounded-[10px] px-2.5 py-1.5 text-left ${on ? "bg-[#fff0e6]" : "bg-white"}`}
    >
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] leading-[19px] text-[#262626] ${on ? "font-bold" : "font-medium"}`}
        >
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
  drafts,
  tier,
  onHome,
  onRemove,
  onWrite,
  onOpen,
  onOpenDraft,
  onRemoveDraft,
}: {
  records: TripRecord[];
  drafts: Draft[];
  tier: number;
  onHome: () => void;
  onRemove: (record: TripRecord) => void;
  onWrite: () => void;
  onOpen: (record: TripRecord) => void;
  onOpenDraft: (draft: Draft) => void;
  onRemoveDraft: (id: number) => void;
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
          <img src={characterOf(tier).src} alt="" className="mt-1 size-[62px] shrink-0 rounded-full object-cover" />
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

        {/*
          작성 중인 초안. **기기에만 있는 글**이라 서버 기록과 섞이면 안 된다 — 섹션을 갈라 위에 두고
          카드도 얇고 회색으로 다르게 그린다. 초안이 없으면 이 자리는 통째로 없다.
        */}
        {drafts.length > 0 && (
          <>
            <h2 className="mt-7 shrink-0 px-[23px] text-[16px] leading-6 font-medium tracking-[-0.16px] text-[#262626]">
              작성 중인 기록
            </h2>
            <div className="mt-3 flex shrink-0 flex-col gap-2.5 px-[23px]">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="relative flex h-[64px] items-center rounded-[16px] border border-[#eae7e2] bg-[#faf9f8] px-4"
                >
                  {/* 카드 전체가 이어 쓰기 문 — ✕ 만 그 위에 얹힌다 (기록 카드와 같은 규칙) */}
                  <button
                    onClick={() => onOpenDraft(d)}
                    aria-label={`${d.title || "제목 없는 초안"} 이어 쓰기`}
                    className="absolute inset-0 z-10 rounded-[16px]"
                  />
                  <div className="min-w-0 flex-1 pr-7">
                    <p className="truncate text-[14px] leading-5 font-medium text-[#262626]">
                      {d.title || "제목 없는 초안"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-[#7d7d7d]">
                      {d.course || "코스 미정"} · {savedAt(d.id)}
                    </p>
                  </div>
                  <button
                    onClick={() => onRemoveDraft(d.id)}
                    aria-label={`${d.title || "제목 없는 초안"} 초안 지우기`}
                    className="absolute top-[17px] right-[11px] z-20 flex size-[30px] items-center justify-center transition active:scale-[0.9]"
                  >
                    <img src="/safelog/icon-close.svg" alt="" className="size-[14px]" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

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
              <div
                key={r.id}
                className="relative flex h-[150px] items-start gap-[18px] rounded-[20px] border border-[#eae7e2] bg-white p-4 shadow-[0_4px_12px_0_rgba(0,0,0,0.05)] transition active:scale-[0.99]"
              >
                {/*
                  카드를 누르면 상세로 (TRIP-09-A). 카드 자체를 button 으로 감싸면 안 된다 —
                  안에 ✕ 버튼이 있어서 button 안의 button 이 되고, 그건 HTML 이 금지한다
                  (하이드레이션 오류로 터진다). 대신 카드를 덮는 투명 버튼을 글 위에 깔고 ✕ 를 그 위에 둔다.
                */}
                <button
                  onClick={() => onOpen(r)}
                  aria-label={`${r.title} 기록 열기`}
                  className="absolute inset-0 z-10 rounded-[20px]"
                />
                {/* ✕ — 주행 저장 카드와 같은 자리·같은 아이콘이다 (app/safelog/page.tsx). 두 목록이 같은 카드라 규칙도 하나여야 한다 */}
                <button
                  onClick={() => onRemove(r)}
                  aria-label={`${r.title} 기록 지우기`}
                  className="absolute top-[8px] right-[11px] z-20 flex size-[30px] items-center justify-center transition active:scale-[0.9]"
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
              </div>
            ))}
          </div>
        )}

        <div className="min-h-5 flex-1" />
      </div>

      {/*
        하단 버튼은 흰 띠 위에 앉힌다. 띠가 없으면 스크롤하던 카드가 버튼 바로 위에서 칼로 자른 듯
        끊겨 버튼이 카드 위에 얹힌 것처럼 보인다 — 여기가 화면의 바닥이라는 걸 띠가 말해준다.

        기록으로 들어가는 문이 여기다 (와이어프레임 "여행 기록하기 버튼 누르면"). 그 아래가 홈으로.
      */}
      <div className="flex shrink-0 flex-col bg-white pt-3">
        <Cta label="여행 기록하기" onClick={onWrite} />
        <div className="h-4 shrink-0" />
        <Cta label="홈으로 돌아가기" onClick={onHome} ghost />
        <div className="h-[35px] shrink-0" />
      </div>
    </Frame>
  );
}
