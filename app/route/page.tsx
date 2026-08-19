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

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { labeledPin, type LatLng } from "../RouteMap";
import { parseProfile } from "@/lib/profile";
import { navigateTo } from "@/lib/parking";
import { isoToday } from "@/lib/record";
import { saveDrive, thinPath, type SafeDrive } from "@/lib/safelog";
import { tradeoff, 예요 } from "@/lib/briefing";
import { viaPoint, type LiveRoute } from "@/lib/route";
import RouteRadio from "./RouteRadio";
import PlaceSearch from "./PlaceSearch";
import type { Place } from "@/lib/geocode";
import { addRecent, loadRecent } from "@/lib/recent";
import { aiRadio, areaOf, compareRoutes, type Compared } from "./actions";

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
 *
 * **이제 이 값은 높이가 아니라 상한이다** (시트의 maxHeight 주석). 그래서 넉넉히 잡아도
 * 손해가 없다 — 내용이 짧은 화면은 시트가 알아서 줄고 지도가 그만큼 커진다. 근거를 520 →
 * 545 로 올린 건 버튼 위 여백을 22 로 벌리면서(시트 아래 pt) 표가 5px 넘쳤기 때문이고,
 * 그 5px 때문에 생기는 어중간한 스크롤은 넘친 걸 알려주지도 못하면서 손만 타게 한다.
 * 20px 을 더 얹은 건 판정 문장이 두 줄로 접히는 경로에서도 안 걸리게 하려는 여유다.
 *
 * 545 → 565 는 제목 줄 위에 18px 을 띄우면서다 (Why 의 pt 주석). 그 18 이 위 여유를 그대로
 * 먹어 표 마지막 줄이 14px 넘쳤다 — 다섯 줄짜리 표가 한 줄만 잘려 보이는, 정확히 위에서
 * 말한 "어중간한 스크롤"이 됐다. 이 줄을 건드릴 때는 근거 화면에서 실제로 재 보고 고친다.
 */
const SHEET_H = { compare: 320, why: 565 };

/**
 * 접었을 때 남는 높이 — 손잡이(20) + 요약 한 줄(44) + 버튼 영역(92: 여백 8 + 버튼 52 +
 * 밑줄 8+16 + 아래 8) = 156 인데, 재보니 손잡이 줄이 그보다 두툼해 170 이어야 요약이 안 눌린다.
 *
 * **딱 맞춰야 하는 값이다.** 이건 상한(maxHeight)이라 모자라면 넘치는 게 아니라 안이 눌린다 —
 * 버튼 영역은 shrink-0 이고 요약 줄은 flex-1 이라, 모자란 만큼 **요약 줄이 0 으로 깔린다.**
 * 실제로 버튼 위 여백을 늘리고 버튼 밑 한 줄을 두 화면 다 띄우자 38 이 모자라 요약이
 * 통째로 사라졌다. 위 세 조각 중 하나라도 높이를 바꾸면 이 값도 같이 고쳐야 한다.
 *
 * **버튼은 같이 안 내린다.** 지도를 크게 보는 동안에도 떠날 결정은 언제든 할 수 있어야 한다.
 * 그런데 버튼이 남으면 "무엇을 고른 상태인가"도 같이 남아야 한다 — 안 보이는 걸 확정하는
 * 버튼이 되기 때문이다. 그 줄이 요약 한 줄이고, 동시에 시트를 되올리는 손잡이를 겸한다
 * (/parking 은 목록이 통째로 사라져서 되올릴 문을 따로 띄웠지만, 여기는 남을 줄이 이미 있다).
 */
const STRIP_H = 170;

/**
 * 부담 구간을 겹쳐 그릴 색. 경로선(fast 파랑 #4A7DFF · safe 초록 #2FA97C, DESIGN.md --color-fast/--color-safe) 위에 올라가므로
 * 둘 다와 구별돼야 한다. **그 전제가 깨지면 이 색도 같이 깨진다** — 실제로 경로선이 주황이던
 * 동안 이 테라코타가 경로선·말풍선과 한 색으로 읽혔다 (lib/route.ts 색 주석).
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

/**
 * 출발·도착 핀. 색은 위 route-editor 의 점과 **같은 색**이다 (출발 #fc7f35 / 도착 #1f1f1f) —
 * 카드에서 본 색이 지도에 그대로 나와야 두 점이 위 두 칸이라는 게 이어진다.
 * 모양·글자는 RouteMap 의 labeledPin 이 굽는다 (여행 코스 지도와 같은 핀).
 */
const 출발핀 = labeledPin("#fc7f35", "출발");
const 도착핀 = labeledPin("#1f1f1f", "도착");

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
       * 대본 ⑤칸(도착해서 차를 댈 곳)의 재료다. dest 는 **주차장** 좌표고, destLat/destLng 는
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
   * 지운다 — 안 지우면 대본 ⑤칸이 "새 도착지에서 옛 관광지까지" 걸어가는 시간을 말하고,
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
   * 시트를 내려 지도를 크게 보고 있는가.
   *
   * 근거 화면에서도 접힌다. 한동안 비교 화면에서만 접었는데(거기는 읽는 자리니 접으면 남는 게
   * 없다는 논리였다), 손잡이는 두 화면에 똑같이 그려져 있어서 눌러도 아무 일이 없는 화면이
   * 생겼다 — 안 되는 기능이 아니라 고장으로 읽힌다. 접으면 비교 화면과 같은 요약 한 줄이
   * 남으므로 "아무것도 안 남는" 것도 아니다. 표는 되펼치면 그대로 있다.
   */
  const [collapsed, setCollapsed] = useState(false);
  // 근거로 넘어갔다 돌아오면 다시 펴 둔다 — 접힌 채로 돌아오면 방금 본 근거의 카드가 안 보인다
  useEffect(() => {
    if (view === "why") setCollapsed(false);
  }, [view]);

  const routes = result && !("error" in result) ? result.routes : [];
  const chosen = routes.find((r) => r.id === picked) ?? routes[0] ?? null;
  const sheetH = collapsed ? STRIP_H : SHEET_H[view];

  /*
   * 지도가 아래로 비워 둘 높이 — **상한이 아니라 시트가 실제로 차지한 높이**다.
   *
   * sheetH 를 그대로 넘겼더니 지도가 손해를 봤다. 그 값은 상한이고(시트의 maxHeight) 시트는
   * 내용만큼만 차지하므로, 근거 화면에서 상한 545 대 실제 515 로 30px 이 빈다. 그만큼 지도가
   * 좁은 영역에 경로를 우겨넣어 축척이 한 단계 물러나 있었다 — 재보니 148 자리에 그리고
   * 있었고 실제로 보이는 건 178 이었다.
   *
   * **화면이 바뀔 때만 잰다.** 전에 ResizeObserver 로 계속 쟀다가 값이 흔들릴 때마다 지도가
   * 축척을 다시 맞춰 출렁였다. 시트 높이는 화면(view)과 접힘 말고는 안 변하고, 그 둘이
   * 바뀔 때는 어차피 지도가 다시 그려진다. 페인트 전에 재야 한 프레임 깜빡이지 않는다.
   */
  const 시트 = useRef<HTMLDivElement>(null);
  const [지도여백, set지도여백] = useState(sheetH);
  useLayoutEffect(() => {
    set지도여백(시트.current?.offsetHeight ?? sheetH);
  }, [view, collapsed, result, sheetH]);


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

  /**
   * 지도에 빨갛게 칠할 요인 — **두 화면이 같은 것을 칠한다.**
   *
   * 화면마다 따로 골랐었다: 비교는 "두 길을 가른 것", 근거는 "이 길에서 가장 부담인 것".
   * 질문이 다르니 답도 다르다는 논리였는데, 사람은 두 화면을 연달아 본다 — 비교에서 급커브가
   * 빨갛다가 근거로 넘어가서 좁은 길이 빨개지면 그건 같은 빨강이 두 가지 뜻을 갖는 것이다.
   * 색이 스스로 못 말하고 옆에 이름을 적어 설명해야 했던 것 자체가 그 신호였다.
   *
   * **가른요인 쪽으로 통일한다.** 근거 화면이라고 한 길만 보는 자리가 아니어서다 — 그 화면의
   * 표가 이미 "50곳 → 19곳"으로 두 길을 견주고 있다. 표가 비교인데 지도만 단일 경로 관점을
   * 쓰면 한 화면 안에서 먼저 어긋난다.
   *
   * 길이 하나뿐이면(가른요인이 null) 가를 상대가 없으므로 그 길에서 가장 부담인 것으로
   * 물러난다. 그때는 표도 화살표 없이 제 값만 적으므로 둘이 여전히 같은 말을 한다.
   */
  const 칠할요인 =
    가른요인 ??
    (result && !("error" in result) && chosen
      ? (result.score.breakdown
          .filter((b) => b.route === chosen.id)
          .sort((a, b) => b.weighted - a.weighted)
          .map((b) => chosen.risks.find((r) => r.label === b.factor))
          .find((r) => r?.spans?.length)?.label ?? null)
      : null);

  /*
   * 지도에 칠할 구간 목록. **선(긴 것)과 점(짧은 것)이 같은 목록을 나눠 쓴다** — 두 곳에서
   * 따로 뽑으면 기준이 어긋나 같은 구간이 선이면서 점이 되거나 양쪽에서 빠진다.
   * 근거 화면은 고른 길 하나만 그리므로 여기서 미리 거른다.
   */
  const 부담구간 = 칠할요인
    ? (view === "why" ? routes.filter((r) => r.id === picked) : routes).map((r) => ({
        r,
        spans: r.risks.find((k) => k.label === 칠할요인)?.spans ?? [],
      }))
    : [];

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
  /**
   * 방금 고른 길을 주행 저장에 담는다 (app/safelog).
   *
   * **넘길 때 담는다.** 진짜 달렸는지는 웹앱이 알 수 없다 — 내비를 열자마자 껐어도 남는다.
   * 그래도 이게 우리가 가진 유일한 신호이고, 틀린 기록은 목록에서 ✕ 한 번이면 빠진다.
   * 같은 길을 30분 안에 다시 넘기면 새로 쌓지 않고 갈아끼운다 (lib/safelog.ts SAME_DRIVE_MS) —
   * 길을 고르다 마음을 바꿔 두 번 누르는 일이 흔해서, 안 막으면 요약의 회수·거리가 부풀어 오른다.
   *
   * **keepalive 가 핵심이다.** 바로 뒤 navigateTo 가 이 문서를 떠나므로, 없으면 브라우저가
   * 요청을 끊는다 — "가끔 기록이 안 남는" 재현 어려운 버그가 된다.
   *
   * 점수·거리·시간·위험요인은 **이 화면이 이미 계산해 둔 값 그대로**다. 주행 저장이 따로
   * 매기지 않는다 — 한 주행이 두 화면에서 다른 점수로 보이면 안 된다.
   */
  async function 담기(picked: LiveRoute) {
    // result 는 실패 사유일 수도 있는 합집합이라 화면 다른 곳과 같은 방식으로 좁힌다
    if (!result || "error" in result) return;

    /*
     * 출발지 이름. 검색해서 온 사람은 쿼리에 실려 있지만, 현위치에서 바로 길을 본 사람은 없다 —
     * 그때 "출발지 → 서귀포매일올레시장"으로 담기면 목록에서 어디서 떠났는지 알 수 없다.
     * 좌표를 동네 이름으로 바꿔 쓴다 (areaOf). 못 받으면 "현재 위치"로 떨어뜨린다 —
     * 이 화면 출발지 칸이 쓰는 말과 같아서, 사람이 본 것과 담긴 것이 어긋나지 않는다.
     */
    const 출발 =
      query.originName ?? (origin ? ((await areaOf(...origin)) ?? "현재 위치") : "현재 위치");
    const 점수 = picked.id === "fast" ? result.score.fastScore : result.score.safeScore;
    const 최단 = Math.min(...routes.map((r) => r.durationMin));
    const drive: SafeDrive = {
      id: Date.now(),
      date: isoToday(),
      // 제목의 도착지는 **관광지 이름**(query.dest)이지 주차장이 아니다 — 주차장은 아래 P 줄이
      // 따로 말한다. to 를 쓰면 카드에 "협재해수욕장 공영주차장"이 두 번 적힌다.
      // 주차장까지만 찍고 온 경우(dest 없음)에는 어쩔 수 없이 그 이름을 쓴다.
      title: `${출발} → ${query.dest ?? to}`,
      mine: false,
      // 화면이 보여준 값과 같아야 한다 — 여기 화면도 반올림해 "54"로 적는다 (53.6 이 그대로 담기면
      // 사람이 본 적 없는 숫자가 기록에 남는다)
      score: Math.round(점수),
      minutes: picked.durationMin,
      km: Math.round(picked.distanceKm),
      slower: Math.max(0, picked.durationMin - 최단),
      path: thinPath(picked.path),
      /*
       * 댄 주차장. **주차장을 거쳐 오지 않았으면 비운다.**
       *
       * 주차장 흐름은 관광지(dest) 위에 주차장(to)을 얹어 온다 (app/parking/detail/GoButton.tsx).
       * 그래서 dest 가 없거나 to 와 같으면 to 는 주차장이 아니라 그냥 도착지다 — 그걸 담으면
       * 카드에 제목과 같은 말이 "P" 줄에 한 번 더 적힌다. 비워두면 화면이 그 줄을 아예 안 그린다.
       */
      parking: query.dest && to !== query.dest ? to : "",
      /*
        세 줄이고 라벨은 화면이 들고 있다 (app/safelog/page.tsx REASON_LABELS) — 여기는 값만 준다.
        순서가 곧 라벨이라 칸을 넣고 빼면 양쪽을 같이 고쳐야 한다.

        맨 앞에 좌회전 줄이 있었다. 처음엔 "그 중 몇 번이 비보호인가"였는데, 세는 쪽
        (lib/analyze.ts guideKind)이 안내문에 "좌회전"이 있어야만 세서 카카오가 비스듬한
        교차로를 부르는 "왼쪽 10시 방향"을 놓쳤다 — 굳혀둔 경로에서만 15건이다. 그 지점은
        turnPoints 에 안 실려 "모르면 null" 방어를 못 타고 조용히 0 이 됐고, 실제로 비보호인
        길에 "없음"이 찍힐 수 있었다. 판독표(data/unprotected-left.json)와 조회 코드
        (lib/unprotected.ts)는 남겨 뒀다 — 안내문 종류를 다 덮으면 되살릴 값이다.

        비보호를 뺀 자리에 좌회전 횟수만 남겼다가 그 줄도 뺐다. 조작 횟수는 언제나 값이
        있지만, 이 상자가 답하는 건 "왜 안심 길이었나"라 부담의 근거가 아닌 값은 자리만 먹는다.
      */
      reasons: [
        `${Math.round(picked.stats.narrow * 100)}%`,
        `${picked.stats.sharpCurveKm}km`,
        "확인 안 됨", // 사고 잦은 곳 — 공개 데이터가 경로를 구분 못 해 이 앱이 안 쓴다 (lib/scenario.ts)
      ],
      parkingTags: "",
    };
    void saveDrive(profile.experienceYears, drive, { keepalive: true });
  }

  function go() {
    if (!chosen || !dest) return;
    /*
     * 담기는 기다리지 않는다 — 지명을 받아오느라 내비가 늦게 열리면 안 된다.
     * 대신 saveDrive 가 keepalive 로 나가서, 이 문서를 떠난 뒤에도 요청이 끊기지 않는다.
     */
    void 담기(chosen);
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
        /*
          HOME-03 위쪽은 **뒤로가기 하나 + 홈 하나**다 (와이어프레임 3920:668 / 3920:681).
          출발/도착 칸은 여기 없다 — 이미 앞 화면에서 확인하고 넘어온 값이다.

          둘이 하는 일이 다르다: 뒤로는 **한 칸** 물러나 길 비교로 돌아가고(같은 화면의 앞
          상태라 라우트를 안 바꾼다), 홈은 이 흐름을 통째로 접고 나간다. 길을 고르다 말고
          그만두는 사람에게 뒤로가기만 주면 앞 화면들을 역순으로 다 되짚어야 나갈 수 있다.
        */
        // -mt-[8px] 와 px-[21px] 는 길 비교 쪽 홈 줄과 같은 값이다 —
        // 두 화면에서 홈이 정확히 같은 자리에 선다 (거기 주석에 이유가 있다)
        // 좌우도 길 비교와 같은 21 이다 — 거기 홈은 아래 카드·✕ 와 같은 줄에 서야 해서 21 이고,
        // 두 화면에서 홈이 같은 자리에 있으려면 여기도 그 값을 따라간다 (mx-4 였다)
        <div className="-mt-[8px] flex shrink-0 items-center px-[21px]">
          {/*
            둘 다 옅은 주황(#fff0e6)이다 — 이 앱이 아이콘 버튼에 두루 쓰는 집 색이다.
            회색은 길 비교의 ✕ 하나뿐이다: 거긴 이 흐름을 **닫고 나가는** 문이라 색을 안 준다.
            여기 둘은 화면 안에서 오가는 문이라 같은 색이어도 헷갈리지 않는다.
          */}
          <button
            onClick={() => setView("compare")}
            aria-label="뒤로"
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90"
          >
            <img src="/icon-arrow-left.svg" alt="" className="size-6" />
          </button>
          {/* 프로필 쿼리를 물고 간다 — 길 비교 쪽 홈과 같다. 안 물리면 홈이 기본 프로필로 되돌아간다 */}
          <button
            onClick={() => router.push(`/home?${searchParams}`)}
            aria-label="홈으로"
            className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90"
          >
            <img src="/route/icon-home.svg" alt="" className="size-6" />
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
        <>
        {/*
          홈 — 카드 위, 오른쪽 끝 (와이어프레임 "수정 HOME-02 | 길 비교 24").
          테두리 없는 맨 아이콘이다: 아래 ✕ 는 상자에 담겨 있는데 홈까지 상자면 오른쪽에
          같은 네모가 둘 생겨 무엇이 다른 문인지 안 읽힌다.

          **-mt-[8px] 로 끌어올린다.** 상태바가 아래쪽에 19 를 비워두는데(app/StatusBar.tsx pb),
          그 빈칸을 그대로 두면 위가 휑해지고 카드도 그만큼 밀린다. 그렇다고 19 를 다 되찾으면
          이번엔 9:41 줄에 바짝 붙어 답답하다 — 8 만 당기고 11 은 숨 쉴 자리로 남긴다.

          하는 일은 ✕ 와 다르다 — ✕ 는 **온 화면**으로 돌아가고(back 쿼리, 목적지·근처 주차장),
          홈은 이 흐름을 통째로 접고 나간다. 외부 내비까지 다녀와 돌아온 사람에게 ✕ 만 주면
          목적지·주차장을 역순으로 되짚어야 첫 화면에 닿는다.
        */}
        <div className="-mt-[8px] flex shrink-0 justify-end px-[21px]">
          <button
            onClick={() => router.push(`/home?${searchParams}`)}
            aria-label="홈으로"
            className="flex size-11 items-center justify-center rounded-full transition hover:bg-[#fff0e6] active:scale-90"
          >
            <img src="/route/icon-home.svg" alt="" className="size-6" />
          </button>
        </div>
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
            홈으로 무조건 보내면 튕겨나가는 느낌이 난다 — 온 화면들은 전부 지도 중심이라 배경이 이어진다.
            back 은 정해둔 몇 곳만 받는다: 임의 주소면 남의 사이트로 튕겨 보낼 수 있다.
            칸을 고치는 중이면 그것부터 접는다. 한 번에 나가면 고치려다 만 사람이 화면 밖으로 밀려난다.
          */}
          <button
            onClick={() => (editing ? setEditing(null) : router.push(`${닫고갈곳}?${searchParams}`))}
            aria-label={editing ? "고치기 그만두기" : "닫기"}
            /*
              호버가 **회색**이다 — 위 홈만 옅은 주황(#fff0e6)이다.
              주황은 이 앱에서 "앞으로 가는 문"의 색이라, 흐름을 접고 나가는 홈에만 남긴다.
              닫기는 되돌아가는 문이라 색을 안 쓴다. 둘이 나란히 서 있어 색이 같으면
              어느 쪽이 어디로 가는지 손이 먼저 헷갈린다.
            */
            className="mt-[32px] grid size-[44px] shrink-0 place-items-center rounded-[10px] border border-[#d6d6d6] bg-white transition hover:bg-[#f1f1f1] active:bg-black/5"
          >
            <img src="/home/icon-close.svg" alt="" className="size-6" />
          </button>
        </div>
        </>
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
                위험 구간을 경로선 위에 겹친다. **두 화면 다** 같은 요인을 칠한다 (칠할요인 주석).

                뒤에 놓아야 경로선 위로 올라온다 (RouteMap 이 배열 순서대로 그린다).

                **굵기는 경로를 따라간다.** 아래 선보다 굵으면 빨강이 양옆으로 삐져나와
                **선 위에 얹은 점**처럼 보인다. 같은 굵기로 정확히 덮으면 "이 구간에서 선이
                빨개진다"로 읽힌다 — 어느 길인지는 아래 깔린 경로선과 말풍선이 이미 말한다.

                **색이 셋이 되는 걸 받아들인다.** 비교 화면에서는 빼 뒀었다 — 두 길 중 하나를
                고르는 자리에 세 번째 색이 올라오면 무엇을 견주는 화면인지 흐려진다는 이유였다.
                그런데 두 길이 무엇으로 갈렸는지가 바로 고르는 근거라, 그걸 빼면 색 두 개가
                "파랑과 초록 중 고르세요"만 말하고 만다.

                **말풍선은 안 붙인다.** 가장 긴 선에 요인 이름을 붙여봤더니 경로 라벨("67분")과
                한 자리에 겹쳐 시간을 통째로 가렸다 — 둘 다 경로 중간점 근처라 그렇다
                (RouteMap 주석의 "겹치면 그때" 가 이 경우다). 무슨 색인지는 시트 위 잔글씨 한 줄과
                비교표의 같은 줄에 찍는 같은 색 점이 알린다 (Why 의 위험요인 prop).
              */
              ...부담구간.flatMap(({ r, spans }) =>
                spans.map((path) => ({
                  path,
                  color: 부담색,
                  weight: 굵기(r.id),
                  opacity: 0.95,
                  // 아래 경로선 위에 색만 얹는다 — 흰 테를 두르면 경계가 생긴다 (RouteMap overlay)
                  overlay: true,
                })),
              ),
            ]}
            markers={[
              ...(origin ? [{ coord: origin, label: "출발", icon: 출발핀 }] : []),
              ...(dest ? [{ coord: dest, label: "도착", icon: 도착핀 }] : []),
            ]}
            padBottom={지도여백}
            /* 지도 빈 곳을 눌렀다 = 지도를 보겠다는 뜻이다 — 손잡이를 다시 찾게 하지 않는다 */
            onBlank={() => setCollapsed(true)}
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
        시트는 두 화면 다 **흰 바탕**이다.

        근거 화면만 아래로 갈수록 옅은 파랑을 깔았었다 (와이어프레임 2153:1992). 그 위에
        얹히는 흰 카드(tradeoff-card)가 테두리 없이 떠 보이게 하려던 장치인데, 그 카드를
        없애면서(판정·시간·듣기를 상자 없이 세로로 쌓았다) 띄울 것이 사라졌다. 남은 건
        표 아래가 까닭 없이 푸르스름한 것뿐이라 걷어낸다.
      */}
      <div
        ref={시트}
        style={{
          /*
            **높이가 아니라 상한이다.** 고정 높이였을 때, 판정 문장이 없는 화면(길이 두 갈래라
            "부담이 거의 같습니다" 줄이 안 붙는 경우)에서는 카드 아래로 66px 가 그냥 비었고
            버튼이 그만큼 아래로 밀려 있었다. 상한만 두면 내용이 짧은 화면은 시트가 같이 줄고,
            버튼이 카드 바로 밑에 붙는다 — 긴 화면(근거 표)은 예전처럼 여기서 걸려 스크롤된다.
          */
          maxHeight: sheetH,
        }}
        /* 지도와 함께 접힌다 — 칸을 고치는 동안 그 자리는 검색 목록 것이다 */
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)] ${editing ? "hidden" : ""}`}
      >
        {/*
          손잡이. 실제로 끌리지는 않고, 눌러서 되는 걸로 충분하다 (/parking 시트와 같은 판단).
          보이는 막대는 4px 지만 누르는 자리는 20px 이다.

          **두 화면 다 눌린다.** 근거 화면에서는 그림으로만 그려 뒀었는데, 같은 자리에 같은
          막대가 있으면 손이 먼저 간다 — 안 되는 게 아니라 안 눌리는 걸로 보인다.
        */}
        {result && !("error" in result) ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={
              collapsed
                ? "펼치기"
                : view === "why"
                  ? "근거 접고 지도 크게 보기"
                  : "길 비교 접고 지도 크게 보기"
            }
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
              {collapsed && chosen ? (
                /*
                  접었을 때 남는 한 줄. 이름·시간·점수 셋만 적는다 — 거리와 배지는 뺐다.
                  여기는 고르는 자리가 아니라 **이미 고른 걸 확인하는 자리**라서,
                  아래 버튼이 무엇을 확정하는 버튼인지만 말하면 된다.

                  줄 전체가 펼치는 문이다. 위 손잡이와 같은 일을 하지만 누르는 자리가 훨씬 넓어,
                  4px 막대를 정확히 노리지 않아도 된다.
                */
                <button
                  onClick={() => setCollapsed(false)}
                  aria-label="펼치기"
                  className="flex h-[44px] w-full items-center gap-2 px-4 text-left transition active:bg-black/[0.03]"
                >
                  <span className="truncate text-[15px] font-bold text-[#1f1f1f]">
                    {titleOf(
                      chosen,
                      result.score.recommendedRoute === chosen.id || result.routes.length === 1,
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
                  위험요인={칠할요인}
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

                    "연속 급커브 - 두 길이 가장 다른 구간" 이라고 적었었는데 뜻이 안 통했다.
                    **"구간"이 두 번 나온다** — 급커브 "구간"과 두 길이 다른 "구간". 앞은 항목
                    이름이고 뒤는 그 항목이 두 길을 갈랐다는 말인데, 같은 낱말이라 빨간 데가
                    "두 길이 서로 다른 길로 가는 자리"라는 뜻으로도 읽혔다.

                    게다가 **사실도 아니었다.** 가른요인이 재는 건 위치가 아니라 항목이다 —
                    요인마다 두 경로의 감점 차를 재서 그 차가 가장 큰 **항목**을 고른다. 그리고
                    칠하는 건 두 경로 각각의 그 요인 구간 **전부**라, 두 길이 겹치는 데 급커브가
                    있으면 거기도 빨개진다. "두 길이 다른 구간"이라고 읽고 지도를 보면 빨간 데가
                    두 길이 갈라지는 자리일 줄 알게 되는데, 표시는 그것과 아무 상관이 없다.

                    그래서 **먼저 색부터 짚고, 뒤는 항목 얘기라는 게 드러나게 쓴다.** 이 줄이
                    답할 질문은 "저 칠해진 게 뭐야" 하나라 그 답이 맨 앞에 오고, "가른 것"은
                    자리가 아니라 항목을 가리키는 말이다.

                    **"빨간 곳"이라고 쓰지 않는다.** 부담색은 빨강이 아니라 벽돌빛이고 그건
                    일부러다 (부담색 주석 — DESIGN.md 의 빨강 금지). 글이 색을 빨강이라 부르면
                    금지해 둔 그 색을 눈으로 찾게 만든다. 벽돌빛·주황이라 부르는 것도 안 된다 —
                    앱의 버튼·배지가 이미 주황이라 그쪽을 가리키게 된다. 왼쪽 점이 지도와 같은
                    색이므로 **"이 색"이 그 점을 가리키고**, 색 이름을 아예 안 쓰면 된다.

                    카드 안에 넣을 자리가 없고(추천점수·시간·거리·이름이 이미 꽉 찼다) 지도에
                    말풍선을 띄우면 경로 라벨과 겹친다(위 routes prop 주석). 그래서 지도와 카드
                    사이에 잔글씨로 둔다 — 지도를 본 눈이 카드로 내려오는 길목이다.

                    **근거 화면과 같은 요인이다** (칠할요인 주석). 넘어가도 빨간 자리가 안 바뀌므로
                    이 줄에서 읽은 이름이 다음 화면에서도 그대로 쓰인다 — 거기서는 이름을 다시
                    적는 대신 비교표의 그 줄에 같은 색 점을 찍는다 (Why 의 위험요인 prop).
                  */}
                  {/*
                    **뒷말이 갈린다.** 빨강을 고른 기준이 다르기 때문이다 (칠할요인 주석):
                    길이 두 장이면 두 길을 가른 항목이고, 한 장이면 가를 상대가 없어 그 길에서
                    감점이 가장 큰 항목이다. 같은 뒷말을 쓰면 한 장짜리 화면이 "두 길"을 말한다.

                    예전에는 이 줄 자체가 가른요인에 걸려 있어서, 길이 한 장이면 지도와 표의
                    빨강만 남고 그게 뭔지 대는 데가 아무 곳에도 없었다.
                  */}
                  {칠할요인 && (
                    <p className="mt-[14px] flex items-center gap-[6px] px-4 text-[11px] leading-[16px] text-[#949494]">
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: 부담색 }}
                      />
                      이 색이 {칠할요인}
                      {예요(칠할요인)} ·{" "}
                      {가른요인 ? "두 길을 가장 크게 가른 것" : "이 길에서 가장 신경 쓸 곳"}
                    </p>
                  )}

                  {/*
                    두 카드가 크기가 다르다 (와이어프레임 3847:2926 — 추천 202x132 / 나머지 147x98).
                    items-end 로 **아래를 맞춘다** — 위를 맞추면 작은 카드가 공중에 뜬 것처럼 보인다.
                    폭은 고정값 대신 비율(flex-[202]/flex-[147])로 준다. 360px 기기에서 합이 넘치면
                    고정 폭은 그냥 삐져나가는데, 비율이면 둘이 같이 줄어든다.
                  */}
                  {/*
                    **추천을 왼쪽에 둔다.** 목록 순서(빠른 길 → 안심 길)를 그대로 그렸더니
                    추천 카드가 오른쪽에 앉았는데, 눈은 왼쪽부터 읽어서 먼저 본 게 추천이
                    아닌 쪽이었다. 큰 카드가 왼쪽에 오면 배지를 찾기 전에 이미 어느 쪽인지 안다.
                    추천이 없는 경우(tie/unclear)는 recommendedRoute 가 어느 id 와도 안 맞아
                    둘 다 0 이 되고, 원래 순서가 그대로 남는다.
                  */}
                  <div className="mt-[18px] flex items-end gap-[11px] px-4">
                    {[...result.routes]
                      .sort(
                        (a, b) =>
                          Number(b.id === result.score.recommendedRoute) -
                          Number(a.id === result.score.recommendedRoute),
                      )
                      .map((r) => (
                      <RouteCard
                        key={r.id}
                        route={r}
                        title={titleOf(
                          r,
                          result.score.recommendedRoute === r.id || result.routes.length === 1,
                        )}
                        score={
                          r.id === "fast"
                            ? result.score.fastScore
                            : result.score.safeScore
                        }
                        recommended={result.score.recommendedRoute === r.id}
                        단일={result.routes.length === 1}
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

            {/*
              버튼 위 22px — 와이어프레임 3920:641 표 아래끝(353)과 버튼(3981:793, 375) 사이 값이다.
              시트가 내용만큼만 차지하게 되면서 이 여백이 곧 카드와 버튼 사이가 됐다 (전에는 남는
              높이가 알아서 벌려줘서 8px 로도 안 붙어 보였다).
            */}
            <div
              /*
                버튼 위 22px — 와이어프레임 3920:641 표 아래끝(353)과 버튼(3981:793, 375) 사이
                값이다. 시트가 내용만큼만 차지하게 되면서 이 여백이 곧 카드와 버튼 사이가 됐다
                (전에는 남는 높이가 알아서 벌려줘서 8px 로도 안 붙어 보였다).

                **접었을 때는 8 로 돌아간다.** 그 위는 카드가 아니라 요약 한 줄이라 22 만큼
                떨어질 이유가 없고, 접힌 시트(STRIP_H)는 그 한 줄이 겨우 들어가는 높이라
                여백을 키운 만큼 줄이 눌려 사라진다 — 실제로 그렇게 사라졌다.
              */
              className={`shrink-0 px-4 pb-2 ${view === "compare" && collapsed ? "pt-2" : "pt-[22px]"}`}
            >
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
                /*
                  **두 화면 다 곧장 카카오맵을 연다.** 전에는 비교 화면의 같은 버튼이 근거
                  화면으로 한 번 넘기고 거기 버튼이 내비를 열었다 — "왜 이 길인지 한 번은
                  보고 떠나게" 하려던 건데, 떠나려고 누른 버튼이 안 떠나는 게 더 나빴다.
                  글씨가 "이 길로 갈게요"인 버튼은 어느 화면에서든 그 일을 해야 한다.

                  근거는 카드의 「근거 보기」가 연다 (아래 RouteCard) — 보고 싶은 사람이
                  누르는 문이지, 지나가야 하는 관문이 아니다.
                */
                onClick={go}
                /*
                  두 화면이 색과 폭까지 다르다 (와이어프레임 3847:2947 검정 ↔ 2153:2036 주황).
                  비교 화면의 버튼은 아직 떠나는 버튼이 아니라 근거를 여는 문이라, 화면 폭을
                  꽉 채우지 않고 가운데 251px 알약으로 물러나 있다. 근거 화면에서 같은 글씨가
                  주황 통짜로 바뀌는 그 순간이 "이제 진짜 나간다"는 표시가 된다.
                */
                /*
                  검정 알약이었다가 와이어프레임 3975:743 대로 되돌렸다 — **주황 네모, 폭 꽉,
                  높이 52, 모서리 10**. 앱에서 흐름 안의 "하려던 일"은 전부 주황이라는 규칙과도
                  이제 어긋나지 않는다 (검정은 흐름 밖 화면 몫이다).
                  근거 화면도 같은 모양이다 — 두 화면이 하는 일은 다르지만(근거 열기 / 내비 열기)
                  그 차이는 화면이 이미 말하고 있어서 버튼까지 갈라 놓을 일이 아니다.
                */
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#ff7d32] text-[16px] font-bold text-white transition hover:bg-[#ff6114] active:scale-[0.99]"
              >
                <img src="/route/icon-navigation.svg" alt="" aria-hidden className="size-5" />
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
              <p className="mt-2 text-center text-[11px] leading-[16px] text-[#9e9e9e]">
                {origin
                  ? "카카오맵이 이 길로 안내해요"
                  : "출발지를 몰라 다른 길로 안내될 수 있어요"}
              </p>
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
 * **좌회전이 비보호인지도 뺐다.** 로드뷰 판독표(lib/unprotected.ts · data/unprotected-left.json)를
 * 만들어 한동안 이 표에 적었는데, 세는 쪽이 놓치는 안내문이 있어 내렸다 — 카카오가 비스듬한
 * 교차로를 "왼쪽 10시 방향"이라 부르면 lib/analyze.ts guideKind 가 좌회전으로 안 세고,
 * 그러면 그 지점은 "모르면 null" 방어를 못 타고 조용히 0 이 된다. 안 본 길에 "없음"이 찍힌다.
 *
 * 표와 조회 코드는 남겨 뒀다. 안내문 종류를 다 덮으면 되살릴 값이지 틀린 값이 아니다
 * (reasons 자리 주석에 자세히).
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
  /*
    **문장이 부르는 이름과 카드가 부르는 이름이 같아야 한다.** 문장 쪽은 상대를 늘 "빠른 길"로
    못 박고 있었다 — 카드에는 "짧은 길"이라 써 놓고 바로 아래 문장은 "빠른 길보다 7분 더"라고
    하는 화면이 나왔고, 같은 길을 두 이름으로 부르면 두 길 얘기인 줄 안다.
    이름을 정하는 곳은 기본이름() 한 곳뿐이고, 문장은 그걸 받아 쓴다.
  */
  const 한줄 = tradeoff(pick, route, other, other ? 기본이름(other) : "");
  const rows: { label: string; mine: string; theirs: string }[] = [
    row("회전교차로", (s) => (s.roundabouts ? `${s.roundabouts}곳` : "없음")),
    row("연속 급커브", (s) => (s.sharpCurveKm ? `${s.sharpCurveKm}km` : "없음")),
    row("좁은 교행 구간", (s) =>
      s.narrow ? `${Math.round(s.narrow * 100)}%` : "없음",
    ),
    row("고속주행 구간", (s) =>
      s.highSpeedKm ? `${s.highSpeedKm}km` : "없음",
    ),
    /*
      보이는 값이 죄다 "확인 안 됨"인 줄은 뺀다.

      값이 없으면 그 줄은 표에서 사라진다. "없음"과는 다르다: 없음은 확인해서 없다는 사실이고,
      확인 안 됨은 사실이 아니라 공백이다. 한쪽이라도 값이 있으면 남긴다.
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
    /*
      손잡이 바로 밑에서 시작하면 제목 줄이 시트 천장에 붙는다 — 여기 첫 줄에는 40px 짜리
      점수가 얹혀 있어서 더 그렇다. 비교 화면의 첫 줄과 같은 18px 을 띄운다.
    */
    <div className="px-4 pt-[18px]">
      <div className="flex items-center gap-2">
        {/*
          상대가 없으면(단일 경로) 추천 배지 자리에 회색 배지가 대신 앉는다. 문구는 우리가
          여기서 짓지 않고 route.badge 를 그대로 쓴다 — 후보를 접어 한 장으로 만든 건
          lib/route.ts 라서, 무슨 상태인지도 거기서 붙인 이름이 맞다.

          **주황이면 안 된다.** 주황 배지는 "둘 중 이걸 골랐다"는 뜻인데 여기는 고른 적이
          없다. 같은 색을 쓰면 진짜로 두 길을 견줘 고른 화면과 구분이 안 된다.
        */}
        {recommended ? (
          <span className="shrink-0 rounded-[5px] bg-[#fc7f35] px-2 py-[3px] text-[11px] leading-none font-bold text-white">
            추천
          </span>
        ) : !other ? (
          <span className="shrink-0 rounded-[5px] bg-[#f2f2f2] px-2 py-[3px] text-[11px] leading-none font-bold text-[#9e9e9e]">
            {route.badge}
          </span>
        ) : null}
        {/* 근거 화면도 비교 화면과 같은 이름을 쓴다 — 넘어오면서 이름이 바뀌면 같은 길인지 흔들린다 */}
        <span className="min-w-0 truncate text-[16px] font-bold text-[#1f1f1f]">
          {titleOf(route, recommended || !other)}
        </span>
        {/*
          점수만 주황이다. 비교 화면의 카드에서는 검정인데(거기선 두 값을 나란히 재는 자리라
          한쪽만 물들면 그게 답처럼 보인다) 여기는 이미 한 길을 고르고 들어온 자리라
          이 화면의 주인공이 그 숫자다 — 와이어프레임도 여기서만 주황으로 칠했다.
        */}
        {/*
          높음/낮음을 뗐다 (와이어프레임 3920:625 에 없다). 이 화면은 이미 한 길을 고르고
          들어온 자리라 그 한 마디가 판정처럼 읽히는데, 정작 판정은 아래 한 줄이 하고 있다.
          숫자만 크게 두면 눈이 거기서 아래 문장으로 그대로 내려간다.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-[14px]">
          <span className="text-[14px] text-[#949494]">추천점수</span>
          <span className="text-[40px] leading-none font-bold text-[#fc7f35]">
            {Math.round(score)}
          </span>
        </span>
      </div>

      {/*
        판정 한 줄 → 시간 → 듣기 줄. **세로로 셋**이다 (와이어프레임 3920:630 / 3920:631 /
        3961:721 이 각각 y 12 · 44 · 156 — 옆으로 붙은 게 아니라 아래로 쌓여 있다).

        한때 판정을 62% 상자에 가두고 듣기 줄을 그 오른쪽에 붙였는데, 그러면 "빠른 길보다 9분
        더, 대신 훨씬 편해요"가 두 줄로 깨진다. 와이어프레임의 그 줄은 한 줄이다 —
        이 화면에서 유일하게 "그래서 어떻다"를 말하는 줄이라 두 동강 나면 안 된다.

        상자(테두리·배경)는 안 그린다. 시트가 흰색이라 흰 카드를 얹어봤자 안 보이고,
        와이어프레임에도 판정 둘레에 선이 없다.
      */}
      {한줄 && (
        <p className="mt-4 text-[14px] leading-[20px] font-bold text-[#1f1f1f]">
          {한줄}
        </p>
      )}

      {/*
        시간은 **왼쪽에 붙여 쓴다** (3920:631 → 3961:720 → 3961:719 가 나란히 붙어 있다).
        양끝으로 벌려 뒀었는데 그러면 폭이 넓은 기기에서 둘이 멀어져 "35분에서 42분으로"가
        아니라 상관없는 숫자 두 개로 읽힌다.
      */}
      {/*
        상대가 없으면(단일 경로) 화살표 대신 **내 값만** 같은 자리에 같은 크기로 적는다.
        이 줄을 통째로 빼 봤더니 판정 바로 밑에 듣기 줄이 붙어 위아래 간격이 어긋났고,
        그 화면에는 소요시간이 어디에도 없었다 — 비교 카드에는 있던 값이다.
        거리를 같이 적는 것도 그래서다. 비교할 때는 표가 그 일을 하지만 여기는 표도 한 칸이다.
      */}
      <div className="mt-3 flex items-baseline gap-[8px]">
        {other && (
          <>
            <span className="text-[12px] text-[#949494]">{other.durationMin}분</span>
            <span aria-hidden className="text-[13px] font-medium text-[#949494]">
              →
            </span>
          </>
        )}
        <span className="text-[18px] font-bold text-[#1f1f1f]">{route.durationMin}분</span>
        {!other && <span className="text-[12px] text-[#949494]">{route.distanceKm}km</span>}
      </div>

      {/*
        듣기 줄 — **시간 줄과 표 사이, 오른쪽 끝**이다 (3961:721 + 확성기 3926:684).
        순서가 이유다: 무엇과 무엇을 맞바꾸는지 읽고(위) → 더 들을 사람은 듣고 → 숫자로
        확인한다(아래 표). 오른쪽으로 물러나 있는 건 이 줄이 안 눌러도 되는 문이라서다.
      */}
      {대본 && (
        <div className="mt-2">
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
        {rows.map((r) => (
          <div
            key={r.label}
            /* 칸 사이 선을 안 긋는다 — 와이어프레임 3920:641 은 주황 테두리 하나뿐이다.
               네 줄짜리 표에 선을 세 개 더 그으면 테두리가 말하려던 "여기 하나로 묶임"이 흩어진다 */
            className="flex items-center justify-between px-[14px] py-[10px]"
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
            {/* 앞 값은 물러나고 **뒤 값만 크고 굵다** — 바뀐 결과가 이 표의 주인공이다 (3920:644) */}
            <dd className="flex items-baseline gap-[7px]">
              {r.theirs && (
                <>
                  <span className="text-[12px] text-[#949494]">{r.theirs}</span>
                  <span aria-hidden className="text-[13px] font-medium text-[#949494]">
                    →
                  </span>
                </>
              )}
              <span className="text-[16px] font-bold text-[#1f1f1f]">{r.mine}</span>
            </dd>
          </div>
        ))}
      </dl>

    </div>
  );
}

/**
 * 카드에 적는 이름. **도로 이름("516로 경유")이 아니라 그 길의 성격이다** — 초보에게
 * "남조로"는 아무 정보가 아니고, 두 카드가 답해야 하는 건 "그래서 어느 쪽이 뭔데"다.
 * 도로 이름은 지도의 말풍선과 근거 화면이 이미 말하고 있다.
 *
 * **두 이름뿐이다: "안심 길" / "짧은 길".** 화면 어디서나 같은 말로 부르기로 한 결정이다
 * (와이어프레임 3920:630 의 "짧은 길보다 7분 더" 도 그 이름을 쓴다).
 *
 * 한때 상대와 재서 골랐다 — 시간이 짧으면 "빠른 길", 거리만 짧으면 "짧은 길", 둘 다 아니면
 * "다른 길". 그 규칙을 뗀 건 같은 길이 화면마다 다른 이름으로 불리면 두 길 얘기인 줄 알아서다.
 *
 * ponytail: **"짧은 길"이 늘 참인 건 아니다.** fast 자리는 "나머지 중 가장 빠른 것"이라
 * (lib/route.ts) 시간으로 고른 값이고, 거리가 더 짧다는 보장이 없다 — 드물게 더 긴 길을
 * "짧은 길"이라 부르게 된다. 실제로 그런 화면이 나오면 되돌릴 자리는 여기 한 곳이다.
 * 아래 tradeoff 로 이름이 흘러가므로 문장도 같이 따라온다.
 */
function 기본이름(route: LiveRoute): string {
  return route.id === "safe" ? "안심 길" : "짧은 길";
}

/**
 * 카드에 적을 이름. "맞춤"은 **프로필로 정해진 길**에 얹는다 (와이어프레임의 "맞춤 안심 길").
 *
 * 추천 배지가 붙는 쪽이 대개 그쪽이지만 둘이 같은 말은 아니다 — 길이 한 장인 구간에는 추천이
 * 안 붙는데(고를 상대가 없다), 그 한 장도 프로필로 잰 부담 점수를 달고 나온다. 그래서 거기도
 * 얹는다. 배지는 회색 "단일 경로"가 대신 앉아 고른 게 아니라는 걸 같은 줄에서 말한다.
 */
function titleOf(route: LiveRoute, 맞춤: boolean): string {
  const base = 기본이름(route);
  return 맞춤 ? `맞춤 ${base}` : base;
}

function RouteCard({
  route,
  title,
  score,
  recommended,
  단일,
  picked,
  onPick,
  onWhy,
}: {
  route: LiveRoute;
  /** 카드에 적을 이름 — 도로 이름이 아니라 성격이다 (아래 titleOf) */
  title: string;
  score: number;
  recommended: boolean;
  /** 이 카드가 유일한 카드인가. 추천 배지 자리에 route.badge 를 회색으로 대신 앉힌다 */
  단일: boolean;
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
      /*
        **한 번 누르면 고르고, 한 번 더 누르면 근거를 연다.**

        전에는 카드 안에 「근거 보기」를 눌러야 하는 작은 자리로 따로 뒀는데, 카드가 이미
        누르는 물건이라 그 안에 또 누를 데를 파 놓은 꼴이었다 — 작으면 안 보이고, 키우면
        카드 안에 상자가 하나 더 생겼다. 카드 전체를 문으로 쓰면 그 문제가 통째로 없어진다.

        고른 카드에만 「근거 보기 ›」가 뜨는 게 그 안내다. 안 고른 카드에 그 글자가 있으면
        거짓말이 된다 (거기서 한 번 누르면 근거가 아니라 선택이 옮겨간다). 두 길을 다 보려면
        한 장씩 고른 뒤 다시 누르면 된다 — 어차피 지도에 굵게 그려진 길과 근거가 어긋나면
        안 되므로, 고르는 게 먼저인 건 원래 규칙이다.

        더블클릭(dblclick)이 아니다. 손가락으로 두 번 빠르게 치라는 뜻이 아니라 **누를 때마다
        한 단계씩** 나아가는 것이라, 얼마나 빨리 누르든 상관없다.
      */
      onClick={picked ? onWhy : onPick}
      aria-pressed={picked}
      /*
        flex 가 필요하다 — <button> 은 안쪽 내용을 세로 가운데로 몰아넣는 기본 동작이 있어서,
        그냥 두면 위에 붙어야 할 제목이 카드 한가운데로 내려와 아래 절대배치 줄과 겹친다.
      */
      className={`relative flex min-w-0 flex-col items-start rounded-[7px] text-left transition-all duration-200 ${
        big ? "h-[124px] flex-[193] px-[12px] pt-[14px]" : "h-[89px] flex-[148] px-[11px] pt-[11px]"
      } ${
        picked
          ? "border-2 border-[#fc7f35] bg-[#ffece1]"
          : "border border-[#d6d6d6] bg-white"
      }`}
    >
      {/* 제목 줄 = 배지 + 이름. 이 줄은 이름 몫으로 통째로 비워 둔다 (아래 「근거 보기」 주석) */}
      {/*
        gap 은 와이어프레임(8)보다 좁은 6 이다. 저 도면은 390px 기준인데 375px 기기에서는
        카드가 5px 좁아져서 "맞춤 안심 길"이 딱 한 글자만큼 모자라 말줄임표가 떴다.
        글자를 줄이는 대신 사이를 좁힌다 — 이름이 잘리면 무슨 길인지가 사라진다.
      */}
      <span className="flex w-full items-center gap-[6px]">
        {recommended ? (
          <span className="shrink-0 rounded-[6px] bg-[#fc7f35] px-[9px] py-[5px] text-[12.5px] leading-none font-bold text-white">
            추천
          </span>
        ) : 단일 ? (
          // 근거 화면과 같은 규칙이다 (Why 의 배지 주석) — 두 화면이 같은 길을 같은 말로 불러야 한다
          <span className="shrink-0 rounded-[6px] bg-[#f2f2f2] px-[9px] py-[5px] text-[12.5px] leading-none font-bold text-[#9e9e9e]">
            {route.badge}
          </span>
        ) : null}
        <span
          className={`min-w-0 truncate font-bold text-[#1f1f1f] ${big ? "text-[17.5px]" : "text-[13px]"}`}
        >
          {title}
        </span>
      </span>

      {/* 시간·거리는 왼쪽 아래. 추천 카드에서는 이 줄도 주황이다 — 카드가 통째로 주황 계열이라 회색이면 혼자 식어 보인다 */}
      <span
        className={`absolute left-[16px] ${
          big ? "top-[58px] text-[14px] text-[#ff7d32]" : "top-[41px] text-[11px] text-[#7d7d7d]"
        }`}
      >
        {route.durationMin}분 · {route.distanceKm}km
      </span>

      {/*
        「근거 보기」 — 근거 화면(HOME-03)으로 가는 **유일한** 문이다. 아래 「이 길로 갈게요」가
        곧장 카카오맵을 열게 되면서(위 버튼 주석) 근거를 거쳐 가는 길이 없어졌다.

        **누르는 자리가 아니라, 이 카드를 한 번 더 누르면 무엇이 열리는지 적은 줄이다**
        (누르는 건 카드 전체다 — 위 onClick 주석). 밑줄만 둔 건 그래도 이게 다음 걸음이라는
        표시라서고, 상자를 안 만들면서 그 말을 할 수 있는 가장 조용한 방법이라서다. 테두리
        알약으로도 해 봤는데 카드 자체가 이미 테두리 두른 상자라 안에 상자가 둘이 됐다.

        **고른 카드에만** 나온다. 안 고른 카드에 적으면 거짓말이다 — 거기서 한 번 누르면
        근거가 아니라 선택이 옮겨간다. 시간 줄 아래로 비어 있던 자리라 아무것도 안 밀어낸다.
      */}
      {big && (
        <span
          className="absolute top-[86px] left-[16px] flex items-center gap-[3px] text-[#f2721b]"
        >
          <span className="border-b text-[12.5px] font-bold whitespace-nowrap">
            근거 보기
          </span>
          <svg viewBox="0 0 8 14" fill="none" aria-hidden className="h-[11px] w-[6px]">
            <path
              d="M1.4 1.4 L6.6 7 L1.4 12.6"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}

      {/*
        점수. 오른쪽 끝이 아니라 **안쪽 여백 안**에 선다 (와이어프레임 3984:821 가이드가 카드
        오른쪽에서 13px 들어온 자리다) — 전에는 right-[9px] 라 숫자가 테두리에 붙어 보였다.
      */}
      <span className={`absolute right-[14px] ${big ? "top-[44px]" : "top-[31px]"} text-right`}>
        <span
          className={`block font-bold text-[#1f1f1f] ${big ? "text-[40px]" : "text-[28px]"} leading-none`}
        >
          {Math.round(score)}
        </span>
        <span
          className={`mt-[7px] block font-medium text-[#040404] ${big ? "text-[12px]" : "text-[9px]"} leading-none`}
        >
          추천 점수
        </span>
      </span>
    </button>
  );
}
