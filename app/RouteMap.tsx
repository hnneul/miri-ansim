"use client";

import { useEffect, useRef, useState } from "react";
import { WHY } from "@/lib/briefing";
import type { RiskFactor } from "@/lib/score";

// ponytail: 카카오 SDK는 타입 정의가 없어 any로 둔다.
// 지도 교체(Leaflet) 가능성이 있어 타입 패키지를 붙일 만큼 표면적이 넓지 않음.
declare global {
  interface Window {
    kakao: any;
  }
}

export type LatLng = [number, number]; // [위도, 경도]
/** label 을 주면 경로 중간에 말풍선이 붙는다 (카카오맵 "OO로 55분"과 같은 자리). */
export type MapRoute = {
  path: LatLng[];
  color: string;
  weight?: number;
  opacity?: number;
  label?: string;
  /** 말풍선 색. 선을 회색으로 눕힌 경로도 라벨은 제 색이어야 어느 길인지 읽힌다. */
  labelColor?: string;
  /**
   * 다른 선 **위에 겹쳐 얹는 선**이다 (부담 구간). 흰 테를 안 두른다.
   *
   * 테를 두르면 아래 경로선과 사이에 흰 경계가 생겨서, 색이 바뀐 구간이 아니라 위에 올려둔
   * 딴 물건으로 보인다 — 짧을수록 심해서 흘린 자국처럼 읽혔다. 테 없이 같은 폭으로 얹으면
   * 아래 선의 흰 테가 그대로 이어지고, **그 자리에서 선 색만 바뀐 것**이 된다
   * (카카오맵이 정체 구간을 칠하는 방식이 이것이다).
   */
  overlay?: boolean;
};

/**
 * 마커 아이콘. src 는 data: URI 를 넣는다 — 인라인 SVG면 파일도 외부 요청도 안 늘어난다.
 * anchor 를 안 주면 이미지 가운데를 좌표에 맞춘다 (핀 모양이면 뾰족한 끝을 직접 지정할 것).
 */
export type MarkerIcon = { src: string; size: [number, number]; anchor?: [number, number] };
export type MapMarker = {
  coord: LatLng;
  label: string;
  icon?: MarkerIcon;
  risk?: RiskFactor;
  /**
   * 마커를 눌렀다. 주면 **누를 수 있는 물건이 된다** — 손이 올라가면 커서가 바뀌고 아이콘이
   * 살짝 커진다 (아래 마커 만드는 자리). 안 주면 예전처럼 그냥 그림이다.
   */
  onClick?: () => void;
};

type Props = {
  center: LatLng;
  level?: number; // 클수록 넓게 보임
  routes: MapRoute[];
  markers?: MapMarker[];
  /**
   * 바깥 상자 모양. 기본은 카드(둥근 모서리·안쪽 그림자)다.
   * 화면 전체를 까는 자리(app/destination)는 각지게 넘긴다 — 폰 프레임이 이미 모서리를 둥글리고 있어
   * 여기까지 둥글면 두 반지름이 어긋나 귀퉁이에 프레임 배경이 비친다.
   */
  className?: string;
  /**
   * 아래쪽 몇 px 이 다른 것에 덮여 있는지 (하단 시트 높이). 지도는 자기 상자 전체를 쓰지만
   * 사람이 보는 건 그 위쪽뿐이라, 정중앙에 맞추면 마커가 시트에 반쯤 걸리거나 눌린 것처럼 보인다.
   * 이 값만큼 안 가린 영역의 한가운데로 올려 잡는다.
   */
  padBottom?: number;
  /**
   * 지도의 빈 곳(선·마커가 아닌 자리)을 눌렀다. 지도를 보겠다는 뜻이라, 부르는 쪽은 보통
   * 덮고 있던 시트를 내린다 (/route 의 collapsed).
   *
   * 카카오의 map "click" 은 마커·선을 눌렀을 때는 안 온다 — 그래서 "빈 곳"이 그냥 성립한다.
   *
   * 누른 좌표를 같이 준다 — 출발 위치를 지도에서 직접 고르는 화면(TRIP-04-C)이 이걸 쓴다.
   * 옵션인 이유는 카카오가 좌표 없는 click 을 줄 수도 있어서다. 안 쓰는 쪽은 그냥 무시하면 된다.
   */
  onBlank?: (at?: LatLng) => void;
  /**
   * **휠로** 확대/축소할지. 끄는 건 마우스 휠 하나뿐이다 — 핀치·더블클릭 확대와 끌기는 그대로 산다.
   *
   * **세로로 긴 화면 한복판에 박힌 지도는 꺼야 한다** (메인). 사람이 스크롤하려고 지도 위에서
   * 휠을 굴리면 화면이 안 내려가고 지도만 축소된다 — 스크롤은 화면 가운데서 하는 게 보통이라
   * 그 자리의 지도가 휠을 먹으면 화면이 고장 난 것처럼 느껴진다.
   *
   * setZoomable(false) 이 아니라 이 옵션인 이유: 저건 확대를 통째로 막아 핀치까지 죽는다.
   * 휠은 데스크톱에서만 스크롤과 겹치고, 폰의 핀치는 스크롤과 안 겹친다 — 겹치는 것만 끈다.
   * (확인: scrollwheel:false 지도에 휠은 레벨 5→5, 더블클릭은 5→4.)
   *
   * 지도가 화면의 주인공인 곳(길 비교·목적지)은 기본값 그대로 둔다.
   */
  wheelZoom?: boolean;
  /**
   * 지도 오른쪽 아래 ＋/－ 버튼. wheelZoom 을 끈 자리(메인)에 확대할 문 하나는 있어야 한다 —
   * 폰의 핀치·더블탭은 살아 있지만 마우스로 여는 사람에게는 더블클릭 말고 보이는 게 없다.
   *
   * 카카오 기본 줌 컨트롤(ZoomControl) 대신 직접 그린다. 그건 지도 회색·파란 테두리로 와서
   * 이 앱의 흰 카드·주황 톤과 안 맞고, 자리도 오른쪽 위(현위치 버튼 자리)로 고정이다.
   */
  zoomButtons?: boolean;
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

/** 주차장 지도(app/parking)도 같은 SDK 를 쓴다 — 프로미스가 하나여야 스크립트도 하나다. */
export function loadSdk() {
  return (sdkPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    // autoload=false — 로드 직후 maps.load() 로 직접 초기화한다
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false`;
    s.onload = () => window.kakao.maps.load(resolve);
    s.onerror = reject;
    document.head.append(s);
  }));
}

export default function RouteMap({
  center,
  level = 10,
  routes,
  markers = [],
  className = "rounded-[24px] shadow-inner ring-1 ring-black/5",
  padBottom = 0,
  onBlank,
  wheelZoom = true,
  zoomButtons = false,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const [sdk, setSdk] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<RiskFactor | null>(null);

  // 배열 prop이 매 렌더 새 참조라 의존성으로 직접 못 쓴다
  /**
   * 최신 마커 목록. 마커를 다시 만드는 기준(shape)은 JSON 이라 함수가 빠지므로, onClick 만
   * 바뀐 렌더는 마커를 새로 만들지 않는다 — 리스너가 만들어질 때의 낡은 콜백에 묶이면
   * 그때의 URL·상태로 움직인다. 눌리는 순간 이 ref 에서 꺼내 쓴다 (blank 와 같은 이유).
   */
  const latest = useRef<MapMarker[]>(markers);
  latest.current = markers;
  const blank = useRef<((at?: LatLng) => void) | undefined>(undefined);
  const blankBound = useRef(false);

  const shape = JSON.stringify({ center, level, routes, markers, padBottom });

  useEffect(() => {
    if (!KEY) return;
    // 이미 로드됐으면 프로미스가 그대로 resolve 돼서, 리마운트에도 다시 뜬다
    loadSdk().then(
      () => setSdk("ready"),
      () => setSdk("error"),
    );
  }, []);

  useEffect(() => {
    if (sdk !== "ready" || !box.current) return;
    const { kakao } = window;
    const pt = ([lat, lng]: LatLng) => new kakao.maps.LatLng(lat, lng);

    // scrollwheel 은 세터가 없어 생성자에서만 걸린다 — 지도는 한 번만 만들어지므로(??=)
    // 이 값은 화면마다 고정이다. 도중에 바꿔야 할 자리가 생기면 그때 지도를 다시 만들어야 한다.
    map.current ??= new kakao.maps.Map(box.current, { center: pt(center), level, scrollwheel: wheelZoom });

    /*
      빈 곳 누르기. 리스너는 지도 하나당 한 번만 단다 — 이 효과는 경로·마커가 바뀔 때마다 도는데
      그때마다 붙이면 누를 때 콜백이 여러 번 불린다. 최신 콜백은 ref 로 읽어 오래된 값에 안 묶인다.
    */
    blank.current = onBlank;
    if (onBlank && !blankBound.current) {
      blankBound.current = true;
      kakao.maps.event.addListener(map.current, "click", (e: any) => {
        const ll = e?.latLng;
        blank.current?.(ll ? [ll.getLat(), ll.getLng()] : undefined);
      });
    }

    // 라벨을 어느 쪽으로 붙일지 정하는 기준선 (경로 전체의 동서 한가운데)
    const allLng = routes.flatMap((r) => r.path.map((p) => p[1]));
    const midLng = (Math.min(...allLng) + Math.max(...allLng)) / 2;

    drawn.current.forEach((o) => o.setMap(null));
    const 선 = (r: MapRoute, color: string, plus = 0, opacity = r.opacity ?? 0.9) =>
      new kakao.maps.Polyline({
        path: r.path.map(pt),
        strokeWeight: (r.weight ?? 6) + plus,
        strokeColor: color,
        strokeOpacity: opacity,
      });

    drawn.current = [
      /*
        흰 테두리를 먼저 깔고 그 위에 색선을 얹는다. 기본 지도가 파스텔이라 — 물·강은 파랑,
        국립공원·곶자왈은 초록 — 경로색이 배경과 같은 계열이면 선이 지도에 묻힌다
        (제주 지도에서 파란 경로가 강처럼, 초록 경로가 공원 경계처럼 보였다).
        내비게이션이 다 하는 처리이고, 어떤 색을 쓰든 통한다.
      */
      ...routes.filter((r) => !r.overlay).map((r) => 선(r, "#fff", 4, 0.85)),
      ...routes.map((r) => 선(r, r.color)),
      // 라벨은 경로 중간점에 — 두 경로가 갈라진 뒤라 겹칠 일이 거의 없다.
      // ponytail: 겹치면 그때 갈라지는 지점 계산으로 올린다.
      ...routes
        .filter((r) => r.label)
        .map((r) => {
          const at = r.path[Math.floor(r.path.length / 2)];
          return new kakao.maps.CustomOverlay({
            position: pt(at),
            zIndex: 3,
            // 가운데 정렬(기본값)하면 지도 가장자리 경로에서 잘린다. 여백을 더 주면 축척이 한 단계
            // 물러나 경로가 작아지므로, 대신 말풍선을 지도 안쪽으로 붙인다 (동쪽 점이면 왼쪽으로).
            xAnchor: at[1] > midLng ? 1 : 0,
            content:
              `<div style="padding:5px 10px;border-radius:10px;` +
              // 선은 흐리게 해도 글자는 안 된다 — 추천/대안 구분은 선 굵기가 이미 하고 있다
              `background:${r.labelColor ?? r.color};color:#fff;font-size:12px;font-weight:700;white-space:nowrap;` +
              `box-shadow:0 2px 6px rgba(0,0,0,.25)">${r.label}</div>`,
          });
        }),
      ...markers.map((m, i) => {
        const [w, h] = m.icon?.size ?? [0, 0];
        const anchor = m.icon?.anchor ?? [w / 2, h / 2];
        const 그림 = (배: number) =>
          m.icon &&
          new kakao.maps.MarkerImage(m.icon.src, new kakao.maps.Size(w * 배, h * 배), {
            // 앵커도 같이 키운다 — 안 키우면 커지면서 핀 끝이 좌표에서 미끄러진다
            offset: new kakao.maps.Point(anchor[0] * 배, anchor[1] * 배),
          });
        const 기본 = 그림(1);
        const marker = new kakao.maps.Marker({
          position: pt(m.coord),
          title: m.label,
          image: 기본,
        });
        if (m.risk) kakao.maps.event.addListener(marker, "click", () => setSelected(m.risk!));
        if (m.onClick) {
          kakao.maps.event.addListener(marker, "click", () => latest.current[i]?.onClick?.());
          /*
            호버. 커서만 바꾸면 마우스를 이미 얹은 사람에게만 보이고, 아이콘만 키우면
            누를 수 있는 물건인지는 여전히 모른다 — 둘을 같이 한다.
            손가락에는 호버가 없으므로 여기서 하는 일이 없다 (누르는 건 그대로 된다).
          */
          const 커서 = (c: string) => map.current?.setCursor(c);
          const 큰그림 = 그림(1.25);
          kakao.maps.event.addListener(marker, "mouseover", () => {
            커서("pointer");
            if (큰그림) marker.setImage(큰그림);
          });
          kakao.maps.event.addListener(marker, "mouseout", () => {
            커서("");
            if (기본) marker.setImage(기본);
          });
        }
        return marker;
      }),
    ];
    drawn.current.forEach((o) => o.setMap(map.current));

    // 경로 전체가 담기도록 맞춘다 — level을 시나리오마다 손으로 고르면
    // 컨테이너 폭이 달라질 때 한쪽 경로가 화면 밖으로 나간다.
    // 경로가 없으면(주차 미니 지도 등) 마커에 맞춘다 — 축척을 손으로 고를 필요가 없다.
    const all = routes.length ? routes.flatMap((r) => r.path) : markers.map((m) => m.coord);
    // 두 점 이상이어야 담을 범위가 생긴다. 한 점 이하면 center/level 을 그대로 쓰되,
    // relayout 은 그때도 걸어야 한다 — 안 걸면 컨테이너가 0 이던 시점의 중심에 멈춘다
    // (목적지 화면처럼 마커가 하나뿐인 지도가 제주 대신 엉뚱한 데를 보고 있었다).
    const lat = all.map((p) => p[0]);
    const lng = all.map((p) => p[1]);
    const bounds =
      all.length < 2
        ? null
        : new kakao.maps.LatLngBounds(
            new kakao.maps.LatLng(Math.min(...lat), Math.min(...lng)),
            new kakao.maps.LatLng(Math.max(...lat), Math.max(...lng)),
          );

    // 컨테이너 크기가 0인 동안 맞추면 축척이 터진다 (제주 대신 한반도가 보인다).
    // 첫 렌더에 폭이 0일 수 있고, 창 크기가 바뀌어도 다시 맞춰야 하므로 관찰한다.
    const fit = () => {
      if (!box.current?.clientWidth || !box.current.clientHeight) return;
      map.current.relayout();
      // 가려진 아래쪽은 여백으로 넘긴다 — setBounds 가 알아서 그만큼 위로 잡는다
      if (bounds) map.current.setBounds(bounds, 24, 24, 24 + padBottom, 24);
      else {
        // setLevel 도 같이 걸어야 한다 — 생성자에 준 level 은 첫 렌더의 값이라, 나중에 prop 이
        // 바뀌어도(목적지를 고르면 10 → 5) 지도는 처음 축척에 그대로 있다.
        map.current.setLevel(level);
        map.current.setCenter(pt(center));
        if (padBottom) {
          // 화면에서 center 를 padBottom/2 만큼 위로 올린다 — 안 가린 영역(H - padBottom)의
          // 한가운데가 정중앙에서 딱 그만큼 위다.
          //
          // panBy 를 쓰면 안 된다. 애니메이션이라 바로 뒤따르는 setCenter/relayout 에 잘려
          // 실제로는 몇 px 만 움직였다. 투영으로 목표 좌표를 직접 구하면 한 번에 끝난다.
          const proj = map.current.getProjection();
          const p = proj.containerPointFromCoords(pt(center));
          p.y += padBottom / 2;
          map.current.setCenter(proj.coordsFromContainerPoint(p));
        }
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [sdk, shape]);

  const notice = !KEY
    ? "NEXT_PUBLIC_KAKAO_MAP_KEY 가 없습니다 (.env.local 확인)"
    : sdk === "loading"
      ? "지도를 불러오는 중…"
      : sdk === "error"
        ? "지도를 불러오지 못했습니다 (키·도메인 등록 확인)"
        : null;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-slate-100 ${className}`}>
      <div ref={box} className="h-full w-full" />
      {zoomButtons && sdk === "ready" && (
        /*
          오른쪽 아래 — 위는 현위치 버튼, 왼쪽 아래는 카카오 로고·축척자가 이미 쓰는 자리다.

          **현위치 버튼과 같은 세로줄에 선다.** 둘 다 right-[30px] 이었는데도 어긋나 보였다 —
          현위치는 44px 그림 안에 흰 원이 36px 로 들어 있어(public/home/btn-locate.svg 의
          rect x=4 w=36) 눈에 보이는 원이 34px 지점에서 끝난다. 그림의 투명 여백만큼 밀린 것이다.
          그래서 여기는 34 로 맞추고 폭도 36 으로 같이 맞춘다 — 폭이 다르면 오른쪽 끝을 맞춰도
          가운데가 어긋나 한 줄로 안 읽힌다.
        */
        <div className="absolute right-[34px] bottom-[12px] z-10 flex w-9 flex-col overflow-hidden rounded-[10px] bg-white shadow-[0_1px_4px_0_rgba(0,0,0,0.1)]">
          {/*
            레벨은 클수록 넓게 보인다 — ＋ 가 빼는 쪽이다. 1·14 밖은 카카오가 알아서 잘라낸다 (확인: 0→1, 30→14).

            **{animate:true} 를 주면 안 된다.** 카카오가 그 애니메이션 뒤로 setLevel 을 더는 안 먹는다 —
            첫 한 번만 움직이고 두 번째부터 레벨이 안 바뀐다 (맨 지도로도 재현: 4→5→5→5,
            옵션 없이는 4→5→4→3→4→5→4). 어차피 한 단계씩이라 즉시 바뀌는 편이 더 또렷하다.
          */}
          {([["확대", -1], ["축소", +1]] as const).map(([label, step]) => (
            <button
              key={label}
              onClick={() => map.current?.setLevel(map.current.getLevel() + step)}
              aria-label={label}
              /* 회색이다 — 주황은 이 앱에서 "고르는 것"의 색인데(검색바·강조) 줌은 지도를 보는 손짓이지 고르는 게 아니다 */
            className="h-[32px] w-full text-[16px] leading-none text-[#1f1f1f] transition first:border-b first:border-[#ececec] hover:bg-[#f5f5f5] active:bg-[#ececec]"
            >
              {step < 0 ? "＋" : "－"}
            </button>
          ))}
        </div>
      )}
      {selected && sdk === "ready" && <RoadviewPanel risk={selected} onClose={() => setSelected(null)} />}
      {notice && <Notice>{notice}</Notice>}
    </div>
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
      // 로드뷰는 생성 시점의 컨테이너 크기를 물고 있어서, 파노라마를 붙인 뒤 relayout 을
      // 부르지 않으면 300x300 기본값에 멈춘 채 회색으로 남는다. setTimeout(0) 으로는
      // 뷰어 DOM 이 만들어지기 전에 돌아 놓친다 — init 이 그 시점을 정확히 알려준다.
      kakao.maps.event.addListener(roadview, "init", () => roadview.relayout());
      roadview.setPanoId(panoId, position);
      setStatus("ready");
    });
  }, [risk]);

  return (
    // 지도 안에 갇혀야 한다 — max-h 가 없으면 패널(503px)이 지도(351px)보다 커져서
    // 위로 넘치고, 부모의 overflow-hidden 에 제목이 통째로 잘린다. 넘치는 몫은
    // 로드뷰가 아니라 아래 설명이 스크롤로 흡수한다 (사진이 이 패널의 본론이다).
    <aside className="absolute inset-x-3 bottom-3 z-20 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-[24px] bg-white text-slate-900 shadow-2xl ring-1 ring-black/10">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-orange-500">위험구간 미리보기</p>
          <h2 className="mt-0.5 text-base font-black tracking-normal">{risk.label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{risk.location}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="로드뷰 닫기"
          className="-mt-1 -mr-1 shrink-0 rounded-full px-2 py-1 text-lg leading-none text-slate-400 hover:bg-[#fff0e6] hover:text-[#ff6114]"
        >
          x
        </button>
      </div>
      <div className="relative h-40 shrink-0 bg-slate-100">
        <div ref={box} className={`h-full w-full ${status === "empty" ? "hidden" : ""}`} />
        {status !== "ready" && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-slate-500">
            {status === "loading" ? "로드뷰를 찾는 중..." : "이 지점 주변 로드뷰가 없습니다."}
          </div>
        )}
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto p-4 text-sm">
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
