"use client";

// 주행 저장 — 와이어프레임 "주행 저장" 섹션 (Figma 2606:846).
// 프레임 여섯 장이지만 화면은 둘이다 — 목록과 상세.
//
// 목록 (SAFELOG-01-A)은 탭 둘로 갈린다:
//   전체 (3423:527) — 담긴 주행 전부
//   나만의 길 (3678:2014) — 그중 "나만의 길"로 저장해둔 것만
// 카드를 누르면 그 자리에서 펼쳐진다 (3713:2542 · 3794:2697) — 주차장 줄이 버튼 둘로 바뀌고,
// 이미 나만의 길인 카드는 "자세히" 하나만 남는다. 자세히를 누르면 상세 (2574:418)로 간다.
// 담긴 게 하나도 없으면 목록 자리에 귤이가 들어선다 (2770:2050).
//
// **묻지 않는다.** 예전 와이어프레임에는 주행을 마치고 오면 목록 위에 어둠막을 덮고
// "이번 주행도 기록할까요?"를 묻는 흐름(?done=1)이 있었는데, 지금 디자인에서 빠졌다 —
// 빈 화면이 "주행을 하면 자동으로 등록됩니다"라고 말한다. 등록은 사람이 누르는 일이 아니다.
// 그래서 여기서 사람이 할 수 있는 건 빼기(✕)와 나만의 길로 담기 둘뿐이다.
//
// 메인화면(/home)의 "주행 저장" 칸으로 들어온다.
//
// 세로 배치는 좌표가 아니라 흐름으로 쌓는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어
// 절대배치를 하면 그때 아래쪽이 프레임 밖으로 나간다 (app/home/page.tsx 와 같은 이유).

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng } from "../RouteMap";

/**
 * 기록 한 건.
 *
 * 거리·시간·경로·"왜 안심 길이었나요?" 네 줄은 **실제 값이다** — 카카오 길찾기로 경로를 받고
 * lib/analyze.ts 에 표준노드링크(data/jeju-link.json)를 물려 계산했다.
 *
 * score 만 아직 목업이다 (와이어프레임의 부담 34·41 을 100 에서 뺀 값). 진짜 주행이 담기면
 * 이 화면이 지어내는 게 아니라 **길 비교 화면과 같은 엔진이 낸 추천점수**가 그대로 들어온다 —
 * risksOf(analyze(경로)) 로 위험요인을 뽑고 burdenOf 로 부담을 매긴 뒤 100 에서 뒤집은 값이다
 * (lib/score.ts). 경로 하나만으로 계산된다 — 후보끼리 견주는 scoreRoutes 는 셋 중 무엇을
 * "안심 길" 자리에 앉힐지 고르는 함수지 점수를 만드는 함수가 아니다.
 *
 * 같은 길도 프로필에 따라 점수가 다르지만(초보는 급커브 가중치가 크다), **점수는 주행 당시
 * 값으로 굳혀 저장한다** — 열 때마다 다시 계산하면 프로필을 바꿨다고 작년에 달린 길이 갑자기
 * 편해졌다고 말하는 화면이 된다. 분·km·주차장이 다 그날 값인데 점수만 오늘 값일 이유가 없다.
 * "지금의 나에게 이 길이 어떤가"는 다시 달릴 때 길 비교 화면이 새로 계산해 답한다.
 * ponytail: 저장소가 붙으면 이 목업 값을 지운다.
 */
type SafeRoute = {
  date: string;
  /** "출발 → 도착". 상세 화면의 지도 양끝 이름도 여기서 갈라 쓴다 */
  title: string;
  /** "나만의 길"에 담아둔 기록인가 — 두 번째 탭은 이것만 추린다 */
  mine: boolean;
  score: number;
  minutes: number;
  km: number;
  /** 빠른 길보다 몇 분 더 걸렸나 (상세에만 나온다) */
  slower: number;
  /**
   * 그 주행에서 실제로 달린 길. 상세 화면 지도가 이걸 그린다.
   * 카카오 길찾기가 준 좌표열을 40점으로 솎은 것이다 (원본은 400~700점) —
   * 342px 짜리 카드 안 지도라 그보다 촘촘해도 눈에 안 보이고 파일만 길어진다.
   */
  path: LatLng[];
  parking: string;
  /** 왜 안심 길이었나 — 상세의 네 줄. 라벨은 네 건이 같고 값만 다르다 */
  reasons: [string, string, string, string];
  /** 주차장 한 줄평 (상세에만 나온다) */
  parkingTags: string;
};

const REASON_LABELS = ["비보호 좌회전 · 유턴", "좁은 교행 구간", "급커브", "사고 잦은 곳"];

/**
 * 추천점수 배지 바탕색 — 30 이하 · 60 이하 · 그 위 세 칸이다.
 *
 * 색을 기록에 들고 다니지 않는다. 색과 숫자가 따로 놀면 다음 사람이 색을 보고 점수를 짐작한다.
 * 높음·보통·낮음 같은 말은 안 붙인다 — 숫자와 색이 이미 그 말을 하고 있다.
 */
const badgeColor = (score: number) =>
  score <= 30 ? "#fff0e5" : score <= 60 ? "#e5f5e5" : "#e5eaf5";

/**
 * 상세 지도의 출발·도착 점. 흰 테두리를 둘러야 지도 위 어느 색 위에서도 점이 점으로 보인다
 * (와이어프레임의 ● 두 개와 같은 색이다).
 */
const dot = (color: string) => ({
  src: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="5" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`,
  )}`,
  size: [14, 14] as [number, number],
});

/**
 * 와이어프레임 목록에 그려진 네 건.
 *
 * **깔아두지 않는다.** 저장소가 없어서 이 앱에 담긴 주행은 하나도 없고, 없는데 있는 척
 * 네 건을 채워두면 화면이 거짓말을 한다 (메인화면 "여행 기록"과 같은 규칙). 그래서 들어오면
 * 빈 화면(2770:2050)이 뜬다 — 지금 상태를 그대로 말하는 화면이다.
 *
 * 목록·탭·카드·상세는 그러면 열 길이 없어져서, 시연용으로 `?demo=1` 일 때만 이 둘이 담긴다.
 * ponytail: 주행이 끝나면 진짜로 담기게 되는 날 이 상수와 demo 갈래를 같이 지운다.
 *
 * **둘 다 mine 이 아니다.** 와이어프레임 "나만의 길" 탭에는 이 둘이 그려져 있지만, 같은 애월 카드를
 * "전체"에서 펼친 프레임(3713:2556)에는 [자세히][나만의 길의 저장] 두 버튼이 다 떠 있다 —
 * 아직 안 담긴 상태다. 둘을 다 만족시킬 수는 없어서 안 담긴 쪽으로 맞췄다. 나만의 길 탭은
 * 비어 있다가 저장을 누르면 채워진다.
 */
const SAMPLE: SafeRoute[] = [
  {
    date: "2026.08.12",
    title: "애월해안도로 → 협재",
    mine: false,
    score: 66,
    minutes: 28,
    km: 19,
    slower: 0,
    // 애월해안도로 → 협재해수욕장 (카카오 추천 경로 18.7km)
    path: [[33.47812,126.36867],[33.47813,126.3649],[33.4752,126.36525],[33.47353,126.36388],[33.47094,126.36616],[33.46819,126.35993],[33.46701,126.35287],[33.46555,126.34699],[33.46311,126.33995],[33.46247,126.33495],[33.46267,126.33098],[33.46263,126.32882],[33.46202,126.32534],[33.46137,126.32179],[33.46001,126.31435],[33.45844,126.31075],[33.45361,126.30896],[33.44957,126.30857],[33.44767,126.30683],[33.44517,126.3035],[33.44435,126.29955],[33.44347,126.29301],[33.44189,126.28919],[33.44013,126.2835],[33.43771,126.27978],[33.43336,126.27684],[33.42739,126.27736],[33.42388,126.27789],[33.42127,126.278],[33.41673,126.27673],[33.41209,126.27521],[33.40911,126.27363],[33.40452,126.26907],[33.39951,126.2647],[33.39632,126.26053],[33.39373,126.25645],[33.39591,126.2457],[33.3955,126.24259],[33.39312,126.24006],[33.3935,126.23934]],
    parking: "협재해수욕장 공영주차장",
    reasons: ["확인 안 됨", "20%", "10곳", "확인 안 됨"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
  {
    date: "2026.07.28",
    title: "성산일출봉 → 함덕",
    mine: false,
    score: 59,
    minutes: 48,
    km: 31,
    slower: 0,
    // 성산일출봉 → 함덕해수욕장 (카카오 추천 경로 30.9km)
    path: [[33.46221,126.93754],[33.46406,126.93414],[33.46649,126.93018],[33.46857,126.9289],[33.46874,126.92798],[33.46877,126.91973],[33.46547,126.90886],[33.47056,126.90281],[33.47928,126.8982],[33.48924,126.89674],[33.49361,126.89349],[33.49946,126.88623],[33.50512,126.87928],[33.51293,126.86796],[33.51514,126.86512],[33.5183,126.86132],[33.52036,126.85698],[33.52299,126.85233],[33.52536,126.848],[33.52909,126.83943],[33.53908,126.82654],[33.54221,126.81659],[33.54599,126.80441],[33.55038,126.79594],[33.55228,126.78677],[33.54956,126.779],[33.5516,126.76727],[33.55105,126.75231],[33.55117,126.74655],[33.55343,126.7398],[33.55605,126.73078],[33.55212,126.71562],[33.55186,126.70915],[33.55227,126.70364],[33.54812,126.69541],[33.5453,126.68843],[33.54115,126.68099],[33.54005,126.6742],[33.54102,126.66936],[33.54262,126.66924]],
    parking: "함덕해수욕장 주차장",
    reasons: ["확인 안 됨", "22%", "7곳", "확인 안 됨"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
];

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function SafelogPage() {
  return (
    <Suspense>
      <Safelog />
    </Suspense>
  );
}

function Safelog() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /** 담긴 주행. 아직 저장소가 없어 **빈 채로 시작한다** (SAMPLE 주석) */
  const [routes, setRoutes] = useState<SafeRoute[]>(
    searchParams.get("demo") === "1" ? SAMPLE : [],
  );
  /** 보고 있는 탭 */
  const [mineOnly, setMineOnly] = useState(false);
  /** 펼쳐 본 카드의 제목. 한 번에 하나만 펼친다 (와이어프레임 3713:2542) */
  const [open, setOpen] = useState<string | null>(null);
  /** 자세히로 들어간 기록. 있으면 상세 화면이다 (2574:418) */
  const [detail, setDetail] = useState<SafeRoute | null>(null);

  const shown = mineOnly ? routes.filter((r) => r.mine) : routes;

  if (detail) return <Detail route={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="flex flex-1 flex-col bg-white pb-[19px]">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        앱바. 제목이 화면 한가운데라 좌우 버튼과 같은 줄에 못 놓는다 —
        제목만 절대배치로 띄우고 버튼은 양끝에 둔다 (제목 길이가 가운데를 밀지 않게).
      */}
      <Header
        onBack={() => router.push(`/home?${searchParams}`)}
        right={<span className="text-[20px] leading-none text-[#6e6e6e]">⌕</span>}
      />

      <Summary routes={shown} />

      {/*
        Tab / 전체 · 나만의 길 (3423:540 · 3678:2011).
        칩 둘이 나란한 게 아니라 **겹쳐** 있다 — 와이어프레임에서 전체는 x16, 나만의 길은 x78 인데
        폭이 각각 92 다. 그래서 옅은 주황 알약 하나 위로 주황 덩어리가 좌우로 미끄러지는 모양이 된다.
        떼어 놓고 그리면 버튼 두 개가 되고, 붙여 놔야 지금 어느 쪽인지가 한눈에 읽힌다.

        겹침은 와이어프레임의 30 이 아니라 16 이다. 글자가 둘 다 흰색이라 30 으로 두면 **안 고른 쪽
        글자 앞머리가 주황 덩어리에 9px 걸친다** — 흰 글자가 주황과 살구를 반씩 깔고 앉아 깨져 보인다.
        16 이면 어느 쪽을 골라도 글자가 한 바탕 위에만 놓이고, 고른 쪽 글자는 덩어리 한가운데에 온다.

        담긴 게 하나도 없으면 "전체" 하나만 남는다 (빈 화면 프레임 2770:2050) — 갈 곳이 없는데
        칸이 둘이면 저쪽엔 뭐가 있나 싶어 눌러보게 된다. 그때는 알약도 92 로 줄어든다.
      */}
      <div
        className={`relative mt-[11px] ml-[24px] h-[34px] shrink-0 rounded-[17px] bg-[#ffcfbc] ${
          routes.length > 0 ? "w-[168px]" : "w-[92px]"
        }`}
      >
        {/* 고른 쪽을 덮는 주황 덩어리. 76px 을 미끄러진다 (칩 폭 92 - 겹침 16) */}
        <span
          aria-hidden
          className={`absolute top-0 left-0 h-[34px] w-[92px] rounded-[17px] bg-[#ff5914] transition-transform duration-200 ${
            mineOnly ? "translate-x-[76px]" : "translate-x-0"
          }`}
        />
        <Tab label="전체" left={0} on={!mineOnly} onClick={() => setMineOnly(false)} />
        {routes.length > 0 && (
          <Tab label="나만의 길" left={76} on={mineOnly} onClick={() => setMineOnly(true)} />
        )}
      </div>

      {shown.length === 0 ? (
        <Empty mineOnly={mineOnly} />
      ) : (
        <div className="mt-[23px] flex flex-col gap-[11px] px-[24px]">
          {shown.map((route) => (
            <RouteCard
              key={route.title}
              route={route}
              open={open === route.title}
              onToggle={() => setOpen(open === route.title ? null : route.title)}
              onRemove={() => setRoutes(routes.filter((r) => r !== route))}
              onSaveMine={() =>
                setRoutes(routes.map((r) => (r === route ? { ...r, mine: true } : r)))
              }
              onDetail={() => setDetail(route)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
 * 탭 하나. 바탕은 위 알약과 미끄러지는 덩어리가 다 그리고, 여기는 글자와 누를 자리만 맡는다.
 * 둘 다 92px 이라 글자 길이와 상관없이 가운데가 맞는다.
 */
function Tab({
  label,
  left,
  on,
  onClick,
}: {
  label: string;
  left: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{ left }}
      className="absolute top-0 z-10 h-[34px] w-[92px] text-[11px] leading-none font-medium text-white"
    >
      {label}
    </button>
  );
}

/**
 * Route History Summary — 이용 횟수 · 이동 거리. 가운데 세로줄이 둘을 가른다.
 *
 * 둘 다 **보고 있는 목록**에서 뽑는다. 와이어프레임은 4건에 214km 라 적었지만 카드에 적힌
 * 24+38+27+29 는 118km 이고, "나만의 길" 탭(2건)에서도 214km 가 그대로다 — 채워 넣은 숫자다.
 * 0건 프레임이 0회 · 0km 인 걸 보면 원래 세려던 값이 맞고, 카드와 어긋나는 총합을
 * 화면에 박아두면 시연 중에 누가 더해본다.
 */
function Summary({ routes }: { routes: SafeRoute[] }) {
  const km = routes.reduce((sum, r) => sum + r.km, 0);

  return (
    <div className="mt-[30px] mx-[24px] h-[92px] shrink-0 rounded-[17px] px-[16px] pt-[13px]">
      <p className="text-[11px] leading-none font-medium text-[#ff5914]">귤이와 함께 달린 안심 길</p>
      <div className="mt-[12px] flex items-center">
        <Stat value={`${routes.length}회`} label="이용" />
        <span className="h-[54px] w-px bg-[#e5e0db]" />
        <Stat value={`${km}km`} label="이동" />
      </div>
    </div>
  );
}

/** 요약 한 칸. 세로줄을 사이에 두고 반씩 나눠 쓴다 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 text-center">
      <p className="text-[17px] leading-[20px] font-bold text-[#1f1f1f]">{value}</p>
      <p className="mt-[6px] text-[9px] leading-none text-[#6e6e6e]">{label}</p>
    </div>
  );
}

/**
 * 담긴 게 없을 때 (2770:2050).
 *
 * 아래 두 줄은 등록 버튼 자리에 들어선 안내다 — 사람이 등록하는 게 아니라 주행이 끝나면
 * 알아서 담긴다는 말이라, 여기서 할 일이 없다는 뜻이기도 하다.
 * "나만의 길" 탭이 비었을 때는 담을 것 자체는 있으니 문구가 달라야 한다.
 */
function Empty({ mineOnly }: { mineOnly: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center px-[24px] pt-[62px]">
      <img src="/safelog/character-empty.png" alt="" className="h-[158px] w-[170px] object-contain" />
      <p className="mt-[14px] text-center text-[15px] leading-[22px] font-medium text-[#b0b0b0]">
        지금까지의
        <br />
        {mineOnly ? "나만의 길이 없어요" : "주행 저장 기록이 없어요"}
      </p>
      <p className="mt-[46px] text-center text-[15px] leading-[25px] font-medium text-[#262626]">
        {mineOnly ? (
          <>
            마음에 든 주행을 나만의 길로 담아보세요.
            <br />
            담아둔 길은 여기 모여요
          </>
        ) : (
          <>
            주행을 하면 자동으로 등록됩니다.
            <br />
            나만의 길 등록을 통해 자세한 코스를 알 수 있어요
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Safe Route Record — 목록 카드.
 *
 * 접혀 있을 때는 주차장 줄이 맨 아래에 있고(142px), 누르면 그 줄이 버튼 둘로 바뀐다(184px).
 * 테두리도 1px 회색에서 2px 주황으로, 점수 배지도 살구에서 진한 살구로 바뀐다 (3713:2556).
 * 카드 전체가 버튼이면 안쪽 버튼이 그 안에 들어갈 수 없어, 펼치는 건 윗부분만 맡는다.
 */
function RouteCard({
  route,
  open,
  onToggle,
  onRemove,
  onSaveMine,
  onDetail,
}: {
  route: SafeRoute;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onSaveMine: () => void;
  onDetail: () => void;
}) {
  return (
    <div
      className={`relative shrink-0 rounded-[16px] bg-white px-[15px] pt-[12px] ${
        open ? "border-2 border-[#ff7b33] pb-[21px]" : "border border-[#e5e0db] pb-[13px]"
      }`}
    >
      {/* ✕ — 이 기록을 목록에서 뺀다. 카드를 펼치는 자리 위에 얹히므로 버튼이 먼저 받는다 */}
      <button
        onClick={onRemove}
        aria-label={`${route.title} 기록 지우기`}
        className="absolute top-[8px] right-[11px] flex size-[30px] items-center justify-center transition active:scale-[0.9]"
      >
        <img src="/safelog/icon-close.svg" alt="" className="size-[14px]" />
      </button>

      <button onClick={onToggle} className="block w-full text-left" aria-expanded={open}>
        <p className="text-[10px] leading-none text-[#6e6e6e]">{route.date}</p>
        <p className={`text-[16px] leading-[19px] font-bold text-[#1f1f1f] ${open ? "mt-[18px]" : "mt-[11px]"}`}>
          {route.title}
        </p>
        <div className="mt-[11px] flex items-center">
          {/*
            **나만의 길로 담긴 카드는 배지가 살구다** (3794:2712). 펼쳤는지가 아니라 담겼는지로 갈린다 —
            펼쳐야만 바뀌면 목록에서는 어느 것이 내 길인지 알 수 없고, 접힌 카드에도 표가 나야
            "전체" 탭에서 담긴 것과 안 담긴 것이 한눈에 갈린다.
            (와이어프레임은 접힌 나만의 길 카드를 초록으로 그려뒀지만 그건 안 고친 자국이다.)
          */}
          <span
            className="flex h-[30px] w-[84px] items-center justify-center rounded-[15px] text-[10px] leading-none font-medium"
            style={
              route.mine
                ? { background: "#ffdcc7", color: "#ff4b00" }
                : { background: badgeColor(route.score), color: "#42a861" }
            }
          >
            추천 점수 {route.score}
          </span>
          <span className="ml-[12px] text-[10px] leading-none text-[#6e6e6e]">
            {route.minutes}분 · {route.km}km
          </span>
        </div>
      </button>

      {open ? (
        /*
          펼친 카드의 버튼 줄.

          **값은 목적지·주차장 화면의 "자세히 · 여기로 갈게요" 짝을 그대로 쓴다** (app/parking/page.tsx) —
          알약 모양 · 높이 40 · 사이 4 · 흰 알약은 #e5e5e5 테두리, 주황 알약은 #ff7b33 에 flex-1.
          와이어프레임은 102/19/185 에 #cacaca 테두리로 그렸지만, 같은 성격의 버튼 짝이 앱 안에서
          화면마다 다르게 생기면 방금 누른 것과 지금 누를 것이 다른 물건처럼 보인다.

          이미 나만의 길이면 담을 것이 없어 "자세히" 하나만 남고, 그때는 폭을 다 쓴다 —
          담긴 것과 안 담긴 것은 배지 색이 이미 갈라주고 있어서 빈 칸까지 남길 이유가 없다.
        */
        <div className="mt-[24px] flex gap-1">
          {!route.mine && (
            <button
              onClick={onDetail}
              className="h-10 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-4 text-[14px] leading-[22px] font-bold text-[#1f1f1f] transition hover:bg-[#fff0e6] active:scale-[0.98]"
            >
              자세히
            </button>
          )}
          <button
            onClick={route.mine ? onDetail : onSaveMine}
            className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            {route.mine ? "자세히" : "나만의 길의 저장"}
          </button>
        </div>
      ) : (
        /* Parking Used — 그 주행에서 댄 주차장 */
        <div className="mt-[10px] flex h-[26px] items-center rounded-[13px] bg-[#f1f1f1] px-[10px]">
          <span className="truncate text-[10px] leading-none font-medium text-[#6e6e6e]">
            P&nbsp;&nbsp;{route.parking}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * SAFELOG-04 — 기록 상세 (2574:418).
 *
 * 지도는 그 기록의 좌표로 그린 **진짜 경로**다 (아래 Route Map Preview 주석).
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
          {/* 추천 경로가 곧 최단시간이면 "빠른 길보다 0분 더"가 된다 — 그때는 그 말을 뺀다 */}
          <p className="mt-[8px] text-[10px] leading-none text-[#6e6e6e]">
            {route.minutes}분 · {route.km}km
            {route.slower > 0 && ` · 빠른 길보다 ${route.slower}분 더`}
          </p>
        </div>
        {/* 와이어프레임은 숫자 밑에 "낮음"을 달았지만 등급 말은 화면 어디에도 안 쓴다 */}
        <div className="mt-[22px] w-[56px] shrink-0 text-center text-[#ff5914]">
          <p className="text-[22px] leading-[26px] font-bold">{route.score}</p>
        </div>
      </div>

      {/*
        Route Map Preview — 그 주행에서 **실제로 달린 길**이다 (2574:435).

        전에는 곡선 그림 한 장(public/safelog/route-path.svg)이었다. 어느 기록을 열어도 같은 곡선이
        나오니 "이런 길을 달렸다"는 시늉일 뿐이었고, 도착 이름이 곡선 끝점과 겹쳐 글자가 점에 물렸다.
        기록마다 좌표를 들고 다니게 하고 RouteMap 에 넘긴다 — 축척은 RouteMap 이 경로 전체에 맞춘다.

        이름표는 와이어프레임대로 좌상·우하 구석에 두되 흰 알약을 깐다. 그림 위에서는 맨 글자로도
        읽혔지만 지도 위에서는 도로·지명과 겹쳐 안 읽힌다.
      */}
      <div className="relative mt-[31px] mx-[24px] h-[253px] shrink-0">
        <RouteMap
          center={route.path[Math.floor(route.path.length / 2)]}
          routes={[{ path: route.path, color: "#ff5914" }]}
          markers={[
            { coord: route.path[0], label: start, icon: dot("#42a861") },
            { coord: route.path[route.path.length - 1], label: end, icon: dot("#db403b") },
          ]}
          className="rounded-[16px]"
        />
        <span className="pointer-events-none absolute z-10 top-[14px] left-[16px] rounded-full bg-white/85 px-[8px] py-[4px] text-[10px] leading-none font-medium text-[#42a861]">
          {start}
        </span>
        <span className="pointer-events-none absolute z-10 right-[16px] bottom-[14px] rounded-full bg-white/85 px-[8px] py-[4px] text-[10px] leading-none font-medium text-[#db403b]">
          {end}
        </span>
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
