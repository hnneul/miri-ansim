"use client";

// AI 여행 코스 — 와이어프레임 "메인화면 → 여행 코스" 섹션의 입력부 (TRIP-01·02·03, 04-A~E).
//
// 아홉 장이지만 화면은 하나다. 전부 같은 TripPlan 한 덩이를 고쳐 쓰고, 다 고른 값을 마지막에
// 한 번 URL 로 넘기기 때문에 — 페이지를 아홉 개로 나누면 그 덩이를 라우트마다 다시 실어 날라야 한다.
// 온보딩(/onboarding)이 네 단계를 한 파일에 둔 것과 같은 이유다.
//
// **순서는 기본정보(02) → 테마(03)다.** 한동안 반대였는데, 테마 화면이 일정 길이에 따라
// 다른 말을 하게 되면서(하루면 안내바가 없고, 2일 이상이면 "여러 개 고르면 매일 다른 곳을
// 볼 수 있어요") 날짜를 먼저 알아야 그 말을 고를 수 있다. 그래서 "AI 코스 만들기"도 테마 화면에 있다.
//
// 04-A~E 는 "적용하기"를 눌러야 반영된다. 그래서 각자 초안(draft)을 들고 있다가 그때 한 번
// 올려 보낸다 — 뒤로 나가면 고치던 값이 없던 일이 되는 게 와이어프레임의 동작이다.
//
// 색은 이 플로우 전용 토큰이다 (피그마 NEW AI Travel — accent #ff7d32, 나머지 화면의 #fc7f35 와 다르다).
//
// 좌표는 390x844 를 옮기되 절대배치는 쓰지 않는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어서
// 가운데(flex-1)부터 줄어야 하단 버튼이 안 잘린다 (app/onboarding/page.tsx 와 같은 이유).

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import DemoNotice from "../DemoNotice";
import { recommendSpots, suggestPlaces } from "../destination/actions";
import { hereNow } from "../home/actions";
import RouteMap, { type LatLng } from "../RouteMap";
import { 이어친목록, type Place } from "@/lib/geocode";
import {
  COMPANIONS,
  DRIVE_HOURS,
  MAX_MUSTS,
  MAX_NIGHTS,
  addDays,
  MAX_PER_PEOPLE,
  PEOPLE,
  THEMES,
  companionLabel,
  fixedHeads,
  dayLabel,
  driveLabel,
  isReady,
  모자란것,
  monthGrid,
  DEFAULT_TRIP,
  parseTrip,
  queryRecord,
  TRIP_KEYS,
  mustLabel,
  periodLabel,
  shiftMonth,
  toTripQuery,
  type Companion,
  type TripPlan,
} from "@/lib/trip";
import { homeQuery, isoToday } from "@/lib/record";

/** 타이핑이 멎고 나서 후보를 부르기까지 (app/destination/page.tsx 와 같은 값·같은 이유) */
const TYPING_MS = 250;

/**
 * 주차장인가. 카카오 분류("교통,수송 > 주차장 > 공영주차장")가 먼저지만, 분류가 비거나
 * 다른 데 걸린 곳도 있어 이름까지 본다 — 제주에 "…주차장"이라는 이름의 관광지는 없다.
 */
const 주차장 = (p: Place) => /주차/.test(p.type) || /주차장|주차타워/.test(p.label);

/**
 * TRIP-01 캐릭터 둘레의 네 자리. THEMES 순서(바다·자연·먹거리·감성)와 짝이다.
 *
 * **여기 적는 값은 이모지의 왼쪽 위가 아니라 한가운데다** (-translate-1/2 로 옮긴다).
 * 왼쪽 위로 잡으면 글자 폭이 다른 이모지(🌊 는 납작하고 🌿 는 길다)마다 눈에 보이는
 * 중심이 어긋나서, 좌표는 대칭인데 그림은 삐뚤어 보인다.
 * 그래서 가로는 50% 에서 같은 만큼 벌린 짝(23·77, 17·83)이고, 크기도 넷 다 같다.
 */
const HALO = [
  "top-[6.944%] left-[77%]", // 🌊 오른쪽 위
  "top-[27.778%] left-[83%]", // 🌿 오른쪽 아래
  "top-[6.944%] left-[23%]", // 🍊 왼쪽 위
  "top-[27.778%] left-[17%]", // 📷 왼쪽 아래
];

/**
 * 섬 한가운데. 아직 아무것도 안 골랐을 때 04-C 지도가 보는 자리다
 * (목적지 화면의 JEJU_CENTER 와 같은 값).
 *
 * 전에는 제주시청이었는데 그건 **북쪽 해안**이라, 208px 짜리 지도의 위 절반이 바다였고
 * 서귀포·성산은 화면 밖이었다. 이 화면의 안내가 "지도를 눌러 고를 수 있어요" 라
 * 남쪽에 묵는 사람은 지도를 끌어야 자기 자리가 나왔다.
 */
const JEJU_CENTER: LatLng = [33.38, 126.55];

/**
 * 04-C 지도에 찍는 주황 점. 파일도 외부 요청도 안 늘어난다 (RouteMap MarkerIcon 주석).
 * 흰 테두리를 두르는 이유는 코스 화면의 핀과 같다 — 지도 바탕이 파스텔이라 색만으로는 묻힌다.
 */
const ORIGIN_PIN = {
  src:
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
        `<circle cx="13" cy="13" r="11" fill="#ff7d32" stroke="#fff" stroke-width="4"/></svg>`,
    ),
  size: [26, 26] as [number, number],
};

type View = "intro" | "fields" | "taste" | "period" | "companion" | "origin" | "drive" | "must";

/** 기본정보(02) 목록으로 되돌아가는 상세 화면들 — 뒤로가기 목적지가 같다 */
const FIELD_DETAILS: View[] = ["period", "companion", "origin", "drive"];

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function TripPage() {
  return (
    <Suspense>
      <Trip />
    </Suspense>
  );
}

function Trip() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const params = new URLSearchParams(searchParams);

  /*
    어디서 왔는지. **"from" 이면 안 된다** — 그 이름은 여행 시작일이 쓰고 있다
    (lib/trip.ts toTripQuery: from=2026-08-04 · to=2026-08-06).

    한동안 겹쳐 썼고, 기록 화면이 q.set("from","record") 로 시작일을 덮어쓴 뒤 여기서 지우기까지 해서
    코스 조건 중 **여행 기간만** 사라졌다. 동행·출발지는 멀쩡한데 날짜 칸만 비어 보이는 증상이었다
    (parseTrip 은 한쪽만 성한 날짜를 둘 다 버린다).
  */
  const from = params.get("back");

  /*
    **코스 화면에서 뒤로 나온 길인가** (app/trip/course/page.tsx onBack 이 resume=1 을 붙인다).
    그때만 URL 의 여행 조건을 되살린다.

    이 화면은 여덟 장을 상태 하나로 넘기므로 URL 이 늘 `/trip?…` 하나다. 그래서 코스에서 뒤로 나오면
    컴포넌트가 새로 마운트되고, 고른 날짜·동행·출발지·테마가 통째로 날아가 TRIP-01 로 되돌아갔다.
    코스 URL 에는 그 조건이 다 들어 있으니(toTripQuery) 되읽어서 **마지막 단계(테마)** 로 연다.

    **표시가 없으면 조건을 통째로 걷어낸다.** 조건은 코스를 지나 기록 화면·홈까지 쿼리에 묻어
    다니는데, 홈의 "여행 코스"가 그걸 그대로 넘겨서 새 여행을 시작하려는 사람에게 지난 여행이
    되살아났다. 안 걷어내면 더 나쁜 일도 생긴다 — 새로 안 고른 키(지난 must 등)가 makeCourse 의
    "빈 자리만 채우기"에 걸려 고른 적 없는 장소가 코스에 들어간다.

    queryRecord 다: theme·must 는 같은 키를 여러 번 쓰므로 Object.fromEntries 로 읽으면
    마지막 하나만 남는다 (lib/trip.ts queryRecord 주석).
  */
  const 이어서 = params.has("resume");
  params.delete("resume");
  if (!이어서) for (const k of TRIP_KEYS) params.delete(k);

  const 실려온 = 이어서 ? parseTrip(queryRecord(searchParams)) : DEFAULT_TRIP;
  const [plan, setPlan] = useState<TripPlan>(실려온);
  const [view, setView] = useState<View>(() => (isReady(실려온) ? "taste" : "intro"));

  /*
    **이 흐름 밖으로 나갈 때(홈·기록) 실어 보낼 쿼리.** 여행 조건과 back 을 여기서 끊는다.

    조건을 끊는 이유 — 조건은 /trip 과 /trip/course 안에서만 쓸모가 있다. 그대로 딸려 나가면
    기록 화면·홈 URL 에 눌어붙어 다니다가, 홈의 "여행 코스"가 그걸 되돌려줘서 새 여행에 지난 값이
    되살아난다 (이어서 주석). 남는 건 프로필(exp·freq…)과 초안 id 정도다.

    back 을 끊는 이유 — 도착지에서는 "어디서 왔는지"가 쓸 데가 없다.
    params 에는 남겨둔다: 코스 화면(makeCourse)이 물고 가야 뒤로 나올 때 길을 안 잃는다.
  */
  const 나갈쿼리 = new URLSearchParams(params);
  나갈쿼리.delete("back");
  for (const k of TRIP_KEYS) 나갈쿼리.delete(k);
  const carry = 나갈쿼리.toString();

  function back() {
    if (FIELD_DETAILS.includes(view)) return setView("fields");
    // "꼭 가고 싶은 곳"은 테마 화면에서 여는 줄이라 그리로 되돌아간다 (TRIP-03)
    if (view === "must") return setView("taste");
    if (view === "taste") return setView("fields");
    if (view === "fields") return setView("intro");
    // 기록 화면에서 "여행 하러 가기"로 왔으면 **쓰던 자리로** 되돌린다 (write=1 이 작성 화면을 편다).
    // 잘못 눌렀을 때 홈까지 밀려나거나 목록으로 떨어지면 쓰던 글을 다시 찾아 들어가야 한다
    if (from === "record") return router.push(`/trip/record?${carry ? `${carry}&` : ""}write=1`);
    // 홈으로 나갈 때는 기록 흐름의 값도 끊는다 — 초안 id 나 코스 요약이 홈 URL 에 눌어붙으면
    // 홈의 "여행 기록 ＋" 가 목록 대신 쓰다 만 글을 편다 (lib/record.ts homeQuery).
    // 바로 윗줄은 그 값들이 필요한 길이라 carry 그대로다 — 쓰던 자리로 되돌아가는 문이다.
    const 홈 = homeQuery(carry);
    router.push(`/home${[...홈].length ? `?${홈}` : ""}`);
  }

  function makeCourse() {
    // 여행 조건이 먼저, 프로필은 빈 자리에만 — 같은 키가 겹칠 일은 없지만 조건이 이기는 게 맞다
    const q = new URLSearchParams(toTripQuery(plan).slice(1));
    for (const [k, v] of params) if (!q.has(k)) q.append(k, v);
    router.push(`/trip/course?${q}`);
  }

  if (view === "intro") return <Intro onStart={() => setView("fields")} onBack={back} />;

  if (view === "fields")
    return (
      <Shell label="다음" onNext={() => setView("taste")} disabled={!isReady(plan)} note={모자란것(plan)}>
        <Back onClick={back} />
        <div className="mt-2 shrink-0">
          <Title lines={["여행의 기본 정보를", "알려주세요"]} subtitle="이동 시간과 쉬는 간격까지 계산할게요." />
        </div>

        {/*
          필수 셋 · 선택 하나. 묶음을 나눈 건 와이어프레임(TRIP-02)이고, 뜻도 그대로다 —
          하루 운전을 안 골라도 "다음"이 열린다 (lib/trip.ts isReady).
          "꼭 가고 싶은 곳"은 여기 없다. 테마 화면(TRIP-03)이 그 줄을 들고 있다.
        */}
        <Group name="필수">
          <Field icon="/trip/field-period.png" name="여행 기간" value={periodLabel(plan)} empty="날짜를 골라주세요" go={() => setView("period")} />
          <Field icon="/trip/field-people.png" name="누구와 가나요?" value={companionLabel(plan)} empty="동행을 골라주세요" go={() => setView("companion")} />
          <Field icon="/trip/field-origin.png" name="출발 위치" value={plan.origin || null} empty="위치를 골라주세요" go={() => setView("origin")} />
        </Group>
        <Group name="선택">
          <Field icon="/trip/field-drive.png" name="하루 운전" value={driveLabel(plan)} empty="운전 시간을 골라주세요" go={() => setView("drive")} />
        </Group>
      </Shell>
    );

  if (view === "taste")
    return (
      <ThemeView plan={plan} setPlan={setPlan} onBack={back} onMusts={() => setView("must")} onMake={makeCourse} />
    );

  const commit = (patch: Partial<TripPlan>) => {
    setPlan({ ...plan, ...patch });
    // "꼭 가고 싶은 곳"을 적용하면 그걸 연 화면(테마)으로 돌아간다 — 나머지는 기본정보 목록으로
    setView(view === "must" ? "taste" : "fields");
  };

  if (view === "period") return <PeriodView plan={plan} onBack={back} onApply={commit} />;
  if (view === "companion") return <CompanionView plan={plan} onBack={back} onApply={commit} />;
  if (view === "origin") return <OriginView onBack={back} onApply={commit} />;
  if (view === "drive") return <DriveView plan={plan} onBack={back} onApply={commit} />;
  return <MustView plan={plan} onBack={back} onApply={commit} />;
}

/* ─────────────────────────────── 공통 뼈대 ─────────────────────────────── */

/**
 * 모든 화면이 같은 모양이다 — 상태바 · 머리 · 본문 · 바닥 버튼.
 * 본문만 스크롤한다: 인원 카운터(04-B)나 추천 장소(04-E)는 844 안에 안 들어간다.
 * 버튼 아래 67px 은 와이어프레임 값이다 (버튼 top 729 + 높이 48 = 777, 844 - 777).
 */
function Shell({
  children,
  label,
  onNext,
  disabled,
  note,
}: {
  children: React.ReactNode;
  label: string;
  onNext: () => void;
  disabled?: boolean;
  /**
   * 버튼이 잠긴 이유 한 줄. 없으면 그 줄째 빠진다.
   *
   * **버튼 위**에 둔다 (아래가 아니라). 아래에 두면 이 줄이 나타났다 사라질 때마다 버튼이
   * 그만큼 오르내린다 — 마지막 칸을 채우는 순간, 그러니까 사람이 바로 버튼을 누르려는 순간
   * 버튼이 움직인다. 위에 두면 그 높이를 스크롤 영역(flex-1)이 먹어서 버튼은 제자리에 있는다.
   */
  note?: string | null;
}) {
  return (
    // min-h-0 이 있어야 아래 스크롤 영역이 .phone 높이 안에 갇힌다 — flex 자식의 기본 min-height 는
    // auto 라, 없으면 내용이 길 때(장소 검색 결과) 이 상자째 늘어나 버튼이 프레임 밖으로 밀린다.
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <StatusBar tone="text-[#262626]" />
      <DemoNotice />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {/* 본문과 버튼 사이 20 — 피그마 세로 좌표(710 → 730) 그대로 */}
      {note && (
        <p className="mt-4 shrink-0 px-6 text-center text-[12px] leading-[18px] text-[#7d7d7d]">{note}</p>
      )}
      {/*
        **꺼진 버튼은 주황을 버린다.** 전에는 disabled:opacity-40 하나였는데, 주황(#ff7d32)에
        걸리면 살구색이 되고 글자는 흰색 그대로라 대비가 1.6:1 이었다 — "다음"이 거의 안 읽힌다.
        게다가 색이 활성 버튼과 같은 계열이라, 앱에서 주황을 "누르세요"로 배운 손은 눌러도 되는
        버튼으로 읽는다. 누르고, 아무 일도 안 일어나고, 왜인지도 모른다.

        회색 바탕 + 회색 글자로 바꾸면 **색만 보고 "지금은 못 누른다"가 읽힌다.** opacity 는 뗐다 —
        투명도는 원래 색을 옅게 만들 뿐이라 "다른 상태"가 아니라 "같은 버튼이 흐린 것"으로 보인다.
        (막는 조건 isReady 는 그대로다. 필수 셋을 채워야 넘어가는 건 의도한 구성이다.)
      */}
      <button
        onClick={onNext}
        disabled={disabled}
        /*
          호버는 **enabled: 를 붙여 켜진 것에만** 건다. :hover 는 disabled 버튼에도 걸리는 브라우저가
          있어서 그냥 hover: 로 두면 꺼진 회색 버튼이 마우스만 올려도 주황으로 돌아온다 —
          방금 회색으로 바꾼 이유가 그 자리에서 사라진다. (같은 파일 1238 줄의 CTA 는
          꺼질 일이 없어서 hover: 하나로 충분하다.)
        */
        className="mx-6 mt-5 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition enabled:hover:bg-[#ff6114] active:scale-[0.98] disabled:bg-[#eae7e2] disabled:text-[#a8a29b]"
      >
        {label}
      </button>
      {/*
        버튼 아래 여백만 피그마(33)보다 얇다. 우리 상태바가 59 인데 와이어프레임의 자리표시자는
        26 이라 세로로 33 이 모자란데(StatusBar.tsx — 다이내믹 아일랜드를 실측으로 피한다),
        글자 사이 간격을 조금씩 줄여 메우면 화면 전체가 원본과 어긋난다. 아무것도 없는 맨 아래에서 뺀다.

        **이 자리는 늘 같은 높이다.** 예전에는 note 가 있으면 이 여백 대신 들어왔는데,
        그러면 안내가 나타났다 사라질 때마다 위의 버튼이 오르내린다 (note 주석).

        **진짜 폰(<480px)에서는 24 로 줄인다.** 이 67 은 피그마 844 화면의 맨 아래 빈 자리인데,
        폰 브라우저는 위아래 크롬이 먹어 남는 높이가 훨씬 낮다(아이폰 17 사파리 715, SE 553).
        아무것도 없는 여백을 그대로 들고 있으면 그만큼 본문이 밀려, TRIP-01 의 말풍선이 잘렸다.
        상태바(StatusBar.tsx)가 폰에서 59→12 로 접히는 것과 같은 규칙이다.
      */}
      <div className="h-6 shrink-0 min-[480px]:h-[67px]" />
    </div>
  );
}

/** 뒤로 화살표 — 온보딩과 같은 아이콘·같은 44px 터치 영역을 쓴다 */
function Back({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 pl-[15px]">
      {/*
        **아이콘 버튼의 호버는 원을 안 깐다 — 아이콘만 흐려진다** (앱 전체 규칙, 18곳이 같다).
        터치 영역 44px 은 그대로고 보이는 것만 바뀐다.

        예전에는 옅은 주황 원(#fff0e6)이었는데, 상단 안내 띠 바로 아래 서는 자리에서 44px 원이
        띠에 맞붙어 겹쳐 보였다. 원을 지우면 평소 배경이 투명이라 겹칠 면적 자체가 없다.
        같은 색을 쓰는 카드·알약(홈 Quick, 필터 칩)은 아이콘 버튼이 아니라 그대로 둔다.
      */}
      <button onClick={onClick} aria-label="뒤로" className="flex size-11 shrink-0 items-center justify-center transition hover:opacity-40 active:scale-90">
        <img src="/icon-arrow-left.svg" alt="" className="size-6" />
      </button>
      {title && <h1 className="text-[16px] leading-6 font-medium text-[#262626]">{title}</h1>}
    </div>
  );
}

/** 큰 제목 두 줄 + 부제. 와이어프레임이 줄을 나눠 그려서 줄 단위로 받는다. */
function Title({ lines, subtitle }: { lines: [string] | [string, string]; subtitle: string }) {
  return (
    <div className="shrink-0 px-[23px]">
      <h2 className="text-[23px] leading-9 font-bold text-[#262626]">
        {lines[0]}
        {lines[1] && (
          <>
            <br />
            {lines[1]}
          </>
        )}
      </h2>
      <p className="mt-2.5 text-[14px] leading-[21px] text-[#7d7d7d]">{subtitle}</p>
    </div>
  );
}

/** 상세 화면(04-A~E)의 머리 — 뒤로 + 화면 이름, 그 아래 큰 제목 */
function Detail({
  name,
  title,
  subtitle,
  children,
  onBack,
  label,
  onApply,
  disabled,
}: {
  name: string;
  title: [string] | [string, string];
  subtitle: string;
  children: React.ReactNode;
  onBack: () => void;
  label: string;
  onApply: () => void;
  disabled?: boolean;
}) {
  return (
    <Shell label={label} onNext={onApply} disabled={disabled}>
      <Back onClick={onBack} title={name} />
      <div className="mt-2 shrink-0">
        <Title lines={title} subtitle={subtitle} />
      </div>
      <div className="mt-6">{children}</div>
    </Shell>
  );
}

/* ─────────────────────────────── 선택 조각 ─────────────────────────────── */

/** TRIP-02 · 04-D 의 가로 줄. 고르면 주황 테두리 + 연한 주황 바탕이 된다. */
function Row({
  icon,
  label,
  desc,
  on,
  onClick,
  radio,
}: {
  /** 왼쪽 그림 경로. radio 줄에는 없다 (● ○ 가 그 자리다) */
  icon?: string;
  label: string;
  desc: string;
  on: boolean;
  onClick: () => void;
  radio?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-[76px] items-center gap-3.5 rounded-2xl px-4 text-left transition ${
        on ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
      }`}
    >
      <span className="flex w-[26px] shrink-0 items-center justify-center text-center text-[16px] leading-6">
        {radio ? (
          <span className={on ? "text-[#ff7d32]" : "text-[#7d7d7d]"}>{on ? "●" : "○"}</span>
        ) : icon ? (
          <img src={icon} alt="" className="size-[22px] object-contain" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{label}</span>
        <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{desc}</span>
      </span>
      {on && !radio && <span className="shrink-0 text-[16px] leading-6 text-[#262626]">✓</span>}
    </button>
  );
}

/**
 * 04-B-2 의 동행 타일. 다섯이 3 + 2 로 앉는다 (와이어프레임 그대로) —
 * 여섯 칸 격자에 2칸·3칸으로 나눠 재면 두 줄 다 가로를 꽉 채우고 사이 간격도 하나로 맞는다.
 * 2열로 두면 마지막 하나가 혼자 남아 반쪽짜리 줄이 생긴다.
 */
function Tile({ icon, label, on, onClick }: { icon: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-[86px] w-full flex-col items-center justify-center gap-1.5 rounded-[18px] transition ${
        on ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
      }`}
    >
      {/*
        시스템 이모지였다. 기기마다 다른 그림이 나오고(맥 Apple Color Emoji ↔ 윈도우 Segoe UI Emoji),
        가족·친구는 ZWJ 로 이어붙인 조합이라 지원이 없는 환경에서는 낱글자로 흩어졌다.
        홈 quick-*.png 와 같은 방식으로 옮긴다.
        alt 는 비운다: 바로 옆에 label 이 글자로 서 있어 읽어 주면 이름이 두 번 들린다.
      */}
      <img src={icon} alt="" className="size-[26px] shrink-0 object-contain" />
      <span className="max-w-full truncate px-2 text-[14px] leading-5 font-medium text-[#262626]">{label}</span>
    </button>
  );
}

/**
 * 기본정보 목록의 묶음 머리 (TRIP-02 의 "필수" · "선택").
 * 주황인 이유는 이게 이름표가 아니라 **무엇을 안 채우면 못 넘어가는지**를 말하는 자리라서다 —
 * 회색으로 두면 그냥 소제목으로 읽혀 "선택"과 구분이 안 된다.
 */
function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <p className="mt-6 shrink-0 px-[27px] text-[13px] leading-5 font-bold text-[#ff7d32]">{name}</p>
      <div className="mt-2.5 flex shrink-0 flex-col gap-3 px-[23px]">{children}</div>
    </>
  );
}

/** TRIP-02 의 한 줄. 아직 안 고른 값은 흐리게 둬서 무엇이 비었는지 한눈에 보이게 한다. */
function Field({
  icon,
  name,
  value,
  empty,
  go,
}: {
  icon: string;
  name: string;
  value: string | null;
  empty?: string;
  go: () => void;
}) {
  return (
    <button onClick={go} className="flex h-[70px] w-full items-center gap-3 rounded-2xl border border-[#eae7e2] bg-white px-4 text-left transition active:scale-[0.99]">
      {/* 이모지 글자였다 — 기기마다 다른 그림이 나와 파일로 옮겼다 (Tile 주석) */}
      <img src={icon} alt="" className="w-7 shrink-0 object-contain" />

      <span className="min-w-0 flex-1">
        <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">{name}</span>
        <span className={`block truncate text-[16px] leading-6 font-medium ${value ? "text-[#262626]" : "text-[#b8b2aa]"}`}>
          {value ?? empty}
        </span>
      </span>
      <span className="shrink-0 text-[22px] leading-[30px] font-bold text-[#7d7d7d]">›</span>
    </button>
  );
}

/**
 * TRIP-03 | 여행 테마 선택.
 *
 * **여러 개 고른다.** 하나만 고르던 때가 있었는데, 이틀 이상 가는 사람이 하루는 바다 하루는
 * 오름을 보고 싶다는 말을 이 화면이 못 받았다. 그래서 안내바도 일정이 이틀 이상일 때만 뜬다 —
 * 하루짜리 여행에 "매일 다른 곳"이라고 말하면 지킬 수 없는 약속이다.
 *
 * "꼭 가고 싶은 곳"이 여기 붙어 있는 것도 같은 흐름이다. 고르고 싶은 장소는 테마를 정하는
 * 그 순간에 떠오르지, 날짜·동행을 적는 자리에서 떠오르지 않는다.
 *
 * 마지막 입력 화면이라 "AI 코스 만들기"가 여기 있다 (파일 머리 주석 — 순서가 02 → 03 이다).
 */
function ThemeView({
  plan,
  setPlan,
  onBack,
  onMusts,
  onMake,
}: {
  plan: TripPlan;
  setPlan: (p: TripPlan) => void;
  onBack: () => void;
  onMusts: () => void;
  onMake: () => void;
}) {
  const toggle = (i: number) =>
    setPlan({
      ...plan,
      // 고른 순서를 지킨다 — 첫 테마가 코스 제목과 후보의 중심이다 (lib/course.ts)
      themes: plan.themes.includes(i) ? plan.themes.filter((t) => t !== i) : [...plan.themes, i],
    });

  return (
    <Shell label="AI 코스 만들기" onNext={onMake} disabled={plan.themes.length === 0}>
      <Back onClick={onBack} />

      <div className="shrink-0 px-6">
        <h2 className="text-[25px] leading-[31px] font-bold text-[#262626]">
          어떤 제주 여행을
          <br />
          원하시나요?
        </h2>
        <p className="mt-[18px] text-[11px] leading-5 text-[#7d7d7d]">선택한 테마를 중심으로 코스를 추천해요.</p>
      </div>

      <div className="mt-[29px] flex shrink-0 items-baseline justify-between px-[27px]">
        <h3 className="text-[15px] leading-6 font-bold text-[#262626]">여행 테마</h3>
        <span className="text-[10px] leading-[18px] font-medium text-[#ff7d32]">복수 선택 가능</span>
      </div>

      {/* 164x108 두 칸씩 · 사이 14 (피그마 left 24·202, top 268·390) */}
      <div className="mt-[19px] grid shrink-0 grid-cols-2 gap-[14px] px-6">
        {THEMES.map((t, i) => {
          const on = plan.themes.includes(i);
          return (
            <button
              key={t.label}
              onClick={() => toggle(i)}
              aria-pressed={on}
              className={`relative h-[108px] rounded-2xl px-[13px] pt-[11px] text-left transition ${
                on ? "border-[1.5px] border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
              }`}
            >
              <img src={t.icon} alt="" className="block size-[26px] object-contain" />
              <span className={`mt-[5px] block truncate text-[14px] leading-[22px] font-bold ${on ? "text-[#ff7d32]" : "text-[#262626]"}`}>
                {t.label}
              </span>
              <span className="mt-0.5 block truncate text-[10px] leading-[18px] text-[#7d7d7d]">{t.desc}</span>
              {/* 체크 뱃지는 뺐다 — 테두리·바탕·글자색이 이미 골랐다고 말한다. 스크린리더는 aria-pressed 로 안다 */}
            </button>
          );
        })}
      </div>

      {/* 테마 타일과 같은 폭·같은 여백에 서는 한 줄 (TRIP-03). 누르면 04-E 로 간다 */}
      <div className="mt-[18px] shrink-0 px-6">
        <Field icon="/trip/field-must.png" name="꼭 가고 싶은 곳" value={mustLabel(plan)} empty="선택 안 함" go={onMusts} />
      </div>

      <div className="flex-1" />
    </Shell>
  );
}

/* ─────────────────────────────── TRIP-01 ─────────────────────────────── */

function Intro({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  return (
    <Shell label="내 여행 추천받기" onNext={onStart}>
      <Back onClick={onBack} />
      <div className="shrink-0 px-[23px]">
        <p className="text-[14px] leading-[21px] text-[#7d7d7d]">AI 제주 여행</p>
        <h2 className="mt-4 text-[23px] leading-[30px] font-bold text-[#262626]">
          여행을 떠나기 좋은 날이에요 !<br />
          오늘은 어디로 가볼까요?
        </h2>
        {/*
          줄바꿈은 손으로 넣는다 (제목 h2 와 같은 방식) — 글꼴 폭에 따라 접히는 자리가 바뀌면
          두 줄의 길이가 들쭉날쭉해진다. break-keep 은 더 좁은 폰에서 어절이 중간에 끊기지 않게 하는 보험.
        */}
        <p className="mt-5 break-keep text-[14px] leading-[21px] text-[#7d7d7d]">
          몇 가지만 알려주면 귤이가 나에게 맞는
          <br />
          장소와 이동 순서를 함께 짜드려요.
        </p>
      </div>

      {/*
        캐릭터 · 이모지 셋 · 꼬리 달린 말풍선. 이 덩어리만은 피그마 좌표(390 폭, 261~621)를
        그대로 박는다 — 이모지가 캐릭터 둘레에 흩어진 그림이라 흐름 배치로는 그 자리가 안 나온다.
        대신 한 상자 안에서만 절대좌표다.

        **가로도 세로도 % 다** (px 이 아니라). 가로가 % 인 이유는 진짜 폰이 390 보다 좁아서고,
        세로가 % 인 이유는 **폰 브라우저가 844 보다 훨씬 낮아서**다 — 아이폰 17 사파리의
        콘텐츠 높이가 715 다(위 상태바 + 아래 툴바가 먹는다). 360 을 px 로 박았더니 이 덩어리가
        버튼 밑으로 밀려, 말풍선이 반쯤 잘린 채로 첫 화면에 떴다 (실측: 17에서 37px, SE 에서 199px
        넘쳤다). 상자가 남는 높이만큼만 차지하고 안쪽이 통째로 비례해 줄면 어느 기기에서도 다 보인다.
        top 값은 전부 (피그마 y − 261) ÷ 360 이다.

        max 360 은 원래 크기이고(노트북 프레임에서는 이 값 그대로다), min 220 은 가장 작은 폰(SE, 사파리 콘텐츠 553)에서도
        안 넘치면서 말풍선 안쪽(19.444% = 43px)에 글줄 21px 이 여유 있게 드는 선이다.
      */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative h-full max-h-[360px] min-h-[220px] w-full max-w-[390px]">
          {/* 피그마는 왼쪽으로 치우쳐 있었는데(left 56 / right 71) 가운데로 맞춘다 — 둘레가 대칭이라 */}
          <img
            src="/character/trip-hero.png"
            alt="귤이 캐릭터"
            className="absolute top-[11.389%] left-1/2 h-[62.399%] w-[67.489%] -translate-x-1/2 object-contain"
          />
          {/*
            둘레의 이모지는 **테마 그대로**다 (lib/trip.ts THEMES — 바다·자연·먹거리·감성).
            피그마의 다섯 개(🌸🍊🔥🏝️🌿)는 아무 뜻이 없었는데, 이러면 이 그림이 곧 "고를 수 있는
            테마 넷"이 된다. 테마가 바뀌면 여기도 같이 바뀐다 — 한 곳만 고치면 된다.
            자리는 위 둘·아래 둘로 캐릭터를 감싸게 (HALO 가 THEMES 순서와 짝이다).
          */}
          {THEMES.slice(0, HALO.length).map((t, i) => (
            <span
              key={t.icon}
              className={`absolute -translate-x-1/2 -translate-y-1/2 text-[36px] leading-none ${HALO[i]}`}
              aria-hidden
            >
              <img src={t.icon} alt="" className="size-9 object-contain" />
            </span>
          ))}
          <img
            src="/trip/bubble-tail.svg"
            alt=""
            className="absolute top-[73.889%] left-1/2 h-[6.667%] w-[19.13px] -translate-x-1/2"
          />
          {/* 오른쪽 여백만 7 — 피그마 글줄 상자(left 33 · width 260)라 33 을 양쪽에 주면 한 줄이 안 붙는다 */}
          <div className="absolute top-[80.556%] left-1/2 flex h-[19.444%] w-[76.923%] -translate-x-1/2 items-center rounded-[20px] bg-[#fff0e6] pr-[7px] pl-[33px]">
            <p className="text-[14px] leading-[21px] text-[#262626]">오늘의 제주를 가장 완벽하게 즐기는 법 !</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ─────────────────────────────── TRIP-04-A ─────────────────────────────── */

/**
 * 여행 기간. **달력을 직접 그린다** (monthGrid 42칸).
 *
 * 한때 이 자리에 "<input type=\"date\"> 를 쓴다 — OS 기본 달력이 뜨고 키보드 입력과
 * 스크린리더를 공짜로 얻는다"고 적혀 있었는데, 코드는 그렇게 간 적이 없다. 네이티브 달력은
 * **시작~도착 사이를 칠하지 못한다.** 며칠짜리 여행인지가 이 화면이 답할 것 전부라 그 표시를
 * 잃을 수 없어서 직접 그렸고, 그 대가로 아래 것들을 손으로 만들었다:
 *   · 다른 달로 넘기기 — "지난 달"·"다음 달" 버튼 (지난 달은 이번 달에서 멈춘다)
 *   · 스크린리더 — 칸마다 aria-label={dayLabel(date)} 로 날짜를 읽어준다
 *   · 지난 날짜 막기 — 네이티브의 min 대신 칸을 disabled + 흐리게
 * 못 얻은 것도 분명하다: **키보드로 날짜를 쳐 넣을 수는 없다.** 눌러서만 고른다.
 *
 * 도착일은 시작보다 앞선 날짜를 아예 못 고르게 한다 (parseTrip 도 같은 값을 막는다).
 */
function PeriodView({ plan, onBack, onApply }: DetailProps) {
  const [start, setStart] = useState(plan.start);
  const [end, setEnd] = useState(plan.end);
  /*
    **오늘보다 앞은 못 고른다.** 전에는 ‹ 로 2019년까지 넘어가 지난 날짜를 시작일로 잡을 수
    있었고, 달력이 지난 날을 앞으로 올 날과 똑같은 검은 글씨로 그려서 막지도 알려주지도 않았다.
    (여행 계획을 짜는 화면이라 "어제 출발"은 어느 쪽으로도 뜻이 없다.)

    이 값은 렌더에서 바로 잰다 — 이 화면은 useSearchParams 아래라 서버에서 미리 그리지 않아
    (위 Suspense 주석) 서버·클라이언트의 날짜가 엇갈릴 자리가 없다.
  */
  const 오늘 = isoToday();
  const 이번달 = 오늘.slice(0, 7);
  // 고쳐 열면 그 달부터. 처음이면 이번 달 — 여행은 대개 가까운 날짜다.
  // 지난 달로는 안 연다: 손댈 수 없는 칸만 가득한 달을 첫 화면으로 주는 셈이라
  const [month, setMonth] = useState(() => {
    const m = (plan.start || 오늘).slice(0, 7);
    return m < 이번달 ? 이번달 : m;
  });
  /*
    출발만 고른 상태에서 도착으로 고를 수 있는 마지막 날 (lib/trip.ts MAX_NIGHTS).
    상한이 없던 때는 "1826박 1827일"까지 만들어졌다.
  */
  const 최대끝 = start && !end ? addDays(start, MAX_NIGHTS) : "";
  const label = periodLabel({ ...plan, start, end });

  /*
    한 번 누르면 출발, 다시 누르면 도착. 둘 다 찬 뒤에 누르면 출발부터 다시 잡는다 —
    "고치려면 뭘 지워야 하나"를 묻지 않는 방식이고, 와이어프레임의 "차례로 선택해 주세요"가 이 뜻이다.
    출발보다 앞선 날을 누르면 그 날이 새 출발이 된다 (거꾸로 된 기간을 만들 방법이 없다).
  */
  function pick(date: string) {
    if (!start || end || date < start) {
      setStart(date);
      setEnd("");
    } else {
      setEnd(date);
    }
  }

  return (
    <Detail
      name="여행 기간"
      title={["언제 제주로 떠나시나요?"]}
      subtitle="시작일과 종료일을 차례로 선택해 주세요."
      onBack={onBack}
      label={label ? `${label} 적용하기` : "날짜를 골라주세요"}
      onApply={() => onApply({ start, end })}
      disabled={!label}
    >
      <div className="px-6">
        <div className="flex h-[76px] items-center rounded-2xl bg-[#fff0e6] px-[18px]">
          <span className="flex-1">
            <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">출발</span>
            <span className={`block text-[16px] leading-6 font-medium ${start ? "text-[#262626]" : "text-[#b8b2aa]"}`}>
              {start ? dayLabel(start) : "날짜 선택"}
            </span>
          </span>
          <span className="shrink-0 px-2 text-[16px] text-[#7d7d7d]">→</span>
          <span className="flex-1 text-right">
            <span className="block text-[12px] leading-[18px] text-[#7d7d7d]">도착</span>
            <span className={`block text-[16px] leading-6 font-medium ${end ? "text-[#262626]" : "text-[#b8b2aa]"}`}>
              {end ? dayLabel(end) : "날짜 선택"}
            </span>
          </span>
        </div>

        <div className="mt-9 flex items-center justify-between">
          {/* 이번 달에서 멈춘다 — 더 뒤로 가봐야 고를 수 있는 칸이 하나도 없는 달이다 */}
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            disabled={month <= 이번달}
            aria-label="지난 달"
            className="size-11 text-[18px] text-[#7d7d7d] disabled:opacity-25"
          >
            ‹
          </button>
          <span className="text-[16px] leading-6 font-medium text-[#262626]">
            {month.split("-")[0]}년 {Number(month.split("-")[1])}월
          </span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달" className="size-11 text-[18px] text-[#7d7d7d]">
            ›
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 text-center text-[12px] leading-[18px] text-[#7d7d7d]">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7">
          {monthGrid(month).map(({ date, inMonth }) => {
            const isStart = date === start;
            const isEnd = date === end;
            const between = !!start && !!end && date > start && date < end;
            const day = Number(date.slice(8));
            const 오늘칸 = date === 오늘;
            /* 못 고르는 칸 — 지났거나, 출발에서 너무 멀거나, 옆 달이거나 */
            const 잠김 = !inMonth || date < 오늘 || (!!최대끝 && date > 최대끝);
            return (
              <button
                key={date}
                onClick={() => !잠김 && pick(date)}
                disabled={잠김}
                aria-pressed={isStart || isEnd}
                aria-label={dayLabel(date)}
                /* 사이 날짜의 옅은 띠가 칸 사이 틈으로 끊기지 않게, 배경은 칸 전체에 깔고 원만 안에 올린다 */
                className={`flex h-12 items-center justify-center ${between ? "bg-[#fff0e6]" : ""} ${
                  isStart ? "rounded-l-full bg-[#fff0e6]" : ""
                } ${isEnd ? "rounded-r-full bg-[#fff0e6]" : ""}`}
              >
                {/*
                  오늘은 **테두리**다 (칠하지 않는다) — 칠하면 고른 날과 같은 모양이 돼서
                  달력에 주황 원이 셋 뜬다. 테두리는 안쪽에 그려지므로 칸 크기가 안 흔들린다.
                  고른 날이 오늘이면 칠한 쪽이 이긴다: 그때는 "오늘"보다 "고른 날"이 할 말이 많다.
                */}
                <span
                  className={`flex size-[38px] items-center justify-center rounded-full text-[14px] leading-5 ${
                    isStart || isEnd
                      ? "bg-[#ff7d32] font-bold text-white"
                      : 오늘칸
                        ? "border border-[#ff7d32] font-bold text-[#ff7d32]"
                        : 잠김
                          ? "text-[#d6d0c9]"
                          : "text-[#262626]"
                  }`}
                >
                  {day}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-6 flex h-[58px] items-center rounded-2xl bg-[#f6f4f1] px-[18px] text-[14px] leading-[21px] text-[#7d7d7d]">
          {label ? `선택한 여행 기간 · ${label}` : "두 날짜를 모두 고르면 기간이 나와요"}
        </p>
      </div>
    </Detail>
  );
}

/* ─────────────────────────────── TRIP-04-B ─────────────────────────────── */

function CompanionView({ plan, onBack, onApply }: DetailProps) {
  const [companion, setCompanion] = useState<Companion | null>(plan.companion);
  const [people, setPeople] = useState(plan.people);
  const draft = { ...plan, companion, people };

  /*
    **말에 인원이 이미 들어 있는 동행은 안 묻는다** — 혼자는 한 명, 연인은 두 명이다
    (lib/trip.ts COMPANIONS 의 fixed). 그 옆에 0 부터 세는 카운터를 같이 두면
    "연인 + 성인 5명" 같은 말이 안 되는 조합을 만들 수 있다.
    적용할 때 성인 수로 못 박는다 (companionLabel 은 혼자일 때만 인원을 안 붙인다).
  */
  const 정해짐 = fixedHeads(companion);
  const total = PEOPLE.reduce((sum, p) => sum + people[p.key], 0);

  return (
    <Detail
      name="동행 선택"
      title={["누구와 함께 떠나나요?"]}
      subtitle="혼자 또는 함께, 동행에 맞춰 쉬는 장소도 추천해요."
      onBack={onBack}
      // 인원을 안 묻는 동행(혼자·연인)에서 "인원 설정"이라 하면 화면에 없는 걸 가리킨다
      label={!companion ? "동행을 골라주세요" : 정해짐 ? "적용하기" : "인원 설정 적용하기"}
      onApply={() =>
        onApply(정해짐 ? { companion, people: { adult: 정해짐, teen: 0, child: 0 } } : { companion, people })
      }
      /*
        인원이 0 명이면 못 넘어간다. 카운터가 0 에서 시작하니(04-B-2) 손대지 않고 나가면
        "가족 0명"이 되는데, 그건 고른 적 없는 조건이 아니라 **말이 안 되는** 조건이다.
      */
      disabled={!companion || (!정해짐 && total === 0)}
    >
      {/*
        2 × 2. 순서는 COMPANIONS 그대로다 — 윗줄은 인원을 안 묻는 둘(혼자·연인),
        아랫줄은 묻는 둘(가족·친구). 윗줄을 고르면 카운터가 안 나오는 게 줄 단위로 읽힌다.
      */}
      <div className="grid grid-cols-2 gap-3.5 px-[23px]">
        {COMPANIONS.map((c) => (
          <Tile key={c.id} icon={c.icon} label={c.label} on={companion === c.id} onClick={() => setCompanion(c.id)} />
        ))}
      </div>

      {/*
        인원은 동행을 고른 **뒤에** 나온다 (04-B-2). 처음부터 세 줄을 깔아두면 무엇부터
        해야 하는지가 안 읽히고, 동행을 안 고른 채 인원만 센 상태가 생긴다.
      */}
      {companion && !정해짐 && (
        <>
          <p className="mt-8 px-[28px] text-[16px] leading-6 font-medium text-[#262626]">인원</p>
          <div className="mt-3 flex flex-col gap-3 px-[23px]">
            {PEOPLE.map((p) => (
              <div key={p.key} className="flex h-[60px] items-center rounded-[18px] border border-[#eae7e2] bg-white px-[18px]">
                <span className="min-w-0 flex-1 truncate text-[16px] leading-6 font-medium text-[#262626]">{p.label}</span>
                <Step sign="−" onClick={() => setPeople({ ...people, [p.key]: Math.max(0, people[p.key] - 1) })} disabled={people[p.key] === 0} />
                <span className="w-[34px] text-center text-[16px] leading-6 font-medium text-[#262626]">{people[p.key]}</span>
                <Step sign="+" onClick={() => setPeople({ ...people, [p.key]: Math.min(MAX_PER_PEOPLE, people[p.key] + 1) })} disabled={people[p.key] === MAX_PER_PEOPLE} />
              </div>
            ))}
          </div>
          {/* 버튼이 꺼져 있는 이유를 여기서 말한다 — "인원 설정 적용하기"가 흐린 채로만 있으면 왜인지 모른다 */}
          <p className="mt-3 px-[28px] text-[12px] leading-[18px] text-[#7d7d7d]">
            {total ? companionLabel(draft) : "+ 를 눌러 인원을 정해주세요"}
          </p>
        </>
      )}
    </Detail>
  );
}

function Step({ sign, onClick, disabled }: { sign: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={sign === "+" ? "한 명 늘리기" : "한 명 줄이기"}
      className="size-11 shrink-0 text-[22px] leading-[30px] font-bold text-[#7d7d7d] transition disabled:opacity-30"
    >
      {sign}
    </button>
  );
}

/* ─────────────────────────────── TRIP-04-C ─────────────────────────────── */

/**
 * 출발 위치. 장소 검색은 목적지 화면의 서버 액션을 그대로 부른다 (카카오 키가 서버 전용이라
 * 브라우저에서 직접 못 부른다 — app/destination/actions.ts).
 *
 * **정하는 길이 셋이다** (와이어프레임 04-C: "현재 위치를 사용하거나 지도에서 직접 선택하세요").
 * 현재 위치 · 검색 · 지도를 직접 누르기. 셋 다 같은 자리(picked)에 떨어지고, 지도는 그 결과를
 * 되비춘다 — 어디를 골랐는지 글자로만 보면 옆 동네를 고른 걸 알아채지 못한다.
 *
 * 지도를 누르면 동네 이름을 다시 물어본다 (hereNow → areaAt). 이름을 못 받아도 좌표는 성했으니
 * 그대로 쓴다 — 코스 계산에 필요한 건 좌표고, 이름은 화면에 보여줄 말일 뿐이다.
 */
function OriginView({ onBack, onApply }: Omit<DetailProps, "plan">) {
  const [text, setText] = useState("");
  // here: 현재 위치로 잡은 값인지. 검색·지도로 고른 곳까지 "현재 위치 사용" 칸을 켜면 안 된다.
  const [picked, setPicked] = useState<{ name: string; at: LatLng | null; here: boolean } | null>(null);
  const [geo, setGeo] = useState<"idle" | "loading" | "error">("idle");
  const { found, 찾은말, 물어봤나 } = usePlaceSuggest(text);

  function useHere() {
    if (!navigator.geolocation) return setGeo("error");
    setGeo("loading");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const at: LatLng = [coords.latitude, coords.longitude];
        const { area } = await hereNow(at[0], at[1]);
        // 동네 이름을 못 받아도 좌표는 성했다 — 이름만 "현재 위치"로 두고 그대로 쓴다
        setPicked({ name: area ?? "현재 위치", at, here: true });
        setGeo("idle");
      },
      () => setGeo("error"),
    );
  }

  async function pickOnMap(at?: LatLng) {
    if (!at) return;
    // 먼저 자리부터 옮긴다 — 이름을 기다리는 동안 점이 안 움직이면 눌린 게 아닌 줄로 읽힌다
    setPicked({ name: "지도에서 고른 위치", at, here: false });
    const { area } = await hereNow(at[0], at[1]);
    if (area) setPicked({ name: area, at, here: false });
  }

  return (
    <Detail
      name="출발 위치"
      title={["어디에서 출발하시나요?"]}
      subtitle="현재 위치를 사용하거나 지도에서 직접 선택하세요."
      onBack={onBack}
      label={picked ? "이 위치에서 출발" : "위치를 골라주세요"}
      onApply={() => picked && onApply({ origin: picked.name, originAt: picked.at })}
      disabled={!picked}
    >
      <div className="px-[23px]">
        <button
          onClick={useHere}
          className={`flex h-[62px] w-full items-center gap-3 rounded-2xl px-4 text-left transition ${
            picked?.here ? "border-2 border-[#ff7d32] bg-[#fff0e6]" : "border border-[#eae7e2] bg-white"
          }`}
        >
          {/* 이모지 글자였다 — 기기마다 다른 그림이 나와 파일로 옮겼다 (Tile 주석) */}
          <img src="/trip/field-must.png" alt="" className="size-[22px] shrink-0 object-contain" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-6 font-medium text-[#262626]">현재 위치 사용</span>
            <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">
              {geo === "loading"
                ? "위치 확인 중…"
                : geo === "error"
                  ? "위치를 확인할 수 없어요"
                  : picked?.here
                    ? `${picked.name}에서 위치 확인됨`
                    : "눌러서 지금 자리를 확인해요"}
            </span>
          </span>
        </button>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="주소 · 장소 검색"
          className="mt-3 h-[54px] w-full rounded-2xl border border-[#eae7e2] bg-white px-[18px] text-[14px] leading-[21px] text-[#262626] outline-none placeholder:text-[#7d7d7d] focus:border-[#ff7d32]"
        />

        <div className="mt-3 flex flex-col gap-2">
          {/*
            **빈 목록에도 말을 건다.** 전에는 갈래가 없어서, 제주에 없는 이름을 치면 화면이
            그대로였다 — 검색이 도는지도 알 수 없었다 (F07 과 같은 병이 이 화면에도 있었다).
            셋으로 가른다: 아직 안 온 것 · 물어봤는데 없는 것 · 못 물어본 것.
          */}
          {text.trim() && found.length === 0 && (
            <p className="px-1 py-2 text-[13px] leading-[20px] text-[#7d7d7d]">
              {찾은말 !== text ? (
                "검색 결과를 찾는 중…"
              ) : 물어봤나 ? (
                /* "제주에 없다"고는 안 한다 — "스타벅"은 0인데 "스타벅스"는 세 곳이 나온다 */
                <>
                  &lsquo;{text}&rsquo;로는 못 찾았어요.
                  <br />
                  이름을 조금 더 적어보세요.
                </>
              ) : (
                <>
                  지금은 장소를 찾아볼 수 없어요.
                  <br />
                  잠시 뒤에 다시 쳐보세요.
                </>
              )}
            </p>
          )}
          {found.map((p) => (
            <button
              key={`${p.label}${p.road}`}
              onClick={() => {
                setPicked({ name: p.label, at: p.coord, here: false });
                setText("");
              }}
              className="rounded-2xl border border-[#eae7e2] bg-white px-4 py-3 text-left transition active:scale-[0.99]"
            >
              <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{p.label}</span>
              <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{p.road || p.jibun}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        지도는 좌우를 꽉 채운다 — 메인화면 지도 카드와 같은 모양이다 (지도 208 + 아래 줄 52).
        휠 확대는 끈다: 이 화면은 세로로 스크롤되는데 지도가 한복판이라, 휠을 먹으면
        화면이 안 내려가고 지도만 축소된다 (app/home/page.tsx 와 같은 이유).
      */}
      <div className="mt-6">
        <div className="h-[208px] w-full">
          <RouteMap
            center={picked?.at ?? JEJU_CENTER}
            /*
              안 고른 상태는 **섬 전체**가 담기는 11 이다 (제주·서귀포·우도·차귀도까지).
              목적지 화면도 같은 중심에 안 고른 상태를 쓰지만 거기는 10 이다 — 그쪽 지도는
              화면을 꽉 채우는 세로 상자고 이건 208px 짜리 가로 띠라, 같은 축척이면 동서가
              잘려 성산·한림이 화면 밖으로 나간다. 같은 뜻("섬 전체")을 상자 모양에 맞춰 옮긴 값.
            */
            level={picked?.at ? 5 : 11}
            routes={[]}
            markers={picked?.at ? [{ coord: picked.at, label: picked.name, icon: ORIGIN_PIN }] : []}
            className=""
            wheelZoom={false}
            zoomButtons
            onBlank={pickOnMap}
          />
        </div>
        <div className="flex h-[52px] items-center justify-between border-t border-[#ededed] bg-white pr-6 pl-10">
          <span className="text-[13px] text-[#090808]">출발 위치</span>
          <span className="truncate pl-4 text-[13px] font-medium text-[#9e9e9e]">
            {picked?.name ?? "지도를 눌러 고를 수 있어요"}
          </span>
        </div>
      </div>
    </Detail>
  );
}

/* ─────────────────────────────── TRIP-04-D ─────────────────────────────── */

function DriveView({ plan, onBack, onApply }: DetailProps) {
  const [hours, setHours] = useState<number | null>(plan.driveHours);

  return (
    <Detail
      name="하루 운전 시간"
      title={["하루에 얼마나", "운전할 수 있나요?"]}
      subtitle="선택한 시간 안에서 장소와 휴식 순서를 조정할게요."
      onBack={onBack}
      label={hours === null ? "운전 시간을 골라주세요" : `${driveLabel({ ...plan, driveHours: hours })} 적용하기`}
      onApply={() => onApply({ driveHours: hours })}
      disabled={hours === null}
    >
      <div className="flex flex-col gap-3.5 px-[23px]">
        {DRIVE_HOURS.map((d) => (
          <Row key={d.hours} label={d.label} desc={d.desc} on={hours === d.hours} onClick={() => setHours(d.hours)} radio />
        ))}
      </div>
    </Detail>
  );
}

/* ─────────────────────────────── TRIP-04-E ─────────────────────────────── */

function MustView({ plan, onBack, onApply }: DetailProps) {
  const [musts, setMusts] = useState(plan.musts);
  const [text, setText] = useState("");
  /**
   * 검색칸에 들어와 있는지 (04-E-1). 글자가 있는지와 따로 둔다 —
   * ✕ 로 글자만 지웠을 때 화면이 통째로 04-E 로 되돌아가면, 다시 치려고 칸을 또 눌러야 한다.
   */
  const [searching, setSearching] = useState(false);
  /*
    주차장은 걸러낸다. "서귀포올레시장"을 치면 시장 바로 아래에 "서귀포시 매일올레시장 공영주차장"이
    같은 자격으로 붙어 나오는데, **주차장은 가고 싶은 곳이 아니라 거기 가려고 대는 곳**이다.
    코스에 들어가면 시장 대신 주차장이 목적지가 된다.

    출발 위치(04-C)에서는 안 거른다 — 거기서는 차를 세워둔 주차장이 실제 출발점일 수 있다.
    주차장을 찾아주는 화면은 따로 있다 (app/parking).
  */
  const 검색 = usePlaceSuggest(text);
  const found = 검색.found.filter((p) => !주차장(p));
  const full = musts.length >= MAX_MUSTS;
  /**
   * 목적지 검색 화면과 같은 목록 (data/spots.json 을 카테고리별로 한 바퀴씩 — recommendSpots 주석).
   *
   * **여덟 개까지만 보여준다.** recommendSpots 는 18개를 주는데 그건 목적지 화면 사정이다 —
   * 거기서는 최근 검색어와 겹치는 이름을 걷어내고도 여덟이 남아야 해서 넉넉히 받는다.
   * 여기는 걷어낼 게 없으므로 그대로 자른다. 열여덟 개를 다 깔면 칩이 다섯 줄이 되어
   * "몇 개 중에 고르는" 목록이 아니라 벽이 된다.
   */
  const [많이찾는곳, set많이찾는곳] = useState<string[]>([]);
  useEffect(() => {
    recommendSpots().then((names) => set많이찾는곳(names.slice(0, 8)));
  }, []);

  /**
   * 누르면 담고, 담긴 걸 다시 누르면 뺀다.
   * 담긴 것을 못 누르게 막아 뒀었는데, 잘못 누른 곳을 빼려면 화면을 나가서 04-E 의 × 를 찾아야 했다.
   * 검색 결과의 "담음" 버튼도 같은 함수를 쓴다 — 같은 목록을 만지는 자리가 둘이라 규칙도 하나여야 한다.
   */
  const toggle = (name: string) => {
    if (musts.includes(name)) return setMusts(musts.filter((n) => n !== name));
    if (!full) setMusts([...musts, name]);
  };

  /*
    TRIP-04-E-1 | 장소 검색 활성화.
    검색칸이 머리로 올라오고 화면 전체가 결과 목록이 된다 — 아래 버튼도 없다.
    담고 나면 ‹ 로 나가서 목록을 확인하고 적용한다 (그 버튼은 04-E 에 있다).
  */
  if (searching)
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <StatusBar tone="text-[#262626]" />

        <div className="mt-1 flex h-[60px] shrink-0 items-center gap-1 rounded-[30px] border border-[#ff7d32] bg-white mx-[18px] pr-2 pl-1">
          <button
            onClick={() => {
              setSearching(false);
              setText("");
            }}
            aria-label="검색 닫기"
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <img src="/icon-arrow-left.svg" alt="" className="size-5" />
          </button>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="제주 장소를 검색해 보세요"
            className="min-w-0 flex-1 text-[16px] leading-6 text-[#262626] outline-none placeholder:text-[#b8b2aa]"
          />
          {/* 글자가 있을 때만. 빈 칸에 ✕ 가 있으면 무엇을 지우라는 건지 알 수 없다 */}
          {text && (
            <button onClick={() => setText("")} aria-label="검색어 지우기" className="flex size-11 shrink-0 items-center justify-center text-[20px] text-[#7d7d7d]">
              ✕
            </button>
          )}
        </div>

        {/*
          **"검색 결과 0" 은 다 온 뒤에만 적는다.** 전에는 도는 중에도 0 이 떠서, 없다고 말해놓고
          잠시 뒤에 목록이 튀어나왔다. 못 물어본 경우도 갈라 말한다 — 네트워크가 죽었을 뿐인데
          0 이라고 적으면 앱이 거짓말을 한다 (usePlaceSuggest).
        */}
        {text.trim() && (
          <p className="mt-[16px] shrink-0 px-6 text-[14px] leading-[22px] whitespace-pre-line text-[#7d7d7d]">
            {검색.찾은말 !== text
              ? "검색 결과를 찾는 중…"
              : !검색.물어봤나
                ? "지금은 장소를 찾아볼 수 없어요.\n잠시 뒤에 다시 쳐보세요."
                : found.length
                  ? `검색 결과 ${found.length}`
                  : "이름을 조금 더 적어보세요."}
          </p>
        )}

        {/*
          아직 아무것도 안 친 칸. 목적지 검색 화면과 **같은 칩·같은 목록**이다
          (app/destination/page.tsx 의 "제주에서 많이 찾는 곳" — recommendSpots).
          빈 화면에 "검색해 보세요"만 두면 뭘 칠지 모르는 사람이 그대로 나간다.

          여기서는 누르면 **바로 담긴다.** 목적지 화면은 좌표·주소가 필요해 눌러도 검색으로
          한 번 더 가지만, 꼭 가고 싶은 곳은 이름만 들고 있다가 코스 만들 때 지오코딩한다
          (lib/course.ts gatherCandidates) — 여기서 다시 물을 이유가 없다.
        */}
        {!text.trim() && 많이찾는곳.length > 0 && (
          <div className="mt-[18px] shrink-0 px-6">
            <h2 className="text-[14px] leading-[22px] font-bold text-[#262626]">제주에서 많이 찾는 곳</h2>
            {/* 칩이라 줄바꿈으로 흐른다 — 이름 길이가 제각각이라(비자림 ↔ 제주민속오일시장) 격자로 두면 빈칸이 남는다 */}
            <div className="mt-[10px] flex flex-wrap gap-2">
              {많이찾는곳.map((name) => {
                const 담김 = musts.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggle(name)}
                    disabled={full && !담김}
                    className={`h-[32px] shrink-0 rounded-full border px-[13px] text-[13px] leading-none transition active:scale-95 disabled:active:scale-100 ${
                      담김
                        ? "border-[#ff7d32] bg-[#fff0e6] text-[#ff7d32]"
                        : "border-[#e5e0db] bg-white text-[#262626] hover:bg-[#fff0e6] disabled:opacity-40"
                    }`}
                  >
                    {/* ✓ 는 안 붙인다 — 테두리·바탕·글자색이 이미 담겼다고 말한다 (테마 타일과 같은 규칙) */}
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/*
          결과가 있든 없든 남는 자리를 다 먹는다(flex-1) — 그래야 아래 버튼이 다른 화면들처럼
          늘 폰 맨 밑에 선다. 칩 바로 밑에 붙여도 봤지만, 화면을 오갈 때마다 버튼이 위아래로
          튀어서 "적용하기"(04-E)와 같은 자리에 있는 게 낫다.
        */}
        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-[18px]">
          {found.map((p) => (
            <div key={`${p.label}${p.road}`} className="flex h-[70px] shrink-0 items-center gap-3 border-b border-[#f1efec] px-1.5">
              <span aria-hidden className="w-[26px] shrink-0 text-center text-[15px] text-[#b8b2aa]">
                ⌕
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] leading-6 font-medium text-[#262626]">{p.label}</span>
                <span className="block truncate text-[12px] leading-[18px] text-[#7d7d7d]">{p.road || p.jibun}</span>
              </span>
              <Add on={() => toggle(p.label)} added={musts.includes(p.label)} full={full} />
            </div>
          ))}
        </div>

        {/*
          **담고 나서 나가는 길.** 없을 때는 검색칸 왼쪽의 작은 ‹ 하나뿐이라 막다른 길로 읽혔다 —
          칩을 눌러 담으면 ✓ 로 바뀌기만 하고 다음에 뭘 해야 하는지가 화면에 없었다.

          여기서 바로 적용하지 않고 **목록 화면(04-E)으로 돌려보낸다**. 글자로 검색해 담은 곳은
          칩 목록에 없어서, 이 화면만 보면 지금까지 뭘 담았는지 알 수가 없다. 담은 걸 다 펼쳐
          보여주고 빼기(×)까지 되는 자리는 04-E 뿐이고, 진짜 "적용하기"도 거기 있다.

          하나도 안 담았으면 버튼 대신 안내 한 줄이다 — 확인할 게 없는데 버튼만 있으면 빈 채로 나간다.
        */}
        {/* 상한을 채우면 추가 버튼·칩이 다 흐려진다 — 왜인지 말해주지 않으면 고장으로 읽힌다 */}
        {full && (
          <p className="shrink-0 pb-2 text-center text-[11px] leading-[18px] text-[#7d7d7d]">
            한 번에 {MAX_MUSTS}곳까지 담을 수 있어요.
          </p>
        )}
        {musts.length > 0 ? (
          <button
            onClick={() => {
              setSearching(false);
              setText("");
            }}
            className="mx-6 mt-5 h-12 shrink-0 rounded-2xl bg-[#ff7d32] text-[16px] font-medium text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            선택한 {musts.length}곳 확인하기
          </button>
        ) : (
          <p className="shrink-0 py-4 text-center text-[11px] leading-[18px] text-[#7d7d7d]">
            {/* 칩만 떠 있을 때 "검색 결과를 눌러"라고 하면 누를 검색 결과가 화면에 없다 */}
            {text.trim() ? "검색 결과를 눌러 꼭 가고 싶은 곳에 추가하세요." : "많이 찾는 곳을 누르거나, 장소를 검색해 보세요."}
          </p>
        )}
        {/* 버튼 아래 67 — 다른 화면(Shell)과 같은 값이라 화면을 오갈 때 버튼이 안 튄다 (폰에서 줄이는 것도 같이) */}
        <div className="h-6 shrink-0 min-[480px]:h-[67px]" />
      </div>
    );

  return (
    <Detail
      name="꼭 가고 싶은 곳"
      title={["놓치고 싶지 않은", "장소를 추가해 주세요"]}
      subtitle={full ? `한 번에 ${MAX_MUSTS}곳까지 담을 수 있어요.` : "여러 장소를 계속 추가할 수 있어요."}
      onBack={onBack}
      label={musts.length ? `선택한 ${musts.length}곳 적용하기` : "건너뛰기"}
      onApply={() => onApply({ musts })}
    >
      <div className="px-[23px]">
        {/*
          입력칸이 아니라 **버튼이다** — 누르면 검색 화면(04-E-1)이 열린다.
          여기에 그대로 치게 두면 결과가 이 화면 아래에 끼어들어, 추천 장소와 검색 결과가
          한 화면에 섞인다 (메인화면 검색바가 목적지 화면을 여는 것과 같은 이유).
        */}
        <button
          onClick={() => setSearching(true)}
          className="flex h-[54px] w-full items-center rounded-2xl border border-[#eae7e2] bg-white px-[18px] text-left text-[14px] leading-[21px] text-[#7d7d7d] transition active:scale-[0.99] active:bg-[#fff0e6]"
        >
          제주 장소를 검색해 보세요
        </button>

        <p className="mt-7 text-[16px] leading-6 font-medium text-[#262626]">추가한 장소 {musts.length}</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {musts.length === 0 && <p className="text-[12px] leading-[18px] whitespace-pre-line text-[#7d7d7d]">{"아직 없어요.\n검색해서 담아보세요."}</p>}
          {musts.map((m) => (
            <button
              key={m}
              onClick={() => setMusts(musts.filter((x) => x !== m))}
              className="flex h-[42px] items-center gap-2 rounded-[21px] bg-[#fff0e6] px-4 text-[12px] leading-[18px] text-[#262626]"
            >
              {m}
              <span aria-label={`${m} 빼기`} className="text-[#7d7d7d]">
                ×
              </span>
            </button>
          ))}
        </div>
      </div>
    </Detail>
  );
}

/** "＋ 추가" 알약. 이미 담았으면 "담음"으로 굳고, 상한을 채우면 더 못 담는다 */
function Add({ on, added, full }: { on: () => void; added: boolean; full: boolean }) {
  return (
    <button
      onClick={on}
      // 담긴 것은 다시 눌러 뺀다 — 상한에 걸려 못 담는 것만 막는다
      disabled={full && !added}
      className={`h-[34px] w-[62px] shrink-0 rounded-[17px] text-[12px] leading-[18px] transition disabled:opacity-40 ${
        added ? "bg-[#fff0e6] text-[#262626]" : "border border-[#ff7d32] text-[#ff7d32]"
      }`}
    >
      {added ? "담음" : "추가"}
    </button>
  );
}

/* ─────────────────────────────── 공통 훅 ─────────────────────────────── */

/**
 * 타이핑이 멎으면 장소 후보를 받아온다 (출발 위치·꼭 가고 싶은 곳이 같이 쓴다).
 * 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때 먼저 보낸 긴 검색어의 결과가
 * 나중에 도착해 목록을 덮는다 (app/destination/page.tsx 와 같은 이유).
 */
function usePlaceSuggest(text: string) {
  const [found, setFound] = useState<Place[]>([]);
  /**
   * 지금 떠 있는 후보가 **어느 검색어의 결과인가**. null 이면 아직 안 왔다는 뜻이다.
   * 이게 없으면 "아직 안 옴"과 "찾아봤는데 없음"이 둘 다 빈 배열이라 화면이 못 가른다
   * (app/destination/page.tsx · app/route/PlaceSearch.tsx 와 같은 규칙·같은 이유).
   */
  const [찾은말, set찾은말] = useState<string | null>(null);
  /**
   * 그 검색어를 **물어보기는 했나**. false 면 목록이 빈 이유가 "제주에 없어서"가 아니라
   * 카카오에 못 물어봐서다 (../destination/actions.ts suggestPlaces).
   */
  const [물어봤나, set물어봤나] = useState(true);
  /** 마지막으로 결과가 나온 검색어와 그 목록. 치는 중에 붙들 근거다 (lib/geocode.ts 이어친목록) */
  const 앞결과 = useRef<{ 말: string; 목록: Place[] }>({ 말: "", 목록: [] });

  useEffect(() => {
    set찾은말(null); // 글자가 바뀌면 앞 결과는 이 검색어의 것이 아니다 — "찾는 중"으로 되돌린다
    if (!text.trim()) {
      앞결과.current = { 말: "", 목록: [] };
      return setFound([]);
    }

    let alive = true;
    const timer = setTimeout(() => {
      suggestPlaces(text).then((r) => {
        if (!alive) return;
        // 0건이어도 앞 검색어를 이어 친 것이면 붙든다 — 친 글자가 든 것만 남겨서 (이어친목록)
        const 목록 = r.places.length ? r.places : 이어친목록(앞결과.current, text);
        if (목록.length) 앞결과.current = { 말: text, 목록 };
        setFound(목록);
        set물어봤나(r.물어봤나);
        set찾은말(text);
      });
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);

  return { found, 찾은말, 물어봤나 };
}

type DetailProps = {
  plan: TripPlan;
  onBack: () => void;
  onApply: (patch: Partial<TripPlan>) => void;
};
