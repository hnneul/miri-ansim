"use client";

// 가는 길 주변 — 와이어프레임 "탐나는전" (Figma 2160:2236 / 2191:2803).
// 두 프레임은 화면 두 장이 아니라 하단 시트의 두 상태다(목록 올림 / 목록 내림).
// /parking 이 핀 지도와 시트를 한 파일에 둔 것과 같은 구조라 거기 규칙을 그대로 따른다.
//
// 메인화면(/home)의 "탐나는전 사용처" 카드로 들어온다.
//
// 찍는 것은 **탐나는전 캐시백 가맹점**뿐이다 (data/tamna-data.json, 11,912곳).
// 착한가격업소는 여기 섞지 않는다 — 둘 다 놓으면 "여기서 결제하면 10% 돌려받는다"는
// 이 화면 한 줄이 흐려진다. 착한가격 데이터와 lib/goodprice.ts 는 그대로 남아 있다.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import { loadSdk, type LatLng } from "../RouteMap";
import { findPlace } from "../destination/actions";
import { nearbyTamna, type Shop, type TamnaShop } from "@/lib/tamna";
import { walkMinutes } from "@/lib/parking";
import TAMNA from "@/data/tamna-data.json";

const SHOPS = TAMNA.shops as Shop[];

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
 */
function fitRadius(at: LatLng): number {
  const near = nearbyTamna("", at, SHOPS, RADIUS_M);
  if (!near) return RADIUS_M;
  return Math.max(near.shops[near.shops.length - 1].distM, MIN_FIT_M);
}

/**
 * 아무리 뭉쳐 있어도 이보다 더 당기지는 않는다.
 * 40곳이 30m 안에 있는 골목이 있는데, 거기 맞춰 당기면 건물 몇 채만 남고 어디인지 알 수 없다.
 */
const MIN_FIT_M = 150;

/**
 * 화면에 담을 폭 = 반경 × 이 값.
 *
 * 2.0(=지름)이면 40곳이 전부 화면에 들어오지만 시내에서는 핀이 서로를 덮는다.
 * 1.4 면 가장자리 몇 곳이 화면 밖으로 나가는 대신 나머지가 읽을 만해진다 —
 * 정확한 답은 어차피 목록이고(40곳 전부), 지도가 할 일은 "이 동네에 이만큼 깔려 있다"다.
 */
const FIT_SPAN = 1.4;

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

  const move = useRef<((at: LatLng, radiusM: number) => void) | null>(null);

  const near = useMemo(
    () => nearbyTamna(label ?? "이 근처", center, SHOPS, RADIUS_M),
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
        move.current?.([coords.latitude, coords.longitude], fitRadius([coords.latitude, coords.longitude]));
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
    move.current?.(center, fitRadius(center));
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
    move.current?.(found.coord, fitRadius(found.coord));
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
        onBlank={() => setSelected(null)}
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
            className="grid size-9 shrink-0 place-items-center rounded-full text-[18px] text-[#1f1f1f] active:bg-black/5"
          >
            ←
          </button>
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
        onLocate={locate}
        label={label}
        kinds={kinds}
        kind={kind}
        onKind={setKind}
        shops={shops}
        selected={selected}
        onPick={setSelected}
        onClear={() => setSelected(null)}
      />
    </div>
  );
}

type SheetProps = {
  open: boolean;
  onToggle: () => void;
  onLocate: () => void;
  label: string | null;
  kinds: string[];
  kind: string | null;
  onKind: (k: string | null) => void;
  shops: TamnaShop[];
  selected: TamnaShop | null;
  onPick: (s: TamnaShop) => void;
  onClear: () => void;
};

/**
 * 하단 시트 — 와이어프레임 두 프레임(올린 / 내린)이 여기 한 상태값이다.
 * 접어도 칩은 남긴다. 칩까지 사라지면 지도만 남아 무엇을 보고 있는지 알 수 없다.
 *
 * 핀을 고르면 목록 대신 **그 한 곳만** 보여준다 (/parking 의 SpotSheet 와 같다).
 * 목록을 그대로 두고 강조만 하면, 핀을 눌러도 화면이 그대로라 무엇을 골랐는지 알 수 없다.
 */
function Sheet({ open, onToggle, onLocate, label, kinds, kind, onKind, shops, selected, onPick, onClear }: SheetProps) {
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
      {/* 현위치 버튼은 시트에 붙여 둔다 — 화면 아래에 두면 시트(62%)가 덮고, 시트를 접었다
          폈다 할 때마다 자리를 다시 계산해야 한다. 시트에 붙이면 시트를 따라 같이 움직인다. */}
      <button
        onClick={onLocate}
        aria-label="현재 위치"
        className="absolute -top-[58px] right-5 grid size-[46px] place-items-center rounded-full bg-white text-[20px] text-[#2e9c85] shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:bg-black/5"
      >
        ◎
      </button>

      {/* 한 곳을 고른 상태에서는 손잡이가 목록으로 되돌아가는 문이다 (/parking 과 같은 규칙) */}
      <button
        onClick={selected ? onClear : onToggle}
        aria-label={selected ? "목록으로 돌아가기" : open ? "목록 접기" : "목록 펼치기"}
        aria-expanded={selected ? undefined : open}
        className="mx-auto block h-1 w-[38px] shrink-0 rounded-full bg-[#bfbfbf]"
      />

      {selected ? (
        <Picked shop={selected} onClose={onClear} />
      ) : (
        <List
          open={open}
          onExpand={onToggle}
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
function Picked({ shop, onClose }: { shop: TamnaShop; onClose: () => void }) {
  return (
    <div className="px-5 pt-4 pb-6">
      <p className="text-[12px] font-bold text-[#ff6114]">선택한 가맹점</p>
      <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-[#1f1f1f]">{shop.name}</h2>
      <p className="mt-2 text-[13px] text-[#525252]">
        도보 {walkMinutes(shop.distM)}분 · {shop.kind}
      </p>
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

type ListProps = Pick<SheetProps, "open" | "label" | "kinds" | "kind" | "onKind" | "shops" | "onPick"> & {
  onExpand: () => void;
};

/** 반경 안 가맹점 목록. 접혀 있으면 칩과 머리글 한 줄만 보인다. */
function List({ open, onExpand, label, kinds, kind, onKind, shops, onPick }: ListProps) {
  const head = `${label ? `${label}에서` : "이 근처에서"} 가까운 순 · ${shops.length}곳`;
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
        머리글은 거리를 **어디서 잰 값**인지 밝히는 자리다. label 이 없다는 건 위치를 못 받았거나
        (권한 거부) 사용자가 지도를 직접 움직였다는 뜻이라, 그때 "현재 위치에서"라고 적으면
        제주시청에서 잰 숫자를 내 옆이라고 말하게 된다. "이 근처"는 기준을 지도에 맡기는 말이다.

        접혀 있을 때는 이 줄이 목록을 여는 문이기도 하다 — 손잡이(높이 4px)만으로는 눌러야 하는
        줄 모른다. 펴져 있으면 그냥 글로 둔다. 눌러도 아무 일 없는 버튼을 놓지 않는다.
      */}
      {open ? (
        <p className={headClass}>{head}</p>
      ) : (
        <button onClick={onExpand} className={`${headClass} w-full text-left active:bg-black/[0.03]`}>
          {head}
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {shops.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-[#616161]">
            이 근처에는 아직 등록된 곳이 없습니다.
            <br />
            지도를 옮기거나 칩을 눌러보세요.
          </p>
        )}
        {shops.map((s) => (
          <ShopCard key={idOf(s)} shop={s} onClick={() => onPick(s)} />
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
function ShopCard({ shop, onClick }: { shop: TamnaShop; onClick: () => void }) {
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
          <span className="shrink-0 text-[13px] tabular-nums text-[#525252]">
            도보 {walkMinutes(shop.distM)}분
          </span>
        </span>

        {/*
          굳혀둔 곳은 전부 캐시백 인센티브 가맹점이다(scripts/build-tamna-data.mjs 가 그렇게 거른다).
          비율은 적지 않는다 — 10%는 제주도가 정책으로 조정하는 값이라 우리가 화면에 박을 숫자가 아니다.
        */}
        <span className="mt-1.5 inline-block rounded-md bg-[#ffebd6] px-2 py-1 text-[11px] font-bold text-[#ff6114]">
          탐나는전 캐시백
        </span>

        <span className="mt-1.5 block truncate text-[12px] text-[#616161]">{shop.kind}</span>
      </span>
    </button>
  );
}

/** 핀. 인라인 SVG를 data: URI 로 넣어 파일도 외부 요청도 늘리지 않는다 (/parking 과 같은 방식). */
const pin = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const PIN = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">
     <rect x="1" y="1" width="30" height="22" rx="11" fill="#fff" stroke="#1f1f1f" stroke-width="1.6"/>
     <text x="16" y="17" font-family="system-ui,sans-serif" font-size="12" font-weight="700"
           fill="#1f1f1f" text-anchor="middle">₩</text>
   </svg>`,
);

const PIN_ON = pin(
  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="34" viewBox="0 0 44 34">
     <rect x="1.5" y="1.5" width="41" height="31" rx="15.5" fill="#ff6114" stroke="#1f1f1f" stroke-width="2"/>
     <text x="22" y="23" font-family="system-ui,sans-serif" font-size="15" font-weight="700"
           fill="#fff" text-anchor="middle">₩</text>
   </svg>`,
);

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
const SHEET_SHUT = 0.15; // max-h-[122px] ÷ 폰 높이(812)

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

  // 시트를 접었다 펴면 보이는 띠가 달라지므로 기준점도 달라진다. 그런데 지도 자체는 가만히
  // 있어서 idle 이 오지 않는다 — 여기서 직접 다시 잡아준다.
  useEffect(() => {
    if (sdk === "ready" && map.current) idle.current(focus(map.current, fy), false);
  }, [sdk, fy]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current) return;
    const { kakao } = window;
    drawn.current.forEach((mk) => mk.setMap(null));
    drawn.current = pins.map((s) => {
      const on = same(selected, s);
      const [w, h] = on ? [44, 34] : [32, 24];
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(s.at[0], s.at[1]),
        title: s.name,
        zIndex: on ? 2 : 1,
        image: new kakao.maps.MarkerImage(on ? PIN_ON : PIN, new kakao.maps.Size(w, h)),
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
