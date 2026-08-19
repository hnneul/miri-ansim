"use client";

// 길 비교 — 최종 와이어프레임 HOME-02 | 길 비교 (Figma 2153:1704).
// 주차장을 정한 뒤(/parking/detail "이 주차장까지 경로보기") 여기로 온다.
//
// 화면이 하는 일: 카카오가 준 두 갈래를 지도에 겹쳐 그리고, 각각의 **추천점수**를 카드로 보여준다.
// 추천점수는 lib/score.ts 가 매긴다 — 운전 경력·빈도·차종·시간대(프로필)에 따라 같은 길도 값이 다르다.
// **높을수록 권할 만한 길이다.** 근거 카드의 요인별 점수는 반대 방향(깎인 몫)이라는 데 주의.
//
// 근거 화면(수정 HOME-03 | 안심 길 근거 1, Figma 2153:1986)도 여기 있다 — 라우트가 아니라 상태다.
// "이 길로 갈게요"를 누르면 여기로 온다 (카드 오른쪽 › 도 같은 문이다).
//
// 카카오맵은 **근거 화면의 버튼**이 연다. 턴바이턴 안내를 우리가 만들 이유가 없어서다.
// 출발지·경유지·도착지를 함께 넘기므로 **여기서 고른 길로 안내된다** (lib/parking.ts navigateTo).

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng } from "../RouteMap";
import { parseProfile } from "@/lib/profile";
import { navigateTo } from "@/lib/parking";
import { RECOMMEND_THRESHOLD } from "@/lib/score";
import { tradeoff } from "@/lib/briefing";
import { viaPoint, type LiveRoute } from "@/lib/route";
import RouteRadio from "./RouteRadio";
import PlaceSearch from "./PlaceSearch";
import type { Place } from "@/lib/geocode";
import { addRecent, loadRecent } from "@/lib/recent";
import { aiRadio, compareRoutes, type Compared } from "./actions";

/**
 * 시트 높이 = 지도가 아래로 비워 둘 높이. 상태마다 다르다.
 * 비교는 와이어프레임 그대로 350(카드 130 + 버튼 52 + 여백), 근거는 표 다섯 줄이 들어갈 만큼이다.
 *
 * 음성 안내 줄(RouteRadio, 58 + 여백 8)이 버튼 위에 들어갔는데 **높이는 그대로 둔다.**
 * 재보니 안쪽 스크롤 영역에 원래 여유가 있었다 — 비교는 268 자리에 내용이 148,
 * 근거는 438 자리에 359 였다. 시트를 키우면 그만큼 지도가 줄어드는데, 줄일 이유가 없다.
 *
 * 읽는 중에는 문장이 한 줄 더 붙어 근거 화면에서 내용이 넘칠 수 있다. 그건 원래 설계대로
 * **내용만** 스크롤되고 버튼은 아래 붙어 있다 (아래 시트의 flex 구성).
 */
const SHEET_H = { compare: 320, why: 520 };

/**
 * 접었을 때 남는 높이 — 요약 한 줄(44) + 버튼(49) + 여백이다.
 *
 * **버튼은 같이 안 내린다.** 지도를 크게 보는 동안에도 떠날 결정은 언제든 할 수 있어야 한다.
 * 그런데 버튼이 남으면 "무엇을 고른 상태인가"도 같이 남아야 한다 — 안 보이는 걸 확정하는
 * 버튼이 되기 때문이다. 그 줄이 요약 한 줄이고, 동시에 시트를 되올리는 손잡이를 겸한다
 * (/parking 은 목록이 통째로 사라져서 되올릴 문을 따로 띄웠지만, 여기는 남을 줄이 이미 있다).
 */
const STRIP_H = 130;

/**
 * 부담 구간을 겹쳐 그릴 색. 경로선(fast 파랑 #4A7DFF · safe 초록 #2FA97C, DESIGN.md --color-fast/--color-safe) 위에 올라가므로
 * 둘 다와 구별돼야 한다.
 *
 * **빨강(#dc2626)을 쓰다 되돌렸다.** DESIGN.md 토큰에 "빨강(#FF0000 계열) 사용 금지"가
 * 적혀 있고, 그 줄의 근거가 이 앱을 만든 이유다 — 멘토 지적 "네비게이션들 보면 빨간색으로
 * 띵띵 알림을 주는데 이게 초보자에게 어떻게 작용할까?". 경고색을 도로 가져오면 화면 하나가
 * 그 답을 뒤집는다. 게다가 나머지가 전부 귤빛·오프화이트라 순수 빨강만 채도가 튀었다.
 *
 * 그래서 3단 스케일의 맨 윗칸(--color-heavy)을 그대로 쓴다. 경로 두 색과도 구별되고,
 * 같은 뜻을 쓰는 자리가 지도와 카드 두 곳으로 갈리지 않는다.
 */
const 부담색 = "#D9663F";

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function RoutePage() {
  return (
    <Suspense>
      <Route />
    </Suspense>
  );
}

function Route() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams);
  const profile = parseProfile(query);

  /**
   * X 로 닫았을 때 돌아갈 화면. 넘어온 쪽이 ?back= 으로 알려준다.
   * **화이트리스트로만 받는다** — 쿼리에 온 주소를 그대로 push 하면 외부로 튕겨 보낼 수 있다.
   */
  const 닫고갈곳 = ({ destination: "/destination", nearby: "/nearby" } as const)[query.back as "destination" | "nearby"] ?? "/home";

  /** 도착지 — 앞 화면에서 고른 주차장이다 (관광지가 아니라 차를 댈 자리로 길을 만든다). */
  const to = query.to ?? "도착지";
  const dest = coord(query.toLat, query.toLng);

  /**
   * 출발지. 정상 흐름이면 메인화면이 잡아 넘긴 현위치가 쿼리에 실려 온다(originLat/originLng).
   * URL 로 바로 들어오면 없으므로 그때만 브라우저에 다시 묻는다 — 있는 값을 두고 또 묻지 않는다.
   *
   * **쿼리가 먼저고, 상태는 브라우저에 물어 받은 값만 든다.** 예전에는 쿼리를 useState 의 초기값으로
   * 한 번 베껴 두고 출발지를 고칠 때 setOrigin 과 router.replace 를 같이 불렀는데, 그러면 URL 쪽이
   * 묻혔다 — 지도와 경로는 새 출발지로 바뀌는데 칸에는 계속 "현재 위치"가 적혀 있었다.
   * (상태 갱신이 replace 의 트랜지션과 같은 틱에서 겹친다. 값이 두 곳에 있으면 언젠가 갈라진다.)
   */
  const fromQuery = coord(query.originLat, query.originLng);
  /** 브라우저에 물어 받은 현위치. 쿼리에 출발지가 없을 때만 채워진다. */
  const [geo, setGeo] = useState<LatLng | null>(null);
  const origin = fromQuery ?? geo;
  const [result, setResult] = useState<Compared | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  /** 고른 경로. 처음에는 추천된 쪽이다 (아래 useEffect). */
  const [picked, setPicked] = useState<LiveRoute["id"] | null>(null);
  /*
   * 어느 상태를 보고 있나 — 길 비교(HOME-02) / 근거(HOME-03).
   *
   * 화면 두 장을 라우트 두 개로 가르지 않는다. 근거 화면은 비교 화면이 이미 받아둔 값을
   * 다시 보여주는 것뿐인데 라우트를 나누면 카카오를 한 번 더 불러야 하고, **실시간 교통이라
   * 그 사이에 숫자가 바뀐다** — 앞 화면에서 56분이던 길이 근거 화면에서 58분이 된다.
   * (목적지 화면이 세 상태를 한 파일에 둔 것과 같은 이유다.)
   */
  const [view, setView] = useState<"compare" | "why">("compare");
  /** 지금 고쳐 잡는 중인 칸. null 이면 평소 화면(지도 + 시트)이다. */
  const [editing, setEditing] = useState<"from" | "to" | null>(null);
  /** 그 칸에 적고 있는 글자. 카드 안의 input 과 아래 목록이 같이 본다. */
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  /** 칸을 눌러 고치기 시작한다. 적던 값은 지우고 연다 — 지우고 시작하는 게 커서를 끝으로 옮기는 것보다 빠르다. */
  function edit(field: "from" | "to") {
    setEditing(field);
    setText("");
    requestAnimationFrame(() => input.current?.focus());
  }
  /*
   * AI 대본. 못 받으면 null 이고 화면은 규칙 대본(result.radio)을 그대로 쓴다 —
   * 재생 버튼이 이것 때문에 늦게 뜨거나 사라지는 일은 없다 (actions.ts aiRadio 주석).
   */
  const [aiScript, setAiScript] = useState<string[][] | null>(null);

  useEffect(() => {
    if (origin || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setGeo([coords.latitude, coords.longitude]),
      () =>
        setGeoError(
          "현재 위치를 확인할 수 없어 길을 만들지 못했습니다. 위치 접근을 허용해주세요.",
        ),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [origin]);

  const load = useCallback(async () => {
    if (!origin || !dest) return;
    setResult(null);
    const found = await compareRoutes(
      origin,
      dest,
      profile,
      /*
       * 대본 ④칸(도착해서 차를 댈 곳)의 재료다. dest 는 **주차장** 좌표고, destLat/destLng 는
       * 원래 고른 **목적지** 좌표라 둘 사이가 걸어갈 거리다 — /destination → /parking 을 거쳐
       * 오면서 쿼리에 그대로 실려 있다 (routeQuery 가 URLSearchParams 를 통째로 복사한다).
       *
       * query.to 가 없으면 주차장을 거쳐 온 흐름이 아니다. 그때는 넘기지 않는다 —
       * 이름을 "도착지"로 지어내면 대본이 "차는 도착지에 대시면 됩니다"라고 말하게 된다.
       */
      query.to
        ? {
            name: query.to,
            place: coord(query.destLat, query.destLng),
            // 대본 ①칸이 부를 이름 — 주차장이 아니라 **원래 고른 목적지**다 ("성산일출봉").
            // 목적지 화면이 실어 보낸 값이 여기까지 그대로 온다 (app/destination/page.tsx).
            placeName: query.dest,
          }
        : undefined,
    );
    setResult(found);
    // 추천된 쪽을 미리 골라 둔다 — 화면을 열자마자 눌러야 할 게 하나도 없어야 한다
    if (!("error" in found))
      setPicked(found.score.recommendedRoute === "fast" ? "fast" : "safe");
    // profile 은 매 렌더 새 객체라 의존성에 넣으면 무한히 다시 부른다. 쿼리가 그대로면 값도 그대로다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.[0], origin?.[1], dest?.[0], dest?.[1], searchParams.toString()]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * 경로가 새로 오면 AI 대본을 다시 받는다. 경로 카드는 이걸 안 기다린다 —
   * 여기서 await 하면 최대 6초 동안 시트가 "길을 살펴보는 중"에 머문다.
   *
   * 같은 프롬프트면 lib/ai.ts 의 캐시가 받아치므로, 시연에서 같은 구간을 반복해 열어도
   * 무료 한도가 한 번만 닳는다 (temperature 0 이라 캐시가 최적화가 아니라 원래 동작이다).
   */
  useEffect(() => {
    setAiScript(null);
    if (!result || "error" in result) return;
    // 응답이 늦게 온 사이에 다른 구간으로 넘어갔으면 버린다 — 앞 구간 대본이 뒤에 붙으면 안 된다
    let 유효 = true;
    aiRadio(result.facts).then((r) => {
      if (유효) setAiScript(r);
    });
    return () => {
      유효 = false;
    };
  }, [result]);

  /**
   * 검색 패널에서 고른 곳을 그 칸에 앉힌다.
   *
   * 쿼리를 고쳐 쓰기만 하면 된다 — load 가 쿼리를 보고 있어서(deps 의 searchParams) 길이 저절로
   * 다시 계산된다. replace 라 히스토리는 안 늘어난다: 고친 건 이 화면이지 다음 화면이 아니다.
   *
   * 도착지를 고치면 **주차장을 거쳐 온 흐름이 아니게 된다.** 그래서 원래 목적지(dest·destLat·destLng)를
   * 지운다 — 안 지우면 대본 ④칸이 "새 도착지에서 옛 관광지까지" 걸어가는 시간을 말하고,
   * ①칸은 "오늘은 (옛 목적지) 가시고" 로 엉뚱한 곳을 부른다.
   */
  function pick(place: Place) {
    const next = new URLSearchParams(searchParams);
    if (editing === "from") {
      next.set("originLat", String(place.coord[0]));
      next.set("originLng", String(place.coord[1]));
      next.set("originName", place.label);
    } else {
      next.set("to", place.label);
      next.set("toLat", String(place.coord[0]));
      next.set("toLng", String(place.coord[1]));
      next.delete("dest");
      next.delete("destLat");
      next.delete("destLng");
    }
    // 목적지 화면과 같은 목록에 쌓는다 — 여기서 찾은 곳이 거기서 안 보이면 기억이 두 벌이 된다
    addRecent(loadRecent(), place.label);
    setEditing(null);
    // 고친 구간의 근거는 아직 안 본 상태다 — 비교 화면으로 되돌린다
    setView("compare");
    router.replace(`/route?${next}`);
  }

  /**
   * 시트를 내려 지도를 크게 보고 있는가 (비교 화면에서만).
   *
   * 근거 화면은 안 접는다 — 거기는 표와 대본을 읽는 자리라 접으면 화면에 아무것도 안 남는다.
   */
  const [collapsed, setCollapsed] = useState(false);
  // 근거로 넘어갔다 돌아오면 다시 펴 둔다 — 접힌 채로 돌아오면 방금 본 근거의 카드가 안 보인다
  useEffect(() => {
    if (view === "why") setCollapsed(false);
  }, [view]);

  const routes = result && !("error" in result) ? result.routes : [];
  const chosen = routes.find((r) => r.id === picked) ?? routes[0] ?? null;
  const sheetH = view === "compare" && collapsed ? STRIP_H : SHEET_H[view];

  /**
   * 지도에 겹쳐 그릴 위험 구간 — **부담이 가장 큰 요인 하나**의 것.
   *
   * 요인을 다 그리면 색이 늘고 범례가 필요해진다. 게다가 좁은 교행과 고속주행은 성격이 반대인
   * 길이라(좁은 길 / 큰길) 한 색으로 묶으면 거짓말이 된다. 음성 ③칸과 근거 카드가 이미
   * 하나를 지목하고 있으니 지도도 같은 하나를 짚는다 — 세 매체가 같은 곳을 가리킨다.
   *
   * breakdown 을 경로로 먼저 좁힌다. 요인 이름이 양쪽에 같으면(좁은 교행 등) factor 만으로
   * 찾다가 다른 경로 행이 잡힌다 (lib/briefing.ts 최대요인 과 같은 함정이다).
   * spans 가 없는 요인(급커브)은 건너뛰고 그다음 요인을 본다 — 그릴 게 없으면 그리지 않는다.
   */
  /**
   * 비교 화면에서 두 경로에 칠할 요인 — **두 경로의 감점 차가 가장 큰 것** 하나다.
   *
   * 경로마다 자기 최대 요인을 칠하면 안 된다. 같은 빨강이 한쪽에서는 좁은 교행, 다른 쪽에서는
   * 고속주행을 뜻하게 되고, 그러면 "빨간 게 적은 쪽이 낫다"가 거짓이 된다 — 비교 화면에서
   * 색은 **두 길에 같은 뜻**이어야 한다.
   *
   * 차가 가장 큰 요인을 고르는 이유는 그게 두 길을 가른 이유이기 때문이다 (음성 ②칸이 말로
   * 하는 것과 같은 선택 — lib/briefing.ts 나은점). 한쪽에 그 요인이 아예 없으면 그 길에는
   * 빨간 게 안 그려지고, 그 빈 것 자체가 비교다.
   *
   * spans 가 있는 요인만 후보다 — 급커브는 아직 구간 좌표가 없어 칠할 수가 없다.
   */
  const 가른요인 = (() => {
    if (!result || "error" in result || routes.length < 2) return null;
    const 감점 = (id: string, factor: string) =>
      result.score.breakdown.find((b) => b.route === id && b.factor === factor)?.weighted ?? 0;
    const 후보 = [
      ...new Set(routes.flatMap((r) => r.risks.filter((k) => k.spans?.length).map((k) => k.label))),
    ];
    return (
      후보
        .map((f) => ({ f, 차: Math.abs(감점("fast", f) - 감점("safe", f)) }))
        .sort((a, b) => b.차 - a.차)[0]?.f ?? null
    );
  })();

  /**
   * 선 굵기 — 경로선과 그 위에 겹치는 부담 구간이 **같은 값**을 써야 한다.
   * 따로 두면 부담이 선보다 굵어져 양옆으로 삐져나오고, "이 구간에서 선이 빨개진다"가 아니라
   * "선 위에 점이 얹혔다"로 읽힌다 (실제로 그랬다 — 선 4px 에 부담 5px).
   */
  const 굵기 = (id: string) => (id === picked ? 7 : 4);

  /**
   * 안 고른 경로의 선 색. **투명도로 눕히지 않는다** — 같은 50% 라도 초록은 지도 풀색으로
   * 가라앉는데 파랑(#4A7DFF)은 채도가 높아 연보라로 또렷하게 남았다. 색상마다 결과가 다르니
   * 색을 바꿀 때마다 투명도를 다시 맞춰야 한다.
   *
   * 회색으로 눕히면 색상과 무관하게 물러난다. 어느 길인지는 말풍선(제 색 그대로)과 카드가 말한다.
   */
  const 흐린색 = "#A3ADBB";

  const 위험구간 =
    result && !("error" in result) && chosen
      ? (result.score.breakdown
          .filter((b) => b.route === chosen.id)
          .sort((a, b) => b.weighted - a.weighted)
          .map((b) => chosen.risks.find((r) => r.label === b.factor))
          .find((r) => r?.spans?.length) ?? null)
      : null;

  /**
   * 고른 경로의 대본. AI 것이 있으면 그걸, 없으면 규칙 대본을 쓴다.
   * 둘의 칸 구성이 같아서 RouteRadio 는 어느 쪽이 왔는지 몰라도 된다.
   */
  const 대본 =
    result && !("error" in result) && chosen
      ? (aiScript?.[routes.indexOf(chosen)] ?? result.radio[chosen.id] ?? null)
      : null;

  /*
   * 카카오맵으로 넘어간다. 도착지만 넘기면 카카오가 출발지도 경로도 자기 기준으로 다시 잡아서,
   * 여기까지 두 화면을 들여 고른 길이 한 탭에 무의미해진다. 그래서 셋을 다 싣는다:
   * 출발지 · **고른 경로 위의 경유지** · 도착지 (lib/parking.ts navigateTo).
   *
   * 경유지는 상대 경로에서 가장 먼 점이다 — 두 길이 갈라진 한복판이라 그 길로 확실히 돌아온다
   * (lib/route.ts viaPoint). 출발지를 모르면(위치 거부) 경유지도 못 쓴다 — by/car 형식이
   * 출발·경유·도착을 다 요구해서다. 그때는 예전처럼 도착지만 넘기고 화면이 그렇다고 밝힌다.
   */
  function go() {
    if (!chosen || !dest) return;
    const other = routes.find((r) => r.id !== chosen.id);
    navigateTo(
      { name: to, at: dest },
      origin
        ? {
            from: { name: query.originName ?? "출발지", at: origin },
            via: { name: chosen.name, at: viaPoint(chosen.path, other?.path) },
          }
        : {},
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-white">
      <StatusBar tone="text-[#525252]" />

      {view === "why" ? (
        /* HOME-03 은 위에 뒤로가기 하나뿐이다 — 출발/도착은 이미 앞 화면에서 확인한 값이다 */
        <div className="mx-4 flex h-14 shrink-0 items-center">
          <button
            onClick={() => setView("compare")}
            aria-label="뒤로"
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
        </div>
      ) : (
        /*
          route-editor — 두 칸 다 눌러서 고쳐 잡을 수 있다.
          검색 화면을 따로 두지 않는 이유: 고치고 나서 봐야 하는 건 이 화면의 지도와 카드라,
          라우트를 나누면 고칠 때마다 여기를 나갔다 들어오게 된다.

          **고치는 동안에도 이 카드는 제자리에 있다.** 전에는 검색창 하나짜리 화면이 통째로 덮었는데,
          그러면 방금 누른 칸이 화면에서 사라져서 어느 쪽을 고치는 중인지가 다시 흐려졌다.
          카드는 두고 아래(지도·시트)만 목록으로 바꾼다 (/destination 의 그 카드와 같은 규칙).
        */
        <div className="mt-[9px] flex shrink-0 items-start gap-[21px] px-[21px]">
          <div className="min-w-0 flex-1 overflow-hidden rounded-[10px] border border-[#d6d6d6] bg-white">
            <Field
              dot="#fc7f35"
              label="출발지"
              /* 고쳐 잡았으면 그 이름, 아니면 잡아온 현위치다 */
              value={query.originName ?? (origin ? "현재 위치" : "확인 중…")}
              editing={editing === "from"}
              text={text}
              onText={setText}
              inputRef={input}
              onEdit={() => edit("from")}
            />
            <div className="mx-[10px] border-t border-[#e6e6e6]" />
            <Field
              dot="#1f1f1f"
              label="도착지"
              value={to}
              editing={editing === "to"}
              text={text}
              onText={setText}
              inputRef={input}
              onEdit={() => edit("to")}
            />
          </div>
          {/*
            닫기는 **이 경로를 고르기 시작한 화면**으로 나간다 (back 쿼리, 없으면 /home).

            처음엔 무조건 /home 이었다. router.back() 이 주차장으로 되돌아가서 "닫기"가 아니라
            "뒤로"가 되는 게 싫었기 때문인데, 홈으로 보내니 이번엔 **튕겨나가는 느낌**이 났다.
            지도 앱에서 X 가 자연스러운 건 배경 지도가 그대로 남아서다 — 상단 UI 만 걷히니
            "닫혔다"로 읽힌다. 이 앱은 /route(전체화면 지도)와 /home(히어로+카드)의 레이아웃이
            통째로 달라서 그 연속성이 없다.

            그래서 **온 화면으로 돌려보낸다.** 그 화면들은 전부 지도 중심이라 배경이 이어진다.
            주차장(/parking)이 아니라 /destination 인 이유는, 주차장은 거쳐 온 중간 단계지
            경로 고르기를 시작한 자리가 아니어서다.

            back 은 **정해둔 몇 곳만** 받는다 — 임의 주소를 그대로 밀어넣으면 남의 사이트로
            튕겨 보낼 수 있다.

            칸을 고치는 중이면 그것부터 접는다. 한 번에 나가면 고치려다 만 사람이 화면 밖으로 밀려난다.
          */}
          <button
            onClick={() => (editing ? setEditing(null) : router.push(`${닫고갈곳}?${searchParams}`))}
            aria-label={editing ? "고치기 그만두기" : "닫기"}
            /* 호버는 목적지 화면의 같은 상자와 짝을 맞춘다 (거기 주석에 이유가 있다) */
            className="mt-[32px] grid size-[44px] shrink-0 place-items-center rounded-[10px] border border-[#d6d6d6] bg-white transition hover:bg-[#fff0e6] active:bg-black/5"
          >
            <img src="/home/icon-close.svg" alt="" className="size-6" />
          </button>
        </div>
      )}

      {/* 고치는 중이면 지도·시트 자리를 목록이 대신한다 (카드는 위에 그대로 남아 있다) */}
      {editing && <PlaceSearch text={text} onPick={pick} />}

      {/*
        지도 — 두 경로를 겹쳐 그린다. 고른 쪽이 굵고 진하다.

        RouteMap 을 absolute inset-0 로 한 겹 감싸야 한다. 그 안은 h-full 인데 flex-1 부모는
        specified height 가 auto 라, 퍼센트 높이가 0으로 죽어 지도가 통째로 안 보인다
        (실제로 그랬다 — 615px 짜리 상자 안에서 지도 높이가 0이었다). inset-0 이면 크기가 확정된다.
        /destination 이 같은 이유로 같은 모양이다.
      */}
      <div className={`relative mt-[24px] min-h-0 flex-1 ${editing ? "hidden" : ""}`}>
        <div className="absolute inset-0">
          <RouteMap
            className=""
            center={dest ?? [33.38, 126.55]}
            level={9}
            /* 근거 화면에서는 고른 길 하나만 그린다 — 그 길을 설명하는 자리라 나머지는 방해다 */
            routes={[
              ...(view === "why" ? routes.filter((r) => r.id === picked) : routes).map((r) => ({
                path: r.path,
                color: r.id === picked ? r.color : 흐린색,
                labelColor: r.color,
                weight: 굵기(r.id),
                opacity: r.id === picked ? 0.95 : 0.9,
                label: `${r.durationMin}분`,
              })),
              /*
                위험 구간을 경로선 위에 겹친다. **근거 화면에서만** 그린다 —
                비교 화면은 두 길 중 하나를 고르는 자리라 색이 이미 둘이고, 거기에 세 번째 색이
                올라오면 무엇을 견주는 화면인지 흐려진다. 여기는 이미 고른 길 하나만 그리는 자리다.

                뒤에 놓아야 경로선 위로 올라온다 (RouteMap 이 배열 순서대로 그린다).

                **말풍선은 안 붙인다.** 가장 긴 선에 요인 이름을 붙여봤더니 경로 라벨("67분")과
                한 자리에 겹쳐 시간을 통째로 가렸다 — 둘 다 경로 중간점 근처라 그렇다
                (RouteMap 주석의 "겹치면 그때" 가 이 경우다). 무슨 색인지는 아래 비교표의
                같은 줄에 같은 색 점을 찍어 알린다 (Why 의 위험요인 prop) — 지도에 말풍선을
                하나 더 띄우는 것보다 싸고, 숫자를 확인하는 자리와 지도가 한 색으로 묶인다.
              */
              ...(view === "why" && 위험구간?.spans
                ? 위험구간.spans.map((path) => ({
                    path,
                    color: 부담색,
                    weight: 7,
                    opacity: 0.95,
                  }))
                : []),
              /*
                비교 화면에서는 **두 경로에 같은 요인**을 칠한다 (가른요인 주석).

                **투명도는 경로를 따라가지 않는다.** 처음엔 "고른 쪽이 진하다"는 규칙을 여기도
                적용했는데(0.95 / 0.55), 그러면 안 고른 길의 빨강이 흐려져서 **빨간 게 적어
                보인다** — 실제로 추천한 길이 더 위험해 보이는 화면이 나왔다. 이 색이 하는 일은
                양을 견주는 것이고, 한쪽을 흐리면 그 비교가 거짓이 된다.

                **굵기는 경로를 따라간다.** 이건 반대다 — 아래 선보다 굵으면 빨강이 양옆으로
                삐져나와 **선 위에 얹은 점**처럼 보인다 (안 고른 경로는 선이 5px 인데 빨강을 7px 로
                그리고 있었다). 같은 굵기로 정확히 덮으면 "이 구간에서 선이 빨개진다"로 읽힌다.
                어느 길인지는 아래 깔린 경로선과 말풍선이 이미 말한다.
              */
              ...(view === "compare" && 가른요인
                ? routes.flatMap((r) =>
                    (r.risks.find((k) => k.label === 가른요인)?.spans ?? []).map((path) => ({
                      path,
                      color: 부담색,
                      weight: 굵기(r.id),
                      opacity: 0.95,
                    })),
                  )
                : []),
            ]}
            markers={[
              ...(origin ? [{ coord: origin, label: "출발" }] : []),
              ...(dest ? [{ coord: dest, label: "도착" }] : []),
            ]}
            padBottom={sheetH}
            /* 지도 빈 곳을 눌렀다 = 지도를 보겠다는 뜻이다 — 손잡이를 다시 찾게 하지 않는다 */
            onBlank={() => view === "compare" && setCollapsed(true)}
          />
        </div>
      </div>

      {/*
        route-comparison-sheet. 와이어프레임은 350 고정인데 그건 카드 두 장(130) + 버튼(52) 기준이고,
        근거 표는 다섯 줄이라 그 높이에 안 들어간다 — 실제로 버튼이 잘렸다. 상태마다 높이를 달리하되,
        안이 넘치면 **내용만** 스크롤하고 버튼은 아래 붙어 있게 flex 로 나눈다 (줄 수가 늘어도 안 잘린다).
        지도에 넘기는 padBottom 도 같은 값을 써야 마커가 시트에 안 걸린다.
      */}
      {/*
        근거 화면 시트만 아래로 갈수록 옅은 파랑이다 (와이어프레임 2153:1992 배경).
        그 위에 얹히는 흰 카드(tradeoff-card)가 테두리 없이 떠 보이게 하는 장치다 —
        시트가 통째로 흰색이면 카드도 같이 사라진다. 비교 화면은 카드 두 장이 이미
        테두리를 갖고 있어서 흰 바탕 그대로 둔다.
      */}
      <div
        style={{
          height: sheetH,
          ...(view === "why" && {
            backgroundImage: "linear-gradient(180deg, #ffffff 55%, #d2eafe 100%)",
          }),
        }}
        /* 지도와 함께 접힌다 — 칸을 고치는 동안 그 자리는 검색 목록 것이다 */
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)] ${editing ? "hidden" : ""}`}
      >
        {/*
          손잡이. 비교 화면에서만 눌린다 — 실제로 끌리지는 않고, 눌러서 되는 걸로 충분하다
          (/parking 시트와 같은 판단). 보이는 막대는 4px 지만 누르는 자리는 20px 이다.
        */}
        {view === "compare" ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "길 비교 펼치기" : "길 비교 접고 지도 크게 보기"}
            aria-expanded={!collapsed}
            className="flex h-5 w-full shrink-0 items-center justify-center"
          >
            <span aria-hidden className="h-1 w-12 rounded-[2px] bg-[#d6d6d6]" />
          </button>
        ) : (
          <div aria-hidden className="mx-auto h-1 w-12 shrink-0 rounded-[2px] bg-[#d6d6d6]" />
        )}

        {!dest ? (
          <Notice>도착지가 없습니다. 주차장을 다시 골라주세요.</Notice>
        ) : geoError ? (
          <Notice tone="error">{geoError}</Notice>
        ) : !result ? (
          <Notice>길을 살펴보는 중이에요…</Notice>
        ) : "error" in result ? (
          <Notice tone="error">{result.error}</Notice>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view === "compare" && collapsed && chosen ? (
                /*
                  접었을 때 남는 한 줄. 이름·시간·점수 셋만 적는다 — 거리와 배지는 뺐다.
                  여기는 고르는 자리가 아니라 **이미 고른 걸 확인하는 자리**라서,
                  아래 버튼이 무엇을 확정하는 버튼인지만 말하면 된다.

                  줄 전체가 펼치는 문이다. 위 손잡이와 같은 일을 하지만 누르는 자리가 훨씬 넓어,
                  4px 막대를 정확히 노리지 않아도 된다.
                */
                <button
                  onClick={() => setCollapsed(false)}
                  aria-label="길 비교 펼치기"
                  className="flex h-[44px] w-full items-center gap-2 px-4 text-left transition active:bg-black/[0.03]"
                >
                  <span className="truncate text-[15px] font-bold text-[#1f1f1f]">
                    {titleOf(
                      chosen,
                      result.routes.find((r) => r.id !== chosen.id) ?? null,
                      result.score.recommendedRoute === chosen.id,
                    )}
                  </span>
                  <span className="shrink-0 text-[13px] text-[#9e9e9e]">
                    {chosen.durationMin}분 · 추천점수{" "}
                    {Math.round(
                      chosen.id === "fast" ? result.score.fastScore : result.score.safeScore,
                    )}
                  </span>
                </button>
              ) : view === "why" && chosen ? (
                <Why
                  route={chosen}
                  other={result.routes.find((r) => r.id !== chosen.id) ?? null}
                  score={
                    chosen.id === "fast"
                      ? result.score.fastScore
                      : result.score.safeScore
                  }
                  pick={result.score.recommendedRoute}
                  대본={대본}
                  위험요인={위험구간?.label ?? null}
                  대본펼침={query.대본 === "1"}
                />
              ) : (
                <>
                  {/*
                  추천을 접었을 때만 나오는 줄이다. 부담이 같아서 못 고른 경우(tie)는 그렇다고
                  말해준다 — 안 말하면 기본 선택된 카드가 주황으로 떠 있어 추천처럼 보이는데
                  배지는 없는 상태가 된다.

                  판단이 애매한 경우(unclear)는 lib/briefing.ts 가 빈 문자열을 주고, 그러면 이
                  줄을 안 그린다. **빈 값 검사가 곧 그 규칙이다** — 여기서 tie 인지 다시 보지
                  않는다. 무슨 말을 할지는 briefing.ts 한 곳에서만 정한다 (못고른말 주석).
                */}
                  {result.verdicts[picked ?? result.routes[0].id] &&
                    result.score.recommendedRoute === "single" && (
                      <p className="mt-[18px] px-4 text-[13px] leading-[20px] text-[#525252]">
                        {result.verdicts[picked ?? result.routes[0].id]}
                      </p>
                    )}

                  {/*
                    지도의 빨간 색이 무엇인지 대는 한 줄.

                    카드 안에 넣을 자리가 없고(추천점수·시간·거리·이름이 이미 꽉 찼다) 지도에
                    말풍선을 띄우면 경로 라벨과 겹친다(위 routes prop 주석). 그래서 지도와 카드
                    사이에 잔글씨로 둔다 — 지도를 본 눈이 카드로 내려오는 길목이다.

                    **근거 화면과 칠하는 요인이 다르다.** 여기는 두 길을 견주는 자리라 "두 길을
                    가른 것"을 칠하고(가른요인), 근거 화면은 한 길을 설명하는 자리라 "그 길에서
                    가장 부담인 것"을 칠한다. 질문이 다르니 답도 다르다 — 그래서 양쪽 다 이름을
                    적어야 한다. 한쪽에만 이름이 없으면 같은 빨강을 같은 것으로 오해한다.
                  */}
                  {가른요인 && (
                    <p className="mt-[14px] flex items-center gap-[6px] px-4 text-[11px] leading-[16px] text-[#949494]">
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: 부담색 }}
                      />
                      {가른요인} — 두 길이 가장 다른 구간
                    </p>
                  )}

                  {/*
                    두 카드가 크기가 다르다 (와이어프레임 3847:2926 — 추천 202x132 / 나머지 147x98).
                    items-end 로 **아래를 맞춘다** — 위를 맞추면 작은 카드가 공중에 뜬 것처럼 보인다.
                    폭은 고정값 대신 비율(flex-[202]/flex-[147])로 준다. 360px 기기에서 합이 넘치면
                    고정 폭은 그냥 삐져나가는데, 비율이면 둘이 같이 줄어든다.
                  */}
                  <div className="mt-[18px] flex items-end gap-[11px] px-4">
                    {result.routes.map((r) => (
                      <RouteCard
                        key={r.id}
                        route={r}
                        title={titleOf(r, result.routes.find((o) => o.id !== r.id) ?? null, result.score.recommendedRoute === r.id)}
                        score={
                          r.id === "fast"
                            ? result.score.fastScore
                            : result.score.safeScore
                        }
                        recommended={result.score.recommendedRoute === r.id}
                        picked={r.id === picked}
                        onPick={() => setPicked(r.id)}
                        onWhy={() => {
                          setPicked(r.id);
                          setView("why");
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="shrink-0 px-4 pt-2 pb-2">
              {/*
                두 화면이 같은 글씨의 버튼을 쓰지만 **하는 일이 다르다.** 비교(HOME-02)의 버튼은
                근거 화면으로 넘기고, 근거(HOME-03)의 버튼이 실제로 카카오맵을 연다.
                고른 길을 확인만 하고 떠나는 게 아니라 **왜 이 길인지 한 번은 보고 떠나게** 하는
                흐름이다 — 카드 오른쪽 › 로도 같은 화면에 들어가지만 그건 안 눌러도 되는 문이라
                대부분 안 누른 채로 나갔다.

                **와이어프레임은 그 차이를 색으로 갈라 뒀는데(2153:1730 검정 → 2153:2036 주황)
                여기서는 둘 다 주황 알약이다.** 앱에서 검정 버튼은 흐름에 들어오기 전 화면
                (스플래시 "프로필 만들기" · 온보딩 "다음")에만 쓰고, 흐름 안에서 하려던 일은
                전부 주황 알약이다 (출발·근처 주차장 보기, 자세히·여기로 갈게요). 이 화면만
                검정을 쓰면 결이 어긋나고, 게다가 같은 버튼이 화면 상태에 따라 검정과 주황을
                오갔다 — 색이 "무엇을 하는 버튼인가"가 아니라 "지금 몇 번째 화면인가"를 말하고 있었다.
                두 단계의 차이는 화면이 이미 말하고 있으니 버튼 색까지 나눌 일이 아니다.

                ➤ 도 뺐다. 앱의 다른 버튼은 글자만 있다 (주차장의 P 하나가 예외인데 그건 주차 기호다).
              */}
              <button
                onClick={() => {
                  if (view === "why") return go();
                  if (!chosen) return;
                  setPicked(chosen.id);
                  setView("why");
                }}
                /*
                  두 화면이 색과 폭까지 다르다 (와이어프레임 3847:2947 검정 ↔ 2153:2036 주황).
                  비교 화면의 버튼은 아직 떠나는 버튼이 아니라 근거를 여는 문이라, 화면 폭을
                  꽉 채우지 않고 가운데 251px 알약으로 물러나 있다. 근거 화면에서 같은 글씨가
                  주황 통짜로 바뀌는 그 순간이 "이제 진짜 나간다"는 표시가 된다.
                */
                className={
                  view === "why"
                    ? "h-[52px] w-full rounded-full bg-[#ff7b33] text-[16px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.99]"
                    : "mx-auto flex h-[49px] w-[251px] items-center justify-center gap-2 rounded-full bg-[#3a3532] text-[14px] font-bold text-white transition hover:bg-[#1f1f1f] active:scale-[0.99]"
                }
              >
                {view !== "why" && (
                  <img src="/route/icon-navigation.svg" alt="" aria-hidden className="size-5" />
                )}
                이 길로 갈게요
              </button>
              {/*
                버튼 밑 한 줄. **근거 화면에만** 있다 (와이어프레임 2153:3973) — 비교 화면의
                버튼은 다음 화면으로 넘어갈 뿐이라 안내가 시작된다고 말하면 거짓말이다.

                출발지를 모르면 그 자리에 경고를 대신 넣는다. 그때는 경유지를 못 실어
                (by/car 형식이 출발·경유·도착 셋을 다 요구한다) 정말로 다른 길로 안내될 수 있고,
                그건 "이 길로 안내해요"보다 먼저 알아야 하는 사실이다. 둘을 같이 띄우지 않는다 —
                버튼 밑에 잔글씨가 두 줄이면 화면이 각주투성이가 된다.
              */}
              {view === "why" && (
                <p className="mt-2 text-center text-[11px] leading-[16px] text-[#9e9e9e]">
                  {origin
                    ? "카카오맵이 이 길로 안내해요"
                    : "출발지를 몰라 다른 길로 안내될 수 있어요"}
                </p>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

/** "33.4996" 두 개를 좌표로. 숫자가 아니면 없는 셈 친다 — URL 은 손으로 고칠 수 있는 입력이다. */
function coord(lat?: string, lng?: string): LatLng | null {
  const la = Number(lat);
  const ln = Number(lng);
  return lat && lng && Number.isFinite(la) && Number.isFinite(ln)
    ? [la, ln]
    : null;
}

/**
 * route-editor 의 한 줄. 평소에는 값을 보여주는 버튼이고, 고치는 중이면 **그 자리가 입력칸이 된다.**
 * 값 자리와 적는 자리가 같아야 어느 칸을 고치는 중인지가 화면에서 안 흐려진다.
 */
function Field({
  dot,
  label,
  value,
  editing,
  text,
  onText,
  inputRef,
  onEdit,
}: {
  dot: string;
  label: string;
  value: string;
  editing: boolean;
  text: string;
  onText: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onEdit: () => void;
}) {
  const row = "flex h-[51px] w-full items-center gap-[12px] px-[12px] text-left";
  const cap = "block text-[10px] leading-[14px] font-medium text-[#9e9e9e]";
  const val = "block truncate text-[14px] leading-[20px] font-medium text-[#1f1f1f]";
  const point = (
    <span
      aria-hidden
      className="size-[10px] shrink-0 rounded-full"
      style={{ backgroundColor: dot }}
    />
  );

  if (editing)
    return (
      <label className={row}>
        {point}
        <span className="min-w-0 flex-1">
          <span className={cap}>{label}</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder={`${label} 입력해 주세요`}
            aria-label={label}
            className={`${val} w-full bg-transparent outline-none placeholder:font-normal placeholder:text-[#9e9e9e]`}
          />
        </span>
      </label>
    );

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${label} 고치기`}
      className={`${row} transition active:bg-black/5`}
    >
      {point}
      <span className="min-w-0">
        <span className={cap}>{label}</span>
        <span className={val}>{value}</span>
      </span>
    </button>
  );
}

function Notice({ children, tone }: { children: string; tone?: "error" }) {
  return (
    <p
      className={`mt-[60px] px-8 text-center text-[13px] leading-relaxed ${tone ? "text-rose-600" : "text-[#616161]"}`}
    >
      {children}
    </p>
  );
}

/**
 * 경로 카드 한 장 (와이어프레임 safe-route-card / fast-route-card).
 *
 * **이름을 데이터가 뒷받침하는 만큼만 붙인다.** 와이어프레임은 두 장을 "맞춤 안심 길"·"빠른 길"로
 * 못 박아 뒀는데, 여기 두 갈래는 카카오의 최단거리·최단시간 결과일 뿐이라 어느 쪽이 안심 길인지는
 * 점수를 매겨봐야 안다. 그래서 **점수가 추천한 쪽에만** "맞춤 안심 길"을 쓰고, 나머지는 도로 이름
 * ("번영로 경유")으로 둔다. 실측에서 부담 36점짜리가 35.9점짜리 옆에서 "맞춤 저부담" 배지를
 * 달고 있었던 적이 있다 (lib/route.ts routesFor 주석).
 */
/**
 * HOME-03 — 왜 이 길인가 (Figma 2153:1986).
 *
 * 표는 route.stats 로 만든다. 요인 목록(risks)으로는 못 만드는데, 거기는 값이 0인 요인을
 * 아예 빼기 때문이다 — 표에서 요지는 오히려 0 쪽이다 ("급커브 12곳 → 없음").
 *
 * **"사고 잦은 곳"은 아직 뺐다** — 채울 데이터가 없다 (도로교통공단 사고다발지역을 따로 받아야
 * 한다). 모르는 걸 0이나 "없음"으로 적으면 확인한 사실처럼 읽힌다.
 *
 * **"비보호 좌회전"은 되살렸다.** 한동안 신호 데이터가 없어 못 채우고 "좌회전·유턴" 횟수만
 * 적었는데, 제주는 신호현시를 주는 출처가 없어서(제주 C-ITS API가 2026-04-01 종료) 로드뷰로
 * 직접 판독해 표를 만들었다 (lib/unprotected.ts). 좌회전 **횟수**는 뺐다 — 초보에게 무서운 건
 * 좌회전 자체가 아니라 아무도 안 지켜주는 좌회전이라, 둘을 같이 적으면 요지가 흐려진다.
 *
 * 판독표에 없는 좌회전을 지나면 "확인 안 됨"이 된다. **0(봤더니 없다)과 구분해서 적는다.**
 */
function Why({
  route,
  other,
  score,
  pick,
  대본,
  대본펼침,
  위험요인,
}: {
  route: LiveRoute;
  /** 상대 경로. 없으면(단일 경로) 비교 칸 없이 내 값만 적는다 */
  other: LiveRoute | null;
  score: number;
  /** 추천 결과 그대로 (lib/score.ts). "single" 은 추천을 접었다는 뜻이다 */
  pick: "fast" | "safe" | "single";
  대본: string[] | null;
  /** `?대본=1` — 대본 전체를 글로 펼친다 (RouteRadio 펼침 주석) */
  대본펼침?: boolean;
  /**
   * 지도가 빨갛게 칠한 요인의 이름. 그 줄에 같은 색 점을 찍어 **지도와 표를 묶는다** —
   * 지도에 말풍선을 띄우면 경로 라벨과 겹친다 (위 routes prop 주석).
   * 그릴 구간이 없으면 null 이고, 그때는 어느 줄에도 점이 없다.
   */
  위험요인: string | null;
}) {
  const recommended = pick === route.id;
  const 한줄 = tradeoff(pick, route, other);
  const rows: { label: string; mine: string; theirs: string }[] = [
    row("비보호 좌회전", (s) =>
      s.unprotected === null ? "확인 안 됨" : s.unprotected ? `${s.unprotected}번` : "없음",
    ),
    row("회전교차로", (s) => (s.roundabouts ? `${s.roundabouts}곳` : "없음")),
    row("연속 급커브", (s) => (s.sharpCurves ? `${s.sharpCurves}곳` : "없음")),
    row("좁은 교행 구간", (s) =>
      s.narrow ? `${Math.round(s.narrow * 100)}%` : "없음",
    ),
    row("고속주행 구간", (s) =>
      s.highSpeedKm ? `${s.highSpeedKm}km` : "없음",
    ),
    /*
      보이는 값이 죄다 "확인 안 됨"인 줄은 뺀다.

      비보호 좌회전은 판독한 구간에만 값이 있어서(lib/unprotected.ts), 아직 안 본 구간에서는
      양쪽 다 빈 값이 된다 — 그 줄은 표의 맨 위를 차지하고서 아무것도 안 알려준다.
      "없음"과는 다르다: 없음은 확인해서 없다는 사실이고, 확인 안 됨은 사실이 아니라 공백이다.
      한쪽이라도 값이 있으면 남긴다. 그때는 "확인 안 됨 → 3번"이 비교로 읽힌다.
    */
  ].filter((r) => [r.mine, r.theirs].some((v) => v && v !== "확인 안 됨"));

  function row(label: string, of: (s: LiveRoute["stats"]) => string) {
    return {
      label,
      mine: of(route.stats),
      theirs: other ? of(other.stats) : "",
    };
  }

  return (
    <div className="px-4">
      <div className="flex items-center gap-2">
        {recommended && (
          <span className="shrink-0 rounded-[5px] bg-[#fc7f35] px-2 py-[3px] text-[11px] leading-none font-bold text-white">
            추천
          </span>
        )}
        {/* 근거 화면도 비교 화면과 같은 이름을 쓴다 — 넘어오면서 이름이 바뀌면 같은 길인지 흔들린다 */}
        <span className="min-w-0 truncate text-[16px] font-bold text-[#1f1f1f]">
          {titleOf(route, other, recommended)}
        </span>
        {/*
          점수만 주황이다. 비교 화면의 카드에서는 검정인데(거기선 두 값을 나란히 재는 자리라
          한쪽만 물들면 그게 답처럼 보인다) 여기는 이미 한 길을 고르고 들어온 자리라
          이 화면의 주인공이 그 숫자다 — 와이어프레임도 여기서만 주황으로 칠했다.
        */}
        <span className="ml-auto flex shrink-0 items-baseline gap-[6px]">
          <span className="text-[12px] text-[#9e9e9e]">추천점수</span>
          <span className="text-[34px] leading-none font-bold text-[#fc7f35]">
            {Math.round(score)}
          </span>
          <span className="text-[12px] font-medium text-[#9e9e9e]">
            {score >= RECOMMEND_THRESHOLD ? "높음" : "낮음"}
          </span>
        </span>
      </div>

      {/*
        tradeoff-card (와이어프레임 2153:2024) — 판정 한 줄과 시간 교환을 **한 상자에** 담는다.
        둘은 같은 말을 글과 숫자로 하는 것이라 떨어뜨려 두면 관계가 안 보인다.

        판정은 굵은 검정 14px 다. 회색 잔글씨로 뒀었는데, 이 화면에서 유일하게 "그래서 어떻다"를
        말하는 줄이라 표보다 흐리면 안 된다. 시간은 왼쪽에 상대, 오른쪽 끝에 이 길 —
        양끝으로 벌려야 "35분에서 42분으로"가 한눈에 읽힌다 (붙여 쓰면 그냥 숫자 두 개다).

        카드가 흰색이고 시트도 흰색이라 테두리 없이 겹친다. 시트 아래쪽에 옅은 파랑이 깔려서
        (아래 sheet 배경) 표 근처로 갈수록 카드가 떠 보인다 — 와이어프레임이 그렇게 그렸다.
      */}
      {(한줄 || other) && (
        <div className="mt-3 rounded-[9px] bg-white px-[14px] py-3">
          {한줄 && (
            <p className="text-[14px] leading-[20px] font-bold text-[#1f1f1f]">
              {한줄}
            </p>
          )}
          {other && (
            <div
              className={`flex items-center justify-between ${한줄 ? "mt-3" : ""}`}
            >
              <span className="text-[12px] text-[#949494]">
                {other.durationMin}분
              </span>
              <span className="flex items-center gap-[8px] text-[13px]">
                <span aria-hidden className="font-medium text-[#949494]">
                  →
                </span>
                <span className="font-bold text-[#1f1f1f]">
                  {route.durationMin}분
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        듣기 줄 — **판정 카드와 표 사이**가 제자리다 (와이어프레임 2153:3981, top 170).
        한동안 버튼 바로 위에 뒀는데 그건 비교 화면과 공용이던 자리를 그대로 물려받은 것이지
        고른 자리가 아니었다. 여기가 맞는 이유는 순서다: 무엇과 무엇을 맞바꾸는지 한 줄로 읽고
        (위 카드) → 더 들을 사람은 듣고 → 숫자로 확인한다(아래 표).
      */}
      {대본 && (
        <div className="mt-3">
          <RouteRadio script={대본} routeId={route.id} 펼침={대본펼침} />
        </div>
      )}

      {/*
        비교표. 왼쪽이 상대 경로, 오른쪽이 이 경로다 (와이어프레임의 "12곳 → 3곳" 방향 그대로).
        상대가 없으면(단일 경로) 화살표 없이 내 값만 적는다 — 비교할 게 없는데 화살표를 그리면
        왼쪽 빈칸이 0으로 읽힌다.
      */}
      {/* 테두리가 주황이다 — 이 화면에서 눈이 가야 할 곳이 표라는 뜻이다 (와이어프레임 2153:2002) */}
      <dl className="mt-4 overflow-hidden rounded-[10px] border border-[#fc7f35]">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className={`flex items-center justify-between px-[14px] py-[9px] ${i ? "border-t border-[#f0f0f0]" : ""}`}
          >
            <dt className="flex items-center gap-[6px] text-[13px] text-[#525252]">
              {r.label === 위험요인 && (
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: 부담색 }}
                />
              )}
              {r.label}
            </dt>
            <dd className="flex items-baseline gap-[8px] text-[13px]">
              {r.theirs && (
                <>
                  <span className="text-[#bdbdbd]">{r.theirs}</span>
                  <span aria-hidden className="text-[#bdbdbd]">
                    →
                  </span>
                </>
              )}
              <span className="font-bold text-[#1f1f1f]">{r.mine}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[11px] leading-[16px] text-[#bdbdbd]">
        좌회전·회전교차로는 카카오 길안내 지점, 급커브·좁은 길은 표준노드링크
        기준입니다
      </p>
    </div>
  );
}

/**
 * 카드에 적는 이름. **도로 이름("516로 경유")이 아니라 그 길의 성격이다** — 초보에게
 * "남조로"는 아무 정보가 아니고, 두 카드가 답해야 하는 건 "그래서 어느 쪽이 뭔데"다.
 * 도로 이름은 지도의 말풍선과 근거 화면이 이미 말하고 있다.
 *
 * **"빠른 길"은 진짜 빠를 때만 쓴다.** safe 자리는 부담이 가장 낮은 후보가 앉지만(lib/route.ts),
 * fast 자리는 "나머지 중 가장 빠른 것"이라 safe 보다 빠르다는 보장이 없다 — 실측에서 5.16도로가
 * 오히려 5분 느렸다(lib/score.ts fastIsQuicker 주석). 그때도 "빠른 길"이라 부르면 화면이
 * 거짓말을 하게 되므로, 시간이 실제로 짧을 때만 그렇게 부르고 아니면 거리로, 그것도 아니면
 * 아무 약속도 하지 않는 "다른 길"로 물러난다.
 */
function titleOf(route: LiveRoute, other: LiveRoute | null, recommended: boolean): string {
  const base =
    route.id === "safe"
      ? "안심 길"
      : !other || route.durationMin < other.durationMin
        ? "빠른 길"
        : route.distanceKm < other.distanceKm
          ? "짧은 길"
          : "다른 길";
  // 추천 배지가 붙는 쪽만 "맞춤" 을 얹는다 (와이어프레임의 "맞춤 안심 길")
  return recommended ? `맞춤 ${base}` : base;
}

function RouteCard({
  route,
  title,
  score,
  recommended,
  picked,
  onPick,
  onWhy,
}: {
  route: LiveRoute;
  /** 카드에 적을 이름 — 도로 이름이 아니라 성격이다 (아래 titleOf) */
  title: string;
  score: number;
  recommended: boolean;
  picked: boolean;
  onPick: () => void;
  onWhy: () => void;
}) {
  /*
    와이어프레임 "수정 HOME-02 | 길 비교 24" (3847:2926) 그대로다.

    **두 카드가 같은 모양이 아니다.** 추천 카드는 크고(202x132) 주황이 차 있고, 나머지는
    작고(147x98) 흰 바탕이다 — 크기 자체가 "이쪽을 권한다"는 말이라, 배지 하나로 알리던
    것보다 훨씬 먼저 읽힌다. 글자 크기도 한 벌씩 다르다 (점수 37 대 27, 이름 17.5 대 13).

    **큰 카드는 "고른 카드"다.** 와이어프레임에서는 추천 = 고름이라 둘이 겹쳐 보이지만, 기준을
    추천으로 잡으면 두 길 차이가 무의미할 때(score.ts recommendedRoute === "single") 추천이 아예
    안 붙어서 이 비대칭 배치가 화면에 안 나온다. 고름을 기준으로 하면 늘 한 장은 크다 —
    처음 들어올 때 추천 길이 이미 골라져 있어(setPicked) 첫 화면은 와이어프레임과 똑같다.

    덤으로 카드를 누르면 크기가 옮겨가서, 지도의 굵은 선이 바뀐 걸 못 본 사람도 뭘 골랐는지 안다.
    자리가 움직이는 건 transition-all 이 200ms 로 늘여 덜컹거리지 않게 한다.
  */
  const big = picked;
  return (
    <button
      onClick={onPick}
      aria-pressed={picked}
      /*
        flex 가 필요하다 — <button> 은 안쪽 내용을 세로 가운데로 몰아넣는 기본 동작이 있어서,
        그냥 두면 위에 붙어야 할 제목이 카드 한가운데로 내려와 아래 절대배치 줄과 겹친다.
      */
      className={`relative flex min-w-0 flex-col items-start rounded-[7px] text-left transition-all duration-200 ${
        big ? "h-[132px] flex-[202] px-[14px] pt-[16px]" : "h-[98px] flex-[147] px-[11px] pt-[14px]"
      } ${
        picked
          ? "border-2 border-[#fc7f35] bg-[#ffece1]"
          : "border border-[#d6d6d6] bg-white"
      }`}
    >
      <span className="flex items-center gap-[9px]">
        {recommended && (
          <span className="shrink-0 rounded-[6px] bg-[#fc7f35] px-[9px] py-[6px] text-[12.5px] leading-none font-bold text-white">
            추천
          </span>
        )}
        <span
          className={`min-w-0 truncate font-bold text-[#1f1f1f] ${big ? "text-[17.5px]" : "text-[13px]"}`}
        >
          {title}
        </span>
      </span>

      {/*
        › — 근거 화면(HOME-03)으로 가는 문. 와이어프레임이 두 카드 모두에 달아 둔 것이다.

        카드가 <button> 이라 그 안에 또 버튼을 넣으면 HTML 이 겹친다. span 에 역할만 얹고
        클릭이 바깥 카드로 새지 않게 여기서 끊는다 — 대신 그 카드를 고른 뒤에 열어야
        지도에 굵게 그려진 길과 근거 화면이 어긋나지 않으므로, 누를 때 선택도 같이 옮긴다.
      */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`${route.name} 근거 보기`}
        onClick={(e) => {
          e.stopPropagation();
          onWhy();
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onWhy())}
        className={`absolute top-[26px] right-[9px] cursor-pointer leading-none ${
          big ? "text-[20px] text-[#ff7d32]" : "text-[16px] text-[#9e9e9e]"
        }`}
      >
        ›
      </span>

      {/*
        시간·거리는 왼쪽 아래, 점수는 오른쪽에 큰 숫자로 — 둘이 같은 줄에 서지 않는다.
        추천 카드에서는 이 줄도 주황이다 (#ff7d32). 카드가 통째로 주황 계열이라 회색으로 두면
        혼자 식은 것처럼 보인다.
      */}
      <span
        className={`absolute left-[14px] ${
          big ? "top-[58px] text-[15px] text-[#ff7d32]" : "top-[44px] text-[11px] text-[#7d7d7d]"
        }`}
      >
        {route.durationMin}분 · {route.distanceKm}km
      </span>

      <span className={`absolute right-[9px] ${big ? "top-[52px]" : "top-[40px]"} text-right`}>
        <span
          className={`block font-bold text-[#1f1f1f] ${big ? "text-[37px]" : "text-[27px]"} leading-none`}
        >
          {Math.round(score)}
        </span>
        <span
          className={`mt-[7px] block font-medium text-[#040404] ${big ? "text-[11.5px]" : "text-[8.5px]"} leading-none`}
        >
          추천 점수
        </span>
      </span>
    </button>
  );
}
