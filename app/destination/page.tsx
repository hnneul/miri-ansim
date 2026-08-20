"use client";

// 목적지 입력 — 최종 와이어프레임 "목적지 입력" 섹션(Figma 2147:2005).
// 한 화면의 세 상태를 그린다: 지도만(HOME-01) → 검색 중(HOME-01 a) → 목적지 고름(HOME-01 b).
// 세 장을 따로 그린 건 프로토타입 연결을 보여주려는 것이고, 실제로는 같은 화면이 상태만 바뀐다.
//
// 메인화면(/home)에서 목적지를 적고 들어오면 ?dest= 를 물고 오므로 곧장 세 번째 상태로 연다.
//
// 지오코딩은 서버 액션(./actions.ts)을 거친다. 카카오 REST 키가 서버 전용이라 여기서 직접 못 부른다.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng } from "../RouteMap";
import { 이어친목록, type Place } from "@/lib/geocode";
import { addRecent, loadRecent, removeRecent } from "@/lib/recent";
import { findPlace, findPostal, recommendSpots, suggestPlaces } from "./actions";

/** 목적지를 못 골랐을 때 지도가 보고 있을 곳 — 제주 한가운데(한라산)라 섬이 통째로 담긴다. */
const JEJU_CENTER: LatLng = [33.38, 126.55];

/**
 * 목적지 마커. 어느 쪽이든 **뾰족한 끝이 좌표에 앉아야 한다** — anchor 를 안 주면 이미지 가운데가
 * 좌표에 맞아 마커가 통째로 아래로 밀린다 (app/RouteMap.tsx MarkerIcon).
 *
 * MASCOT 을 쓴다. 캐릭터를 왜 핀에 앉혔는지는 scripts/build-marker.py 주석에 있다.
 * PIN 은 와이어프레임(image 16)이 그린 원본이다 — 피그마 에셋 URL 이 7일 뒤 만료돼 다시 못 받으므로
 * 파일째 남긴다. 되돌리려면 아래 markers 의 MASCOT 을 PIN 으로 바꾸면 된다.
 */
const PIN = { src: "/icon-pin.png", size: [50, 56] as [number, number], anchor: [25, 56] as [number, number] };
// 크기·앵커는 scripts/build-marker.py 가 실행 끝에 찍어 주는 값을 그대로 옮긴 것이다.
// 그림자 자리가 아래에 남아 있어 앵커 y 는 이미지 높이(106)가 아니라 꼬리 끝(97)이다.
const MASCOT = { src: "/icon-pin-character.png", size: [80, 106] as [number, number], anchor: [40, 97] as [number, number] };
void PIN; // 지금은 안 쓴다 — 위 주석의 되돌리기용이다

/** 타이핑이 멎고 나서 후보를 부르기까지. 글자마다 부르면 카카오 호출이 입력 길이만큼 늘어난다. */
const TYPING_MS = 250;

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function DestinationPage() {
  return (
    <Suspense>
      <Destination />
    </Suspense>
  );
}

function Destination() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);

  // 출발지는 메인화면이 현재 위치를 잡아 넘겨준다. 직접 들어오면 없고, 그때는 거리 줄을 안 그린다.
  const origin: LatLng | null =
    query.originLat && query.originLng ? [Number(query.originLat), Number(query.originLng)] : null;

  // 검색 패널을 열고 들어왔으면(?search=1) 칸은 비운다 — 다시 고르러 온 자리라 옛 이름이 적혀
  // 있으면 지우고 시작하게 된다 (openSearch 가 같은 이유로 값을 지운다). 고른 곳은 dest 에 남아
  // 있어서 패널을 취소하면 그대로 돌아온다.
  const [text, setText] = useState(query.search === "1" ? "" : (query.dest ?? ""));
  const [place, setPlace] = useState<Place | null>(null);
  /*
    검색 패널(두 번째 상태)이 떠 있는가.

    메인화면 검색바가 ?search=1 을 달고 보낸다 — 거기는 입력칸이 아니라 이 화면을 여는 문이라,
    도착하자마자 적을 수 있어야 한다 (수정 HOME-01 a).
  */
  const [searching, setSearching] = useState(query.search === "1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  /** 타이핑 중에 뜨는 후보 목록 (HOME-01 a). 비어 있으면 최근 검색어 자리가 그대로 남는다. */
  const [suggest, setSuggest] = useState<Place[]>([]);
  /**
   * 지금 떠 있는 후보가 **어느 검색어의 결과인가.** null 이면 아직 안 왔다는 뜻이다.
   *
   * 이게 없으면 "아직 안 옴"과 "찾아봤는데 없음"을 못 가른다 — 둘 다 suggest 가 빈 배열이라
   * 제주에 없는 이름을 친 사람이 **"검색 결과를 찾는 중…"을 영원히** 보고 있었다.
   * 이 화면의 첫 번째 일이 목적지 찾기라, 그 실패가 침묵이면 안 된다.
   */
  const [찾은말, set찾은말] = useState<string | null>(null);
  /**
   * 그 검색어를 **물어보기는 했나**. false 면 목록이 빈 이유가 "제주에 없어서"가 아니라
   * 카카오에 못 물어봐서다 (타임아웃·네트워크·키). 없다고 단정하면 안 되는 자리다
   * (./actions.ts suggestPlaces).
   */
  const [물어봤나, set물어봤나] = useState(true);
  /** 마지막으로 결과가 나온 검색어와 그 목록. 치는 중에 붙들 근거다 (lib/geocode.ts 이어친목록) */
  const 앞결과 = useRef<{ 말: string; 목록: Place[] }>({ 말: "", 목록: [] });
  /** 아직 아무것도 안 적었을 때 띄우는 추천 장소 이름 (./actions.ts recommendSpots). */
  const [spots, setSpots] = useState<string[]>([]);
  /*
    최근 검색어에 이미 있는 이름은 뺀다 — 한 화면에 같은 이름이 두 번 뜨면 둘 중 하나가
    고장 난 것처럼 읽힌다. 서버가 여덟보다 넉넉히 주므로 걷어내도 여덟 개가 찬다.
  */
  const 추천장소 = spots.filter((s) => !recent.includes(s)).slice(0, 8);
  const input = useRef<HTMLInputElement>(null);

  // 시트가 지도 아래쪽을 얼마나 덮는지. 지도가 그만큼 위로 잡아야 마커가 시트에 안 걸린다.
  // 상수로 박지 않는 이유 — 시트 높이는 내용(장소명 줄바꿈·거리 유무)에 따라 달라지고,
  // 나중에 부담 설명 카드가 들어오면 또 달라진다. 재는 쪽이 한 번 쓰고 안 썩는다.
  const [sheetH, setSheetH] = useState(0);
  const sheetBox = useCallback((el: HTMLDivElement | null) => {
    if (!el) return setSheetH(0);
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect(); // React 19 는 ref 콜백의 정리 함수를 받는다
  }, []);

  // localStorage 는 서버에 없다 — 화면이 뜬 뒤에 읽는다 (lib/recent.ts 가 깨진 값까지 막는다)
  useEffect(() => setRecent(loadRecent()), []);

  /*
    추천 장소는 고정 목록이라 한 번만 받는다. data/spots.json 이 36KB 라 화면으로 직접 들여오면
    그게 통째로 번들에 실린다 — 여덟 줄 때문에 그럴 값어치가 없어 서버에서 잘라 받는다.
  */
  useEffect(() => {
    recommendSpots().then(setSpots);
  }, []);

  /**
   * 출발지를 손으로 정하고 **도착지를 찾는 중**인가 (시트의 "출발"을 누른 뒤).
   *
   * 상태를 따로 안 들고 URL 로 판단한다 — 출발지는 정해졌는데(originName) 도착지가 비어 있는
   * 상태가 곧 그 뜻이라, 새로고침·뒤로가기에도 화면이 URL 을 그대로 따라간다.
   */
  const routing = !!query.originName && !query.dest;

  /*
   * 도착지 칸에 커서를 준다. openSearch 의 focus 로는 안 되는데, 그때는 아직 URL 이 안 바뀌어서
   * 화면에 있는 게 도착지 칸이 아니라 예전 검색칸이다 (router.push 가 한 박자 뒤에 반영된다).
   * 두 칸 카드가 실제로 그려진 뒤에 잡아야 커서가 도착지에 앉는다.
   */
  useEffect(() => {
    if (routing) input.current?.focus();
  }, [routing]);

  /*
   * 메인화면 검색바로 들어온 경우(?search=1)도 커서를 준다 — 거기서 누른 게 검색칸처럼 생긴
   * 문이라, 도착해서 한 번 더 눌러야 적을 수 있으면 방금 누른 게 헛손질이 된다.
   */
  useEffect(() => {
    if (query.search === "1") input.current?.focus();
  }, [query.search]);

  /** 목적지를 확정한다. 목록에서 고르든 엔터로 찾든 여기로 모인다. */
  const choose = useCallback(
    (found: Place) => {
      setRecent((prev) => addRecent(prev, found.label));

      /*
       * 출발지를 정해놓고 도착지를 찾던 길이면 **여기서 곧장 길 비교로 나간다.**
       * 출발·도착이 둘 다 손으로 정해진 순간 이 화면이 더 물어볼 게 없다 — 주차장을 거치는 건
       * "관광지에 갔다가 차를 어디 대나"를 푸는 흐름이고, 이 길은 두 지점 사이를 묻는 길이다.
       *
       * dest* 를 지운다. 그건 관광지 좌표 자리인데 여기서는 도착지가 곧 목적지라,
       * 남겨두면 길 비교의 대본이 "차를 대고 옛 관광지까지 걸어간다"고 말하게 된다.
       */
      if (routing) {
        const next = new URLSearchParams(searchParams);
        next.set("to", found.label);
        next.set("toLat", String(found.coord[0]));
        next.set("toLng", String(found.coord[1]));
        for (const k of ["dest", "destLat", "destLng"]) next.delete(k);
        /*
          돌아올 자리를 여기서 정한다 — 안 정하면 앞 흐름이 남긴 값을 물고 가고, 그것도 없으면
          ‹ 가 홈으로 튄다. 이 길로 온 사람은 **여기서** 도착지를 고르던 참이라 여기로 돌아와야
          한다 (dest 가 없어 routing 상태로 열리므로 도착지 칸이 다시 비어 있다).
        */
        next.set("back", "destination");
        router.push(`/route?${next}`);
        return;
      }

      setPlace(found);
      setText(found.label);
      setSearching(false);
      setSuggest([]);
      // 새로고침해도 같은 목적지로 열리게 URL 을 맞춰둔다 (히스토리는 안 늘린다)
      const next = new URLSearchParams(searchParams);
      next.set("dest", found.label);
      // 검색 패널은 이미 닫혔다 — 남겨두면 새로고침할 때 고른 곳 위로 패널이 다시 열린다
      next.delete("search");
      router.replace(`/destination?${next}`);
    },
    [router, searchParams, routing],
  );

  const search = useCallback(
    async (q: string) => {
      setPending(true);
      setError(null);
      const found = await findPlace(q);
      setPending(false);
      if ("error" in found) return setError(found.error);
      choose(found);
    },
    [choose],
  );

  /*
    HOME-01 a — 적는 동안 후보를 불러온다. 예전에는 엔터를 눌러야 첫 번째 결과로 곧장 넘어갔는데,
    "제주 카페"처럼 같은 이름이 여럿인 검색어에서는 어디로 갈지 사용자가 고를 방법이 없었다.

    타이핑이 멎고 나서(TYPING_MS) 부르고, 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때
    먼저 보낸 긴 검색어의 결과가 나중에 도착해 목록을 덮는다.
  */
  useEffect(() => {
    if (!searching || !text.trim()) {
      set찾은말(null);
      앞결과.current = { 말: "", 목록: [] };
      return setSuggest([]);
    }

    let alive = true;
    // 글자가 바뀌면 앞 결과는 이 검색어의 것이 아니다 — 표시를 지워 "찾는 중"으로 되돌린다
    set찾은말(null);
    const timer = setTimeout(() => {
      suggestPlaces(text).then((found) => {
        if (!alive) return;
        const 목록 = found.places.length ? found.places : 이어친목록(앞결과.current, text);
        if (목록.length) 앞결과.current = { 말: text, 목록 };
        setSuggest(목록);
        set물어봤나(found.물어봤나);
        set찾은말(text);
      });
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, searching]);

  /*
    검색 패널은 화면이 아니라 상태라 그냥 두면 히스토리에 안 남는다 — 검색 화면에서 폰(브라우저)
    뒤로가기를 누르면 목적지 화면을 건너뛰고 /home 으로 나가버린다. 패널을 열 때 항목을 하나
    밀어 넣어 그 뒤로가기가 패널만 닫게 한다.

    닫는 길은 하나로 모은다 — 바 안의 ← 도 history.back() 을 부르고, 실제로 닫는 건 popstate 다.
    버튼이 따로 setSearching(false) 를 하면 밀어 넣은 항목이 남아, 목적지 화면에서 아무 일도
    일어나지 않는 뒤로가기가 한 번 생긴다.

    이미 우리 항목이면 다시 안 민다 — 개발 모드(StrictMode)에서 이 효과가 두 번 도는데,
    그때 항목이 두 개 쌓이면 뒤로가기를 두 번 눌러야 나간다.

    **"출발"로 열린 패널은 항목을 안 민다** (borrowed). 거기서는 setStart 가 이미 항목을 하나
    밀었고, 여기서 또 밀면 뒤로가기를 두 번 눌러야 출발 누르기 전으로 돌아간다 —
    한 번은 패널만 닫혀 출발지와 목적지가 같은 곳으로 떠 있는 화면이 나온다.
  */
  /*
    ?search=1 로 열린 패널도 항목을 안 민다 — 메인화면에서 여기로 온 **그 이동**이 이미 항목이라,
    여기서 또 밀면 뒤로가기를 두 번 눌러야 메인으로 돌아간다 (한 번은 빈 지도만 남는다).
  */
  const borrowed = useRef(query.search === "1");
  useEffect(() => {
    // 닫히면 빌린 항목도 같이 사라진다 — 다음에 열 때는 다시 제 항목을 민다
    if (!searching) {
      borrowed.current = false;
      return;
    }

    if (!borrowed.current && history.state?.search !== true)
      history.pushState({ search: true }, "");
    const close = () => setSearching(false);
    addEventListener("popstate", close);
    return () => removeEventListener("popstate", close);
  }, [searching]);

  /*
    ?dest= 가 가리키는 곳으로 화면을 맞춘다. 메인화면에서 검색어를 물고 들어온 첫 진입이 이걸 타고,
    **뒤로가기도 여기로 돌아온다.**

    한 번만 돌게 두면(예전의 auto ref) URL 과 화면이 어긋난다 — "출발"로 dest 를 비운 뒤 뒤로가기하면
    URL 은 목적지가 있는 앞 항목으로 돌아오는데 화면은 아무것도 안 골라진 빈 지도에 남았다.
    URL 이 이 화면의 상태를 쥐고 있으니, 그게 바뀌면 화면도 따라가는 게 맞다.

    **보고 있는 place 가 아니라 URL 값만 본다.** 화면 상태로 판단하면("고른 곳과 다르면 찾는다")
    "출발"이 place 를 비우는 순간 아직 안 지워진 dest 로 다시 검색이 돌아, 방금 고친 URL 을
    되돌려 놓는다. 여기가 하는 일은 URL 을 화면에 옮기는 것 하나다.
  */
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!query.dest) {
      // 목적지가 비었다 — 나중에 같은 곳으로 되돌아와도 다시 맞출 수 있게 기억을 지운다
      synced.current = null;
      return;
    }
    /*
      **검색 패널이 떠 있는 동안에는 맞추기를 미룬다.** 패널이 지도를 덮고 있어 지금 맞춰봐야
      보이지 않는데, 맞추는 길(choose)이 패널을 닫고 search 를 URL 에서 지운다 — 길 비교의
      ✕("다시 고르기")가 dest 를 남긴 채 패널을 열어 보내면 뜨자마자 닫혀 버렸다.
      닫히는 순간 이 effect 가 다시 돌아 그때 맞춘다 (searching 이 deps 에 있다).

      **위 기억 지우기보다 아래여야 한다.** 위에 두면 "출발"로 dest 가 비는 순간(그때는 패널이
      열려 있다) synced 를 못 지우고, 뒤로 돌아와 같은 dest 가 실려도 "이미 맞췄다"며 건너뛰어
      **빈 지도**가 남는다.
    */
    if (searching) return;
    if (synced.current === query.dest) return;
    synced.current = query.dest;
    search(query.dest);
  }, [query.dest, search, searching]);

  /**
   * 고른 출발지. 목적지를 아직 안 골랐을 때 지도가 이걸 대신 보여준다 —
   * "출발"을 누르면 목적지 자리가 비면서 시트가 사라지는데, 그때 지도까지 제주 전체를 비추면
   * 방금 정한 출발지가 화면 어디에도 안 남아 아무 일도 안 일어난 것처럼 보인다.
   *
   * **현재 위치는 안 찍는다** (originName 이 없다) — 여기서 고른 값이 아니라 앞 화면이 실어 보낸
   * 값이고, 목적지 찾기 전의 빈 지도는 원래 설계된 첫 상태다 (HOME-01).
   */
  const start = query.originName && origin ? { coord: origin, label: query.originName } : null;
  /** 지도가 지금 보고 있어야 할 곳. 목적지가 먼저고, 없으면 출발지다. */
  const focus = place ?? start;

  /**
   * 화면에 처음 실려 온 출발지 = 메인화면이 잡아 넘긴 현재 위치. 칩의 ✕ 가 여기로 되돌린다.
   * 여기서 고른 출발지(originName)를 물고 들어왔으면 되돌릴 현재 위치가 애초에 없다.
   * useRef 라 첫 렌더 값만 남는다 — 그 뒤 URL 이 어떻게 바뀌든 "처음 값"이 흔들리지 않아야 한다.
   */
  const fromHome = useRef<[string, string] | null>(
    !query.originName && query.originLat && query.originLng
      ? [query.originLat, query.originLng]
      : null,
  );

  /**
   * 지도의 핀을 눌렀다 = **여기로 간다.**
   *
   * 시트의 「근처 주차장 보기」와 다른 길이다. 저건 "관광지에 갔다가 차를 어디 대나"를 푸는
   * 흐름이라 주차장을 한 번 거치는데, 핀을 누르는 건 찾은 그 자리로 곧장 가겠다는 뜻이다
   * (choose 의 routing 갈래가 하는 일과 같다 — 거기는 출발지를 이미 손으로 정한 경우다).
   *
   * **출발지는 현재 위치다.** 손으로 고른 출발지가 있으면 걷어낸다 — 규칙은 setStart(null) 과
   * 같다: 처음 실려 온 현재 위치를 도로 앉히고, 그것도 없으면 셋을 다 지워 길 비교 화면이
   * 스스로 위치를 잡게 둔다.
   *
   * dest* 를 지우는 이유는 choose 와 같다. 그건 관광지 좌표 자리인데 여기서는 도착지가 곧
   * 목적지라, 남겨두면 대본이 "차를 대고 옛 관광지까지 걸어간다"고 말한다.
   */
  function goStraight(found: Place) {
    setRecent((prev) => addRecent(prev, found.label));
    const next = new URLSearchParams(searchParams);
    next.set("to", found.label);
    next.set("toLat", String(found.coord[0]));
    next.set("toLng", String(found.coord[1]));
    /*
      **돌아올 자리를 여기서 정한다.** 예전에는 back 을 손대지 않아서, 앞 흐름이 남기고 간 값이
      그대로 실려 갔다 — 그러면 ✕ 가 엉뚱한 화면으로 가고, 마침 destination 이 실려 있으면
      dest 를 지운 채 이 화면으로 돌아와 **빈 지도**가 떴다 (고른 곳이 URL 에서 사라져서다).

      dest 는 남긴다. 이 화면이 그 값으로 고른 곳을 되찾는다(아래 synced effect).
      좌표(destLat/destLng)는 지운다 — 그건 "차를 대고 목적지까지 걸어갈" 거리의 재료인데
      (app/route/page.tsx 대본 ⑤칸), 여기서는 도착지가 곧 목적지라 걸어갈 구간이 없다.
    */
    next.set("back", "destination");
    next.set("dest", found.label);
    for (const k of ["destLat", "destLng", "search"]) next.delete(k);
    if (fromHome.current) {
      next.set("originLat", fromHome.current[0]);
      next.set("originLng", fromHome.current[1]);
      next.delete("originName");
    } else {
      for (const k of ["originLat", "originLng", "originName"]) next.delete(k);
    }
    router.push(`/route?${next}`);
  }

  function openSearch() {
    setSearching(true);
    setError(null);
    // 다시 검색하려고 눌렀으니 이전 값은 지운다 — 지우고 시작하는 게 커서를 끝으로 옮기는 것보다 빠르다
    setText("");
    requestAnimationFrame(() => input.current?.focus());
  }

  /** 최근 검색어 한 개를 지운다 — 목록에서 빼고 저장소도 같은 값으로 맞춘다 (lib/recent.ts). */
  const forget = (term: string) => setRecent((prev) => removeRecent(prev, term));

  /**
   * 찾은 곳을 **출발지**로 앉힌다 (시트의 "출발").
   *
   * 이 화면은 목적지를 찾는 자리라, 출발지를 고른 다음에는 다시 목적지를 찾아야 한다 —
   * 그래서 시트를 접고 검색 패널을 곧장 열어준다. 고른 출발지는 위 칩에 남아 있다.
   *
   * 좌표와 이름을 함께 URL 에 싣는다. 좌표만 있으면 다음 화면들이 "현재 위치"라고 적게 되는데,
   * 손으로 고른 곳이라 그건 사실이 아니다 (길 비교 화면이 originName 을 그대로 읽는다).
   * null 을 주면 다시 현재 위치로 되돌린다 — 그건 고쳐 쓰기라 항목을 안 남긴다(replace).
   *
   * **고를 때는 push 다.** 뒤로가기 한 번이 출발 누르기 전 지도로 돌아가야 하는데, replace 로
   * 고쳐 쓰면 되돌릴 지점이 없어 목적지가 사라진 화면에 그대로 남는다. 항목을 하나 밀어두면
   * 그 뒤로가기가 URL 을 통째로 되돌리고, 위 동기화 효과가 그 URL 대로 목적지를 다시 세운다.
   * 이어서 열리는 검색 패널은 이 항목을 빌려 쓴다 (borrowed) — 제 것을 또 밀면 두 번 눌러야 한다.
   */
  function setStart(from: Place | null) {
    const next = new URLSearchParams(searchParams);
    if (from) {
      next.set("originLat", String(from.coord[0]));
      next.set("originLng", String(from.coord[1]));
      next.set("originName", from.label);
      // 이 곳은 이제 출발지다 — 목적지 자리에 남겨두면 출발지와 도착지가 같은 곳이 된다
      next.delete("dest");
    } else if (fromHome.current) {
      // 손으로 고른 출발지만 걷어내고 현재 위치를 도로 앉힌다 — 사용자가 지운 건 그 둘 중 앞엣것이다
      next.set("originLat", fromHome.current[0]);
      next.set("originLng", fromHome.current[1]);
      next.delete("originName");
    } else {
      for (const k of ["originLat", "originLng", "originName"]) next.delete(k);
    }
    if (from) {
      router.push(`/destination?${next}`);
      borrowed.current = true;
      setPlace(null);
      openSearch();
    } else {
      router.replace(`/destination?${next}`);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/*
        상태바는 지도 밖에 둔다 — 와이어프레임도 Map/Placeholder 가 상태바 아래(y:32)에서 시작한다.
        지도를 상태바 뒤까지 깔면 시각·배터리가 지도 상호명과 겹쳐 양쪽 다 안 읽힌다.
      */}
      <div className="relative z-20 shrink-0 bg-white">
        <StatusBar tone="text-[#525252]" />
      </div>

      <div className="relative flex-1">
        {/*
          지도는 상태바 아래를 전부 깔고, 나머지는 그 위에 뜬다 (와이어프레임의 Map/Placeholder 자리).
          z-0 은 장식이 아니라 필수다 — 카카오가 지도 안쪽 요소에 z-index:1 을 직접 박는데,
          여기가 z-auto 면 그것들이 부모 문맥으로 새어 나와 아래 흰 덮개와 검색 패널 위에 그려진다.
          z-0 하나로 쌓임 문맥이 생겨 지도의 z-index 가 이 상자 안에 갇힌다.
        */}
        <div className="absolute inset-0 z-0">
          <RouteMap
            className=""
            center={focus?.coord ?? JEJU_CENTER}
            level={focus ? 5 : 10}
            routes={[]}
            /*
              시트를 닫는 길. ✕ 를 뺀 자리를 지도 빈 곳이 받는다 — /around·/route·/parking 이
              쓰는 것과 같은 문이라 이 앱에서 시트를 접는 손짓이 화면마다 갈리지 않는다.
              (검색바를 눌러도 시트는 가려진다. 그건 다시 고르러 가는 길이고, 이건 그냥 접는 길이다.)
            */
            onBlank={() => setPlace(null)}
            /* 캐릭터 핀은 목적지 것이다 — 출발지는 기본 마커로 찍어 둘이 안 헷갈리게 한다 */
            markers={
              place
                ? [
                    {
                      coord: place.coord,
                      label: place.label,
                      icon: MASCOT,
                      /* 핀이 곧 "여기로 갈게요" 버튼이다 (goStraight) */
                      onClick: () => goStraight(place),
                    },
                  ]
                : start
                  ? [{ coord: start.coord, label: `${start.label} (출발)` }]
                  : []
            }
            padBottom={sheetH}
          />
        </div>

        {/* 검색 중에는 지도를 흰 종이로 덮는다 — 와이어프레임 HOME-01 a 가 흰 바탕이다 */}
        {searching && <div className="absolute inset-0 z-[5] bg-white" />}

        {/*
          지도 위에 뜨는 것들. pointer-events-none 이 없으면 지도가 끌리지도 확대되지도 않는다 —
          이 상자가 눈에 안 보일 뿐 지도를 통째로 덮고 있어서 클릭·드래그를 전부 가로챈다.
          실제로 눌러야 하는 것들만 pointer-events-auto 로 되살린다.
        */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
          {/*
            route-editor — 와이어프레임 "목적지 → 출발 선택"(Figma 2212:2649 / 2153:3944)이 여기 자리다.
            출발지를 정하고 도착지를 찾는 동안 검색바 대신 이 카드가 선다.

            **길 비교 화면(app/route)의 route-editor 와 같은 물건이다** — 라벨 위·값 아래 두 줄, 앞에 점,
            카드 바깥 오른쪽에 닫기 상자. 여기서 채운 두 줄을 다음 화면에서 그대로 다시 만나야
            "내가 넣은 게 그거였구나"가 이어진다. 그래서 규격도 거기 것을 그대로 쓴다.

            점은 속이 빈 링이다 (와이어프레임 그대로). 출발지는 주황, 아직 안 채운 도착지는 회색 —
            채워지면 검정이 된다. 어느 칸이 비었는지를 색이 먼저 말한다.
          */}
          {routing ? (
            <div className="pointer-events-auto mt-[9px] flex shrink-0 items-start gap-[21px] px-[21px]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  search(text);
                }}
                className="min-w-0 flex-1 overflow-hidden rounded-[10px] border border-[#d6d6d6] bg-white"
              >
                <div className="flex h-[51px] items-center gap-[12px] px-[12px]">
                  <Ring color="#fc7f35" />
                  <span className="min-w-0">
                    <span className="block text-[10px] leading-[14px] font-medium text-[#9e9e9e]">
                      출발지
                    </span>
                    <span className="block truncate text-[14px] leading-[20px] font-medium text-[#1f1f1f]">
                      {query.originName}
                    </span>
                  </span>
                </div>

                <div className="mx-[10px] border-t border-[#e6e6e6]" />

                <label className="flex h-[51px] items-center gap-[12px] px-[12px]">
                  <Ring color={text ? "#1f1f1f" : "#c4c4c4"} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] leading-[14px] font-medium text-[#9e9e9e]">
                      도착지
                    </span>
                    <input
                      ref={input}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onFocus={() => setSearching(true)}
                      placeholder="도착지 입력해 주세요"
                      aria-label="도착지"
                      className="block w-full bg-transparent text-[14px] leading-[20px] font-medium text-[#1f1f1f] outline-none placeholder:font-normal placeholder:text-[#9e9e9e]"
                    />
                  </span>
                </label>
                {/*
                  폼에 submit 컨트롤이 하나도 없으면 엔터 동작이 브라우저마다 갈린다.
                  눈에 안 보이는 버튼 하나로 모바일 키보드의 "이동"까지 같은 길로 모은다.
                */}
                <button type="submit" className="sr-only">
                  검색
                </button>
              </form>

              {/*
                닫기. 길 비교 화면의 그 상자와 같은 규격(44px·테두리)이다.
                출발 누르기 전으로 되돌린다 — history.back() 이 URL 을 통째로 되돌리고,
                그러면 출발지도 이 카드도 같이 사라진다 (setStart 가 항목을 하나 밀어둔 덕이다).
              */}
              <button
                type="button"
                onClick={() => history.back()}
                aria-label="닫기"
                /* 호버는 앱의 다른 누르는 자리와 같은 옅은 주황이다 — 회색으로 혼자 빠져 있으면 안 눌리는 것처럼 읽힌다 */
                className="mt-[32px] grid size-[44px] shrink-0 place-items-center rounded-[10px] border border-[#d6d6d6] bg-white transition hover:bg-[#fff0e6] active:bg-black/5"
              >
                <img src="/home/icon-close.svg" alt="" className="size-6" />
              </button>
            </div>
          ) : (
          /* 검색바. 와이어프레임(2129:1793) 기준 높이 54, 좌우 여백 20 */
          <div className="pointer-events-auto flex shrink-0 items-center pt-[19px] pr-5 pl-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(text);
            }}
            /*
              흰 바탕 + 주황 테두리로 바뀌었다 (메인화면 검색바와 같은 모양이다).
              전에 쓰던 주황 15% 배경은 지도 위에서 상호명이 비쳐 글자가 묻혔는데, 흰 바탕이라 그 문제도 같이 없어진다.
            */
            className="flex h-[54px] min-w-0 flex-1 items-center gap-[10px] rounded-[16px] border border-[#fc7f35] bg-white px-[14px] shadow-[0_3px_5px_0_rgba(0,0,0,0.07)]"
          >
            {/*
              뒤로가기. 와이어프레임은 나가는 길을 하단 탭바로 두는데 아직 탭바가 없다.
              지도 위에 동그란 버튼을 따로 띄웠더니 저 혼자 튀어서, 검색바 안에 넣는 /parking·/around 와
              같은 모양으로 맞췄다 — 바가 이미 배경을 갖고 있어 아이콘에 원도 그림자도 필요 없다.
              검색 패널이 열려 있으면 그것부터 닫는다. 한 번에 나가면 적던 검색어가 날아간다.
              ponytail: 하단 탭바(Figma 2153:1985)를 만들면 이 버튼을 뺀다.
            */}
            <button
              type="button"
              onClick={() => (searching ? history.back() : router.push(`/home?${searchParams}`))}
              aria-label={searching ? "검색 닫기" : "뒤로"}
              /*
                -mx-1.5 가 p-1.5 만큼 도로 당긴다 — 커서 얹을 동그란 자리만 생기고 화살표 위치와
                입력칸 사이 간격(gap-[10px])은 그대로다. 아래 ✕ 도 같은 값이라 둘이 짝이 맞는다.
              */
              className="-mx-1.5 shrink-0 p-1.5 transition hover:opacity-40 active:scale-90"
            >
              <img src="/icon-arrow-left.svg" alt="" className="size-6" />
            </button>
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setSearching(true)}
              /*
                **홈 검색바와 같은 문장이다** (app/home/page.tsx). 거기는 입력칸이 아니라 이 화면을
                여는 버튼이라, 누른 문장이 그대로 적힌 칸이 나와야 "그 자리로 왔다"가 된다.
                문구가 갈리면 다른 칸으로 옮겨온 것처럼 읽힌다 — 바꿀 때는 두 곳을 같이 고친다.

                "장소" 만으로는 부족하다. 이 화면은 목적지도 고르고 출발지도 고르는데(시트의 "출발"),
                예전에는 들어오는 문이 홈 검색바 하나뿐이라 손에 맥락이 남아 있었다. 길 비교의
                ✕("출발지·도착지 다시 고르기")가 생기면서 **맥락 없이 떨어지는 입구**가 하나 늘었고,
                그 사람에게는 이 칸이 둘 중 뭘 받는지 문구로만 말할 수 있다.
              */
              placeholder="가고 싶은 제주 장소를 검색해요"
              aria-label="목적지"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[#1f1f1f] outline-none placeholder:text-[#7d7d7d]"
            />
            {/* 값이 있을 때만 지우기. 와이어프레임 HOME-01 b 의 X 자리다 */}
            {text && (
              <button
                type="button"
                onClick={openSearch}
                aria-label="지우기"
                className="-mx-1.5 shrink-0 p-1.5 transition hover:opacity-40 active:scale-90"
              >
                <img src="/home/icon-close-bold.svg" alt="" className="size-6" />
              </button>
            )}
            {/*
              와이어프레임에 검색 버튼이 없어서 엔터(암묵적 제출)에만 기대고 있었는데, 폼에 submit
              컨트롤이 하나도 없으면 그 동작이 브라우저마다 갈린다. 눈에 안 보이는 제출 버튼 하나로
              모바일 키보드의 "이동"까지 같은 길로 모은다 — 화면은 그대로다.
            */}
            <button type="submit" className="sr-only">
              검색
            </button>
          </form>
        </div>
          )}

          {/*
            고른 출발지. 도착지를 이미 고른 뒤에만 뜬다 — 찾는 중일 때는 위 두 칸 카드가 같은 말을
            더 또렷하게 하고 있어서, 칩까지 있으면 출발지가 화면에 두 번 적힌다.
            ✕ 가 유일한 되돌리는 길이다 (지우면 다시 현재 위치가 출발지다).
          */}
          {query.originName && !routing && (
            <div className="pointer-events-auto mt-2 ml-5 flex h-[30px] shrink-0 items-center gap-[6px] self-start rounded-full border border-[#e5e5e5] bg-white pr-[8px] pl-[11px] shadow-[0_1px_4px_0_rgba(0,0,0,0.08)]">
              <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-[#fc7f35]" />
              <span className="max-w-[220px] truncate text-[12px] leading-none text-[#1f1f1f]">
                {query.originName}에서 출발
              </span>
              <button
                onClick={() => setStart(null)}
                aria-label="출발지 지우기"
                className="shrink-0 px-[3px] text-[13px] leading-none text-[#9e9e9e]"
              >
                ✕
              </button>
            </div>
          )}

          {(pending || error) && (
            <p
              className={`pointer-events-auto mt-3 shrink-0 rounded-[8px] bg-white/90 px-6 py-1 text-[12px] leading-[18px] ${error ? "text-rose-600" : "text-[#525252]"}`}
            >
              {error ?? "장소를 찾는 중…"}
            </p>
          )}

          {/*
            HOME-01 a — 검색 패널. 적기 시작하면 후보 목록으로, 비어 있으면 최근 검색어로 바뀐다.
            둘을 같이 띄우지 않는 이유는 자리가 아니라 뜻이다 — 후보가 떠 있는 동안 최근 검색어는
            지금 적고 있는 것과 상관없는 목록이라 손이 잘못 간다.
            목록이 길면 화면 밖으로 나가므로 여기만 따로 스크롤한다 (지도 위 오버레이라 바깥이 안 스크롤된다).
          */}
          {searching && (
            <div className="pointer-events-auto mt-5 min-h-0 flex-1 overflow-y-auto px-6 pb-4">
              {text.trim() ? (
                suggest.length > 0 ? (
                  <ul>
                    {suggest.map((p) => (
                      /* 같은 이름이 여럿이라 key 는 좌표까지 붙인다 ("스타벅스"가 제주에만 수십 곳이다) */
                      <li key={`${p.label}${p.coord}`}>
                        <button onClick={() => choose(p)} className="flex w-full items-start gap-3 py-[10px] text-left">
                          <img src="/home/icon-search.svg" alt="" aria-hidden className="mt-[5px] size-[15px] shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-baseline gap-[7px]">
                              <span className="truncate text-[14px] leading-[22px] text-[#1f1f1f]">{p.label}</span>
                              {p.type && <span className="shrink-0 text-[11px] text-[#9e9e9e]">{p.type}</span>}
                            </span>
                            {/*
                              주소가 있어야 같은 이름 중에 어느 지점인지 갈린다 — 없는 곳은 그 줄만 빠진다.
                              도로명이 있으면 그쪽이다: 길 이름이 들어가야 "스타벅스" 수십 곳이 서로 구분된다.
                            */}
                            {(p.road || p.jibun) && (
                              <span className="mt-[2px] block truncate text-[12px] text-[#9e9e9e]">
                                {p.road || p.jibun}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : 찾은말 === text ? (
                  /*
                    찾아봤는데 없다. 무엇을 하면 되는지까지 적는다 — "없음"만으로는 다음 손이 안 움직인다.
                    **못 물어본 경우는 갈라 말한다**: 네트워크가 죽었을 뿐인데 "그런 곳 없어요"라고
                    단정하면 앱이 거짓말을 한다 (./actions.ts suggestPlaces).
                  */
                  물어봤나 ? (
                    /*
                      **"제주에 없다"고는 안 한다.** 카카오가 0을 준 건 "이 조각으로는 못 맞췄다"까지고,
                      실제로 "스타벅"은 0인데 "스타벅스"는 세 곳이 나온다. 엔터로 확정할 때만(findPlace)
                      사유를 단정한다 — 거긴 다 친 뒤다.
                    */
                    <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">
                      &lsquo;{text}&rsquo;로는 못 찾았어요.
                      <br />
                      이름을 조금 더 적어보세요.
                    </p>
                  ) : (
                    <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">
                      지금은 장소를 찾아볼 수 없어요.
                      <br />
                      잠시 뒤에 다시 쳐보세요.
                    </p>
                  )
                ) : (
                  <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">검색 결과를 찾는 중…</p>
                )
              ) : (
                <>
                  {/*
                    추천 장소. 여기가 예전에는 **빈 화면**이었다 — 최근 검색어가 없으면(첫 사용자,
                    지우고 난 뒤) 검색 패널에 아무것도 없어서, 메인화면 검색바를 눌러 들어온 사람이
                    받는 첫 화면이 백지 한 장이었다. "뭘 검색해야 하나"에 답이 없다.

                    고른 기준은 거리가 아니라 유명세다 (./actions.ts recommendSpots 주석에 이유가 있다).
                    **최근 검색어 위에 둔다.** 칩 여덟 개는 세 줄로 끝나지만 최근 검색어는 한 줄에 하나라,
                    열 개가 차면 그것만으로 화면을 넘긴다 — 아래에 두면 추천이 통째로 접힌 밖으로 밀린다.
                    개수가 0~10 으로 출렁이는 쪽보다 늘 같은 높이인 쪽이 위에 있어야 자리도 안 흔들린다.

                    누르면 최근 검색어와 같은 길로 간다 (setText + search). 좌표를 안고 곧장 넘어가지
                    않는 이유도 위 주석에 있다 — 주소 배지가 틀리느니 카카오에 한 번 묻는 게 낫다.
                  */}
                  {추천장소.length > 0 && (
                    <>
                      <h2 className="text-[14px] leading-[22px] font-bold text-[#1f1f1f]">
                        제주에서 많이 찾는 곳
                      </h2>
                      {/* 칩이라 줄바꿈으로 흐른다 — 이름 길이가 제각각이라(섭지코지 ↔ 제주동문시장) 격자로 두면 빈칸이 남는다 */}
                      <div className="mt-[10px] flex flex-wrap gap-2">
                        {추천장소.map((name) => (
                          <button
                            key={name}
                            onClick={() => {
                              setText(name);
                              search(name);
                            }}
                            /* 호버 색은 빠르게 둘러보기 칸과 같은 #fff0e6 이다 — 이 앱에서 "얹혀 있다"는 뜻으로 이미 쓰는 색이다 */
                            className="h-[32px] shrink-0 rounded-full border border-[#e5e0db] bg-white px-[13px] text-[13px] leading-none text-[#1f1f1f] transition hover:bg-[#fff0e6] active:scale-95"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* 최근 검색어. 없으면 목록째 빠진다 (빈 제목만 남으면 고장 난 것처럼 보인다) */}
                  {recent.length > 0 && (
                  <>
                    <h2 className={`text-[14px] leading-[22px] font-bold text-[#1f1f1f] ${추천장소.length > 0 ? "mt-6" : ""}`}>
                      최근 검색어
                    </h2>
                    <ul className="mt-2">
                      {recent.map((r) => (
                        /*
                          한 줄에 두 버튼이라 <li> 를 flex 로 두고 버튼을 나란히 놓는다 — 버튼 안에 버튼을
                          못 넣으니(검색 전체를 감싸면 X 가 그 안에 갇힌다) 검색과 삭제를 형제로 가른다.
                          왼쪽을 누르면 재검색, 오른쪽 X 를 누르면 그 항목만 지운다 (Figma icon/close 자리).
                        */
                        <li key={r} className="flex items-center gap-2 py-2">
                          <button
                            onClick={() => {
                              setText(r);
                              search(r);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <img src="/home/icon-search.svg" alt="" aria-hidden className="size-[15px] shrink-0 opacity-60" />
                            <span className="truncate text-[14px] leading-[22px] text-[#1f1f1f]">{r}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => forget(r)}
                            aria-label={`최근 검색어에서 ${r} 삭제`}
                            /*
                              호버에 동그라미를 안 깐다 — 앱의 아이콘 버튼 규칙이다(app/trip/page.tsx Back 주석).
                              커서를 올리면 ✕ 가 더 흐려져서, 어느 줄을 겨누고 있는지가 보인다.
                            */
                            className="shrink-0 p-1 transition hover:opacity-40 active:scale-90"
                          >
                            <img
                              src="/home/icon-close.svg"
                              alt=""
                              aria-hidden
                              /* 평소에도 옅다 — 목록에서 지우기가 이름보다 세면 안 된다. 호버는 버튼이 맡는다 */
                              className="size-4 opacity-70"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                  )}
                </>
              )}
            </div>
          )}

          {/* HOME-01 b — 목적지를 고르면 아래에서 올라오는 시트. 높이를 재서 지도에 넘긴다 */}
          {place && !searching && (
            <div ref={sheetBox} className="pointer-events-auto mt-auto">
              <PlaceSheet
                place={place}
                /*
                 * 목적지 좌표까지 넘긴다 — 이름만 넘기면 주차장 화면이 지오코딩을 한 번 더 해야 하고,
                 * 같은 이름이 여러 곳이면 여기서 고른 곳과 다른 데가 잡힐 수 있다.
                 */
                onParking={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("dest", place.label);
                  next.set("destLat", String(place.coord[0]));
                  next.set("destLng", String(place.coord[1]));
                  router.push(`/parking?${next}`);
                }}
                onStart={() => setStart(place)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 고른 목적지 시트. 와이어프레임(search-panel 2153:2981)은 높이 515 로 그려졌지만 그 아래가 비어 있다 —
 * 채울 내용이 정해지면 늘어날 자리이고, 지금 515 를 박으면 지도만 가린다. 내용 높이로 둔다.
 */
function PlaceSheet({
  place,
  onParking,
  onStart,
}: {
  place: Place;
  onParking: () => void;
  onStart: () => void;
}) {
  /** 주소 카드를 펼쳤나 (Figma "목적지 주소 펼쳤을때" 2606:847). */
  const [openAddress, setOpenAddress] = useState(false);
  /**
   * 우편번호. 카드를 처음 펼칠 때 받아온다 (./actions.ts findPostal 주석에 미리 안 받는 이유가 있다).
   * "아직 안 받음"과 "받아봤는데 없음"을 갈라야 해서 undefined / null 을 둘 다 쓴다 —
   * null 로 뭉치면 도로명 없는 곳(우편번호가 원래 없는 곳)에서 펼칠 때마다 헛호출이 나간다.
   */
  const [postal, setPostal] = useState<string | null | undefined>(undefined);
  // 목적지가 바뀌면 이전 장소의 우편번호가 남아 있으면 안 된다
  useEffect(() => {
    setOpenAddress(false);
    setPostal(undefined);
  }, [place]);

  function toggleAddress() {
    setOpenAddress((v) => !v);
    // 도로명이 없으면 우편번호도 없다 — 부르지 않는다 (lib/geocode.ts postalOf 주석)
    if (postal === undefined && place.road) findPostal(place.road).then(setPostal);
  }

  return (
    /*
      위 여백은 **패딩이다.** 손잡이를 빼고 첫 자식에 mt 를 줬더니 그 마진이 부모 밖으로 빠져나가
      (margin collapsing) 안쪽이 아니라 시트째 밀렸다 — 이름이 시트 위 테두리에 붙어 보인 이유다.
      부모에 padding 을 주면 빠져나갈 마진이 없다.
    */
    <div className="relative rounded-t-[24px] bg-white pt-7 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      {/*
        손잡이(grab)는 뺐다. 끌어올릴 수 있어 보이게 하는 표시인데 **이 시트는 안 끌린다** —
        와이어프레임에도 장식으로만 그려져 있던 것이라 그대로 옮겼었다.
        없는 동작을 있는 것처럼 말하는 표시라, 잡아당겨 본 사람에게는 고장으로 읽힌다.
        (주차장 화면의 손잡이는 눌러서 실제로 목록이 오르내린다 — 거기는 남는다.)
      */}
      <div className="flex items-start pr-[15px] pl-[30px]">
        <div className="min-w-0">
          {/*
            유형 뱃지는 이름 뒤에 붙는다. 카테고리가 없는 곳이 있어 그때는 통째로 빠지고,
            **이름에 이미 그 말이 들어 있을 때도 뺀다** — "서귀포KAL호텔 호텔", "협재해수욕장 해수욕장",
            "제주국제공항 공항"처럼 같은 말이 두 번 적히기 때문이다. 실제 검색 결과 14곳 중 9곳이 그랬다.
            뱃지가 값을 하는 건 이름만 봐서는 뭔지 모르는 곳들이다 —
            "늘봄흑돼지 음식점", "스타벅스 제주용담DT점 카페", "우도 섬".

            와이어프레임은 서귀포칼호텔 옆에 "호텔"을 붙여 그렸지만 그건 예시 한 장이고, 실제 데이터에서는
            반복이 규칙이었다. 와이어프레임대로 늘 붙이려면 아래 !place.label.includes(...) 만 지우면 된다.
          */}
          <div className="flex min-w-0 items-baseline gap-[7px]">
            <h2 className="truncate text-[18px] leading-[26px] font-bold text-[#1f1f1f]">{place.label}</h2>
            {place.type && !place.label.includes(place.type) && (
              <span className="shrink-0 text-[13px] leading-[26px] font-medium text-[#9e9e9e]">{place.type}</span>
            )}
          </div>

          {/*
            거리 + 지역. 이 줄 자체는 안 바뀌고, ⌄ 를 누르면 주소 카드가 위에 떠오른다
            (와이어프레임과 카카오·네이버가 다 같은 모양이다 — 줄을 늘리면 아래 버튼들이 밀린다).
            주소가 아예 없는 장소에서는 누를 게 없으니 disabled 다.
          */}
          {/*
            주소 카드가 이 줄을 기준으로 위에 뜬다. 기준을 이 줄 하나로 좁게 잡는 게 중요하다 —
            바깥 상자(이름 + 이 줄)를 기준 삼으면 카드가 이름보다 더 위로 밀려난다. 와이어프레임은
            카드 바닥이 이 줄 바로 위, 즉 이름을 덮는 자리다.
          */}
          <div className="relative">
            <button
              type="button"
              onClick={toggleAddress}
              disabled={!place.road && !place.jibun}
              aria-expanded={openAddress}
              aria-label="주소 보기"
              className="mt-[6px] flex min-w-0 items-center gap-[6px] text-left text-[14px] leading-[22px] font-medium text-[#9e9e9e] disabled:cursor-default"
            >
              <span className="min-w-0 truncate">
                {/*
                  거리는 안 적는다. 여기서 낼 수 있는 값은 좌표 사이 직선거리뿐인데(lib/parking.ts
                  meters) 제주는 해안도로·중산간이 굽어 주행거리와 크게 어긋난다 — 한 탭 뒤
                  길 비교가 카카오 길찾기가 준 진짜 거리를 말하므로, 같은 목적지를 두고 두 화면이
                  다른 숫자를 말할 자리였다. 여기는 어디인지만 말한다.
                */}
                {place.region}
              </span>
              {(place.road || place.jibun) && (
                <Chevron className={`shrink-0 transition-transform ${openAddress ? "rotate-180" : ""}`} />
              )}
            </button>

            {openAddress && (
              <>
                {/*
                  바깥을 눌러 닫는 길. 카드보다 먼저 그려서 뒤에 깔린다.
                  fixed inset-0 이라 시트 밖(지도)까지 덮는다 — 지도를 끌어서 닫으려는 것도 여기서 잡힌다.
                */}
                <button
                  aria-label="주소 닫기"
                  onClick={() => setOpenAddress(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />

                {/*
                  카드. 와이어프레임은 320x89 를 x:17 에 두고 시트 위쪽 경계를 24px 넘겨 걸쳐 놓았다.
                  bottom-full 로 붙이면 줄 수가 둘이든 셋이든 알아서 위로 자란다 — 높이 89 를 박으면
                  우편번호 없는 곳(도로명이 없는 관광지)에서 빈 칸이 남는다.
                  -13px 은 시트의 pl-[30px] 을 상쇄해 와이어프레임의 x:17 로 맞추는 값이다.
                */}
                <div className="absolute bottom-full left-[-13px] z-20 mb-[3px] w-[320px] rounded-[10px] border border-[#ededed] bg-white px-[16px] py-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.14)]">
                  <AddressRow badge="도로명" value={place.road} />
                  <AddressRow badge="지번" value={place.jibun} />
                  {/* 아직 받는 중이면 줄이 없다. 다 받고도 없으면(도로명 없는 곳) 그대로 안 그린다 */}
                  <AddressRow badge="우편번호" value={postal ?? ""} filled />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        출발 — 지금 보고 있는 곳을 출발지로 삼는다. 화면을 따로 두지 않는다:
        출발지를 고르는 일은 목적지를 고르는 일과 같은 장소 검색이라, 같은 화면이 칸만 바꿔 받는다
        (원래 계획은 "목적지 → 출발 선택" 별도 화면이었다 — Figma 2173:1932).
        근처 주차장 보기는 /parking 이 받는다 (Figma 2153:1771 "수정 PARK-01 | 목적지 주변 주차장").
      */}
      <div className="mt-[11px] flex gap-1 px-4">
        <button
          onClick={onStart}
          className="h-10 shrink-0 rounded-full border border-[#e5e5e5] bg-white px-4 text-[14px] leading-[22px] font-bold text-[#1f1f1f] transition hover:bg-[#f5f5f5] active:scale-[0.98]"
        >
          출발
        </button>
        <button
          onClick={onParking}
          /*
            이 짝(흰 알약 + 주황 알약)이 앱의 기준이다 — 주차장 카드의 "자세히 · 여기로 갈게요"가
            여기 값을 그대로 따라간다 (app/parking/page.tsx SpotCard).
            이미 주황이 꽉 차 있어 옅은 주황을 덮을 수 없으니 한 톤 진한 주황으로 눌린다.
          */
          className="flex h-10 flex-1 items-center justify-center gap-[15px] rounded-full bg-[#ff7b33] text-[14px] leading-[22px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
        >
          <span aria-hidden className="text-[17px] leading-none font-bold">
            P
          </span>
          근처 주차장 보기
        </button>
      </div>

      {/*
        와이어프레임은 여기에 "길의 부담 설명 카드" 두 장(175x132)을 두는데 안이 비어 있다 —
        무엇을 적을지 정해지지 않은 자리다. 빈 테두리만 옮기면 화면이 고장 난 것처럼 보여서 뺐다.
        ponytail: 문구가 정해지면 여기에 되살린다 (lib/briefing.ts 에 규칙 기반 문장이 이미 있다).
      */}
    </div>
  );
}

/**
 * 주소 카드 한 줄 — 뱃지 + 주소 + 복사 (Figma 2606:847).
 *
 * 값이 없으면 줄째 사라진다. 도로명이 없는 장소(성산일출봉·협재해수욕장·우도)가 실제로 있고,
 * 그러면 우편번호도 없다 — 빈 줄로 남기면 못 받아온 것처럼 보이지만 원래 없는 것이다.
 *
 * 복사 자리는 오른쪽 정렬이 아니라 **값 바로 뒤**다. 와이어프레임에서 우편번호 줄의 복사만
 * x:137 로 앞에 와 있는데(다른 두 줄은 x:228), 값 길이를 따라간다는 뜻이다.
 */
function AddressRow({ badge, value, filled = false }: { badge: string; value: string; filled?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    // 보안 컨텍스트(https·localhost)가 아니면 clipboard 가 아예 없다. 그때는 조용히 넘어간다 —
    // 누른 사람에게 알릴 수 있는 게 "이 브라우저에서는 안 됩니다"뿐이라 알려도 할 수 있는 일이 없다.
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 무시 */
    }
  }

  return (
    <div className="flex items-center gap-[15px] py-[2px]">
      <span
        className={`grid h-[19px] w-[48px] shrink-0 place-items-center rounded-[4px] text-[10px] leading-none ${
          filled ? "bg-[#ff7b33] font-bold text-white" : "border border-[#ff7b33] text-[#1f1f1f]"
        }`}
      >
        {badge}
      </span>
      <span className="min-w-0 truncate text-[11px] leading-[19px] text-[#1f1f1f]">{value}</span>
      <button onClick={copy} className="shrink-0 text-[11px] leading-[19px] text-[#2f6fed]">
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

/**
 * route-editor 의 점. 속이 빈 링이다 (와이어프레임 그대로) — 꽉 찬 점은 이미 정해진 값처럼 보이는데,
 * 여기는 아직 채우는 중인 칸이 하나 있는 자리다.
 */
function Ring({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-[10px] shrink-0 rounded-full border-2 bg-white"
      style={{ borderColor: color }}
    />
  );
}

/** 주소 줄을 펼치는 ⌄. 와이어프레임의 Vector 15 자리인데 따로 뽑아둔 에셋이 없어 그려 넣는다. */
function Chevron({ className }: { className: string }) {
  return (
    <svg width="12" height="7" viewBox="0 0 12 7" fill="none" className={className} aria-hidden>
      <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
