// 주차장 상세 — 최종 와이어프레임 PARK-02 | 주차장 상세 · P2 (Figma 2153:3136).
// 목적지 흐름의 마지막 화면이다: 목록(PARK-01) → 확인 모달(PARK-01-a) → 여기.
//
// 주차장은 좌표로 가리켜 받는다 (app/parking/page.tsx detailQuery). 그 좌표로 공공데이터에서
// 원본을 되찾아 요금·규모·주차형태를 꺼내고, 못 찾으면(카카오 POI) 이름·주소만 쓴다 —
// 카카오 쪽은 유형·구획수·요금을 모르므로 없는 값을 지어내지 않는다 (lib/parking.ts 주석).
//
// **서버 컴포넌트다.** 이 화면이 데이터에서 꺼내는 건 1,572곳 중 딱 한 줄인데, 클라이언트였을
// 때는 그 한 줄을 찾자고 parking-data.json 전체(224KB, gzip 30KB)를 폰으로 내려보냈다.
// 여기서 찾아 결과만 넘기면 번들에서 통째로 빠진다. 대신 쿼리를 서버에서 읽으므로 이 라우트는
// 정적 프리렌더가 아니라 요청마다 렌더된다 — 1,572개 스캔이라 그 비용은 없는 셈이다.

import StatusBar from "../../StatusBar";
import BackButton from "./BackButton";
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

export default async function ParkingDetailPage({ searchParams }: PageProps<"/parking/detail">) {
  const sp = await searchParams;

  const name = one(sp.name) ?? "주차장";
  const at = coord(one(sp.lat), one(sp.lng));
  const dest = coord(one(sp.destLat), one(sp.destLng));

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
        <BackButton />
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

/** 서버의 searchParams 는 `?lat=1&lat=2` 면 배열로 온다. 손으로 고친 URL 이니 첫 값만 본다. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** "33.4996" 같은 쿼리 두 개를 좌표로. 숫자가 아니면 없는 셈 친다 — URL 은 손으로 고칠 수 있는 입력이다. */
function coord(lat: string | undefined, lng: string | undefined): [number, number] | null {
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

  // confirmed 를 따지지 않고 parallel 만 본다. 확인된 평행에만 이 갈래를 태우면 **추정 평행**
  // (노상 643곳)이 아래 직각 4단계로 떨어져서, 평행주차를 만날 사람에게 정반대 방법을 가르치게 된다.
  // 확실한지 아닌지는 단계를 보일지 말지가 아니라 문구의 세기로 말한다.
  if (kind.parallel) {
    return (
      <p className="mx-4 mt-6 shrink-0 rounded-[12px] bg-[#f7f7f7] p-4 text-[13px] leading-relaxed text-[#525252]">
        {kind.confirmed ? (
          <>
            위성사진으로 확인한 결과 연석 옆에 칸을 그린 <b className="font-bold text-[#1f1f1f]">평행주차</b> 구획입니다.
          </>
        ) : (
          <>
            도로 노면에 칸을 그린 주차장이라 연석 옆 <b className="font-bold text-[#1f1f1f]">평행주차</b>일 확률이 높습니다
            (공개 데이터로 추정한 값입니다).
          </>
        )}{" "}
        직각주차와 대는 방법이 달라 아래 순서 안내를 띄우지 않았습니다.
      </p>
    );
  }

  return (
    <>
      <h2 className="mx-4 mt-6 shrink-0 text-[14px] leading-[22px] font-medium text-[#fc7f35]">
        직각 주차, 이렇게 하세요
      </h2>
      {/* 목록·시트가 "확률이 높습니다"라고 말한 곳에서 상세만 단정하면 두 화면이 어긋난다 */}
      {!kind.confirmed && (
        <p className="mx-4 mt-1 shrink-0 text-[11px] leading-relaxed text-[#9e9e9e]">
          도로 밖에 따로 만든 주차장이라 직각주차일 확률이 높습니다. 공개 데이터로 추정한 값입니다.
        </p>
      )}
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
