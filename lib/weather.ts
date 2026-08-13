// 실시간 날씨 — 화면 상단 칩("지금 제주 18° 흐림 · 강풍 없음") 한 줄에만 쓴다.
//
// Open-Meteo. 키 없음·가입 없음이고, 한국 지점은 기상청 관측/모델값을 받아 서비스한다.
// 기상청 공공데이터포털(초단기실황)을 직접 쓰지 않은 이유: 키 발급 + 위경도→격자(nx,ny)
// 변환 + 항목코드(T1H/SKY/WSD) 파싱이 붙는데, 칩 한 줄이 얻는 값은 같다.
// 무료 한도는 비상업 하루 1만 호출 — revalidate 10분이면 지점당 하루 144회다.
//
// 부담점수에는 넣지 않는다. lib/traffic.ts 와 같은 이유 — 같은 프로필로 두 번 열었을 때
// 점수가 달라지면 근거 카드가 무너진다. 날씨는 표시로만 쓴다.
//
// 실패해도 throw 하지 않는다 — 날씨 API가 죽었다고 지도가 안 뜨면 안 된다.

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** 관측 갱신 주기가 15분이라 그보다 자주 받을 이유가 없다. 호출 수도 같이 준다. */
const REVALIDATE_S = 600;

const TIMEOUT_MS = 4000;

/**
 * 강풍 판정 (10m 풍속, m/s). 기상청 강풍주의보 기준 = 풍속 14 이상 또는 순간풍속 20 이상.
 * 그 아래에 하나를 더 둔 건 제주 해안도로 때문이다 — 주의보에 한참 못 미치는 9m/s에서도
 * 옆바람에 차가 밀리고, 초보에게는 그게 진짜 부담이다. 주의보 기준만 쓰면 이 구간이
 * 전부 "강풍 없음"으로 나온다.
 */
const GALE = { wind: 14, gust: 20 };
const BREEZY = 9;

export type Weather = {
  tempC: number;
  /** 하늘 상태 한 단어 — "맑음" · "흐림" · "비" 등 */
  sky: string;
  windMs: number;
  /** 칩 뒷부분 — "강풍 없음" · "바람 강함" · "강풍 주의" */
  wind: string;
  /** 관측 시각 (Asia/Seoul). 실시간이라 적으려면 언제 값인지도 적어야 한다. */
  at: string;
};

/**
 * WMO 코드 → 한 단어. 경계값(코드 자체)으로 표를 만든다: 코드 c 는 자기보다 크지 않은
 * 마지막 경계의 이름을 쓴다. 28개를 다 적는 대신 8줄이고, 새 코드가 생겨도 근처 이름으로 흐른다.
 */
const SKY: [number, string][] = [
  [0, "맑음"],
  [2, "구름많음"],
  [3, "흐림"],
  [45, "안개"],
  [51, "이슬비"],
  [61, "비"],
  [71, "눈"],
  [80, "소나기"],
  [85, "눈소나기"],
  [95, "뇌우"],
];

export function skyOf(code: number): string {
  let name = SKY[0][1];
  for (const [c, n] of SKY) {
    if (code < c) break;
    name = n;
  }
  return name;
}

export function windOf(windMs: number, gustMs: number): string {
  if (windMs >= GALE.wind || gustMs >= GALE.gust) return "강풍 주의";
  if (windMs >= BREEZY) return "바람 강함";
  return "강풍 없음";
}

/** 지금 날씨. 실패하면 null — 호출한 쪽은 칩을 그냥 안 그린다. */
export async function weatherAt(lat: number, lng: number): Promise<Weather | null> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m",
    wind_speed_unit: "ms", // 기본이 km/h 다. 강풍 기준(기상청)이 m/s 라 여기서 맞춰 받는다
    timezone: "Asia/Seoul",
  });

  try {
    const res = await fetch(`${ENDPOINT}?${q}`, {
      next: { revalidate: REVALIDATE_S },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const c = (await res.json()).current;
    if (c?.temperature_2m == null) return null;

    const windMs = Math.round(c.wind_speed_10m);
    return {
      tempC: Math.round(c.temperature_2m),
      sky: skyOf(c.weather_code),
      windMs,
      wind: windOf(windMs, c.wind_gusts_10m ?? 0),
      // current.time 은 "2026-08-12T14:00" — 이미 Asia/Seoul 이라 뒤 5글자가 곧 표시할 시각이다
      at: String(c.time).slice(11, 16),
    };
  } catch {
    return null;
  }
}
