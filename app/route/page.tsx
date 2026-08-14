"use client";

// 길 비교 — 최종 와이어프레임 HOME-02 | 길 비교 (Figma 2153:1704).
// 주차장을 정한 뒤(/parking/detail "이 주차장으로 갈게요") 여기로 온다.
//
// 화면이 하는 일: 카카오가 준 두 갈래를 지도에 겹쳐 그리고, 각각의 **부담점수**를 카드로 보여준다.
// 부담점수는 lib/score.ts 가 매긴다 — 운전 경력·빈도·차종·시간대(프로필)에 따라 같은 길도 값이 다르다.
//
// 근거 화면(HOME-03 | 안심 길 근거, Figma 2153:1986)도 여기 있다 — 라우트가 아니라 상태다.
// 고른 카드의 › 로 들어간다 (아래 view 주석에 왜 한 파일인지 적어뒀다).
//
// 마지막 "이 길로 갈게요"는 카카오맵을 연다. 턴바이턴 안내를 우리가 만들 이유가 없어서다.
// 출발지·경유지·도착지를 함께 넘기므로 **여기서 고른 길로 안내된다** (lib/parking.ts navigateTo).

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../StatusBar";
import RouteMap, { type LatLng } from "../RouteMap";
import { parseProfile } from "@/lib/profile";
import { navigateTo } from "@/lib/parking";
import { COMFORT_THRESHOLD } from "@/lib/score";
import { viaPoint, type LiveRoute } from "@/lib/route";
import { compareRoutes, type Compared } from "./actions";

/**
 * 시트 높이 = 지도가 아래로 비워 둘 높이. 상태마다 다르다.
 * 비교는 와이어프레임 그대로 350(카드 130 + 버튼 52 + 여백), 근거는 표 다섯 줄이 들어갈 만큼이다.
 */
const SHEET_H = { compare: 350, why: 520 };

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

  /** 도착지 — 앞 화면에서 고른 주차장이다 (관광지가 아니라 차를 댈 자리로 길을 만든다). */
  const to = query.to ?? "도착지";
  const dest = coord(query.toLat, query.toLng);

  /**
   * 출발지. 정상 흐름이면 메인화면이 잡아 넘긴 현위치가 쿼리에 실려 온다(originLat/originLng).
   * URL 로 바로 들어오면 없으므로 그때만 브라우저에 다시 묻는다 — 있는 값을 두고 또 묻지 않는다.
   */
  const fromQuery = coord(query.originLat, query.originLng);
  const [origin, setOrigin] = useState<LatLng | null>(fromQuery);
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

  useEffect(() => {
    if (origin || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setOrigin([coords.latitude, coords.longitude]),
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
    const found = await compareRoutes(origin, dest, profile);
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

  const routes = result && !("error" in result) ? result.routes : [];
  const chosen = routes.find((r) => r.id === picked) ?? routes[0] ?? null;
  const sheetH = SHEET_H[view];

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
            from: { name: "출발지", at: origin },
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
          route-editor — 출발/도착을 보여주기만 한다. 고치는 건 아직 갈 화면이 없다.
          ponytail: "목적지 → 출발 선택"(Figma 2173:1932)을 만들면 이 카드를 누를 수 있게 한다.
        */
        <div className="mt-[9px] flex shrink-0 items-start gap-[21px] px-[21px]">
          <div className="min-w-0 flex-1 overflow-hidden rounded-[10px] border border-[#d6d6d6] bg-white">
            <Field
              dot="#fc7f35"
              label="출발지"
              value={
                fromQuery ? "현재 위치" : origin ? "현재 위치" : "확인 중…"
              }
            />
            <div className="mx-[10px] border-t border-[#e6e6e6]" />
            <Field dot="#1f1f1f" label="도착지" value={to} />
          </div>
          <button
            onClick={() => router.back()}
            aria-label="닫기"
            className="mt-[32px] grid size-[44px] shrink-0 place-items-center rounded-[10px] border border-[#d6d6d6] bg-white active:bg-black/5"
          >
            <img src="/home/icon-close.svg" alt="" className="size-6" />
          </button>
        </div>
      )}

      {/*
        지도 — 두 경로를 겹쳐 그린다. 고른 쪽이 굵고 진하다.

        RouteMap 을 absolute inset-0 로 한 겹 감싸야 한다. 그 안은 h-full 인데 flex-1 부모는
        specified height 가 auto 라, 퍼센트 높이가 0으로 죽어 지도가 통째로 안 보인다
        (실제로 그랬다 — 615px 짜리 상자 안에서 지도 높이가 0이었다). inset-0 이면 크기가 확정된다.
        /destination 이 같은 이유로 같은 모양이다.
      */}
      <div className="relative mt-[24px] min-h-0 flex-1">
        <div className="absolute inset-0">
          <RouteMap
            className=""
            center={dest ?? [33.38, 126.55]}
            level={9}
            /* 근거 화면에서는 고른 길 하나만 그린다 — 그 길을 설명하는 자리라 나머지는 방해다 */
            routes={(view === "why"
              ? routes.filter((r) => r.id === picked)
              : routes
            ).map((r) => ({
              path: r.path,
              color: r.color,
              weight: r.id === picked ? 7 : 5,
              opacity: r.id === picked ? 0.95 : 0.45,
              label: `${r.durationMin}분`,
            }))}
            markers={[
              ...(origin ? [{ coord: origin, label: "출발" }] : []),
              ...(dest ? [{ coord: dest, label: "도착" }] : []),
            ]}
            padBottom={sheetH}
          />
        </div>
      </div>

      {/*
        route-comparison-sheet. 와이어프레임은 350 고정인데 그건 카드 두 장(130) + 버튼(52) 기준이고,
        근거 표는 다섯 줄이라 그 높이에 안 들어간다 — 실제로 버튼이 잘렸다. 상태마다 높이를 달리하되,
        안이 넘치면 **내용만** 스크롤하고 버튼은 아래 붙어 있게 flex 로 나눈다 (줄 수가 늘어도 안 잘린다).
        지도에 넘기는 padBottom 도 같은 값을 써야 마커가 시트에 안 걸린다.
      */}
      <div
        style={{ height: sheetH }}
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] bg-white pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.14)]"
      >
        <div
          aria-hidden
          className="mx-auto h-1 w-12 shrink-0 rounded-[2px] bg-[#d6d6d6]"
        />

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
              {view === "why" && chosen ? (
                <Why
                  route={chosen}
                  other={result.routes.find((r) => r.id !== chosen.id) ?? null}
                  score={
                    chosen.id === "fast"
                      ? result.score.fastScore
                      : result.score.safeScore
                  }
                  recommended={result.score.recommendedRoute === chosen.id}
                  verdict={result.verdicts[chosen.id]}
                />
              ) : (
                <div className="mt-[30px] flex gap-[14px] px-4">
                  {result.routes.map((r) => (
                    <RouteCard
                      key={r.id}
                      route={r}
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
              )}
            </div>

            <div className="shrink-0 px-4 pt-[15px] pb-2">
              <button
                onClick={go}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#1f1f1f] text-[16px] font-bold text-white transition active:scale-[0.99]"
              >
                <span aria-hidden className="text-[15px]">
                  ➤
                </span>
                이 길로 갈게요
              </button>
              <p className="mt-2 text-center text-[11px] leading-[16px] text-[#9e9e9e]">
                {origin
                  ? "카카오맵이 이 길로 안내해요 · 출발지와 경유지를 함께 넘겨요"
                  : "카카오맵으로 안내를 시작해요 · 출발지를 못 넘겨 다른 길로 안내될 수 있어요"}
              </p>
              <p className="mt-1 text-center text-[11px] leading-[16px] text-[#bdbdbd]">
                {result.at} 실시간 교통 기준
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

function Field({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex h-[51px] items-center gap-[12px] px-[12px]">
      <span
        aria-hidden
        className="size-[10px] shrink-0 rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className="min-w-0">
        <span className="block text-[10px] leading-[14px] font-medium text-[#9e9e9e]">
          {label}
        </span>
        <span className="block truncate text-[14px] leading-[20px] font-medium text-[#1f1f1f]">
          {value}
        </span>
      </span>
    </div>
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
 * **와이어프레임의 네 줄 중 두 줄은 뺐다.** "사고 잦은 곳"은 채울 데이터가 없고(도로교통공단
 * 사고다발지역 데이터를 따로 받아야 한다), "비보호 좌회전"의 **비보호** 여부는 신호 데이터가
 * 없어 모른다 — 좌회전 횟수는 정확하므로 그 줄은 "좌회전·유턴"으로 이름만 줄여 남겼다.
 * 모르는 걸 0이나 "없음"으로 적으면 확인한 사실처럼 읽힌다.
 */
function Why({
  route,
  other,
  score,
  recommended,
  verdict,
}: {
  route: LiveRoute;
  /** 상대 경로. 없으면(단일 경로) 비교 칸 없이 내 값만 적는다 */
  other: LiveRoute | null;
  score: number;
  recommended: boolean;
  verdict?: string;
}) {
  const rows: { label: string; mine: string; theirs: string }[] = [
    row("좌회전 · 유턴", (s) => (s.turns ? `${s.turns}번` : "없음")),
    row("회전교차로", (s) => (s.roundabouts ? `${s.roundabouts}곳` : "없음")),
    row("연속 급커브", (s) => (s.sharpCurves ? `${s.sharpCurves}곳` : "없음")),
    row("좁은 교행 구간", (s) =>
      s.narrow ? `${Math.round(s.narrow * 100)}%` : "없음",
    ),
    row("고속주행 구간", (s) =>
      s.highSpeedKm ? `${s.highSpeedKm}km` : "없음",
    ),
  ];

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
        <span className="min-w-0 truncate text-[16px] font-bold text-[#1f1f1f]">
          {recommended ? "맞춤 안심 길" : route.name}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-[6px]">
          <span className="text-[12px] text-[#9e9e9e]">부담점수</span>
          <span className="text-[28px] leading-none font-bold text-[#1f1f1f]">
            {Math.round(score)}
          </span>
          <span className="text-[12px] font-medium text-[#9e9e9e]">
            {score < COMFORT_THRESHOLD ? "낮음" : "높음"}
          </span>
        </span>
      </div>

      {/* 한 줄 판정. lib/briefing.ts 가 만든다 — 점수와 임계값을 읊지 않고 교환을 말한다 */}
      {verdict && (
        <p className="mt-3 text-[13px] leading-[20px] text-[#525252]">
          {verdict}
        </p>
      )}

      {/*
        비교표. 왼쪽이 상대 경로, 오른쪽이 이 경로다 (와이어프레임의 "12곳 → 3곳" 방향 그대로).
        상대가 없으면(단일 경로) 화살표 없이 내 값만 적는다 — 비교할 게 없는데 화살표를 그리면
        왼쪽 빈칸이 0으로 읽힌다.
      */}
      <dl className="mt-4 overflow-hidden rounded-[10px] border border-[#e5e5e5]">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className={`flex items-center justify-between px-[14px] py-[9px] ${i ? "border-t border-[#f0f0f0]" : ""}`}
          >
            <dt className="text-[13px] text-[#525252]">{r.label}</dt>
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

function RouteCard({
  route,
  score,
  recommended,
  picked,
  onPick,
  onWhy,
}: {
  route: LiveRoute;
  score: number;
  recommended: boolean;
  picked: boolean;
  onPick: () => void;
  onWhy: () => void;
}) {
  return (
    <button
      onClick={onPick}
      aria-pressed={picked}
      /* 높이를 130 으로 못 박지 않는다 — 추천 카드만 도로 이름 한 줄이 더 붙어서 글자가 잘렸다.
         min-h 로 두면 둘이 같이 늘어난다 (나란한 flex 항목이라 키가 저절로 맞는다). */
      className={`min-h-[130px] min-w-0 flex-1 rounded-[10px] px-3 pt-[14px] pb-[12px] text-left transition ${
        picked
          ? "border-2 border-[#fc7f35] bg-[#ffece1]"
          : "border border-[#d6d6d6] bg-white"
      }`}
    >
      <div className="flex items-center gap-2">
        {recommended && (
          <span className="shrink-0 rounded-[5px] bg-[#fc7f35] px-2 py-[3px] text-[11px] leading-none font-bold text-white">
            추천
          </span>
        )}
        <span className="min-w-0 truncate text-[15px] leading-none font-bold text-[#1f1f1f]">
          {recommended ? "맞춤 안심 길" : route.name}
        </span>
        {/*
          › 는 근거 화면으로 가는 문이다 (와이어프레임의 카드 오른쪽 화살표).
          카드 안의 버튼이라 <button> 을 겹치면 HTML 이 깨진다 — span 에 역할만 얹고
          클릭이 바깥 카드로 새지 않게 여기서 끊는다. 고른 카드에만 띄운다: 안 고른 카드의
          근거를 바로 열면 지도가 다른 길을 그리고 있어 화면과 글이 어긋난다.
        */}
        {picked && (
          <span
            role="button"
            tabIndex={0}
            aria-label="이 길을 고른 이유 보기"
            onClick={(e) => {
              e.stopPropagation();
              onWhy();
            }}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.stopPropagation(), onWhy())
            }
            className="ml-auto shrink-0 cursor-pointer px-1 text-[18px] leading-none text-[#fc7f35]"
          >
            ›
          </span>
        )}
      </div>

      <div className="mt-[14px] flex items-baseline gap-[6px]">
        <span className="text-[12px] text-[#9e9e9e]">부담점수</span>
        <span className="text-[32px] leading-none font-bold text-[#1f1f1f]">
          {Math.round(score)}
        </span>
        {/* 낮음/높음의 기준은 lib/score.ts 의 COMFORT_THRESHOLD 하나다 — 화면에서 다시 정하지 않는다 */}
        <span className="text-[12px] font-medium text-[#9e9e9e]">
          {score < COMFORT_THRESHOLD ? "낮음" : "높음"}
        </span>
      </div>

      <p className="mt-[14px] text-[13px] text-[#9e9e9e]">
        {route.durationMin}분 · {route.distanceKm}km
      </p>
      {/* 추천 카드는 이름 자리를 "맞춤 안심 길"에 내줬으니 도로 이름을 여기로 내린다 */}
      {recommended && (
        <p className="mt-[2px] truncate text-[11px] text-[#bdbdbd]">
          {route.name}
        </p>
      )}
    </button>
  );
}
