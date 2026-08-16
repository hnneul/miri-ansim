"use client";

// 가는 길 주변 — 와이어프레임 "탐나는전" (Figma 2160:2236 / 2191:2803).
// 두 프레임은 화면 두 장이 아니라 하단 시트의 두 상태다(목록 올림 / 목록 내림).
// /parking 이 핀 지도와 시트를 한 파일에 둔 것과 같은 구조라 거기 규칙을 그대로 따른다.
//
// 메인화면(/home)의 "탐나는전 사용처" 카드로 들어온다.
//
// 찍는 것은 **탐나는전 캐시백 가맹점**뿐이다 (11,912곳).
// 착한가격업소는 여기 섞지 않는다 — 둘 다 놓으면 "여기서 결제하면 10% 돌려받는다"는
// 이 화면 한 줄이 흐려진다. 착한가격 데이터와 lib/goodprice.ts 는 그대로 남아 있다.
//
// 데이터(data/tamna-data.json, 838KB)는 **여기서 읽지 않는다.** 이 파일이 "use client" 라
// import 하면 그게 통째로 폰으로 내려간다 — 반경 안 40곳만 actions.ts 에서 받아 온다.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { loadSdk, type LatLng } from "../RouteMap";
import { findPlace } from "../destination/actions";
import { tamnaAround, type Around as Nearby } from "./actions";
import { type TamnaShop } from "@/lib/tamna";
import { walkMinutes, meters } from "@/lib/parking";

/**
 * 반경 — 도보권 1km.
 *
 * 착한가격업소(417곳)는 1km로 자르면 성산 1곳·협재 0곳이라 3km를 써야 했다.
 * 탐나는전은 11,912곳이라 그 전제가 뒤집힌다 — 실측으로 1km 안에 제주시청 823곳,
 * 서귀포 올레시장 682곳, 협재 111곳, 성산 47곳이다. 걸어갈 거리 밖까지 넓힐 이유가 없다.
 */
const RADIUS_M = 1000;

/** 처음 보고 있을 곳 — 제주시청. /parking 과 같은 이유로 섬 한가운데(한라산)를 잡지 않는다. */
const START: LatLng = [33.4996, 126.5312];
const START_LEVEL = 5;

/**
 * 옮겨갈 때 축척을 데이터에 맞춘다 — 화면에 담을 반경.
 *
 * 반경(1km)에 맞춰 고정하면 밀집 지역에서 화면이 이상해진다: 제주시청 1km 안에 823곳인데
 * 40곳만 찍으니 가까운 40곳이 150m 안에 다 들어와, 지도는 1.5km를 보여주는데 핀은 한 덩어리로
 * 뭉쳐 서로를 가린다. 그래서 반경이 아니라 **실제로 찍는 40곳이 퍼진 범위**에 축척을 맞춘다.
 *
 * 그 40번째 거리는 데이터가 있어야 나오므로 서버가 실어 보낸다 (actions.ts fitM).
 * 여기서는 너무 당기지 않게 바닥만 받친다 — 그건 지도 쪽 사정이다 (MIN_FIT_M).
 */
const fitRadius = (near: Nearby | null) => Math.max(near?.fitM ?? RADIUS_M, MIN_FIT_M);

/**
 * 아무리 뭉쳐 있어도 이보다 더 당기지는 않는다.
 * 40곳이 30m 안에 있는 골목이 있는데, 거기 맞춰 당기면 건물 몇 채만 남고 어디인지 알 수 없다.
 */
const MIN_FIT_M = 150;

/**
 * 고른 핀이 덮는 반경 — 이 안에 있는 다른 가게의 점은 지도에서 뺀다.
 *
 * 가장 많이 당긴 축척(레벨 1, 축척막대 20m)에서 1px 이 약 0.15m 라, 50px 짜리 고른 핀은
 * 8m 쯤을 덮는다. 12m 로 잡아 그 언저리까지 치운다. 더 넓히면 멀쩡히 떨어진 가게까지
 * 지도에서 사라지고, 좁히면 원래 문제가 남는다.
 */
const PIN_CLEAR_M = 12;

/**
 * 화면에 담을 폭 = 반경 × 이 값.
 *
 * 2.0(=지름)이면 40곳이 전부 화면에 들어오지만 시내에서는 핀이 서로를 덮는다.
 * 1.4 면 가장자리 몇 곳이 화면 밖으로 나가는 대신 나머지가 읽을 만해진다 —
 * 정확한 답은 어차피 목록이고(40곳 전부), 지도가 할 일은 "이 동네에 이만큼 깔려 있다"다.
 */
const FIT_SPAN = 1.4;

/**
 * 이 거리 밖이면 "도보 N분"을 쓰지 않는다.
 *
 * 거리는 **내 위치에서** 재는데, 이 화면은 지도를 옮겨 다니며 보는 화면이다. 제주시에 서서
 * 성산으로 지도를 옮기면 40km 밖 가게가 목록에 뜨는데, 거기에 도보 시간을 적으면 숫자는
 * 맞아도 아무 의미가 없다. 걸어갈 수 있는 거리일 때만 말한다.
 */
const WALK_LIMIT_M = 2000;

/**
 * 업종 칩을 놓을 순서.
 *
 * byKind 는 **가까운 순으로 처음 등장한 순서**라 지도를 조금만 옮겨도 칩이 자리를 바꾼다 —
 * 같은 자리를 노리고 누르려던 손가락이 헛짚는다. 데이터가 세 종류뿐이라 순서를 못 박는다
 * (scripts/build-tamna-data.mjs 의 KINDS 와 같은 차례).
 */
const KIND_ORDER = ["음식점", "숙박", "주유"];

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function AroundPage() {
  return (
    <Suspense>
      <Around />
    </Suspense>
  );
}

/** 같은 업소인가. 이름만 보면 지점이 겹칠 수 있어 좌표까지 본다 (/parking 과 같은 규칙). */
const same = (a: TamnaShop | null, b: TamnaShop) =>
  !!a && a.name === b.name && a.at[0] === b.at[0] && a.at[1] === b.at[1];

const idOf = (s: TamnaShop) => `shop-${s.name}-${s.at[0]}-${s.at[1]}`;

function Around() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [center, setCenter] = useState<LatLng>(START);
  const [kind, setKind] = useState<string | null>(null); // null = 전체
  const [selected, setSelected] = useState<TamnaShop | null>(null);
  /**
   * 시트 두 상태 — 와이어프레임의 올린 / 내린 버전. **내린 채로 시작한다.**
   *
   * 목록부터 펴면 지도가 화면의 38%로 눌린다. 그러면 축척을 "보이는 띠"에 맞추는 규칙 때문에
   * 세로 187px 안에 반경이 들어가도록만 당겨져서, 가로로는 1km가 펼쳐지고 핀 40개가 화면
   * 한구석에 뭉친다. 접고 시작하면 띠가 3배로 넓어져 그만큼 더 당겨지고 핀이 퍼진다.
   *
   * 카드에 이름·업종·도보 시간뿐이라(원본에 사진도 메뉴도 없다) 목록을 앞세울 이유도 약하다.
   * "내 주변에 캐시백 되는 데가 있나"에 답하는 건 이름 40개가 아니라 핀이 깔린 지도다.
   */
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 기준 장소 이름. 와이어프레임의 "성판악 탐방안내소 주변" 자리다.
   *
   * **사용자가 지도를 직접 끌면 버린다** (아래 onIdle). 현위치를 눌러 "현재 위치에서"가 뜬 뒤
   * 지도를 반대편으로 끌었는데 문구가 그대로면 거짓말이 된다 — 어디서 잰 거리인지 밝히는 게
   * 이 줄의 일이라, 틀린 이름보다 이름 없는 쪽이 낫다.
   */
  const [label, setLabel] = useState<string | null>(null);

  /** 내 위치 좌표. 카드의 "도보 N분"은 지도 한가운데가 아니라 **여기서** 잰다. */
  const [me, setMe] = useState<LatLng | null>(null);

  /** 내 발로 갈 만한 거리일 때만 미터를 준다. 아니면 null — 카드가 아예 안 적는다. */
  const walkFromMe = (s: TamnaShop) => {
    if (!me) return null;
    const d = meters(me, s.at);
    return d <= WALK_LIMIT_M ? d : null;
  };

  const move = useRef<((at: LatLng, radiusM: number) => void) | null>(null);

  /**
   * 이 자리의 가맹점. 데이터가 서버에 있어서(actions.ts) 계산이 아니라 **받아오는 값**이다.
   *
   * 지도가 멎을 때마다(idle) 한 번 나간다. 끄는 동안이 아니라 멎은 뒤라 드래그 한 번에 한 번이고,
   * 돌아오는 건 많아야 40곳이라 4KB 쯤이다 — 11,912곳 838KB 를 폰이 들고 있던 것과 바꾼 값이다.
   *
   * center 는 idle 마다 새 배열로 와서 값이 같아도 참조가 바뀐다. 숫자로 걸어 헛호출을 막는다
   * (app/route/page.tsx 의 load 와 같은 방식).
   */
  const [near, setNear] = useState<Nearby | null>(null);
  useEffect(() => {
    // 늦게 온 응답이 그 사이 옮겨간 자리의 목록을 덮으면 안 된다
    let 유효 = true;
    tamnaAround(label ?? "이 근처", center, RADIUS_M, kind).then((r) => 유효 && setNear(r));
    return () => {
      유효 = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, center[0], center[1], kind]);

  /**
   * 기준을 옮긴다 (현위치·검색·첫 화면). 축척에 쓸 거리가 서버에 있어서 비동기다.
   *
   * 옮기고 나면 idle 이 위 effect 를 한 번 더 돌려 같은 자리를 다시 받는다. 그냥 둔다 —
   * 막으려면 "방금 우리가 간 자리인가"를 좌표로 맞춰봐야 하는데, 그 판정이 한 번 어긋나면
   * 목록이 옛 동네에 붙은 채로 남는다. 4KB 를 아끼자고 걸 위험이 아니다.
   */
  const 옮기기 = async (at: LatLng) =>
    move.current?.(at, fitRadius(await tamnaAround("", at, RADIUS_M)));

  // 칩은 반경 안에 **실제로 있는 업종**으로만 만든다. 목록에 없는 업종을 칩으로 그리면
  // 눌러도 아무 일이 없다 (/parking 이 24시간 칩을 빼둔 것과 같은 이유).
  const kinds = useMemo(
    () => KIND_ORDER.filter((k) => near?.byKind[k]),
    [near],
  );

  // 업종 필터는 nearbyTamna 안에서 **자르기 전에** 걸린다 — 여기서 다시 거르면 안 된다.
  const shops = near?.shops ?? [];

  /**
   * 지도에 찍을 것. 목록(shops)과 따로 노는 두 가지가 있다.
   *
   *  1. 고른 곳이 업종 칩 때문에 목록에서 빠져도 핀은 남긴다 — 지도에 그 핀만 없으면
   *     어디를 고른 건지 알 수 없다 (/parking 과 같은 규칙).
   *  2. 고른 핀이 깔고 앉는 자리의 점은 뺀다. 가맹점이 몇 미터 간격으로 붙어 있는 자리가
   *     많아서(제주시청 1km 안 823곳) 고른 핀의 뾰족한 끝 바로 밑에 옆 가게 점이 걸리는데,
   *     그러면 고른 가게의 점은 분명히 지워졌는데도 "안 지워졌다"로 보인다 — 실제로 7px
   *     떨어진 경우를 쟀다. 목록에는 그대로 남으니 사라지는 건 지도 위 점 하나뿐이다.
   */
  const pins = useMemo(() => {
    const all = selected && !shops.some((s) => same(selected, s)) ? [...shops, selected] : shops;
    if (!selected) return all;
    return all.filter((s) => same(selected, s) || meters(selected.at, s.at) > PIN_CLEAR_M);
  }, [shops, selected]);

  /**
   * 현재 위치로 옮긴다 (/parking 의 locate 와 같다).
   *
   * 좌표를 받은 **뒤에만** 이름을 세운다 — 위치를 못 받았는데 머리글에 "현재 위치에서"가
   * 떠 있으면 제주시청에서 잰 숫자를 내 옆이라고 말하는 셈이 된다.
   */
  function locate(silent = false) {
    if (!("geolocation" in navigator)) {
      if (!silent) setError("이 브라우저는 위치 확인을 지원하지 않습니다");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setBusy(false);
        setSelected(null);
        setLabel("현재 위치");
        setMe([coords.latitude, coords.longitude]);
        옮기기([coords.latitude, coords.longitude]);
      },
      (err) => {
        setBusy(false);
        // 열자마자 부른 건(silent) 실패해도 조용히 넘어간다. 위치를 쓸 생각이 없는 사람에게
        // 묻지도 않은 경고가 화면에 계속 붙어 있으면, 정작 버튼을 눌렀을 때의 경고가 안 읽힌다.
        if (silent) return;
        setError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요."
            : "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // 지도가 만들어지면 두 가지를 한다.
  //
  //  1. 지금 보고 있는 곳(START)의 축척을 데이터에 맞춘다. 축척 맞추기는 move 안에 있어서
  //     현위치·검색으로 **옮길 때만** 걸렸고, 위치 권한을 거부하면 옮기는 일이 없어 첫 화면이
  //     START_LEVEL 그대로였다 — 핀 40개가 한 덩어리로 뭉친 채로.
  //  2. 위치를 물어본다. 받으면 그쪽으로 다시 옮기며 축척도 다시 맞춘다.
  //
  // 거부당하면 1번만 남아 제주시청에 머물고, 머리글도 "이 근처에서"로 남는다.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    옮기기(center);
    locate(true);
    // locate 는 매 렌더 새로 만들어지지만 여기서는 지도가 준비된 그 순간에만 부르면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    const found = await findPlace(q);
    setBusy(false);
    if ("error" in found) return setError(found.error);
    setSelected(null);
    setLabel(found.label);
    옮기기(found.coord);
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f2f5f0]">
      <Map
        pins={pins}
        selected={selected}
        onPick={setSelected}
        onIdle={(at, byUser) => {
          setCenter(at);
          if (byUser) setLabel(null);
        }}
        move={move}
        onReady={() => setReady(true)}
        onBlank={() => {
          // 빈 지도를 누르면 고른 곳을 풀고 목록도 내린다 — 시트가 62%를 덮고 있어서,
          // 지도를 더 보려면 버튼까지 손을 옮기는 대신 보이는 지도를 툭 치면 된다.
          setSelected(null);
          setOpen(false);
        }}
        fy={focusY(open)}
      />

      {/* 지도가 화면을 꽉 채우고 나머지는 그 위에 뜬다 (/parking 과 같은 full-map) */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <div className="pointer-events-auto px-4 text-[#1f1f1f] drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)]">
          <StatusBar tone="" />
        </div>

        {/*
          기준 장소 — 와이어프레임의 "성판악 탐방안내소 주변" 자리를 검색 입력으로 쓴다.
          제목("가는 길 주변")은 따로 두지 않고 ← 를 검색바 안에 넣었다 (/parking 과 같은 모양) —
          지도 위에 제목 줄을 한 겹 더 얹으면 그만큼 지도가 가려지고, 실제로 핀 위에 글자가 겹쳤다.
          프로필 쿼리를 그대로 돌려줘야 메인화면이 프로필을 되읽는다 (lib/profile.ts).
        */}
        <form
          onSubmit={search}
          className="pointer-events-auto mx-[18px] flex h-[58px] shrink-0 items-center gap-2 rounded-[29px] bg-white pr-[18px] pl-3 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)]"
        >
          <button
            type="button"
            onClick={() => router.push(`/home?${searchParams}`)}
            aria-label="뒤로"
            className="shrink-0 transition active:scale-90"
          >
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={label ? `${label} 주변` : "목적지 또는 주소 검색"}
            aria-label="기준 장소"
            className="min-w-0 flex-1 text-[14px] text-[#1f1f1f] outline-none placeholder:text-[#8a8a8a]"
          />
          {/* 돋보기는 /home·/destination 과 같은 자산을 쓴다 — 여기만 글자 ⌕ 라 모양이 혼자 달랐다 */}
          <button
            type="submit"
            aria-label="검색"
            disabled={busy}
            className="shrink-0 transition active:scale-90 disabled:opacity-40"
          >
            <img src="/home/icon-search.svg" alt="" className="h-[18px] w-[17px]" />
          </button>
        </form>

        {(error || busy) && (
          <p className="pointer-events-auto mx-[18px] mt-2 shrink-0 rounded-lg bg-white/95 px-3 py-2 text-[12px] leading-relaxed shadow">
            <span className={error ? "text-rose-600" : "text-[#616161]"}>{error ?? "찾는 중…"}</span>
          </p>
        )}

        <div className="flex-1" />

        {/* 현위치 — 시트가 떠 있으면 그 위로 비켜선다. 시트가 없을 때는 목록 버튼 위에 선다. */}
        <button
          // locate 를 그대로 넘기면 MouseEvent 가 silent 인자로 들어가 늘 조용해진다 —
          // 눌러서 실패했는데 아무 말도 안 하는 버튼이 된다. 인자 없이 부른다.
          onClick={() => locate()}
          aria-label="현재 위치"
          className={`pointer-events-auto mr-5 grid size-[46px] shrink-0 place-items-center self-end rounded-full bg-white text-[20px] text-[#2e9c85] shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:bg-black/5 ${
            open || selected ? "mb-[calc(62%+12px)]" : "mb-3"
          }`}
        >
          ◎
        </button>

        {/* 목록 보기 — 시트를 여는 유일한 문이다 (/parking 의 "목록으로 보기"와 같다) */}
        {!open && !selected && (
          <button
            onClick={() => setOpen(true)}
            className="pointer-events-auto mx-auto mt-3 mb-7 h-11 shrink-0 rounded-[22px] bg-[#1f1f1f] px-8 text-[14px] font-bold text-white shadow-lg active:scale-[0.98]"
          >
            목록 보기
          </button>
        )}
      </div>

      {/*
        시트는 **필요할 때만 존재한다** — 목록을 열었거나(open) 핀을 골랐을 때(selected).
        접힌 시트를 항상 깔아두면 칩 줄과 머리글이 지도를 계속 덮는데, 첫 화면에서 답해야 할
        질문은 "내 주변에 어디 있나"라서 그 자리는 지도가 쓰는 게 맞다 (/parking 과 같은 규칙).
      */}
      {(open || selected) && (
      <Sheet
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label={label}
        kinds={kinds}
        kind={kind}
        onKind={setKind}
        shops={shops}
        selected={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
        walkFromMe={walkFromMe}
      />
      )}
    </div>
  );
}

type SheetProps = {
  open: boolean;
  onToggle: () => void;
  label: string | null;
  kinds: string[];
  kind: string | null;
  onKind: (k: string | null) => void;
  shops: TamnaShop[];
  selected: TamnaShop | null;
  onPick: (s: TamnaShop) => void;
  onClear: () => void;
  /** 내 위치에서 걸어갈 만한 거리면 미터, 아니면 null (WALK_LIMIT_M) */
  walkFromMe: (s: TamnaShop) => number | null;
};

/**
 * 하단 시트 — 와이어프레임 두 프레임(올린 / 내린)이 여기 한 상태값이다.
 * 접어도 칩은 남긴다. 칩까지 사라지면 지도만 남아 무엇을 보고 있는지 알 수 없다.
 *
 * 핀을 고르면 목록 대신 **그 한 곳만** 보여준다 (/parking 의 SpotSheet 와 같다).
 * 목록을 그대로 두고 강조만 하면, 핀을 눌러도 화면이 그대로라 무엇을 골랐는지 알 수 없다.
 */
function Sheet({ open, onToggle, label, kinds, kind, onKind, shops, selected, onPick, onClear, walkFromMe }: SheetProps) {
  return (
    <aside
      /*
        높이는 애니메이션하지 않는다.

        내용(고른 한 곳 ↔ 목록)은 즉시 바뀌는데 높이만 200ms 동안 줄면, 빈 지도를 눌러 선택을
        풀 때 목록 40개가 잠깐 떴다가 쓸려 내려간다 — 실제로 그렇게 보였다. 둘을 맞추려면
        내용 교체도 같이 늦춰야 하는데, 그건 애니메이션 하나 얻자고 상태를 하나 더 드는 일이다.
      */
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)] ${
        selected || open ? "max-h-[62%]" : "max-h-[122px]"
      }`}
    >
      {/*
        손잡이 — 목록을 닫는 문이다 (빈 지도를 눌러도 닫히지만, 시트가 62%를 덮은 상태에서는
        누를 지도가 얼마 없다). 한 곳을 고른 상태에서는 목록으로 되돌아가는 문이 된다
        (/parking 과 같은 규칙).

        보이는 건 4px 막대지만 그대로 두면 누르기 어렵다 — 막대는 그대로 두고 그 둘레를
        버튼으로 넓힌다(위아래 여백 포함 28px). 시트 맨 위 여백(pt-2.5)을 버튼이 대신 먹는다.
      */}
      <button
        onClick={selected ? onClear : onToggle}
        aria-label={selected ? "목록으로 돌아가기" : "목록 닫기"}
        aria-expanded={selected ? undefined : open}
        className="-mt-2.5 flex h-7 w-full shrink-0 items-center justify-center"
      >
        <span aria-hidden className="block h-1 w-[38px] rounded-full bg-[#bfbfbf]" />
      </button>

      {selected ? (
        <Picked shop={selected} walkM={walkFromMe(selected)} onClose={onClear} />
      ) : (
        <List
          walkFromMe={walkFromMe}
          label={label}
          kinds={kinds}
          kind={kind}
          onKind={onKind}
          shops={shops}
          onPick={onPick}
        />
      )}
    </aside>
  );
}

/** 고른 한 곳. 지도에서 핀을 눌렀을 때 목록 대신 여기가 뜬다. */
function Picked({ shop, walkM, onClose }: { shop: TamnaShop; walkM: number | null; onClose: () => void }) {
  return (
    <div className="px-5 pt-4 pb-6">
      <p className="text-[12px] font-bold text-[#ff6114]">선택한 가맹점</p>
      <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-[#1f1f1f]">{shop.name}</h2>
      <p className="mt-2 text-[13px] text-[#525252]">
        {walkM == null ? shop.kind : `도보 ${walkMinutes(walkM)}분 · ${shop.kind}`}
      </p>
      {/* 여기는 배지를 남긴다 — 이 화면은 목록을 통째로 대신해서 머리글이 안 보이고,
          한 장뿐이라 반복도 아니다. 카드에서 뺀 것과 어긋나 보이지만 이유가 다르다. */}
      <span className="mt-3 inline-block rounded-md bg-[#ffebd6] px-2 py-1 text-[11px] font-bold text-[#ff6114]">
        탐나는전 캐시백
      </span>

      <button
        onClick={onClose}
        className="mt-5 h-[52px] w-full rounded-xl bg-[#f2f2f2] text-[14px] font-bold text-[#1f1f1f] active:scale-[0.99]"
      >
        목록으로 돌아가기
      </button>
    </div>
  );
}

type ListProps = Pick<SheetProps, "label" | "kinds" | "kind" | "onKind" | "shops" | "onPick" | "walkFromMe">;

/** 반경 안 가맹점 목록. 시트가 열려 있을 때만 그려진다. */
function List({ label, kinds, kind, onKind, shops, onPick, walkFromMe }: ListProps) {
  const scope = `${label ? `${label} ` : ""}주변 ${shops.length}곳`;
  const headClass = "shrink-0 px-5 pt-4 pb-1 text-[13px] font-bold text-[#1f1f1f]";
  return (
    <>
      {/* 업종 칩. "전체"만 우리가 넣고 나머지(음식점·숙박·주유)는 데이터에서 나온다 (byKind).
          와이어프레임의 "관광지·카페" 칩은 그리지 않는다 — 원본 업종에 그런 값이 없다. */}
      <div className="mt-3.5 flex shrink-0 gap-2 overflow-x-auto px-5 [&::-webkit-scrollbar]:hidden">
        <Chip on={kind === null} onClick={() => onKind(null)}>
          전체
        </Chip>
        {kinds.map((k) => (
          <Chip key={k} on={kind === k} onClick={() => onKind(k)}>
            {k}
          </Chip>
        ))}
      </div>

      {/*
        머리글이 "이 목록이 뭔지"를 대신 말한다 — 카드마다 붙어 있던 "탐나는전 캐시백" 배지를
        여기 한 번으로 옮겼다. 이 화면에 뜨는 건 애초에 캐시백 가맹점뿐이라
        (scripts/build-tamna-data.mjs 가 그렇게 거른다) 배지가 다른 값을 가질 일이 없고,
        40장에 전부 같은 배지는 구분하는 정보가 아니라 무늬다. 지우면 가게 이름이 또렷해진다.

        개수는 **목록에 실제로 있는 수**만 적는다. 반경 안 전체(817곳)는 관광객이 쓸 숫자가
        아니고, "여기 많다"는 지도에 깔린 핀이 이미 말한다.

        label 이 없다는 건 위치를 못 받았거나(권한 거부) 사용자가 지도를 직접 움직였다는 뜻이라,
        그때 장소 이름을 적으면 거짓이 된다. 그럴 땐 기준을 말하지 않고 "가까운 N곳"만 남긴다.
      */}
      <p className={headClass}>
        <span className="text-[#ff6114]">탐나는전 캐시백</span>
        <span className="text-[#c4c4c4]"> · </span>
        {scope}
      </p>

      {/*
        "도보 3분"만 있으면 뭘 기준으로 3분인지 알 수 없다. 카드마다 "내 위치에서"를 붙이면
        오른쪽 자리가 좁아 가게 이름이 잘리므로, 배지를 머리글로 올렸을 때처럼 한 번만 말한다.
        도보 시간이 한 곳도 안 붙는 상태(위치 모름·전부 2km 밖)에서는 설명할 것이 없으니 안 그린다.
      */}
      {shops.some((s) => walkFromMe(s) != null) && (
        <p className="shrink-0 px-5 pb-0.5 text-[11px] text-[#8a8a8a]">도보 시간은 현재 위치 기준이에요</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {shops.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-[#616161]">
            이 근처에는 아직 등록된 곳이 없습니다.
            <br />
            지도를 옮기거나 칩을 눌러보세요.
          </p>
        )}
        {/* 목록은 가까운 순으로 잘라 보여준다. 머리글 숫자와 카드 수가 다른 이유를 여기서 밝힌다. */}
        {shops.map((s) => (
          <ShopCard key={idOf(s)} shop={s} walkM={walkFromMe(s)} onClick={() => onPick(s)} />
        ))}

      </div>
    </>
  );
}

/** 업종 칩 — 켜면 주황 테두리(와이어프레임의 선택 상태), 끄면 회색 테두리 */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-[33px] shrink-0 rounded-[16.5px] border px-4 text-[13px] font-bold transition ${
        on ? "border-[#ff6114] bg-[#fff3ec] text-[#ff6114]" : "border-[#e2e2e2] bg-white text-[#616161]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 목록 카드 한 장.
 *
 * 와이어프레임에는 왼쪽에 음식 사진이, 아래에 "한식 · 8,000원~" 같은 대표 품목이 있다.
 * 원본 데이터에는 둘 다 없다 — 가맹점명·주소·업종뿐이다. 없는 걸 지어내느니 업종만 둔다.
 */
function ShopCard({ shop, walkM, onClick }: { shop: TamnaShop; walkM: number | null; onClick: () => void }) {
  return (
    <button
      id={idOf(shop)}
      onClick={onClick}
      className="mt-2.5 flex w-full items-center gap-3 rounded-2xl border border-[#ececec] bg-white p-3 text-left transition active:bg-black/[0.03]"
    >
      <span
        aria-hidden
        className="grid size-[58px] shrink-0 place-items-center rounded-xl bg-[#f2f2f2] text-[13px] font-bold text-[#8a8a8a]"
      >
        {shop.kind.slice(0, 2)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="truncate text-[15px] font-bold text-[#1f1f1f]">{shop.name}</span>
          {/* 걸어갈 만한 거리가 아니면 줄 자체를 안 그린다 — 빈 자리를 남기면 무언가 빠진 것처럼 보인다 */}
          {walkM != null && (
            <span className="shrink-0 text-[13px] tabular-nums text-[#525252]">
              도보 {walkMinutes(walkM)}분
            </span>
          )}
        </span>

        {/* 캐시백 배지는 목록 머리글로 옮겼다 — 40장이 전부 같은 값이라 카드에서는 무늬였다 */}
        <span className="mt-1.5 block truncate text-[12px] text-[#616161]">{shop.kind}</span>
      </span>
    </button>
  );
}

/**
 * 핀. 탐나는전 정식 앱과 같은 물방울 모양이고, 둘은 **속으로** 갈린다 —
 * 안 고른 것은 **빈** 핀(흰 바탕 + 주황 테두리), 고른 것은 **찬** 핀(주황 + 흰 테두리 + 로고)이다.
 *
 * 둘 다 주황으로 채워봤더니 지도가 주황 수프가 됐다 — 카카오 지도는 가게 이름을 주황 글씨로
 * 쓰기 때문에 우리 핀 40개가 지도 원래 글자와 안 갈리고, 고른 하나도 나머지 39개에 묻혔다.
 * 몸통을 희게 비우면 지도에서 떨어져 나오고, 선택은 "채워졌다"로 읽힌다.
 *
 * 둘 다 그림자를 깐다 (feDropShadow). 종이처럼 들려 보여야 지도 위에 얹힌 것으로 읽힌다.
 *
 * 안 고른 39개까지 로고를 넣지 않는 이유 — 얼굴은 사람 눈이 자동으로 쫓는 형태라 40개가 깔리면
 * 기호보다 훨씬 시끄럽다. 어차피 40개가 다 같은 캐시백 가맹점이라 하나하나가 무엇인지 말할 게 없고,
 * 지도가 할 일은 "이 동네에 이만큼 깔려 있다"다. 로고는 고른 하나에만 붙어 그게 어디인지 말한다.
 *
 * **모양도 크기도 갈린다.** 안 고른 것은 꼬리도 테두리도 없는 22px 동그라미, 고른 것은 50x70
 * 물방울이다. 40개가 다 물방울이면 크기 차이(32 vs 50)만으로는 어느 게 골라진 건지 안 읽혔다 —
 * 모양이 아예 다르고 넓이가 8배쯤 나야 눈이 하나를 집어낸다.
 *
 * 동그라미는 지도 위 점이니 **한가운데**가 그 가게 자리고, 물방울은 뾰족한 끝이 자리다.
 * 그래서 아래 기준점이 둘이 다르다.
 *
 * off 는 인라인 data: URI 다 (/parking 과 같은 방식). 로고가 빠지면서 path 하나 182바이트가 돼
 * 파일로 둘 이유가 없어졌고, **파일로 두면 고칠 때마다 브라우저 이미지 캐시에 걸린다** —
 * 모양을 바꿔도 옛 핀이 그대로 뜬다. 인라인이면 소스가 바뀔 때 URI 자체가 바뀌어 그 일이 없다.
 *
 * on 만 **파일**인 이유 — 로고가 자동 벡터화로 딴 것이라 좌표가 6KB다. 그걸 소스에 인라인으로
 * 박으면 이 파일이 읽을 수 없게 된다. 요청 한 번은 그 값을 한다 (대신 캐시는 감수한다).
 */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 40">
     <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
       <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#000" flood-opacity="0.3"/>
     </filter>
     <rect x="6" y="6" width="44" height="28" rx="14" fill="#ffbf9a" filter="url(#s)"/>
   </svg>`,
);

const PIN_ON = "/tamna-pin-on.svg";

/**
 * 핀 크기와 **기준점** — [폭, 높이, 기준 x, 기준 y].
 *
 * 그림자가 번질 자리를 만드느라 캔버스가 그림보다 커서, 카카오 기본값("이미지 아래 가운데")을
 * 그대로 두면 핀이 몇 px 떠서 엉뚱한 건물을 가리킨다. 그려진 자리를 직접 넘겨 막는다.
 * 타원은 한가운데 (28,20), 물방울은 끝점 (28,69) — 각각 그린 크기로 환산한 값이다.
 */
const PIN_SIZE = [38, 27, 19, 14] as const;
const PIN_ON_SIZE = [50, 70, 25, 62] as const;

/**
 * 우리가 지도를 옮긴 뒤 멎기까지 넉넉히 잡은 시간.
 * 한 번 옮기면 idle 이 여러 번 온다(setCenter·setLevel·panBy). 이 안에 온 건 사용자가 끈 게 아니다.
 */
const SETTLE_MS = 1200;

/**
 * 하단 시트가 덮는 높이 (화면 대비). Sheet 의 max-h 클래스와 **같이** 움직여야 한다 —
 * 한쪽만 바뀌면 기준점이 시트 뒤로 숨거나 화면 꼭대기로 올라붙는다.
 */
const SHEET_OPEN = 0.62;
const SHEET_SHUT = 0.1; // 시트가 없을 때 아래를 차지하는 "목록 보기" 버튼 자리 (약 80px)

/** 위에서 지도를 덮는 것 — 상태바 + 검색바 (약 120px ÷ 812). 여기도 핀을 두면 안 보인다. */
const TOP_CHROME = 0.15;

/**
 * 지도의 세로 어디를 "여기"로 삼을지 (컨테이너 높이 대비).
 *
 * 지도는 화면을 꽉 채우지만 아래쪽은 하단 시트가 덮는다. 그래서 지도 한가운데(0.5)를
 * 기준으로 잡으면 반경 1km 안 가맹점이 **전부 시트 뒤에 숨는다** — 실제로 그랬다.
 * 위로는 검색바(TOP_CHROME)가, 아래로는 시트가 덮는다. 그 사이 **진짜 보이는 띠**의
 * 한가운데를 기준으로 삼아야 핀과 목록이 같은 곳을 가리킨다. 검색바를 안 빼면 핀이
 * 검색바 뒤에 숨는다 — 이것도 실제로 그랬다.
 *
 * 시트를 접으면 보이는 띠가 넓어지므로 기준점도 같이 내려가야 한다. 고정값으로 두면
 * 접었을 때 핀이 전부 검색바 밑으로 몰리고 아래쪽 지도가 텅 빈다 — 이것도 실제로 그랬다.
 */
const focusY = (open: boolean) => (TOP_CHROME + (1 - (open ? SHEET_OPEN : SHEET_SHUT))) / 2;

/**
 * 지도에서 기준으로 삼을 좌표. 시트 위로 보이는 띠의 가운데다 (focusY).
 *
 * 픽셀 → 좌표 변환(coordsFromContainerPoint)은 쓰지 않는다. 실려 오는 SDK 빌드의
 * Projection 에는 그 메서드가 없어서 조용히 지도 한가운데로 물러났다 — 핀이 전부
 * 시트 뒤에 숨은 채로. 대신 문서화된 getBounds() 로 화면 전체가 덮는 위도 폭을 재고,
 * 그 폭의 (0.5 - fy) 만큼 북쪽으로 올린다. 화면 높이 = 위도 폭이라 비율이 그대로 맞는다.
 */
function focus(map: any, fy: number): LatLng {
  const c = map.getCenter();
  const b = map.getBounds?.();
  if (!b) return [c.getLat(), c.getLng()];
  const latSpan = b.getNorthEast().getLat() - b.getSouthWest().getLat();
  return [c.getLat() + latSpan * (0.5 - fy), c.getLng()];
}

type MapProps = {
  pins: TamnaShop[];
  selected: TamnaShop | null;
  onPick: (s: TamnaShop) => void;
  /** byUser 는 우리가 옮긴 게 아니라 사용자가 지도를 끌었다는 뜻이다. */
  onIdle: (at: LatLng, byUser: boolean) => void;
  move: React.RefObject<((at: LatLng, radiusM: number) => void) | null>;
  /** 지도가 만들어져 move 를 쓸 수 있게 된 순간. 부모가 현위치로 옮기는 시점이다. */
  onReady: () => void;
  /** 핀이 아닌 빈 지도를 눌렀을 때. 고른 가맹점을 푼다. */
  onBlank: () => void;
  /** 기준으로 삼을 세로 위치 (focusY). 시트를 접었다 펴면 바뀐다. */
  fy: number;
};

/**
 * 주변 업소 지도. RouteMap 대신 SDK 로더만 가져다 쓴다 —
 * 거기는 경로가 다 담기도록 매번 setBounds 를 다시 걸어서, 지도를 움직이는 족족 되돌아온다.
 * (/parking 의 Map 과 같은 이유·같은 골격이다.)
 */
function Map({ pins, selected, onPick, onIdle, move, onReady, onBlank, fy }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 핸들러가 지도 생성 effect 안에 갇히므로(한 번만 돈다) 최신 값을 ref 로 넘긴다
  const pick = useRef(onPick);
  pick.current = onPick;
  const idle = useRef(onIdle);
  idle.current = onIdle;
  const ready = useRef(onReady);
  ready.current = onReady;
  const blank = useRef(onBlank);
  blank.current = onBlank;
  /** 마지막으로 마커를 누른 시각. 지도 click 이 마커 click 뒤에 따라 올라오는지 가리는 데 쓴다. */
  const pickedAt = useRef(0);
  const focusRef = useRef(fy);
  focusRef.current = fy;
  /** 마지막으로 **우리가** 지도를 옮긴 시각. 이후 SETTLE_MS 안에 온 idle 은 사용자 조작이 아니다. */
  const movedAt = useRef(0);

  useEffect(() => {
    loadSdk().then(
      () => setSdk("ready"),
      () => setSdk("error"),
    );
  }, []);

  useEffect(() => {
    if (sdk !== "ready" || !box.current) return;
    const { kakao } = window;
    const pt = ([lat, lng]: LatLng) => new kakao.maps.LatLng(lat, lng);

    const m = new kakao.maps.Map(box.current, { center: pt(START), level: START_LEVEL });
    map.current = m;

    // move 로 옮기면 idle 이 여러 번 온다(setCenter·setLevel·panBy). 그 사이에 온 건 전부
    // 우리가 옮긴 것으로 친다 — 사용자가 끈 것만 기준 장소 이름을 버리게 해야 한다.
    kakao.maps.event.addListener(m, "idle", () => {
      idle.current(focus(m, focusRef.current), Date.now() - movedAt.current > SETTLE_MS);
    });

    // idle 은 사용자가 지도를 움직여야 온다. 처음 열었을 때는 오지 않아서 기준점이 START(=지도
    // 한가운데) 로 남았고, 그러면 반경 안 가맹점이 전부 시트 뒤에 숨는다. 첫 타일이 깔린 뒤
    // 한 번만 직접 부른다 — 그때는 getBounds() 도 값을 준다. 이후는 idle 이 맡는다.
    const first = () => {
      idle.current(focus(m, focusRef.current), false);
      kakao.maps.event.removeListener(m, "tilesloaded", first);
    };
    kakao.maps.event.addListener(m, "tilesloaded", first);

    // 빈 지도를 누르면 고른 가맹점을 푼다.
    //
    // 마커를 눌러도 이 이벤트가 **따라 올라온다** — 그대로 두면 핀을 고르는 즉시 풀려서
    // 아무것도 선택되지 않는다(실제로 그랬다). 방금 마커를 누른 직후면 무시한다.
    kakao.maps.event.addListener(m, "click", () => {
      if (Date.now() - pickedAt.current < 300) return;
      blank.current();
    });

    move.current = (at, radiusM) => {
      movedAt.current = Date.now();
      const h = box.current?.clientHeight ?? 0;
      const fy = focusRef.current;

      m.setCenter(pt(at));

      /*
        축척을 데이터에 맞춘다.

        setBounds(bounds, ...padding) 은 쓰지 않는다 — 이 SDK 빌드에서는 여백 인자가 먹지 않고,
        뒤이어 부른 setCenter·panBy 까지 덮어써서 핀이 시트 뒤 한가운데로 돌아갔다.
        (Projection 의 coordsFromContainerPoint 가 없던 것과 같은 종류의 함정이다.)

        대신 지금 축척에서 **보이는 띠**가 몇 미터인지 한 번 재고, 필요한 레벨을 계산해서
        한 번에 간다. 재고-바꾸고를 반복하면 안 된다 — getBounds() 가 setLevel 직후에는
        옛 값을 주기 때문에, 루프가 조건을 못 빠져나와 레벨 1까지 내리꽂았다(빈 지도가 떴다).
        레벨 한 단계는 축척 두 배라 log2 로 몇 단계인지 바로 나온다.
      */
      const band = 2 * (fy - TOP_CHROME); // 검색바와 시트 사이, 실제로 보이는 세로 비율
      const b = m.getBounds();
      const nowM = (b.getNorthEast().getLat() - b.getSouthWest().getLat()) * 111_000 * band;
      const want = radiusM * FIT_SPAN;
      if (nowM > 0) {
        const step = Math.round(Math.log2(want / nowM));
        m.setLevel(Math.min(12, Math.max(1, m.getLevel() + step)));
      }

      // 옮겨간 곳을 지도 한가운데(=시트 뒤)가 아니라 기준점(focusY) 자리로 올린다.
      // 안 하면 "성판악에서 가까운 순"이라 적어놓고 성판악 북쪽 어딘가를 기준으로 재게 된다.
      if (h) m.panBy(0, h * (0.5 - fy));
    };

    ready.current();

    // 컨테이너가 0폭인 동안 만들어지면 축척이 터진다 (RouteMap 과 같은 이유)
    const ro = new ResizeObserver(() => m.relayout());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, move]);

  /*
    시트를 접었다 펴면 보이는 띠가 달라지므로 기준점(focusY)도 달라진다.

    기준점만 다시 잡으면 안 된다 — **지도는 가만히 있는데 기준만 화면의 26% 위로 뛴다.**
    그러면 보고 있던 동네 대신 검색바 위쪽에서 40곳이 새로 뽑혀서, 목록 보기를 누른 것뿐인데
    처음 보는 핀이 화면 꼭대기에 우르르 생긴다(상태바에 걸린 채로). 목록을 여는 행위가
    목록의 내용을 바꾸면 안 된다.

    그래서 기준점이 움직인 만큼 **지도를 옮긴다.** 보던 자리가 새 띠 한가운데로 따라 올라오고,
    기준 좌표는 그대로라 뽑히는 40곳도 그대로다.

    panBy 는 쓰지 않는다 — 픽셀 값은 맞게 넘어가는데 이 SDK 빌드에서 지도가 꿈쩍도 안 했다
    (setBounds 의 여백 인자가 먹지 않던 것과 같은 종류다). 대신 getBounds() 로 화면이 덮는
    위도 폭을 재서 setCenter 로 직접 간다 — focus() 가 쓰는 것과 같은 계산이다.
    화면을 위로 밀려면 중심이 남쪽으로 가야 하므로 부호는 (fy - prev) 다.
  */
  const shownFy = useRef(fy);
  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const m = map.current;
    const prev = shownFy.current;
    shownFy.current = fy;

    const b = prev !== fy ? m.getBounds?.() : null;
    if (b) {
      const span = b.getNorthEast().getLat() - b.getSouthWest().getLat();
      const c = m.getCenter();
      movedAt.current = Date.now(); // 우리가 옮긴 것 — 기준 장소 이름을 버리면 안 된다
      m.setCenter(new window.kakao.maps.LatLng(c.getLat() + (fy - prev) * span, c.getLng()));
    }
    idle.current(focus(m, fy), false);
  }, [sdk, fy]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h, ax, ay] = on ? PIN_ON_SIZE : PIN_SIZE;
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h), {
          offset: new kakao.maps.Point(ax, ay),
        }),
      });
      kakao.maps.event.addListener(marker, "click", () => {
        pickedAt.current = Date.now();
        pick.current(s);
      });
      marker.setMap(map.current);
      return marker;
    });
  }, [sdk, pins, selected]);

  const notice = !process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
    ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
    : sdk === "loading"
      ? "지도를 불러오는 중…"
      : sdk === "error"
        ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
        : null;

  return (
    <>
      <div ref={box} className="absolute inset-0" />
      {notice && (
        <p className="absolute inset-x-0 top-1/2 z-0 px-8 text-center text-[13px] text-[#616161]">{notice}</p>
      )}
    </>
  );
}
