"use client";

// 주행 저장 — 와이어프레임 "주행 저장" 섹션 (Figma 2606:846).
// 프레임 다섯 장이지만 화면은 하나다.
//
// 들어오면 기록이 있느냐로 갈린다:
//   기록 없음 → SAFELOG-01 (2770:2050) — 귤이가 "지금까지의 주행 저장 기록이 없어요"
//   기록 있음 → SAFELOG-01 (2586:623) — 기록 목록
// 목록에서 경로 하나를 누르면 → SAFELOG-02 (2574:418) — 기록 상세
//
// **지금은 담긴 주행이 없어 빈 화면부터 뜬다.** 저장소가 아직 없어서다 (SAMPLE 주석).
// 등록을 누르면 그때 목록이 생긴다 — 새로고침하면 다시 빈 화면이다.
//
// 나머지 둘은 **방금 주행을 마치고 돌아왔을 때** 지나가는 화면이다 (?done=1):
//   SAFELOG-01 (2586:551) — 목록 위에 어둠막 + 귤이가 "이번 주행도 기록할까요?"
//   SAFELOG-01 (2574:358) — 등록 직후. 새 기록이 맨 위에 오고 그 아래가 "최근 이용한 길"로 갈린다
// 어둠막과 빈 화면은 같은 물음의 두 얼굴이다 — 기록이 있으면 목록 위에 덮고, 없으면 화면 전체가 그 물음이 된다.
//
// 메인화면(/home)의 "주행 저장" 칸으로 들어온다. 주행을 끝낸 화면에서 부를 때만 ?done=1 을 붙인다
// — 아직 그런 화면이 없어서 지금은 주소로 직접 열어야 어둠막을 지나갈 수 있다.
//
// 세로 배치는 좌표가 아니라 흐름으로 쌓는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어
// 절대배치를 하면 그때 아래쪽이 프레임 밖으로 나간다 (app/home/page.tsx 와 같은 이유).

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";

/**
 * 기록 한 건.
 *
 * badge 는 점수 배지의 **배경색**이다. 값에서 뽑지 않고 그대로 들고 다닌다 —
 * 와이어프레임이 한 건만 초록(#e5f5e5)이고 나머지 셋은 살구(#fff0e5)인데 숫자와 아무 관계가
 * 없다. 규칙이 없는 걸 규칙으로 만들면 다음 사람이 그 규칙을 믿는다.
 *
 * score 는 lib/score.ts 와 같은 **추천점수**다 — 높을수록 좋다. 여기 값은 아직 목업이라
 * 와이어프레임의 부담 34·41·36·32 를 100 에서 뺀 것이다.
 */
type SafeRoute = {
  date: string;
  /** "출발 → 도착". 상세 화면의 지도 양끝 이름도 여기서 갈라 쓴다 */
  title: string;
  /** 즐겨찾기에 담아둔 기록인가 — 카드 오른쪽 위 별이 차고 주황으로 바뀐다 */
  starred: boolean;
  score: number;
  badge: string;
  minutes: number;
  km: number;
  /** 빠른 길보다 몇 분 더 걸렸나 (상세에만 나온다) */
  slower: number;
  parking: string;
  review: string;
  /** 왜 안심 길이었나 — 상세의 네 줄. 라벨은 네 건이 같고 값만 다르다 */
  reasons: [string, string, string, string];
  /** 주차장 한 줄평 */
  parkingTags: string;
};

const REASON_LABELS = ["비보호 좌회전 · 유턴", "좁은 교행 구간", "급커브", "사고 잦은 곳"];

/**
 * 와이어프레임 목록에 그려진 네 건.
 *
 * **처음부터 깔아두지 않는다.** 저장소가 없어서 지금 이 앱에는 담긴 주행이 하나도 없고,
 * 없는데 있는 척 네 건을 채워두면 화면이 거짓말을 한다 (메인화면 "여행 기록"과 같은 규칙).
 * 그래서 빈 화면으로 시작하고, 등록을 누를 때 방금 담은 한 건과 함께 예전 기록으로 딸려 온다 —
 * 목록·"최근 이용한 길"·상세를 그때 볼 수 있어야 해서다.
 */
const SAMPLE: SafeRoute[] = [
  {
    date: "2026.08.12",
    title: "애월해안도로 → 협재",
    starred: true,
    score: 66,
    badge: "#e5f5e5",
    minutes: 38,
    km: 24,
    slower: 6,
    parking: "협재해수욕장 공영주차장",
    review: "좋았어요",
    reasons: ["2번", "5%", "4곳", "없음"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
  {
    date: "2026.07.28",
    title: "성산일출봉 → 함덕",
    starred: false,
    score: 59,
    badge: "#fff0e5",
    minutes: 56,
    km: 38,
    slower: 9,
    parking: "함덕해수욕장 주차장",
    review: "좋았어요",
    reasons: ["3번", "8%", "6곳", "1곳"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
  {
    date: "2026.07.20",
    title: "중문관광단지 → 산방산",
    starred: true,
    score: 64,
    badge: "#fff0e5",
    minutes: 44,
    km: 27,
    slower: 5,
    parking: "산방산 공영주차장",
    review: "여유로웠어요",
    reasons: ["2번", "6%", "5곳", "없음"],
    parkingTags: "칸 넓음 · 지상 · 초보에게 편해요",
  },
  {
    date: "2026.07.11",
    title: "표선해수욕장 → 성산항",
    starred: false,
    score: 68,
    badge: "#fff0e5",
    minutes: 35,
    km: 29,
    slower: 4,
    parking: "성산항 공영주차장",
    review: "진입이 쉬워요",
    reasons: ["1번", "4%", "3곳", "없음"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
];

/** 방금 끝난 주행. 저장할지 묻는 대상이고, 등록하면 목록 맨 위로 간다 (와이어프레임 2586:568) */
const PENDING: SafeRoute = {
  date: "2026.08.14",
  title: "제주공항 → 서귀포 칼호텔",
  starred: true,
  score: 72,
  badge: "#e5f5e5",
  minutes: 42,
  km: 31,
  slower: 7,
  parking: "서귀포 칼호텔 주차장",
  review: "좋았어요",
  reasons: ["1번", "3%", "3곳", "없음"],
  parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
};

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function RecordPage() {
  return (
    <Suspense>
      <Record />
    </Suspense>
  );
}

function Record() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /** 담긴 주행. 아직 저장소가 없으니 **빈 채로 시작한다** (SAMPLE 주석) */
  const [routes, setRoutes] = useState<SafeRoute[]>([]);
  /**
   * 방금 끝난 주행을 저장할지 묻는 중.
   * 주행을 마치고 온 사람에게만 묻는다 — 기록을 보러 들어온 사람에게 저장하겠냐고 물으면
   * 목록을 가린 어둠막부터 치워야 화면을 볼 수 있다.
   */
  const [asking, setAsking] = useState(searchParams.get("done") === "1");
  /** 등록한 직후인가 — 새 기록과 예전 기록 사이에 "최근 이용한 길"이 끼는 건 이때뿐이다 (2574:358) */
  const [added, setAdded] = useState(false);
  /** 펼쳐 본 기록. 있으면 상세 화면이다 (2574:418) */
  const [open, setOpen] = useState<SafeRoute | null>(null);

  const home = () => router.push(`/home?${searchParams}`);

  function register() {
    setRoutes([PENDING, ...SAMPLE]);
    setAdded(true);
    setAsking(false);
  }

  if (open) return <Detail route={open} onBack={() => setOpen(null)} />;

  return (
    /*
      묻는 동안에는 화면을 폰 높이에 딱 맞춰 자른다 (min-h-0 + overflow-hidden).
      어둠막이 absolute inset-0 로 이 상자를 덮는데, 안 자르면 상자가 목록 길이(880+)만큼 자라서
      막이 폰 밖으로 흘러내리고 버튼도 화면 아래로 밀려난다. 어차피 물음에 답하기 전엔 못 넘긴다.
    */
    <div className={`relative flex flex-1 flex-col bg-white pb-[19px] ${asking ? "min-h-0 overflow-hidden" : ""}`}>
      <StatusBar tone="text-[#1f1f1f]" />
      <Header onBack={home} right={<span className="text-[20px] leading-none text-[#6e6e6e]">⌕</span>} />

      <Summary routes={routes} />

      {/* Tab / 전체. 와이어프레임에 칩이 이 하나뿐이라 고를 것이 없다 — 지금 무엇을 보고 있는지 알리는 표시다 */}
      <div className="mt-[11px] ml-[24px] flex h-[34px] w-[92px] shrink-0 items-center justify-center rounded-[17px] bg-[#ff5914]">
        <span className="text-[11px] leading-none font-medium text-white">전체</span>
      </div>

      {routes.length === 0 ? (
        /*
          기록이 0건 (2770:2050). 목록 자리에 귤이가 들어서고 아래에 버튼 둘이 붙는다 —
          어둠막(2586:551)과 같은 물음이라 버튼도 같은 것을 쓴다.
        */
        <div className="flex flex-1 flex-col px-[24px]">
          <div className="flex flex-1 flex-col items-center justify-center">
            <img src="/safelog/character-empty.png" alt="" className="h-[158px] w-[170px] object-contain" />
            <p className="mt-[14px] text-center text-[15px] leading-[22px] font-medium text-[#6e6e6e]">
              지금까지의
              <br />
              주행 저장 기록이 없어요
            </p>
          </div>
          <AskButtons register="주행 저장 등록하러 가기" onRegister={register} onLater={home} />
        </div>
      ) : (
        <div className="mt-[23px] flex flex-col gap-[11px] px-[24px]">
          {routes.map((route, i) => (
            <div key={route.title} className="contents">
              {/*
                등록 직후에만 첫 기록과 나머지가 갈린다 (2574:358). 평소 목록은 한 덩어리다 (2586:623) —
                방금 넣은 것과 예전 것을 구분해줘야 할 때만 줄을 긋는다.
              */}
              {added && i === 1 && (
                <h2 className="mt-[19px] mb-[6px] text-[17px] leading-[20px] font-bold text-[#1f1f1f]">
                  최근 이용한 길
                </h2>
              )}
              <RouteCard route={route} onOpen={() => setOpen(route)} />
            </div>
          ))}
        </div>
      )}

      {/*
        2586:551 — 목록 위에 어둠막을 덮고 묻는다.
        기록이 0건이면 위쪽 빈 화면이 이미 같은 물음이라 여기서는 안 덮는다.
      */}
      {asking && routes.length > 0 && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/[0.49] px-[24px] pb-[20px]">
          {/*
            귤이와 말풍선은 가운데가 아니라 **버튼에서 101px 위**에 앉는다 — 와이어프레임에서
            풍선 아래(616)와 버튼 위(717) 사이가 그만큼이다. 가운데 정렬로 두면 폰이 880 보다
            낮은 만큼 통째로 위로 뜬다 (실제로 100px 넘게 떴다).
          */}
          <div className="flex flex-1 flex-col items-center justify-end pb-[101px]">
            <img src="/safelog/character-ask.png" alt="" className="h-[160px] w-[202px] object-contain" />
            {/*
              말풍선. 꼬리가 풍선 위에 얹혀 귤이를 가리킨다 — 와이어프레임에서 꼬리는 가운데가 아니라
              왼쪽으로 치우쳐 있다 (풍선 왼끝에서 133px). -mb-px 는 꼬리와 풍선 사이 실틈을 지운다.
            */}
            <img
              src="/safelog/bubble-tail.svg"
              alt=""
              className="mt-[18px] -mb-px h-[24px] w-[19px] self-start ml-[155px]"
            />
            <div className="w-[300px] rounded-[20px] bg-[#fff0e6] pt-[8px] pb-[9px]">
              <p className="text-center text-[12.667px] leading-[19px] font-medium tracking-[-0.1267px] text-[#ff5914]">
                제주공항 &nbsp;→&nbsp; 서귀포 칼호텔
              </p>
              <p className="mt-[2px] text-center text-[16px] leading-[24px] font-medium tracking-[-0.16px] text-[#262626]">
                이번 주행도 기록할까요?
              </p>
            </div>
          </div>
          <AskButtons register="안심 길 기록에 등록하기" onRegister={register} onLater={() => setAsking(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * 앱바. 제목이 화면 한가운데라 좌우 버튼과 같은 줄에 못 놓는다 —
 * 제목만 절대배치로 띄우고 버튼은 양끝에 둔다 (제목 길이가 가운데를 밀지 않게).
 */
function Header({ onBack, right }: { onBack: () => void; right: React.ReactNode }) {
  return (
    <div className="relative flex h-[52px] shrink-0 items-center justify-between px-[10px]">
      <button onClick={onBack} aria-label="뒤로" className="z-10 flex size-11 items-center justify-center">
        <img src="/icon-arrow-left.svg" alt="" className="size-6" />
      </button>
      <h1 className="pointer-events-none absolute inset-x-0 text-center text-[20px] leading-[24px] font-bold text-[#1f1f1f]">
        주행 저장
      </h1>
      {/* ⌕ · ••• — 와이어프레임에 자리만 잡혀 있고 갈 곳이 없다. 눌리는 척은 안 시킨다 */}
      <span aria-hidden className="flex size-11 items-center justify-center">
        {right}
      </span>
    </div>
  );
}

/**
 * Route History Summary — 이용 횟수 · 이동 거리 · 평균 추천점수.
 *
 * 세 값 다 목록에서 뽑는다. 와이어프레임은 4건에 214km · 31점이라 적었지만 카드에 적힌
 * 24+38+27+29 는 118km 이고, 기록을 하나 더해도 214km 가 그대로다 — 채워 넣은 숫자다.
 * 0건 프레임이 0회 · 0km · 0점인 걸 보면 원래 세려던 값이 맞고, 카드와 어긋나는 총합을
 * 화면에 박아두면 시연 중에 누가 더해본다.
 */
function Summary({ routes }: { routes: SafeRoute[] }) {
  const km = routes.reduce((sum, r) => sum + r.km, 0);
  const score = routes.length ? Math.round(routes.reduce((sum, r) => sum + r.score, 0) / routes.length) : 0;

  return (
    <div className="mt-[30px] mx-[24px] h-[92px] shrink-0 rounded-[17px] px-[16px] pt-[13px]">
      <p className="text-[11px] leading-none font-medium text-[#ff5914]">귤이와 함께 달린 안심 길</p>
      <div className="mt-[14px] flex gap-[10px]">
        <Stat value={`${routes.length}회`} label="이용" />
        <Stat value={`${km}km`} label="이동" />
        <Stat value={`${score}점`} label="평균 추천점수" />
      </div>
    </div>
  );
}

/** 요약 한 칸. 셋이 94px 씩 10px 씩 띄워 앉는다 (와이어프레임 x 16 · 120 · 224) */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="w-[94px] text-center">
      <p className="text-[17px] leading-[20px] font-bold text-[#1f1f1f]">{value}</p>
      <p className="mt-[6px] text-[9px] leading-none text-[#6e6e6e]">{label}</p>
    </div>
  );
}

/** Safe Route Record — 목록 카드. 누르면 상세로 간다 */
function RouteCard({ route, onOpen }: { route: SafeRoute; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="h-[142px] shrink-0 rounded-[16px] border border-[#e5e0db] bg-white px-[15px] pt-[12px] text-left transition active:scale-[0.98]"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] leading-none text-[#6e6e6e]">{route.date}</span>
        {/*
          ★ 즐겨찾기 · ⇧ 공유. 와이어프레임에 그려진 상태 그대로 보여주기만 한다 —
          담고 빼는 문은 아직 없고, 이 화면에서 누를 수 있는 건 카드뿐이다.
          (와이어프레임은 중문 카드만 별을 채워놓고 회색으로 뒀는데, 담아둔 별을 회색으로 두면
           안 담은 것과 구별이 안 된다. 상세의 "★ 즐겨찾기 저장됨"과 같은 주황으로 맞춘다.)
        */}
        <span
          aria-hidden
          className={`-mt-[1px] text-[17px] leading-none font-medium ${route.starred ? "text-[#ff5914]" : "text-[#6e6e6e]"}`}
        >
          {route.starred ? "★" : "☆"}&nbsp;&nbsp;&nbsp;⇧
        </span>
      </div>

      <p className="mt-[11px] text-[16px] leading-[19px] font-bold text-[#1f1f1f]">{route.title}</p>

      <div className="mt-[11px] flex items-center">
        <span
          className="flex h-[30px] w-[84px] items-center justify-center rounded-[15px] text-[10px] leading-none font-medium text-[#42a861]"
          style={{ background: route.badge }}
        >
          추천 {route.score} · 높음
        </span>
        <span className="ml-[12px] text-[10px] leading-none text-[#6e6e6e]">
          {route.minutes}분 · {route.km}km
        </span>
      </div>

      {/* Parking Used — 그 주행에서 댄 주차장과 한 줄평 */}
      <div className="mt-[10px] flex h-[26px] w-[310px] items-center justify-between rounded-[13px] bg-[#f0f5f0] px-[10px] text-[10px] leading-none font-medium">
        <span className="truncate text-[#6e6e6e]">P&nbsp;&nbsp;{route.parking}</span>
        <span className="shrink-0 pl-[8px] text-[#42a861]">{route.review}&nbsp;&nbsp;›</span>
      </div>
    </button>
  );
}

/** 어둠막(2586:551)과 빈 화면(2770:2050)이 같이 쓰는 버튼 둘. 위는 등록, 아래는 미루기 */
function AskButtons({
  register,
  onRegister,
  onLater,
}: {
  register: string;
  onRegister: () => void;
  onLater: () => void;
}) {
  return (
    <div className="shrink-0">
      <button
        onClick={onRegister}
        className="h-[52px] w-full rounded-[26px] bg-[#ff5914] text-[15px] font-bold text-white transition active:scale-[0.98]"
      >
        {register}
      </button>
      <button
        onClick={onLater}
        className="mt-[12px] h-[46px] w-full rounded-[23px] border border-[#e5e0db] bg-white text-[13px] font-medium text-[#6e6e6e] transition active:scale-[0.98]"
      >
        나중에 할게요
      </button>
    </div>
  );
}

/**
 * SAFELOG-02 — 기록 상세 (2574:418).
 *
 * 지도는 그림 한 장이다 (public/safelog/route-path.svg). 와이어프레임이 그린 것도 실제 경로가 아니라
 * "이런 길을 달렸다"는 곡선 하나라, 진짜 지도를 띄우려면 저장된 좌표가 있어야 하는데 아직 없다.
 * ponytail: 기록에 경로 좌표가 붙으면 RouteMap 으로 바꾼다.
 */
function Detail({ route, onBack }: { route: SafeRoute; onBack: () => void }) {
  const [start, end] = route.title.split(" → ");

  return (
    <div className="flex flex-1 flex-col bg-white pb-[20px]">
      <StatusBar tone="text-[#1f1f1f]" />
      <Header onBack={onBack} right={<span className="text-[18px] leading-none font-bold text-[#6e6e6e]">•••</span>} />

      {/* Record Header — 날짜 · 경로 · 소요, 오른쪽에 추천점수 */}
      <div className="mt-[21px] mx-[24px] flex h-[104px] shrink-0 items-start justify-between rounded-[17px] px-[16px] pt-[12px]">
        <div>
          <p className="text-[10px] leading-none text-[#6e6e6e]">{route.date} · 완료된 경로</p>
          <p className="mt-[12px] text-[17px] leading-[20px] font-bold text-[#1f1f1f]">{route.title}</p>
          <p className="mt-[8px] text-[10px] leading-none text-[#6e6e6e]">
            {route.minutes}분 · {route.km}km · 빠른 길보다 {route.slower}분 더
          </p>
        </div>
        <div className="mt-[14px] w-[56px] shrink-0 text-center text-[#ff5914]">
          <p className="text-[22px] leading-[26px] font-bold">{route.score}</p>
          <p className="mt-[1px] text-[9px] leading-none font-medium">높음</p>
        </div>
      </div>

      {/* Record Action Bar — 반씩 나눠 쓰는 두 칸. 갈 곳이 정해진 게 없어 표시만 한다 */}
      <div
        aria-hidden
        className="mt-[9px] mx-[24px] flex h-[54px] shrink-0 items-center rounded-[15px] border border-[#e5e0db] bg-white text-[12px] leading-none font-medium"
      >
        <span className="flex-1 text-center text-[#ff5914]">★&nbsp;&nbsp;즐겨찾기 저장됨</span>
        <span className="h-[34px] w-px bg-[#e5e0db]" />
        <span className="flex-1 text-center text-[#1f1f1f]">⇧&nbsp;&nbsp;기록 공유</span>
      </div>

      {/* Route Map Preview */}
      <div className="mt-[26px] mx-[24px] h-[253px] shrink-0 rounded-[16px] bg-[#f0f5f0] px-[16px] pt-[14px]">
        <p className="text-[10px] leading-none font-medium text-[#42a861]">● {start}</p>
        <img src="/safelog/route-path.svg" alt="" className="mt-[10px] ml-[4px] h-[72px] w-[300px]" />
        {/* 도착 이름은 길 끝 점 바로 옆에 붙는다 — 음수 마진으로 그림 위로 12px 올린다 (와이어프레임 y94) */}
        <p className="-mt-[12px] text-right text-[10px] leading-none font-medium text-[#db403b]">● {end}</p>
      </div>

      <h2 className="mt-[19px] mx-[24px] shrink-0 text-[17px] leading-[20px] font-bold text-[#1f1f1f]">
        왜 안심 길이었나요?
      </h2>

      {/* Burden Reasons — 점수를 깎은 네 가지 */}
      {/* 위아래 여백이 다르다 (3 / 13). 줄 넷이 28px 씩이라 이렇게 해야 상자가 와이어프레임의 128 이 된다 */}
      <div className="mt-[22px] mx-[24px] shrink-0 rounded-[16px] border border-[#e5e0db] bg-white px-[15px] pt-[3px] pb-[13px]">
        {REASON_LABELS.map((label, i) => (
          <div
            key={label}
            className="flex h-[28px] items-center justify-between border-t border-[#e5e0db] first:border-t-0"
          >
            <span className="text-[11px] leading-none text-[#6e6e6e]">{label}</span>
            <span className="text-[12px] leading-none font-bold text-[#ff5914]">{route.reasons[i]}</span>
          </div>
        ))}
      </div>

      {/* Parking Review — 목록 카드의 P 줄을 펼친 것 */}
      <div className="mt-[16px] mx-[24px] h-[82px] shrink-0 rounded-[16px] border border-[#e5e0db] bg-white px-[15px] pt-[10px]">
        <p className="text-[10px] leading-none text-[#6e6e6e]">이용한 주차장</p>
        <p className="mt-[10px] text-[14px] leading-[17px] font-medium text-[#1f1f1f]">{route.parking}</p>
        <p className="mt-[7px] text-[10px] leading-none text-[#ff5914]">{route.parkingTags}</p>
      </div>
    </div>
  );
}
