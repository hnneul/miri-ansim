"use client";

// 주차장 상세 — 최종 와이어프레임 PARK-02 | 주차장 상세 · P2 (Figma 2153:3136).
// 목적지 흐름의 마지막 화면이다: 목록(PARK-01) → 확인 모달(PARK-01-a) → 여기.
//
// 주차장은 좌표로 가리켜 받는다 (app/parking/page.tsx detailQuery). 그 좌표로 공공데이터에서
// 원본을 되찾아 요금·규모·주차형태를 꺼내고, 못 찾으면(카카오 POI) 이름·주소만 쓴다 —
// 카카오 쪽은 유형·구획수·요금을 모르므로 없는 값을 지어내지 않는다 (lib/parking.ts 주석).

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusBar from "../../StatusBar";
import { meters, walkMinutes, parkingKind, feeText, feeDetail, type Lot } from "@/lib/parking";
import PARKING from "@/data/parking-data.json";

const LOTS = PARKING.spots as Lot[];

/**
 * 직각주차 4단계 (와이어프레임 parking-step-1..4 [직각 예시]).
 *
 * 프레임 이름의 "[주차형태 조건부]"가 말하듯 주차형태에 따라 달라져야 하는데, 와이어프레임에는
 * 직각 예시만 그려져 있다. 평행주차 절차는 여기서 지어내지 않는다 — 초보에게 잘못된 순서를
 * 알려주면 안 그리느니만 못하다. 확인된 평행 구획이면 단계 대신 그 사실만 밝힌다 (아래 Steps).
 */
const STEPS = [
  { n: 1, src: "/parking/step1.png", lines: ["옆 차와", "1.5m 띄우기"] },
  { n: 2, src: "/parking/step2.png", lines: ["뒷바퀴가 선에", "닿을 때 꺾기"] },
  { n: 3, src: "/parking/step3.png", lines: ["사이드미러로", "양 옆 확인"] },
  { n: 4, src: "/parking/step4.png", lines: ["차를 곧게 맞추고", "천천히 후진"] },
];

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function ParkingDetailPage() {
  return (
    <Suspense>
      <ParkingDetail />
    </Suspense>
  );
}

function ParkingDetail() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const name = searchParams.get("name") ?? "주차장";
  const at = coord(searchParams.get("lat"), searchParams.get("lng"));
  const dest = coord(searchParams.get("destLat"), searchParams.get("destLng"));

  /*
   * 좌표가 정확히 같은 행을 찾는다. 이름으로 찾지 않는 이유 — 원본에 이름도 좌표도 똑같은 행이
   * 15쌍 있고("이도이동 1053" 3면/2면), 이름만 겹치는 곳은 더 많다.
   * 좌표는 detailQuery 가 이 데이터에서 그대로 실어 보낸 값이라 부동소수 비교가 어긋나지 않는다.
   */
  const lot = at ? LOTS.find((l) => l.at[0] === at[0] && l.at[1] === at[1]) : undefined;
  const kind = lot ? parkingKind(lot) : null;
  const walkM = at && dest ? Math.round(meters(dest, at)) : null;

  return (
    <div className="flex flex-1 flex-col bg-white">
      <StatusBar tone="text-[#525252]" />

      {/* AppBar/Back — 44px 터치 영역 + 24px 화살표 (공통 앱바 규격) */}
      <div className="mx-4 flex h-14 shrink-0 items-center gap-3">
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
        <h1 className="min-w-0 truncate text-[18px] leading-[26px] font-bold text-[#1f1f1f]">{name}</h1>
      </div>

      {/*
        와이어프레임은 여기(top:88)에 "주차장 전경 사진 자리" 점선 상자를 둔다 — 사진이 없는 자리다.
        빈 테두리를 그대로 옮기면 화면이 고장 난 것처럼 보여서 뺐다 (/destination 의 빈 카드와 같은 이유).
        ponytail: 전경 사진이 생기면 여기 358x104 자리에 되살린다.
      */}

      {/* parking-info-card — 라벨은 왼쪽, 값은 오른쪽 */}
      <dl className="mx-4 mt-2 shrink-0 rounded-[12px] border border-[#e5e5e5] bg-[#ffece1] px-[13px] py-[11px]">
        <Row label="요금" value={lot ? feeText(lot) : "요금 정보 없음"} />
        <Row
          label="규모"
          value={lot?.spaces != null ? `총 ${lot.spaces}면 · 공영` : lot ? "공영" : "카카오맵에서 찾은 곳"}
        />
        {walkM !== null && <Row label="목적지까지" value={`걸어서 ${walkMinutes(walkM)}분`} />}
        {/*
          와이어프레임의 "운영 시간 06:00 ~ 20:00" 줄은 뺐다. 원본 CSV 1,657곳이 전부
          00:00~23:59 인데 유료 117곳도 그렇다 — 운영시간이 아니라 미입력 기본값이라
          화면에 적을 수 있는 사실이 아니다 (app/parking/page.tsx 첫 주석과 같은 판단).
        */}
      </dl>

      {lot && feeDetail(lot) && <p className="mx-4 mt-2 shrink-0 text-[12px] text-[#9e9e9e]">{feeDetail(lot)}</p>}

      <Steps kind={kind} />

      <div className="h-8 shrink-0" />
    </div>
  );
}

/** "33.4996" 같은 쿼리 두 개를 좌표로. 숫자가 아니면 없는 셈 친다 — URL 은 손으로 고칠 수 있는 입력이다. */
function coord(lat: string | null, lng: string | null): [number, number] | null {
  const la = Number(lat);
  const ln = Number(lng);
  return lat && lng && Number.isFinite(la) && Number.isFinite(ln) ? [la, ln] : null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[5px]">
      <dt className="shrink-0 text-[12px] leading-[18px] text-[#525252]">{label}</dt>
      <dd className="truncate text-[14px] leading-[22px] font-medium text-[#1f1f1f]">{value}</dd>
    </div>
  );
}

/**
 * 주차 방법. 직각일 때만 4단계를 편다.
 *
 * 세 갈래다 — 확인된 평행이면 단계 대신 그 사실만 알리고, 형태를 아예 모르면(카카오) 아무 말도 안 한다.
 * "모르면 침묵"은 이 프로젝트가 데이터 없는 자리에서 쓰는 규칙이다 (lib/parking.ts parkingKind).
 */
function Steps({ kind }: { kind: { parallel: boolean; confirmed: boolean } | null }) {
  if (!kind) return null;

  if (kind.parallel && kind.confirmed) {
    return (
      <p className="mx-4 mt-6 shrink-0 rounded-[12px] bg-[#f7f7f7] p-4 text-[13px] leading-relaxed text-[#525252]">
        연석 옆에 칸을 그린 <b className="font-bold text-[#1f1f1f]">평행주차</b> 구획입니다. 아래 직각주차 순서와 대는
        방법이 달라 안내를 띄우지 않았습니다.
      </p>
    );
  }

  return (
    <>
      <h2 className="mx-4 mt-6 shrink-0 text-[14px] leading-[22px] font-medium text-[#fc7f35]">
        직각 주차, 이렇게 하세요
      </h2>
      <div className="mx-4 mt-3 grid shrink-0 grid-cols-2 gap-4">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-[12px] border border-[#e5e5e5] bg-white p-[7px]">
            <div className="relative">
              <img src={s.src} alt="" className="h-[82px] w-full rounded-[8px] object-cover" />
              {/* 번호는 그림 위 왼쪽에 얹는다 (와이어프레임 step-number 28px 원) */}
              <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-[#1f1f1f] text-[11px] leading-4 font-medium text-white">
                {s.n}
              </span>
            </div>
            <p className="mt-2 pb-1 text-center text-[12px] leading-[18px] text-[#1f1f1f]">
              {s.lines[0]}
              <br />
              {s.lines[1]}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
