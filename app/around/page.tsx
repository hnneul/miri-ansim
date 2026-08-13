"use client";

// 가는 길 주변 — 와이어프레임 "탐나는전" (Figma 2160:2236 / 2191:2803).
// 두 프레임은 화면 두 장이 아니라 하단 시트의 두 상태다(목록 올림 / 목록 내림).
// /parking 이 핀 지도와 시트를 한 파일에 둔 것과 같은 구조라 거기 규칙을 그대로 따른다.
//
// 메인화면(/home)의 "탐나는전 사용처" 카드로 들어온다.
//
// **지금 찍는 데이터는 착한가격업소 417곳뿐이다.** 탐나는전 가맹점(공공데이터포털 15157894,
// 48,081행)은 주소만 있고 좌표가 없어 지오코딩을 돌려야 해서 아직 굳혀둔 파일이 없다.
// ponytail: 그 데이터가 들어오면 SHOPS 에 합치고 배지(source)만 늘리면 된다 —
//   업종 칩은 데이터에서 자동으로 생기므로(kinds) 칩을 손댈 필요가 없다.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { loadSdk, type LatLng } from "../RouteMap";
import { findPlace } from "../destination/actions";
import { nearbyGoodprice, type GoodpriceShop, type Shop } from "@/lib/goodprice";
import { walkMinutes } from "@/lib/parking";
import GOODPRICE from "@/data/goodprice-data.json";

const SHOPS = GOODPRICE.shops as Shop[];

/**
 * 반경. data/goodprice-data.json 을 만들 때 쓴 값(3km)을 그대로 쓴다.
 * 1km로 좁히면 성산 1곳·협재 0곳이라 동·서 구간이 통째로 빈다 (lib/goodprice.ts 주석).
 */
const RADIUS_M = 3000;

/** 처음 보고 있을 곳 — 제주시청. /parking 과 같은 이유로 섬 한가운데(한라산)를 잡지 않는다. */
const START: LatLng = [33.4996, 126.5312];
const START_LEVEL = 5;

/** 검색으로 옮겨갈 때 축척. 반경 3km가 화면에 담기는 정도다. */
const FOCUS_LEVEL = 6;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function AroundPage() {
  return (
    <Suspense>
      <Around />
    </Suspense>
  );
}

/** 같은 업소인가. 이름만 보면 지점이 겹칠 수 있어 좌표까지 본다 (/parking 과 같은 규칙). */
const same = (a: GoodpriceShop | null, b: GoodpriceShop) =>
  !!a && a.name === b.name && a.at[0] === b.at[0] && a.at[1] === b.at[1];

const idOf = (s: GoodpriceShop) => `shop-${s.name}-${s.at[0]}-${s.at[1]}`;

function Around() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [center, setCenter] = useState<LatLng>(START);
  const [kind, setKind] = useState<string | null>(null); // null = 전체
  const [selected, setSelected] = useState<GoodpriceShop | null>(null);
  const [open, setOpen] = useState(true); // 시트 두 상태 — 와이어프레임의 올린/내린 버전
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 기준 장소 이름. 와이어프레임의 "성판악 탐방안내소 주변" 자리다.
   * 검색하기 전에는 지도를 움직이는 대로 기준이 바뀌므로 장소 이름을 지어내지 않는다 —
   * 어디서 잰 거리인지 밝히지 않으면 "도보 3분"이 근거 없는 숫자가 된다 (/parking 과 같은 판단).
   */
  const [label, setLabel] = useState<string | null>(null);

  const move = useRef<((at: LatLng, level?: number) => void) | null>(null);

  const near = useMemo(
    () => nearbyGoodprice(label ?? "지도 가운데", center, SHOPS, RADIUS_M),
    [label, center],
  );

  // 칩은 반경 안에 **실제로 있는 업종**으로만 만든다. 목록에 없는 업종을 칩으로 그리면
  // 눌러도 아무 일이 없다 (/parking 이 24시간 칩을 빼둔 것과 같은 이유).
  const kinds = useMemo(() => Object.keys(near?.byKind ?? {}), [near]);

  const shops = useMemo(
    () => (near?.shops ?? []).filter((s) => !kind || s.kind === kind),
    [near, kind],
  );

  // 고른 곳이 업종 칩 때문에 목록에서 빠져도 핀은 남긴다 — 지도에 그 핀만 없으면
  // 어디를 고른 건지 알 수 없다 (/parking 과 같은 규칙).
  const pins = useMemo(
    () => (selected && !shops.some((s) => same(selected, s)) ? [...shops, selected] : shops),
    [shops, selected],
  );

  // 핀을 누르면 목록에서 그 카드로 데려간다. 목록을 접어둔 상태면 먼저 편다.
  useEffect(() => {
    if (!selected) return;
    setOpen(true);
    document.getElementById(idOf(selected))?.scrollIntoView({ block: "nearest" });
  }, [selected]);

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
    move.current?.(found.coord, FOCUS_LEVEL);
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f2f5f0]">
      <Map pins={pins} selected={selected} onPick={setSelected} onIdle={setCenter} move={move} />

      {/* 지도가 화면을 꽉 채우고 나머지는 그 위에 뜬다 (/parking 과 같은 full-map) */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <div className="pointer-events-auto px-4 text-[#1f1f1f] drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)]">
          <StatusBar tone="" />
        </div>

        {/* 앱바 — 와이어프레임은 ← 와 제목만 있다. 프로필 쿼리를 그대로 돌려줘야
            메인화면이 프로필을 되읽는다 (lib/profile.ts). */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-2 px-4">
          <button
            onClick={() => router.push(`/home?${searchParams}`)}
            aria-label="뒤로"
            className="grid size-9 shrink-0 place-items-center rounded-full text-[18px] text-[#1f1f1f] active:bg-black/5"
          >
            ←
          </button>
          <h1 className="text-[18px] font-bold text-[#1f1f1f]">가는 길 주변</h1>
        </div>

        {/* 기준 장소 — 와이어프레임의 "성판악 탐방안내소 주변" 자리를 검색 입력으로 쓴다 */}
        <form
          onSubmit={search}
          className="pointer-events-auto mx-[18px] mt-2.5 flex h-[46px] shrink-0 items-center gap-2 rounded-[23px] bg-white pr-4 pl-[18px] shadow-[0_4px_16px_0_rgba(0,0,0,0.12)]"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={label ? `${label} 주변` : "목적지 또는 주소 검색"}
            aria-label="기준 장소"
            className="min-w-0 flex-1 text-[14px] text-[#1f1f1f] outline-none placeholder:text-[#8a8a8a]"
          />
          <button
            type="submit"
            aria-label="검색"
            disabled={busy}
            className="shrink-0 text-[17px] leading-none text-[#1f1f1f] disabled:opacity-40"
          >
            ⌕
          </button>
        </form>

        {(error || busy) && (
          <p className="pointer-events-auto mx-[18px] mt-2 shrink-0 rounded-lg bg-white/95 px-3 py-2 text-[12px] leading-relaxed shadow">
            <span className={error ? "text-rose-600" : "text-[#616161]"}>{error ?? "찾는 중…"}</span>
          </p>
        )}

        <div className="flex-1" />
      </div>

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
      />
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
  shops: GoodpriceShop[];
  selected: GoodpriceShop | null;
  onPick: (s: GoodpriceShop) => void;
};

/**
 * 하단 시트 — 와이어프레임 두 프레임(올린 / 내린)이 여기 한 상태값이다.
 * 접어도 칩은 남긴다. 칩까지 사라지면 지도만 남아 무엇을 보고 있는지 알 수 없다.
 */
function Sheet({ open, onToggle, label, kinds, kind, onKind, shops, selected, onPick }: SheetProps) {
  return (
    <aside
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)] transition-[max-height] duration-200 ${
        open ? "max-h-[62%]" : "max-h-[122px]"
      }`}
    >
      <button
        onClick={onToggle}
        aria-label={open ? "목록 접기" : "목록 펼치기"}
        aria-expanded={open}
        className="mx-auto block h-1 w-[38px] shrink-0 rounded-full bg-[#bfbfbf]"
      />

      {/* 업종 칩. "전체"만 우리가 넣고 나머지는 데이터에서 나온다 (byKind).
          ponytail: 탐나는전 데이터가 들어오면 여기에 "탐나는전"·"착한가격" 같은
            출처 칩을 한 줄 더 얹는다 — 지금은 전부 착한가격이라 걸러낼 게 없다. */}
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

      <p className="shrink-0 px-5 pt-4 pb-1 text-[13px] font-bold text-[#1f1f1f]">
        {label ? `${label}에서` : "지도 가운데에서"} 가까운 순 · {shops.length}곳
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {shops.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-[#616161]">
            이 근처에는 아직 등록된 곳이 없습니다.
            <br />
            지도를 옮기거나 칩을 눌러보세요.
          </p>
        )}
        {shops.map((s) => (
          <ShopCard key={idOf(s)} shop={s} on={same(selected, s)} onClick={() => onPick(s)} />
        ))}
      </div>
    </aside>
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
 * 와이어프레임에는 왼쪽에 음식 사진이 있지만 데이터에 사진이 없다 —
 * 없는 사진을 채우느니 업종 글자를 둔다. 대표 품목도 지어내지 않고 menu[0] 을 그대로 쓴다.
 */
function ShopCard({ shop, on, onClick }: { shop: GoodpriceShop; on: boolean; onClick: () => void }) {
  return (
    <button
      id={idOf(shop)}
      onClick={onClick}
      className={`mt-2.5 flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:bg-black/[0.03] ${
        on ? "border-[#ff6114] bg-[#fff8f4]" : "border-[#ececec] bg-white"
      }`}
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
          <span className="shrink-0 text-[13px] tabular-nums text-[#525252]">
            도보 {walkMinutes(shop.distM)}분
          </span>
        </span>

        {/* 지금은 전부 착한가격업소라 배지가 하나뿐이다.
            ponytail: 탐나는전이 들어오면 출처에 따라 배지를 갈아 끼운다. */}
        <span className="mt-1.5 inline-block rounded-md bg-[#ffebd6] px-2 py-1 text-[11px] font-bold text-[#ff6114]">
          착한가격
        </span>

        <span className="mt-1.5 block truncate text-[12px] text-[#616161]">
          {[shop.kind, shop.menu[0]].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}

/** 핀. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다 (/parking 과 같은 방식). */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="34" viewBox="0 0 44 34">
     <rect x="1.5" y="1.5" width="41" height="31" rx="15.5" fill="#fff" stroke="#1f1f1f" stroke-width="2"/>
     <text x="22" y="23" font-family="system-ui,sans-serif" font-size="15" font-weight="700"
           fill="#1f1f1f" text-anchor="middle">₩</text>
   </svg>`,
);

const PIN_ON = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="42" viewBox="0 0 54 42">
     <rect x="2" y="2" width="50" height="38" rx="19" fill="#ff6114" stroke="#1f1f1f" stroke-width="2"/>
     <text x="27" y="28" font-family="system-ui,sans-serif" font-size="18" font-weight="700"
           fill="#fff" text-anchor="middle">₩</text>
   </svg>`,
);

type MapProps = {
  pins: GoodpriceShop[];
  selected: GoodpriceShop | null;
  onPick: (s: GoodpriceShop) => void;
  onIdle: (at: LatLng) => void;
  move: React.RefObject<((at: LatLng, level?: number) => void) | null>;
};

/**
 * 주변 업소 지도. RouteMap 대신 SDK 로더만 가져다 쓴다 —
 * 거기는 경로가 다 담기도록 매번 setBounds 를 다시 걸어서, 지도를 움직이는 족족 되돌아온다.
 * (/parking 의 Map 과 같은 이유·같은 골격이다.)
 */
function Map({ pins, selected, onPick, onIdle, move }: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");

  // 핸들러가 지도 생성 effect 안에 갇히므로(한 번만 돈다) 최신 값을 ref 로 넘긴다
  const pick = useRef(onPick);
  pick.current = onPick;
  const idle = useRef(onIdle);
  idle.current = onIdle;

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

    kakao.maps.event.addListener(m, "idle", () => {
      const c = m.getCenter();
      idle.current([c.getLat(), c.getLng()]);
    });

    move.current = (at, level) => {
      if (level) m.setLevel(level);
      m.panTo(pt(at));
    };

    // 컨테이너가 0폭인 동안 만들어지면 축척이 터진다 (RouteMap 과 같은 이유)
    const ro = new ResizeObserver(() => m.relayout());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, move]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h] = on ? [54, 42] : [44, 34];
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h)),
      });
      kakao.maps.event.addListener(marker, "click", () => pick.current(s));
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
