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
// 빈 화면이 "누르면 저절로 담긴다"고 말한다. 등록은 사람이 누르는 일이 아니다.
// 그래서 여기서 사람이 할 수 있는 건 빼기(✕)와 나만의 길로 담기 둘뿐이다.
//
// 메인화면(/home)의 "주행 저장" 칸으로 들어온다.
//
// 세로 배치는 좌표가 아니라 흐름으로 쌓는다 — .phone 이 노트북에서 844 보다 낮아질 수 있어
// 절대배치를 하면 그때 아래쪽이 프레임 밖으로 나간다 (app/home/page.tsx 와 같은 이유).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap from "../RouteMap";
import { dotted } from "@/lib/record";
import { me } from "@/lib/me";
import { loadDrives, removeDrive, setMine, type SafeDrive } from "@/lib/safelog";

/*
 * 기록의 모양(SafeDrive)과 서버 왕래는 lib/safelog.ts 에 있다 — 서버도 같은 검사를 써야 해서다.
 *
 * 거리·시간·경로·"왜 안심 길이었나요?" 세 줄은 **실제 값이다**. score 만 아직 목업인데,
 * 진짜 주행이 담기면 길 비교 화면이 매긴 추천점수가 그대로 들어온다 (lib/safelog.ts SafeDrive).
 */

const REASON_LABELS = ["좁은 교행 구간", "급커브", "사고 잦은 곳"];

/**
 * 추천점수 배지 바탕색 — 30 이하 · 60 이하 · 그 위 세 칸이다.
 *
 * 색을 기록에 들고 다니지 않는다. 색과 숫자가 따로 놀면 다음 사람이 색을 보고 점수를 짐작한다.
 * 높음·보통·낮음 같은 말은 안 붙인다 — 숫자와 색이 이미 그 말을 하고 있다.
 */
const badgeColor = (score: number) =>
  score <= 30 ? "#fff0e5" : score <= 60 ? "#e5f5e5" : "#e5eaf5";

/**
 * 상세 지도의 출발·도착 표시. **점과 이름을 한 장에 그려** 마커 아이콘으로 넘긴다.
 *
 * 이름을 지도 구석에 따로 띄우면 어느 점이 출발인지 색으로만 알 수 있다. 그렇다고 글자를
 * 따로 얹으려면 RouteMap 에 오버레이 옵션을 달아야 하는데(marker.label 은 툴팁이라 지도에
 * 안 보인다) 그 파일은 지금 다른 작업이 물고 있다 — 아이콘 한 장이면 여기서 끝난다.
 *
 * 점과 글자 모두 흰 테두리를 두른다. 글자는 paint-order 로 획을 먼저 깔아 흰 테를 만드는데,
 * 바다(파랑)·들(초록)·도로(노랑) 어디에 떨어져도 읽히려면 이게 있어야 한다.
 */
const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pin = (color: string, label: string) => {
  // 한글 한 자가 11px 남짓이라 그만큼 잡고 양옆에 여백을 둔다. 좁으면 글자가 잘린다
  const w = Math.max(24, label.length * 12 + 12);
  return {
    src: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="30">` +
        `<circle cx="${w / 2}" cy="7" r="5" fill="${color}" stroke="#fff" stroke-width="2"/>` +
        `<text x="${w / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="11"` +
        ` font-weight="700" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">` +
        `${xml(label)}</text>` +
        `</svg>`,
    )}`,
    size: [w, 30] as [number, number],
    // 좌표에 앉는 건 그림 가운데가 아니라 **점**이다 — 안 맞추면 이름 높이만큼 위로 뜬다
    anchor: [w / 2, 7] as [number, number],
  };
};

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
const SAMPLE: SafeDrive[] = [
  {
    id: 1_755_000_000_000,
    date: "2026-08-12",
    title: "애월해안도로 → 협재",
    mine: false,
    score: 66,
    minutes: 28,
    km: 19,
    slower: 0,
    // 애월해안도로 → 협재해수욕장 (카카오 추천 경로 18.7km)
    path: [[33.47812,126.36867],[33.47813,126.3649],[33.4752,126.36525],[33.47353,126.36388],[33.47094,126.36616],[33.46819,126.35993],[33.46701,126.35287],[33.46555,126.34699],[33.46311,126.33995],[33.46247,126.33495],[33.46267,126.33098],[33.46263,126.32882],[33.46202,126.32534],[33.46137,126.32179],[33.46001,126.31435],[33.45844,126.31075],[33.45361,126.30896],[33.44957,126.30857],[33.44767,126.30683],[33.44517,126.3035],[33.44435,126.29955],[33.44347,126.29301],[33.44189,126.28919],[33.44013,126.2835],[33.43771,126.27978],[33.43336,126.27684],[33.42739,126.27736],[33.42388,126.27789],[33.42127,126.278],[33.41673,126.27673],[33.41209,126.27521],[33.40911,126.27363],[33.40452,126.26907],[33.39951,126.2647],[33.39632,126.26053],[33.39373,126.25645],[33.39591,126.2457],[33.3955,126.24259],[33.39312,126.24006],[33.3935,126.23934]],
    parking: "협재해수욕장 공영주차장",
    reasons: ["20%", "10곳", "확인 안 됨"],
    parkingTags: "입구 넓음 · 지상 · 초보에게 편해요",
  },
  {
    id: 1_754_000_000_000,
    date: "2026-07-28",
    title: "성산일출봉 → 함덕",
    mine: false,
    score: 59,
    minutes: 48,
    km: 31,
    slower: 0,
    // 성산일출봉 → 함덕해수욕장 (카카오 추천 경로 30.9km)
    path: [[33.46221,126.93754],[33.46406,126.93414],[33.46649,126.93018],[33.46857,126.9289],[33.46874,126.92798],[33.46877,126.91973],[33.46547,126.90886],[33.47056,126.90281],[33.47928,126.8982],[33.48924,126.89674],[33.49361,126.89349],[33.49946,126.88623],[33.50512,126.87928],[33.51293,126.86796],[33.51514,126.86512],[33.5183,126.86132],[33.52036,126.85698],[33.52299,126.85233],[33.52536,126.848],[33.52909,126.83943],[33.53908,126.82654],[33.54221,126.81659],[33.54599,126.80441],[33.55038,126.79594],[33.55228,126.78677],[33.54956,126.779],[33.5516,126.76727],[33.55105,126.75231],[33.55117,126.74655],[33.55343,126.7398],[33.55605,126.73078],[33.55212,126.71562],[33.55186,126.70915],[33.55227,126.70364],[33.54812,126.69541],[33.5453,126.68843],[33.54115,126.68099],[33.54005,126.6742],[33.54102,126.66936],[33.54262,126.66924]],
    parking: "함덕해수욕장 주차장",
    reasons: ["22%", "7곳", "확인 안 됨"],
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

  /**
   * 시연용 목업인가 (`?demo=1`). 그때는 서버를 아예 안 부르고 이 화면에서만 담고 뺀다 —
   * 아직 주행을 담는 문(길 비교 → 외부 내비)이 안 붙어서, 이게 없으면 목록·카드·상세를 볼 길이
   * 없다. ponytail: 그 문이 붙으면 SAMPLE 과 함께 이 갈래를 지운다.
   */
  const demo = searchParams.get("demo") === "1";
  /*
    버킷은 **이 브라우저**다 (lib/me.ts). me() 가 localStorage 를 보므로 그리는 중에는 못
    부른다 — effect 로 한 번 받아 두고, 받기 전에는 목록을 안 읽는다.
  */
  const [나, set나] = useState<string | null>(null);
  useEffect(() => set나(me()), []);

  /** 담긴 주행. 서버에서 읽어 온다 — 못 읽으면 빈 목록이고 화면은 "기록이 없어요"가 된다 */
  const [routes, setRoutes] = useState<SafeDrive[]>(demo ? SAMPLE : []);
  /** 보고 있는 탭 */
  const [mineOnly, setMineOnly] = useState(false);
  /**
   * 검색어. null 이면 검색을 안 연 것이고, 빈 문자열이면 열어두고 아직 안 친 것이다 —
   * 둘을 갈라야 "열었는데 결과가 없다"와 "안 열었다"가 화면에서 구별된다.
   */
  const [query, setQuery] = useState<string | null>(null);
  /** 펼쳐 본 카드의 id. 한 번에 하나만 펼친다 (와이어프레임 3713:2542) */
  const [open, setOpen] = useState<number | null>(null);
  /** 자세히로 들어간 기록. 있으면 상세 화면이다 (2574:418) */
  const [detail, setDetail] = useState<SafeDrive | null>(null);

  // 늦게 온 응답이 새 목록을 덮지 않게 떠난 뒤엔 버린다.
  useEffect(() => {
    if (demo || !나) return;
    let 살아있다 = true;
    loadDrives(나).then((list) => {
      if (살아있다) setRoutes(list);
    });
    return () => {
      살아있다 = false;
    };
  }, [demo, 나]);

  /*
   * 빼기·담기는 **서버가 준 목록으로 갈아끼운다.** 화면에서 먼저 지우고 나중에 맞추면,
   * 서버가 거절했을 때 지워진 것처럼 보이다가 새로고침에 되살아난다 — 사용자는 자기가
   * 잘못 본 줄 안다. 실패하면 목록을 그대로 두는 편이 정직하다 (lib/record.ts saveRecord 와 같은 규칙).
   */
  async function remove(drive: SafeDrive) {
    if (demo) return setRoutes((rs) => rs.filter((r) => r.id !== drive.id));
    const next = await removeDrive(me(), drive.id);
    if (next) setRoutes(next);
  }

  async function saveMine(drive: SafeDrive) {
    if (demo) return setRoutes((rs) => rs.map((r) => (r.id === drive.id ? { ...r, mine: true } : r)));
    const next = await setMine(me(), drive.id, true);
    if (next) setRoutes(next);
  }

  /*
   * 탭으로 한 번, 검색어로 한 번 거른다. 찾는 대상은 **출발·도착 이름과 댄 주차장**이다 —
   * 사람이 기억하는 건 "협재 갔던 거"지 날짜나 점수가 아니다.
   *
   * **요약은 탭까지만 따르고 검색은 안 따른다** (아래 Summary 는 tabbed 를 받는다).
   * "귤이와 함께 달린 안심 길"은 지금까지 달린 것의 총합인데, 검색어를 칠 때마다 회수와 거리가
   * 줄었다 늘었다 하면 그건 총합이 아니라 검색 결과 개수다. 안 걸리는 말을 치면 0회·0km 까지 간다.
   */
  const tabbed = mineOnly ? routes.filter((r) => r.mine) : routes;
  const q = query?.trim().toLowerCase() ?? "";
  const shown = tabbed.filter((r) => !q || `${r.title} ${r.parking}`.toLowerCase().includes(q));

  if (detail) return <Detail route={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="flex flex-1 flex-col bg-white pb-[19px]">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        앱바. 제목이 화면 한가운데라 좌우 버튼과 같은 줄에 못 놓는다 —
        제목만 절대배치로 띄우고 버튼은 양끝에 둔다 (제목 길이가 가운데를 밀지 않게).
      */}
      <Header onBack={() => router.push(`/home?${searchParams}`)} />

      <Summary routes={tabbed} />

      {/*
        Tab / 전체 · 나만의 길 (3423:540 · 3678:2011).
        칩 둘이 나란한 게 아니라 **겹쳐** 있다 — 와이어프레임에서 전체는 x16, 나만의 길은 x78 인데
        폭이 각각 92 다. 그래서 옅은 주황 알약 하나 위로 주황 덩어리가 좌우로 미끄러지는 모양이 된다.
        떼어 놓고 그리면 버튼 두 개가 되고, 붙여 놔야 지금 어느 쪽인지가 한눈에 읽힌다.

        겹침은 와이어프레임의 30 이 아니라 16 이다. 글자가 둘 다 흰색이라 30 으로 두면 **안 고른 쪽
        글자 앞머리가 주황 덩어리에 9px 걸친다** — 흰 글자가 주황과 살구를 반씩 깔고 앉아 깨져 보인다.
        16 이면 어느 쪽을 골라도 글자가 한 바탕 위에만 놓이고, 고른 쪽 글자는 덩어리 한가운데에 온다.

        **담긴 게 없어도 둘 다 보인다.** 빈 화면 프레임(2770:2050)에는 "전체"만 그려져 있지만,
        칸이 사라졌다 나타나면 같은 화면이 두 모양이 되고 처음 온 사람은 나만의 길이라는 게
        있는 줄도 모른다. 눌러도 빈 화면이지만 거기 문구가 무엇을 담는 곳인지 말해준다.
      */}
      <div className="mt-[14px] mx-[24px] flex shrink-0 items-center">
        <div className="relative h-[34px] w-[168px] rounded-[17px] bg-[#ffcfbc]">
          {/* 고른 쪽을 덮는 주황 덩어리. 76px 을 미끄러진다 (칩 폭 92 - 겹침 16) */}
          <span
            aria-hidden
            className={`absolute top-0 left-0 h-[34px] w-[92px] rounded-[17px] bg-[#ff7d32] transition-transform duration-200 ${
              mineOnly ? "translate-x-[76px]" : "translate-x-0"
            }`}
          />
          <Tab label="전체" left={0} on={!mineOnly} onClick={() => setMineOnly(false)} />
          <Tab label="나만의 길" left={76} on={mineOnly} onClick={() => setMineOnly(true)} />
        </div>
        {/*
          돋보기가 앱바에서 여기로 내려왔다 (4172:705 · 3423:531) — 탭과 같은 줄, 오른쪽 끝이다.
          와이어프레임은 335~342 사이에서 흔들리는데 본문 오른끝에 맞춘다: 요약 상자도 카드도
          다 24px 여백을 쓰고 있어서, 이것만 어중간하게 안쪽에 있으면 줄이 안 맞아 보인다.

          글자 ⌕ 가 아니라 /home·/destination·/around 가 쓰는 같은 자산이다 — 글자로 두면
          기기 서체에 따라 모양이 달라지고, 이 앱 안에서 혼자 다른 돋보기가 된다.
        */}
        <button
          onClick={() => setQuery(query === null ? "" : null)}
          aria-label={query === null ? "기록 검색" : "검색 닫기"}
          className="ml-auto flex size-11 shrink-0 items-center justify-center transition hover:opacity-40 active:scale-90"
        >
          <img
            src={query === null ? "/home/icon-search.svg" : "/home/icon-close.svg"}
            alt=""
            // brightness 로 색만 진하게 한다 (#525252 → #252525). 자산을 복사해 색만 바꾸면
            // 나중에 돋보기 모양이 바뀔 때 여기만 옛 모양으로 남는다
            className={query === null ? "h-[19px] w-[18px] brightness-[.45]" : "size-[22px]"}
          />
        </button>
      </div>

      {/*
        검색 칸은 돋보기를 눌러야 열린다. 늘 띄워두면 기록이 두어 건일 때도 자리를 먹는데,
        이 목록은 대개 짧아서 눈으로 훑는 게 빠르다.
      */}
      {query !== null && (
        <div className="mt-[10px] mx-[24px] flex h-[40px] shrink-0 items-center rounded-full border border-[#e5e0db] bg-white px-[14px]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="출발·도착 또는 주차장 이름"
            aria-label="기록 검색"
            className="min-w-0 flex-1 text-[14px] text-[#1f1f1f] outline-none placeholder:text-[#8a8a8a]"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="지우기" className="shrink-0 pl-[8px]">
              <img src="/home/icon-close.svg" alt="" className="size-[18px]" />
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        q ? (
          // 담긴 건 있는데 검색어에 안 걸린 경우 — "기록이 없어요"라고 하면 거짓말이 된다
          <p className="mt-[60px] text-center text-[15px] leading-[25px] font-medium text-[#262626]">
            찾는 기록이 없어요.
          </p>
        ) : (
          <Empty mineOnly={mineOnly} />
        )
      ) : (
        <div className="mt-[23px] flex flex-col gap-[11px] px-[24px]">
          {shown.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              open={open === route.id}
              onToggle={() => setOpen(open === route.id ? null : route.id)}
              onRemove={() => remove(route)}
              onSaveMine={() => saveMine(route)}
              onDetail={() => setDetail(route)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    // 오른쪽은 비운다 — 돋보기는 탭 줄로 내려갔고(4172:705), 상세의 ••• 는 갈 곳이 없어 뺐다.
    // 제목이 absolute 라 오른쪽에 자리를 채우는 빈 칸이 없어도 가운데에 그대로 있다.
    <div className="relative flex h-[52px] shrink-0 items-center px-[10px]">
      {/*
        아이콘 버튼의 호버는 동그란 옅은 주황이다 — #fff0e6 은 앱이 이미 여러 군데 쓰는 집 색이라
        새 색을 만들지 않는다 (app/home/page.tsx Quick 과 같은 이유).
        Tailwind v4 가 hover: 를 @media (hover:hover) 로 감싸므로 폰에서 탭한 뒤 눌어붙지 않는다.
      */}
      <button
        onClick={onBack}
        aria-label="뒤로"
        className="z-10 flex size-11 items-center justify-center transition hover:opacity-40 active:scale-90"
      >
        <img src="/icon-arrow-left.svg" alt="" className="size-6" />
      </button>
      <h1 className="pointer-events-none absolute inset-x-0 text-center text-[20px] leading-[24px] font-bold text-[#1f1f1f]">
        주행 저장
      </h1>
    </div>
  );
}

/**
 * 탭 하나. 바탕은 위 알약과 미끄러지는 덩어리가 다 그리고, 여기는 글자와 누를 자리만 맡는다.
 * 둘 다 92px 이라 글자 길이와 상관없이 가운데가 맞는다.
 *
 * **글자색은 발밑 바탕을 따라간다.** 둘 다 흰색이던 때는 안 고른 쪽이 옅은 살구(#ffcfbc) 위에
 * 흰 글자라 대비가 1.4:1 이었다 — 밝은 데서는 탭이 하나만 있는 것처럼 보인다.
 * 안 고른 쪽만 진한 갈주황으로 내리면 4.8:1 이 된다. 고른 쪽은 주황 덩어리 위라 흰색 그대로다.
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
      className={`absolute top-0 z-10 h-[34px] w-[92px] text-[11px] leading-none font-medium ${
        on ? "text-white" : "text-[#8a4a25]"
      }`}
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
function Summary({ routes }: { routes: SafeDrive[] }) {
  const km = routes.reduce((sum, r) => sum + r.km, 0);

  return (
    <div className="mt-[15px] mx-[24px] h-[92px] shrink-0 rounded-[17px] px-[16px] pt-[13px]">
      <p className="text-[11px] leading-none font-medium text-[#ff5914]">귤이와 함께 달린 안심 길</p>
      {/*
        items-start 여야 한다. 가운데 정렬하면 제일 큰 구분선(54)에 맞춰 숫자가 8px 내려앉는다 —
        와이어프레임에서는 구분선 **위끝이 숫자 위끝과 나란하고** 아래로 상자 바닥까지 내려간다.
      */}
      {/*
        숫자 둘은 상자를 반반 나누는 게 아니라 **양끝에 붙는다** (4180:735) — 94px 짜리 칸이
        좌우 안쪽 여백에 걸리고 구분선이 그 사이 한가운데다. 반씩 나누면 숫자가 가운데로 몰려
        구분선만 도드라지고 양옆이 빈다.
        justify-between + 같은 폭이라 구분선은 따로 안 잡아도 정확히 가운데로 온다.
      */}
      <div className="mt-[14px] flex items-start justify-between">
        <Stat value={`${routes.length}회`} label="이용" />
        <span className="h-[54px] w-px bg-[#e5e0db]" />
        <Stat value={`${km}km`} label="이동" />
      </div>
    </div>
  );
}

/** 요약 한 칸. 폭 94 는 와이어프레임 값이다 — 둘이 같아야 구분선이 가운데로 온다 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="w-[94px] text-center">
      <p className="text-[17px] leading-[20px] font-bold text-[#1f1f1f]">{value}</p>
      <p className="mt-[6px] text-[9px] leading-none text-[#6e6e6e]">{label}</p>
    </div>
  );
}

/**
 * 담긴 게 없을 때 (2770:2050).
 *
 * 아래 두 줄은 등록 버튼 자리에 들어선 안내다 — 사람이 등록하는 게 아니라 길 안내로
 * 넘어갈 때 알아서 담긴다는 말이라, 여기서 할 일이 없다는 뜻이기도 하다.
 * "달리기만 하면"이라고는 안 한다 — 앱 없이 그냥 달린 길은 담기지 않는다.
 * "나만의 길" 탭이 비었을 때는 담을 것 자체는 있으니 문구가 달라야 한다.
 */
function Empty({ mineOnly }: { mineOnly: boolean }) {
  return (
    /*
      빈 화면은 **문구 한 덩어리뿐이다** (4180:728 · 4180:749).
      귤이도, "지금까지의 / 기록이 없어요" 회색 두 줄도 지금 디자인에서 빠졌다 —
      탭이 이미 어느 목록인지 말하고 요약이 0회·0km 라 없다는 건 화면이 벌써 다 말하고 있다.
      그래서 남은 한 줄은 "없다"가 아니라 **어떻게 채워지는지**만 말한다.

      두 탭이 같은 자리·같은 모양이라, 탭을 눌러도 글자만 갈아끼워진다.

      자리는 **폰 한가운데**다. 와이어프레임 값(탭 아래 247)을 그대로 옮기면 아래로 처진다 —
      우리 머리가 24 더 두껍고(상태바가 목업보다 높다) 폰은 36 더 짧아서, 같은 247 이 남은 자리에서
      차지하는 몫이 훨씬 크다. 그림의 숫자가 아니라 그림이 노린 자리(가운데쯤)를 옮기는 게 맞다.

      pb 는 위쪽 머리(앱바 52 + 요약 107 + 탭 45 ≈ 263)만큼 되돌리는 값이다 — 이게 없으면
      justify-center 가 탭 아래 남은 자리의 가운데를 잡아 또 처진다.
    */
    <div className="flex flex-1 flex-col items-center justify-center px-[24px] pb-[263px]">
      <p className="text-center text-[15px] leading-[25px] font-medium text-[#262626]">
        {mineOnly ? (
          <>
            마음에 쏙 든 길, 담아두세요!
            <br />
            전체 탭에서 저장하면 여기에 모여요.
          </>
        ) : (
          <>
            홈에서 목적지를 찾아 길 안내를 시작하면
            <br />
            여기에 자동으로 담겨요.
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
  route: SafeDrive;
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
        {/* 저장은 2026-08-12, 화면은 2026.08.12 — 표기 규칙은 여행 기록과 같다 (lib/record.ts dotted) */}
        <p className="text-[10px] leading-none text-[#6e6e6e]">{dotted(route.date)}</p>
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

          **폭·색은 와이어프레임(3713:2556) 그대로다** — 자세히 102, 사이 19, 흰 알약은 #cacaca
          1.5px 테두리에 #aaa 글자. 높이 40 과 알약 모양은 목적지·주차장 화면의
          "자세히 · 여기로 갈게요" 짝과 같다 (app/parking/page.tsx).

          그 짝과 완전히 같지는 않다는 뜻이기도 하다 — 저쪽은 테두리 #e5e5e5 에 검은 글자,
          자세히 폭이 글자만큼이다. 같은 성격의 버튼이 화면마다 조금 다르게 생기는 셈이라,
          한쪽으로 통일할 거면 이 카드가 아니라 둘 중 하나를 골라 양쪽을 같이 고쳐야 한다.

          이미 나만의 길이면 담을 것이 없어 "자세히" 하나만 남고, 그때는 폭을 다 쓴다 —
          담긴 것과 안 담긴 것은 배지 색이 이미 갈라주고 있어서 빈 칸까지 남길 이유가 없다.
        */
        <div className="mt-[24px] flex gap-[19px]">
          {!route.mine && (
            <button
              onClick={onDetail}
              className="h-10 w-[102px] shrink-0 rounded-full border-[1.5px] border-[#cacaca] bg-white text-[14px] leading-[22px] font-bold text-[#aaa] transition hover:bg-[#f5f5f5] active:scale-[0.98]"
            >
              자세히
            </button>
          )}
          <button
            onClick={route.mine ? onDetail : onSaveMine}
            className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            {route.mine ? "자세히" : "나만의 길로 저장"}
          </button>
        </div>
      ) : (
        /*
          Parking Used — 그 주행에서 댄 주차장.
          **주차장을 안 거친 주행은 이 줄이 없다** (관광지로 바로 간 경우). 빈 줄을 두면
          "P" 만 덩그러니 남아 뭔가 빠진 것처럼 보인다 — 없는 건 자리도 안 만든다.
        */
        route.parking && (
          <div className="mt-[10px] flex h-[26px] items-center rounded-[13px] bg-[#f1f1f1] px-[10px]">
            <span className="truncate text-[10px] leading-none font-medium text-[#6e6e6e]">
              P&nbsp;&nbsp;{route.parking}
            </span>
          </div>
        )
      )}
    </div>
  );
}

/**
 * SAFELOG-04 — 기록 상세 (2574:418).
 *
 * 지도는 그 기록의 좌표로 그린 **진짜 경로**다 (아래 Route Map Preview 주석).
 */
function Detail({ route, onBack }: { route: SafeDrive; onBack: () => void }) {
  const [start, end] = route.title.split(" → ");

  return (
    <div className="flex flex-1 flex-col bg-white pb-[20px]">
      <StatusBar tone="text-[#1f1f1f]" />
      <Header onBack={onBack} />

      {/* Record Header — 날짜 · 경로 · 소요, 오른쪽에 추천점수 */}
      <div className="mt-[21px] mx-[24px] flex h-[104px] shrink-0 items-start justify-between rounded-[17px] px-[16px] pt-[12px]">
        <div>
          <p className="text-[10px] leading-none text-[#6e6e6e]">{dotted(route.date)} · 완료된 경로</p>
          <p className="mt-[12px] text-[17px] leading-[20px] font-bold text-[#1f1f1f]">{route.title}</p>
          {/* 추천 경로가 곧 최단시간이면 "짧은 길보다 0분 더"가 된다 — 그때는 그 말을 뺀다 */}
          <p className="mt-[8px] text-[10px] leading-none text-[#6e6e6e]">
            {route.minutes}분 · {route.km}km
            {route.slower > 0 && ` · 짧은 길보다 ${route.slower}분 더`}
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

        출발·도착 이름은 **점 바로 밑에 붙는다** (pin). 와이어프레임은 구석에 따로 띄웠는데,
        그림 한 장일 때는 어느 끝이 어디인지 뻔했지만 진짜 지도에서는 점이 매번 다른 자리에
        찍혀서 색으로만 짝을 지어야 했다.
      */}
      <div className="relative mt-[31px] mx-[24px] h-[253px] shrink-0">
        <RouteMap
          center={route.path[Math.floor(route.path.length / 2)]}
          routes={[{ path: route.path, color: "#ff5914" }]}
          markers={[
            { coord: route.path[0], label: start, icon: pin("#42a861", start) },
            { coord: route.path[route.path.length - 1], label: end, icon: pin("#db403b", end) },
          ]}
          className="rounded-[16px]"
        />
        {/*
          지도를 **고정으로 둔다.** 기록은 지나간 주행이라 여기서 끌거나 확대해 볼 일이 없고,
          세로로 긴 화면 한가운데 있는 지도는 손가락이 스치기만 해도 딸려 움직여서 화면 스크롤을
          삼킨다. 투명한 덮개 한 장으로 끌기·휠·핀치·더블클릭을 다 막는다.

          RouteMap 에 옵션을 다는 대신 여기서 덮는 이유: 그 파일은 지금 다른 작업이 물고 있고,
          이 화면 말고는 고정으로 둘 지도가 없다.
          ponytail: 고정 지도가 한 군데 더 생기면 그때 RouteMap 쪽 옵션으로 올린다.
        */}
        <div aria-hidden className="absolute inset-0 z-10 rounded-[16px]" />
      </div>

      <h2 className="mt-[19px] mx-[24px] shrink-0 text-[17px] leading-[20px] font-bold text-[#1f1f1f]">
        왜 안심 길이었나요?
      </h2>

      {/* Burden Reasons — 점수를 깎은 것들 */}
      {/* 위아래 여백이 다르다 (3 / 13). 줄 하나가 28px 이라 셋이면 상자가 100 이 된다 (넷이던 때는 128) */}
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

      {/*
        Parking Review — 목록 카드의 P 줄을 펼친 것.
        주차장을 안 거친 주행에서는 이 상자째 안 나온다 (카드의 P 줄과 같은 규칙).
      */}
      {route.parking && (
        <div className="mt-[16px] mx-[24px] shrink-0 rounded-[16px] border border-[#e5e0db] bg-white px-[15px] pt-[10px] pb-[12px]">
          <p className="text-[10px] leading-none text-[#6e6e6e]">이용한 주차장</p>
          <p className="mt-[10px] text-[14px] leading-[17px] font-medium text-[#1f1f1f]">{route.parking}</p>
          {/* 한 줄평은 아직 담기지 않는다 — 없으면 그 줄만 빠지고 상자 높이가 줄어든다 */}
          {route.parkingTags && (
            <p className="mt-[7px] text-[10px] leading-none text-[#ff5914]">{route.parkingTags}</p>
          )}
        </div>
      )}
    </div>
  );
}
