// 목적지 주차장 — 초보 운전자가 가장 어려워하는 평행주차를 피할 수 있게 돕는다.
//
// 데이터에는 구획이 평행식인지 직각식인지 알려주는 컬럼이 없다. `주차장유형`을 프록시로 쓴다:
//   노상 = 도로 노면에 그린 구획  → 연석 옆 평행주차일 확률이 높다
//   노외 = 도로 밖 전용 부지·주차빌딩 → 직각(수직)주차일 확률이 높다
// 확정이 아니라 확률이다. 그래서 문구도 단정하지 않고, 출처에 프록시임을 명시한다.
// 생성 과정과 프록시 근거는 scripts/build-parking-data.mjs 주석에 있다.

// 데이터(data/parking-data.json) 자체는 화면 쪽이 물린다 (app/route/actions.ts · app/parking).
// 여기는 판정 로직만 둬서 번들러 없이도 검증이 돌아간다 —
// node --experimental-strip-types lib/parking.check.ts

/** 유료 주차장 요금 (data/parking-data.json). 무료면 통째로 없다. */
export type Rate = {
  baseMin: number | null;
  baseWon: number | null;
  addMin: number | null;
  addWon: number | null;
  dayWon: number | null;
};

export type ParkingSpot = {
  name: string;
  /**
   * 공공데이터에 없는 곳은 카카오에서 온다 (lib/poi.ts).
   *
   * 공공데이터 1,657곳은 전부 `주차장구분: 공영`이라 관광지·호텔의 부설주차장이 통째로 빠져 있다
   * — 성산일출봉 반경 1km 에 잡히는 게 1곳뿐인 이유다. 초보 관광객이 쓰는 앱에서 하필
   * 관광지가 가장 부실하다.
   *
   * 대신 카카오 쪽은 유형·구획수·요금을 모른다. 없는 값을 채우지 않고 없는 채로 둔다.
   */
  source?: "카카오";
  /**
   * "제주시 이도이동" — 이름 대신 위치를 알려주는 줄.
   * name 1,657곳 중 1,514곳(91%)이 이름이 아니라 번지·도로명 그 자체라서 따로 둔다.
   */
  addr: string | null;
  type: string; // "노상" | "노외"
  /**
   * 위성사진으로 사람이 확인한 주차 형태 (data/parking-tags.json).
   * true = 평행, false = 직각. 없으면 아직 아무도 안 본 곳이라 아래 type 프록시로 추정한다.
   */
  parallel?: boolean;
  spaces: number | null;
  fee: string | null;
  rate?: Rate; // 유료·혼합만 있다
  walkM: number;
  at: [number, number]; // [위도, 경도] — 카드 안 미니 지도에 찍는다
};

export type Parking = {
  label: string;
  at: [number, number]; // 목적지 좌표 (미니 지도 중심)
  walkM: number;
  total: number;
  byType: Record<string, number>;
  spots: ParkingSpot[];
};

export type ParallelOdds = {
  level: "high" | "mixed" | "low";
  onStreet: number;
  offStreet: number;
  headline: string;
  detail: string;
};

/** 좌표째로 굳혀둔 주차장 한 곳 (data/parking-data.json). 거리는 런타임에 붙인다. */
export type Lot = Omit<ParkingSpot, "walkM">;

/** 카드 목록·미니 지도에 찍을 최대 개수. 판정은 전체 개수로 하고 표시만 자른다. */
const SPOT_CAP = 40;

/** 도보 10분. 아래 walkMinutes 와 같은 속도로 잰다 — 칩과 표시가 어긋나면 안 된다. */
export const WALK10_M = 670;

/**
 * 칩을 안 켰을 때의 상한 (도보 30분).
 *
 * 처음엔 반경 없이 개수로만 잘랐다 — 한적한 곳에서 핀이 하나도 안 뜨는 게 싫어서였는데,
 * 실제로 열어보니 성산일출봉에서 10km 밖 세화리 주차장이 "도보 160분"으로 목록에 올라왔다.
 * 걸어갈 수 없는 곳을 주차장이라고 내미는 게 빈 목록보다 나쁘다. 빈 경우는 화면이 말로 알린다.
 */
export const REACH_M = 2000;

const rad = (d: number) => (d * Math.PI) / 180;

/** 두 좌표 사이 미터. 제주 크기에선 평면 근사로 충분하다 (빌드 스크립트와 같은 식). */
export const meters = (
  [la1, lo1]: [number, number],
  [la2, lo2]: [number, number],
): number =>
  Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(rad(la1))) * rad(1) * 6371000;

/**
 * 목적지 주변 주차장. 임의 목적지를 받으므로 목적지별로 미리 잘라둘 수가 없다 —
 * 전체 1,572곳(약 150KB)을 굳혀두고 여기서 거른다. 1,572번 거리 계산은 1ms도 안 걸린다.
 *
 * 판정(parallelOdds)은 반경 안 **전체 개수**로 한다. spots 를 자르는 건 표시 몫이라서다 —
 * 제주시청처럼 1km 안에 177곳(노상 135)인 목적지에서 지도를 다 찍으면 읽을 수 없다.
 *
 * 도보 거리는 저장된 좌표(소수 6자리)에서 잰다. 예전에는 빌드 스크립트가 CSV 원본
 * 정밀도로 재서 굳혀뒀는데, 그 값과 최대 1m 어긋난다 (26곳 중 1곳이 104m→103m).
 * 목록 순서와 총계는 그대로다. 계산하는 곳이 여기 하나뿐이니 앞으로 갈라질 일은 없다.
 */
export function nearbyParking(
  label: string,
  at: [number, number],
  lots: Lot[],
  walkM: number,
): Parking | null {
  const near: ParkingSpot[] = [];
  for (const lot of lots) {
    const d = Math.round(meters(at, lot.at));
    if (d <= walkM) near.push({ ...lot, walkM: d });
  }
  if (!near.length) return null;

  near.sort((a, b) => a.walkM - b.walkM);
  return {
    label,
    at,
    walkM,
    total: near.length,
    byType: near.reduce<Record<string, number>>(
      (o, s) => ({ ...o, [s.type]: (o[s.type] ?? 0) + 1 }),
      {},
    ),
    spots: near.slice(0, SPOT_CAP),
  };
}

/**
 * 목적지 주변 주차장 구성 → 평행주차를 만날 확률 판정.
 *
 * **초보에게만 쓴다.** 평행주차가 어려운 건 경력의 문제라, 경력자에게는 노상이든 노외든
 * 차이가 없다. 같은 판정을 말투만 낮춰 되풀이하면 안 볼 경고를 하나 더 얹는 것이고,
 * 프록시(주차장유형)로 추정한 값을 굳이 한 번 더 단언하는 셈이다.
 * 경력자에게는 판정 없이 주차장 자체만 보여준다 (nearestSpots).
 *
 * 판정 기준은 개수 비율이다. 도착해서 한 곳이 만차면 옆으로 옮기게 되므로,
 * "가장 가까운 한 곳"이 아니라 "주변에 뭐가 깔려 있나"가 실제로 겪는 확률에 가깝다.
 *
 * 차폭은 여기 쓰지 않는다. 평행주차 난이도는 전폭보다 전장에 민감하고, 데이터에 구획
 * 크기가 없어 주차장별로 달라지지 않는다 (연결하려면 주차장법 시행규칙 제3조 구획
 * 규격을 먼저 확보해야 한다).
 *
 * 화면 문구에 "노상·노외"를 쓰지 않는다 — 주차장법 제2조 법령 용어라 일반 운전자는
 * 안 쓰는 말이다. 데이터 값과 출처 표기에는 원본 그대로 남긴다.
 */
export function parallelOdds(p: Parking): ParallelOdds {
  const onStreet = p.byType["노상"] ?? 0;
  const offStreet = p.total - onStreet;
  const pct = Math.round((100 * onStreet) / p.total);
  const 규모 = `${p.label} 도보 ${p.walkM}m 안 주차장 ${p.total}곳`;

  if (onStreet === 0)
    return {
      level: "low",
      onStreet,
      offStreet,
      headline: "평행주차를 만날 일이 거의 없습니다",
      detail: `${규모}이 모두 도로 밖에 따로 만든 주차장입니다. 칸에 맞춰 대는 직각주차일 확률이 높습니다.`,
    };

  if (pct >= 50)
    return {
      level: "high",
      onStreet,
      offStreet,
      headline: "평행주차를 만날 확률이 높습니다",
      detail:
        `${규모} 중 ${onStreet}곳(${pct}%)이 도로변에 칸을 그린 주차장입니다. 연석 옆 평행주차일 확률이 높습니다.` +
        (offStreet
          ? ` 평행주차가 부담되면 도로 밖 주차장 ${offStreet}곳을 먼저 보세요.`
          : ""),
    };

  return {
    level: "mixed",
    onStreet,
    offStreet,
    headline: "평행주차 구간이 일부 섞여 있습니다",
    detail:
      `${규모} 중 ${onStreet}곳(${pct}%)이 도로변에 칸을 그린 주차장입니다.` +
      " 아래 주차장으로 바로 가면 평행주차를 피할 수 있습니다.",
  };
}

/** 초보에게 권할 주차장 — 도로 밖(직각 확률) 중 가까운 순. 없으면 빈 배열. */
export function recommendedSpots(p: Parking, n = 3): ParkingSpot[] {
  return p.spots.filter((s) => s.type !== "노상").slice(0, n);
}

/**
 * 경력자에게 보여줄 주차장 — 유형을 안 가리고 가까운 순.
 * 평행/직각을 구분해 줄 이유가 없으니 걸러내지도 않는다. 가까운 게 곧 좋은 것이다.
 */
export function nearestSpots(p: Parking, n = 5): ParkingSpot[] {
  return p.spots.slice(0, n);
}

// --- 주차장 찾기 화면(/parking) ---
// 목적지 흐름(nearbyParking)과 달리 목적지가 없다. 지도를 움직이는 대로 중심이 바뀌므로
// "반경 안 전부"가 아니라 "지금 보는 곳에서 가까운 몇 곳"을 준다.

/** 도보 4km/h = 67m/분. 100m 를 1.5분으로 읽는 흔한 기준이다. 0분은 안 쓴다. */
export const walkMinutes = (m: number): number =>
  Math.max(1, Math.round(m / 67));

/** 주차 형태 판정. confirmed 면 위성으로 사람이 본 값이고, 아니면 주차장유형으로 추정한 값이다. */
export type ParkingKind = { parallel: boolean; confirmed: boolean };

/**
 * 이 주차장이 평행인가 직각인가.
 *
 * 태깅된 곳(data/parking-tags.json)이 먼저다 — 위성으로 구획을 직접 본 값이라, 도로변이면
 * 평행일 것이라는 간접 추론보다 언제나 낫다. 태그가 없으면 그 추론(프록시)으로 떨어진다.
 *
 * 유형도 태그도 없으면 null 이다. 카카오에서 온 주차장이 그렇다 — 모르면 아무 말도 안 한다.
 * "노상이 아니면 직각"으로 쓰면 모르는 곳까지 전부 직각이라고 단언하게 된다.
 */
export function parkingKind(s: {
  type: string;
  parallel?: boolean;
}): ParkingKind | null {
  if (typeof s.parallel === "boolean")
    return { parallel: s.parallel, confirmed: true };
  if (s.type === "노외") return { parallel: false, confirmed: false };
  if (s.type === "노상") return { parallel: true, confirmed: false };
  return null;
}

/** 공개 데이터에 도로변(노상) 주차장이 한 곳도 없는 지역. 주소 앞머리로 가른다. */
const NO_ONSTREET = "서귀포시";

/**
 * 지금 보고 있는 목록에서 "평행주차" 판정이 구조적으로 못 나오는가.
 *
 * 서귀포시 몫 113곳은 **전부 노외**다 (제주시는 노외 901 + 노상 643). 노상이 0곳이라
 * 여기서는 프록시가 언제나 "직각"만 답하고, 화면에는 `주차 쉬움`만 줄줄이 붙는다.
 * 판정이 틀린 건 아니다 — 그 113곳은 진짜 노외다. 틀린 건 **빠진 쪽**이다:
 * 서귀포에 실제로 있는 도로변 주차장이 데이터에 없어서 앱에도 안 나온다.
 *
 * 그래서 판정을 지우지 않고 한계를 말한다. 맞는 정보까지 지우면 초보가 쓸 수 있는 게 없어진다.
 * 카카오에서 온 곳(source)은 애초에 유형을 모르니 이 판단에서 뺀다.
 */
export function onStreetBlind(
  spots: { addr: string | null; source?: string }[],
): boolean {
  const 공공 = spots.filter((s) => !s.source);
  return 공공.length > 0 && 공공.every((s) => s.addr?.startsWith(NO_ONSTREET));
}

/** 카카오 링크에 실을 한 점. 이름은 화면에 뜨는 라벨일 뿐이고 길을 정하는 건 좌표다. */
export type NaviPoint = { name: string; at: [number, number] };

/** 카카오 링크가 받는 경유지 개수 상한 */
const VIA_MAX = 5;

/**
 * 링크 주소만 만든다. navigateTo 에서 떼어낸 이유는 window 없이 확인하기 위해서다 —
 * 이름 인코딩과 경유지 순서는 눈으로 봐서는 틀린 걸 못 잡는다 (lib/parking.check.ts).
 */
export function naviLink(
  dest: NaviPoint,
  opts: { from?: NaviPoint; via?: NaviPoint | NaviPoint[] } = {},
): string {
  const p = ({ name, at }: NaviPoint) =>
    `${encodeURIComponent(name)},${at[0]},${at[1]}`;
  const { from } = opts;
  // 경유지는 여러 개 받는다 — 길 비교(app/route)는 한 점이면 되지만 여행 코스(app/trip/course)는
  // 하루에 들르는 곳을 전부 넘긴다. 카카오 상한이 5개라 넘치면 앞에서 자른다.
  const via = opts.via ? (Array.isArray(opts.via) ? opts.via : [opts.via]).slice(0, VIA_MAX) : [];

  const path =
    from && via.length
      ? `by/car/${p(from)}/${via.map(p).join("/")}/${p(dest)}`
      : from
        ? `from/${p(from)}/to/${p(dest)}`
        : `to/${p(dest)}`;

  return `https://map.kakao.com/link/${path}`;
}

/**
 * 카카오맵 길찾기로 넘긴다. 길을 정하고 나서 실제로 "가는" 길은 이거 하나다.
 *
 * 이 앱에 턴바이턴 안내를 만들 이유가 없다 — 초보 운전자도 내비는 이미 쓰던 걸 쓴다.
 * 여기가 답하는 질문은 "어느 주차장이냐 · 어느 길이냐"까지고, 거기서 끊는 게 맞다.
 *
 * **형식이 셋이고 실을 수 있는 게 다르다.** 예전에는 `/link/to/` 만 써서 도착지만 넘겼는데,
 * 그러면 카카오가 출발지도 경로도 자기 기준으로 다시 잡는다 — 부담 36점 길을 골라 놓고
 * 68점 길로 안내되는 것이다. 그러면 앞의 두 화면이 한 탭에 무의미해진다.
 *
 *   /link/to/{도착}                     도착지만
 *   /link/from/{출발}/to/{도착}          출발지까지
 *   /link/by/car/{출발}/{경유...}/{도착}  경유지까지 (최대 5개)
 *
 * 실측으로 확인했다 (제주공항→서귀포시청): 경유지 없이 52.5km 평화로, 516로 위에 경유지를
 * 하나 찍으면 43.5km 516로로 바뀐다. 라벨은 지어낸 문자열이어도 되고 좌표가 경로를 정한다.
 *
 * **앱 스킴(kakaomap://)은 안 쓴다.** 경유지가 웹 링크로 되므로 앱 설치 여부·데스크톱 여부를
 * 가릴 필요가 없다 — 노트북 브라우저에서도 그대로 먹는다.
 *
 * 이름에 쉼표가 든 곳이 있어("함덕리 1002-83, 1004-5, 6") 반드시 인코딩해야 한다 —
 * 카카오 링크가 쉼표로 이름·위도·경도를 가르기 때문에 안 하면 좌표가 밀린다.
 */
export function navigateTo(
  dest: NaviPoint,
  opts: { from?: NaviPoint; via?: NaviPoint | NaviPoint[] } = {},
) {
  const url = naviLink(dest, opts);
  /*
   * **반환값을 봐야 한다.** 팝업이 막히면 window.open 은 던지지 않고 조용히 null 을 준다 —
   * 버튼을 눌렀는데 화면에 아무 일도 안 일어나고 콘솔에도 아무것도 안 남는다.
   * 이 앱의 마지막 버튼 둘("이 길로 갈게요" · "이 코스로 여행하기")이 그 상태가 된다.
   * 막혔으면 같은 탭에서 연다 — 돌아오는 길은 브라우저 뒤로가기가 맡는다.
   *
   * **기능 문자열에 noopener 를 못 쓴다.** 그걸 주면 명세상 창이 정상으로 열려도 null 이 와서,
   * 막힌 것과 열린 것을 가릴 수가 없다 — 그렇게 뒀더니 새 탭이 열리면서 이 탭까지 카카오맵으로
   * 넘어갔다. 대신 열고 나서 opener 를 끊는다. 새 창이 window.opener 로 이 페이지를 건드리는 걸
   * 막는 목적은 그대로 이루면서, 열렸는지는 반환값으로 알 수 있다.
   */
  const opened = window.open(url, "_blank");
  if (!opened) {
    location.href = url;
    return null;
  }
  opened.opener = null;
  return opened;
}

/** 초보가 편한 쪽(직각)인가. 배지 하나를 붙일지 말지에만 쓴다. */
export const isEasyParking = (s: {
  type: string;
  parallel?: boolean;
}): boolean => parkingKind(s)?.parallel === false;

/** 1000 → "1,000". toLocaleString 은 실행 환경 로케일을 타서 검증과 화면이 갈릴 수 있다. */
const won = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * 요금 한 줄. "유료" 한 단어로는 갈 곳을 정할 수 없어서 원본의 기본요금까지 편다
 * (유료 117곳 중 116곳이 30분 1,000원이다).
 * 혼합은 구역에 따라 갈리는 곳이라 값을 단정하지 않고 "일부 유료"를 앞에 붙인다.
 */
export function feeText(s: { fee: string | null; rate?: Rate }): string {
  if (s.fee === "무료") return "무료";
  const base =
    s.rate?.baseMin && s.rate?.baseWon
      ? `${s.rate.baseMin}분 ${won(s.rate.baseWon)}원`
      : null;
  if (!base) return s.fee ?? "요금 정보 없음";
  return s.fee === "혼합" ? `일부 유료 · ${base}` : base;
}

/** 기본요금 뒤에 붙는 나머지. 무료면 null 이라 줄이 통째로 빠진다. */
export function feeDetail(s: { rate?: Rate }): string | null {
  const r = s.rate;
  if (!r) return null;
  const bits = [];
  if (r.addMin && r.addWon)
    bits.push(`이후 ${r.addMin}분마다 ${won(r.addWon)}원`);
  if (r.dayWon) bits.push(`1일권 ${won(r.dayWon)}원`);
  return bits.join(" · ") || null;
}

/** 지도 화면의 필터 칩. 24시간은 칩이 아니다 — 데이터의 1,657곳이 전부 00:00~23:59라 안 걸러진다. */
export type SpotFilter = { walk10?: boolean; free?: boolean };

/**
 * 굳혀둔 공공데이터에 카카오에서 받은 곳을 얹는다.
 *
 * 같은 주차장이 양쪽에 다 있으면 공공 쪽을 남긴다 — 구획수·요금·유형이 붙어 있어 화면에서
 * 할 말이 더 많다.
 *
 * 같은 곳인지는 두 가지로 본다:
 *   ① 좌표가 gapM 안 — 이름은 한쪽이 "이도일동 1307", 다른 쪽이 "제주시청 공영주차장" 식으로
 *      아예 다르게 적혀 있어 이름만으로는 맞출 수가 없다.
 *   ② 이름이 똑같고 NAME_GAP_M 안 — 큰 주차장은 좌표를 입구에 찍었는지 한가운데에 찍었는지에
 *      따라 30m 를 훌쩍 넘게 벌어진다. 성산일출봉 주차장(285면)이 양쪽에 같은 이름으로
 *      들어 있는데도 ①만으로는 안 걸려서 목록에 두 번 올라왔다.
 *
 * @param gapM 이 거리 안이면 같은 주차장으로 본다. 30m — 주차장 한 필지 폭 정도라,
 *        좌표 차이는 흡수하면서 옆 주차장까지 삼키진 않는다.
 */
const NAME_GAP_M = 300;

/**
 * 이름이 사실은 주소인가. 공공데이터 1,657곳 중 1,514곳(91%)이 "함덕리 1002-83, 1004-5, 6"
 * 처럼 번지·도로명 그대로다 — 숫자가 들어 있으면 그렇게 본다.
 * "동문공설시장주차빌딩" 같은 진짜 이름 143곳은 숫자가 없어서 걸리지 않는다.
 */
const looksLikeAddress = (name: string) => /\d/.test(name);

export function mergeSpots(
  base: ParkingSpot[],
  extra: ParkingSpot[],
  gapM = 30,
): ParkingSpot[] {
  const same = (b: ParkingSpot, e: ParkingSpot) => {
    const d = meters(b.at, e.at);
    return d <= gapM || (b.name === e.name && d <= NAME_GAP_M);
  };

  // 겹치는 카카오 항목은 버리되 **이름만은 빌려온다.**
  // 공공 쪽 "함덕리 1002-83, 1004-5, 6"은 사람이 부르는 이름이 아니라 번지고,
  // 같은 자리를 카카오는 "조천읍무료노외공영주차장"이라고 부른다. 면수·요금·주차형태는
  // 공공만 아는 사실이라 그대로 두고, 이름표만 읽을 수 있는 쪽으로 바꾸는 것이다.
  const merged = base.map((b) => {
    if (!looksLikeAddress(b.name)) return b; // 진짜 이름이 있으면 그게 낫다
    const twin = extra
      .filter((e) => same(b, e))
      .sort((x, y) => meters(b.at, x.at) - meters(b.at, y.at))[0];
    return twin ? { ...b, name: twin.name } : b;
  });

  const fresh = extra.filter((e) => !base.some((b) => same(b, e)));
  return [...merged, ...fresh].sort((a, b) => a.walkM - b.walkM);
}

/**
 * 지도 중심에서 가까운 주차장 cap 곳. 걸어갈 수 있는 거리(REACH_M) 안에서만 고르고,
 * "도보 10분" 칩을 켜면 그때는 WALK10_M 이 기준이 된다.
 */
export function spotsAround(
  center: [number, number],
  lots: Lot[],
  filter: SpotFilter = {},
  cap = SPOT_CAP,
): ParkingSpot[] {
  const limit = filter.walk10 ? WALK10_M : REACH_M;
  const near: ParkingSpot[] = [];
  for (const lot of lots) {
    if (filter.free && lot.fee !== "무료") continue; // "혼합"은 무료가 아니다 — 돈을 낼 수도 있으면 무료로 보여주면 안 된다
    const walkM = Math.round(meters(center, lot.at));
    if (walkM > limit) continue;
    near.push({ ...lot, walkM });
  }
  return near.sort((a, b) => a.walkM - b.walkM).slice(0, cap);
}
