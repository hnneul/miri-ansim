"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ACTION, WHY } from "@/lib/briefing";
import type { RiskFactor } from "@/lib/score";

// ponytail: 카카오 SDK는 타입 정의가 없어 any로 둔다.
// 지도 교체(Leaflet) 가능성이 있어 타입 패키지를 붙일 만큼 표면적이 넓지 않음.
declare global {
  interface Window {
    kakao: any;
  }
}

export type LatLng = [number, number]; // [위도, 경도]
export type MapRoute = { path: LatLng[]; color: string; weight?: number; opacity?: number };
export type MapPreviewRoute = {
  name: string;
  badge?: string;
  color: string;
  durationMin: number | null;
  distanceKm: number | null;
  path: LatLng[];
  risks: RiskFactor[];
};

/**
 * 마커 아이콘. src 는 data: URI 를 넣는다 — 인라인 SVG면 파일도 외부 요청도 안 늘어난다.
 * anchor 를 안 주면 이미지 가운데를 좌표에 맞춘다 (핀 모양이면 뾰족한 끝을 직접 지정할 것).
 */
export type MarkerIcon = { src: string; size: [number, number]; anchor?: [number, number] };
export type MapMarker = { coord: LatLng; label: string; icon?: MarkerIcon; risk?: RiskFactor };

type Props = {
  center: LatLng;
  level?: number; // 클수록 넓게 보임
  routes: MapRoute[];
  markers?: MapMarker[];
  preview?: MapPreviewRoute;
};

const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

/**
 * SDK 로딩. 한 화면에 지도가 여러 개(메인·주차·착한가격)라도 스크립트는 하나면 되므로
 * 모듈 전역 프로미스 하나로 묶는다. 인스턴스마다 resolve 를 나눠 받는다.
 *
 * next/script 를 쓰지 않는 이유 — 같은 src 를 LoadCache 로 묶는 규칙이 인스턴스 수에 따라
 * 갈린다 (node_modules/next/dist/client/script.js): 세 번째부터는 onLoad 가 안 오고,
 * onReady 는 스크립트가 아직 로딩 중인데도 불려서 window.kakao 가 undefined 다.
 * 지도가 셋이 되는 순간 둘 다 밟았다. 스크립트 태그 하나 붙이는 일에 맞출 규칙이 아니다.
 */
let sdkPromise: Promise<void> | undefined;

function loadSdk() {
  return (sdkPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    // autoload=false — 로드 직후 maps.load() 로 직접 초기화한다
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false`;
    s.onload = () => window.kakao.maps.load(resolve);
    s.onerror = reject;
    document.head.append(s);
  }));
}

export default function RouteMap({ center, level = 10, routes, markers = [], preview }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const previewMarker = useRef<any>(null);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<RiskFactor | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState(0);

  // 배열 prop이 매 렌더 새 참조라 의존성으로 직접 못 쓴다
  const shape = JSON.stringify({ center, level, routes, markers });
  const previewShape = JSON.stringify(preview && { name: preview.name, path: preview.path, risks: preview.risks });
  const previewSteps = useMemo(() => buildPreviewSteps(preview), [previewShape]);
  const activeStep = activePreviewStep(previewSteps, progress);

  useEffect(() => {
    if (!KEY) return;
    // 이미 로드됐으면 프로미스가 그대로 resolve 돼서, 리마운트에도 다시 뜬다
    loadSdk().then(
      () => setSdk("ready"),
      () => setSdk("error"),
    );
  }, []);

  useEffect(() => {
    setProgress(0);
    setPreviewing(false);
  }, [previewShape]);

  useEffect(() => {
    if (!previewing || !preview?.path.length) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const next = p + Math.max(1, Math.ceil(preview.path.length / 90));
        return Math.min(next, preview.path.length - 1);
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [previewing, previewShape, preview?.path.length]);

  useEffect(() => {
    if (previewing && preview?.path.length && progress >= preview.path.length - 1) {
      setPreviewing(false);
    }
  }, [previewing, progress, preview?.path.length]);

  useEffect(() => {
    if (sdk !== "ready" || !box.current) return;
    const { kakao } = window;
    const pt = ([lat, lng]: LatLng) => new kakao.maps.LatLng(lat, lng);

    map.current ??= new kakao.maps.Map(box.current, { center: pt(center), level });

    drawn.current.forEach((o) => o.setMap(null));
    drawn.current = [
      ...routes.map(
        (r) =>
          new kakao.maps.Polyline({
            path: r.path.map(pt),
            strokeWeight: r.weight ?? 6,
            strokeColor: r.color,
            strokeOpacity: r.opacity ?? 0.9,
          }),
      ),
      ...markers.map((m) => {
        const [w, h] = m.icon?.size ?? [0, 0];
        const marker = new kakao.maps.Marker({
          position: pt(m.coord),
          title: m.label,
          image:
            m.icon &&
            new kakao.maps.MarkerImage(m.icon.src, new kakao.maps.Size(w, h), {
              offset: new kakao.maps.Point(...(m.icon.anchor ?? [w / 2, h / 2])),
            }),
        });
        if (m.risk) kakao.maps.event.addListener(marker, "click", () => setSelected(m.risk!));
        return marker;
      }),
    ];
    drawn.current.forEach((o) => o.setMap(map.current));

    // 경로 전체가 담기도록 맞춘다 — level을 시나리오마다 손으로 고르면
    // 컨테이너 폭이 달라질 때 한쪽 경로가 화면 밖으로 나간다.
    // 경로가 없으면(주차 미니 지도 등) 마커에 맞춘다 — 축척을 손으로 고를 필요가 없다.
    const all = routes.length ? routes.flatMap((r) => r.path) : markers.map((m) => m.coord);
    if (all.length < 2) return; // 한 점뿐이면 맞출 게 없다 — center/level 을 그대로 쓴다
    const lat = all.map((p) => p[0]);
    const lng = all.map((p) => p[1]);
    const bounds = new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(Math.min(...lat), Math.min(...lng)),
      new kakao.maps.LatLng(Math.max(...lat), Math.max(...lng)),
    );

    // 컨테이너 크기가 0인 동안 맞추면 축척이 터진다 (제주 대신 한반도가 보인다).
    // 첫 렌더에 폭이 0일 수 있고, 창 크기가 바뀌어도 다시 맞춰야 하므로 관찰한다.
    const fit = () => {
      if (!box.current?.clientWidth || !box.current.clientHeight) return;
      map.current.relayout();
      map.current.setBounds(bounds, 24, 24, 24, 24);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, shape]);

  useEffect(() => {
    if (sdk !== "ready" || !map.current || !preview?.path.length) {
      previewMarker.current?.setMap(null);
      previewMarker.current = null;
      return;
    }

    const { kakao } = window;
    const [lat, lng] = preview.path[Math.min(progress, preview.path.length - 1)];
    const position = new kakao.maps.LatLng(lat, lng);
    const image = new kakao.maps.MarkerImage(
      previewDot(preview.color),
      new kakao.maps.Size(34, 34),
      { offset: new kakao.maps.Point(17, 17) },
    );

    if (previewMarker.current) {
      previewMarker.current.setImage(image);
    } else {
      previewMarker.current = new kakao.maps.Marker({
        image,
        zIndex: 10,
      });
    }
    previewMarker.current.setPosition(position);
    previewMarker.current.setMap(map.current);

    return () => {
      if (!preview) previewMarker.current?.setMap(null);
    };
  }, [sdk, previewShape, progress, preview]);

  const notice = !KEY
    ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
    : sdk === "loading"
      ? "지도를 불러오는 중…"
      : sdk === "error"
        ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
        : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[24px] bg-slate-100 shadow-inner ring-1 ring-black/5">
      <div ref={box} className="h-full w-full" />
      {preview && sdk === "ready" && activeStep && (
        <PreviewPanel
          route={preview}
          step={activeStep}
          steps={previewSteps}
          progress={progress}
          playing={previewing}
          onToggle={() => setPreviewing((v) => !v)}
          onChange={(value) => {
            setPreviewing(false);
            setProgress(value);
          }}
          onStep={(dir) => {
            setPreviewing(false);
            const current = previewSteps.findIndex((s) => s === activeStep);
            const next = previewSteps[Math.max(0, Math.min(previewSteps.length - 1, current + dir))];
            if (next) setProgress(next.index);
          }}
        />
      )}
      {selected && sdk === "ready" && <RoadviewPanel risk={selected} onClose={() => setSelected(null)} />}
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}

type PreviewStep = {
  index: number;
  title: string;
  body: string;
  meta: string;
  risk?: RiskFactor;
};

function buildPreviewSteps(route?: MapPreviewRoute): PreviewStep[] {
  if (!route?.path.length) return [];
  const riskSteps = route.risks
    .map((risk) => ({ risk, index: closestIndex(route.path, risk.coord) }))
    .sort((a, b) => a.index - b.index)
    .map(({ risk, index }) => ({
      index,
      title: risk.label,
      body: `${WHY[risk.type]} ${ACTION[risk.type]}`,
      meta: risk.location,
      risk,
    }));

  return [
    {
      index: 0,
      title: "출발 전 경로 감 잡기",
      body: "실제 안내가 아니라, 초보자가 부담을 느낄 지점만 먼저 훑어보는 예습 모드입니다.",
      meta: route.badge ?? route.name,
    },
    ...riskSteps,
    {
      index: route.path.length - 1,
      title: "도착 직전",
      body: "목적지 주변에서는 내비 안내보다 주차장 입구와 차선 위치를 천천히 확인하는 게 더 중요합니다.",
      meta:
        route.durationMin != null && route.distanceKm != null
          ? `${route.durationMin}분 · ${route.distanceKm}km`
          : "소요시간 확인 중",
    },
  ];
}

function activePreviewStep(steps: PreviewStep[], progress: number): PreviewStep | undefined {
  let active = steps[0];
  for (const step of steps) {
    if (step.index > progress) break;
    active = step;
  }
  return active;
}

function closestIndex(path: LatLng[], target: LatLng): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  path.forEach((p, i) => {
    const d = (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2;
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

function previewDot(color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="12" fill="${color}" stroke="#fff" stroke-width="5"/>
      <circle cx="17" cy="17" r="4" fill="#fff"/>
    </svg>
  `)}`;
}

function PreviewPanel({
  route,
  step,
  steps,
  progress,
  playing,
  onToggle,
  onChange,
  onStep,
}: {
  route: MapPreviewRoute;
  step: PreviewStep;
  steps: PreviewStep[];
  progress: number;
  playing: boolean;
  onToggle: () => void;
  onChange: (value: number) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const max = Math.max(0, route.path.length - 1);
  const stepNo = steps.findIndex((s) => s === step) + 1;

  return (
    <aside className="absolute inset-x-3 bottom-3 z-10 rounded-[22px] bg-white/95 p-3 text-slate-900 shadow-2xl shadow-slate-900/10 ring-1 ring-black/10 backdrop-blur lg:inset-x-auto lg:left-3 lg:w-[25rem]">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? "미리 달려보기 정지" : "미리 달려보기 재생"}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black text-white shadow-sm"
          style={{ background: route.color }}
        >
          {playing ? "II" : "▶"}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[11px] font-bold text-orange-500">미리 달려보기</p>
            <p className="shrink-0 text-[11px] tabular-nums text-slate-400">
              {stepNo}/{steps.length}
            </p>
          </div>
          <h2 className="mt-0.5 text-base font-black tracking-normal">{step.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.meta}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-700">{step.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label="이전 부담 구간"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"
        >
          ‹
        </button>
        <input
          aria-label="미리 달려보기 진행 위치"
          className="h-2 min-w-0 flex-1 accent-orange-500"
          type="range"
          min={0}
          max={max}
          value={Math.min(progress, max)}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label="다음 부담 구간"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"
        >
          ›
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        실제 운전 중 길안내는 카카오내비·티맵·네이버지도 같은 전용 내비를 함께 사용하세요.
      </p>
    </aside>
  );
}

function RoadviewPanel({ risk, onClose }: { risk: RiskFactor; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    if (!box.current) return;
    const { kakao } = window;
    const position = new kakao.maps.LatLng(risk.coord[0], risk.coord[1]);
    const roadview = new kakao.maps.Roadview(box.current);
    const client = new kakao.maps.RoadviewClient();

    setStatus("loading");
    client.getNearestPanoId(position, 150, (panoId: number | null) => {
      if (!panoId) {
        setStatus("empty");
        return;
      }
      roadview.setPanoId(panoId, position);
      setStatus("ready");
      window.setTimeout(() => roadview.relayout(), 0);
    });
  }, [risk]);

  return (
    <aside className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-[24px] bg-white text-slate-900 shadow-2xl ring-1 ring-black/10 lg:inset-x-auto lg:top-3 lg:right-3 lg:bottom-3 lg:w-[24rem]">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-orange-500">위험구간 미리보기</p>
          <h2 className="mt-0.5 text-base font-black tracking-normal">{risk.label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{risk.location}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="로드뷰 닫기"
          className="-mt-1 -mr-1 shrink-0 rounded-full px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          x
        </button>
      </div>
      <div className="relative h-56 bg-slate-100 lg:h-72">
        <div ref={box} className={`h-full w-full ${status === "empty" ? "hidden" : ""}`} />
        {status !== "ready" && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-slate-500">
            {status === "loading" ? "로드뷰를 찾는 중..." : "이 지점 주변 로드뷰가 없습니다."}
          </div>
        )}
      </div>
      <div className="space-y-2 p-4 text-sm">
        <p className="leading-relaxed text-slate-700">{WHY[risk.type]}</p>
        <p className="text-xs tabular-nums text-slate-500">
          {risk.value} · 경로의 {Math.round(risk.exposure * 100)}%
        </p>
        <p className="border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-400">
          출처: {risk.source}
        </p>
      </div>
    </aside>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center rounded-[24px] bg-[#F4F7F5] p-4 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
