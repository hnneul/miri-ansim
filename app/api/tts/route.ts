// 출발 전 음성 안내를 소리로 — 대본 한 칸을 받아 음성 파일로 돌려준다.
//
// 왜 서버 액션이 아니라 라우트 핸들러인가: 오디오는 <audio src="..."> 로 바로 물리는 게 싸다.
// 서버 액션으로 주려면 바이너리를 base64 로 실어야 해서 덩치가 4/3 로 불고, 브라우저 HTTP
// 캐시도 못 탄다. GET 한 줄이면 같은 칸을 두 번 재생할 때 아예 네트워크를 안 탄다.
//
// 실패는 전부 502 다. 부르는 쪽(app/route/RouteRadio.tsx)이 그때 브라우저 내장 음성으로
// 떨어지므로, 여기가 죽어도 안내가 사라지지는 않는다 — lib/ai.ts 가 규칙 문장으로 떨어지는 것과
// 같은 구조다. 소리가 안 나는 것보다 덜 좋은 소리로 나는 게 낫다.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { 대본_최대글자 } from "@/lib/ai";
import { 서명맞나 } from "@/lib/sign";

/**
 * 목소리. 후보 스물넷을 같은 대본으로 뽑아 듣고 고른 값이다
 * (기기 내장 · Edge 셋 · OpenAI 열넷 · MeloTTS 둘 · Gemini 셋).
 *
 * **한도 있는 후보는 전부 뺐다.** Gemini 의 Kore 가 억양이 가장 사람 같았지만 무료 등급이
 * 모델당 하루 10회다. 화면 한 번에 한 번씩 써도 스무 번이면 동나고, 그날은 목소리가 바뀐다.
 * 시연 도중에 소리가 달라지는 위험을 안고 가느니 **늘 같은 소리가 나는 쪽**을 골랐다.
 *
 * SunHi 는 마이크로소프트가 한국어로 학습시킨 음성이라 발음이 원어민이다. OpenAI 쪽은
 * 열넷을 다 들어봤지만 전부 영어 화자가 한국어를 읽는 소리라 후보가 못 됐다 —
 * instructions 로 말투는 바꿔도 발음 모델은 못 바꾼다.
 *
 * 대신 포기한 것도 분명하다: 문장 **안**에서 억양이 오르내리지 않는다. 그건 LLM 기반
 * 음성 모델(Gemini·OpenAI)만 하는 일이고, 재래식 뉴럴 음성에는 그 손잡이가 없다.
 * SSML 로 흉내내보려 했지만 무료 엔드포인트가 평문만 받는다 (아래 실측).
 */
const VOICE = "ko-KR-SunHiNeural";

/**
 * 문장 전체에 곱하는 값. 이게 이 엔드포인트에서 쓸 수 있는 **유일한** 조절이다.
 *
 * 실측(2026-08-16, SunHi 로 하나씩 시도):
 *   평문                    ✅
 *   <break time="400ms"/>   ❌ 스트림이 끊긴다
 *   <prosody> 구간 중첩      ❌
 *   <emphasis>              ❌
 *   <mstts:silence>         ❌
 *
 * 즉 쉼도 강조도 구간별 음높이도 못 넣는다. 기본 속도가 안내로 듣기엔 빨라서 조금만 늦춘다 —
 * 칸 사이 쉼은 SSML 대신 재생하는 쪽에서 준다 (app/route/RouteRadio.tsx).
 */
const PROSODY = { rate: "-8%" };

/** 넘기면 포기하고 내장 음성으로 보낸다. 실측 1.8~2.1초라 넉넉한 값이다. */
const TIMEOUT_MS = 12000;

/**
 * 대본 → 음성 캐시.
 *
 * Edge 는 한도가 없어서 캐시가 예산 문제는 아니지만, 같은 칸을 두 번 만들 이유가 없고
 * 재생이 즉시 시작되는 값어치가 크다. 브라우저 캐시(아래 Cache-Control)가 한 겹 더 받는다.
 */
const 캐시 = new Map<string, ArrayBuffer>();
const CACHE_MAX = 120;

/**
 * 아직 답을 기다리는 중인 칸. **캐시만으로는 안 막히는 낭비가 있다** —
 * 같은 칸을 동시에 두 번 부르면 둘 다 캐시에 없는 상태라 두 번 만든다.
 * 개발 모드에서 React 가 이펙트를 두 번 돌려 실제로 그랬다.
 */
const 진행중 = new Map<string, Promise<ArrayBuffer | null>>();

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const text = q.get("t")?.trim();

  /*
   * **서버가 만든 대본만 읽는다** (lib/sign.ts).
   *
   * 글자수 상한은 한 번의 크기를 막지 횟수를 못 막는다. Edge 를 쓰던 동안은 한도가 없어서
   * 그걸로 충분했지만, 값이 붙는 음성으로 바꾸면 이 주소가 남이 우리 돈으로 쓰는 창구가 된다.
   *
   * 틀리면 400 이라 부르는 쪽(RouteRadio)이 내장 음성으로 떨어진다 — 비밀키를 배포처에
   * 안 넣었을 때도 같은 길로 간다. 소리가 사라지지는 않는다.
   */
  if (text && !서명맞나(text, q.get("s"))) return new Response(null, { status: 400 });

  /*
   * 대본 한 칸만 받는다. 길이를 막는 건 형식 검사가 아니라 **키를 지키는 일**이다 —
   * 이 주소는 인증이 없어서 열어두면 아무 글이나 읽어주는 무료 TTS 가 된다.
   * 상한을 lib/ai.ts 에서 가져오므로 대본 규칙이 조여지면 여기도 같이 조여진다.
   */
  if (!text || text.length > 대본_최대글자) return new Response(null, { status: 400 });

  const 있던것 = 캐시.get(text);
  if (있던것) return 오디오(있던것);

  const buf = await (진행중.get(text) ?? 만들기(text));
  return buf ? 오디오(buf) : new Response(null, { status: 502 });
}

function 만들기(text: string): Promise<ArrayBuffer | null> {
  const 일 = (async () => {
    try {
      // 생성형 음성을 먼저 쓰고 안 되면 Edge 로 떨어진다. 둘 다 실패하면 null 이고
      // 그때는 화면이 내장 음성으로 간다 — 세 겹 중 어디서 끊겨도 소리는 난다.
      //
      // 어느 겹이 소리를 냈는지는 **들어서는 잘 안 갈린다** — 모델을 바꿔도 목소리 이름은
      // 그대로 Kore 라 3.1 인지 2.5 인지 귀로 못 가른다. 한 줄 찍어두면 터미널(배포는 로그)에
      // 그대로 나온다. 만드는 데 걸린 시간도 같이 찍는다 — 칸 사이가 벌어질 때 그게 생성
      // 지연 때문인지 아닌지가 이 숫자로 갈린다 (재생 쪽은 한 칸 앞을 미리 받는다).
      const 잰다 = Date.now();
      let buf = await gemini(text);
      const 낸곳 = buf ? GEMINI_MODEL : "edge";
      buf ??= await edge(text);
      console.log(`[tts] ${buf ? 낸곳 : "둘 다 실패"} ${Date.now() - 잰다}ms · ${text.length}자 · ${text}`);
      if (!buf) return null;
      // 오래된 것만 골라 버릴 값어치가 없다 — 통째로 비우고 다시 채운다 (lib/ai.ts 와 같다)
      if (캐시.size >= CACHE_MAX) 캐시.clear();
      캐시.set(text, buf);
      return buf;
    } finally {
      // 실패한 것도 지운다 — 남겨두면 그 칸은 다시 시도조차 못 한다
      진행중.delete(text);
    }
  })();

  진행중.set(text, 일);
  return 일;
}

/**
 * 말투를 글로 지시한다. **이게 재래식 음성에 없던 손잡이다** — 억양을 값으로 지정하는 게
 * 아니라 상황을 설명하면 모델이 문장 뜻을 읽고 어디서 힘을 줄지 스스로 정한다.
 *
 * 문구를 바꿀 때는 소리로 확인해야 한다. "차분하고 낮은 톤, 감정 기복 없이"로 바꿔봤더니
 * 톤은 고르게 나왔지만 라디오 진행자 맛이 통째로 사라졌다 — 일관성과 성격은 다른 값이다.
 *
 * 마지막 줄은 **칸마다 따로 부르기 때문에** 붙는다. 한 번에 한 칸만 주면 모델이 앞뒤를
 * 모른 채 매번 새로 톤을 정해서 칸마다 말투가 달라졌다. 앞 칸을 실제로 넘겨줄 수도 있지만
 * (그러면 주소·서명·캐시 키가 전부 두 칸짜리가 된다) 이 한 줄로 충분했다.
 */
const 지시 =
  "초보운전자에게 출발 직전에 길 안내를 해주는 상황이야. " +
  "라디오 진행자처럼 편안하고 친근하게, 문장마다 억양을 살려서, " +
  "문단 사이는 한 박자 쉬고 읽어줘. " +
  "이건 이어지는 안내의 한 대목이야. 같은 톤을 유지해줘.";

/**
 * `global` 에는 이 모델이 없다. 지역 엔드포인트를 써야 한다 —
 * 안 그러면 403 에 "or it may not exist" 가 붙어 와서 권한 문제로 읽히기 쉽다.
 */
const GEMINI_URL = "https://us-texttospeech.googleapis.com/v1/text:synthesize";
/**
 * 목소리는 `Kore` 로 따로 잡혀 있고(아래 voice.name) 이건 그걸 **어느 세대가 읽느냐**다.
 *
 * 값은 **소리 길이**로 매긴다. 글자가 아니라 오디오 출력 토큰이라, 대본을 짧게 쓰는 건
 * 값에 직결되지만(대본_최대글자 90) 지시 프롬프트 길이는 거의 무관하다 — 입력 단가가
 * 출력의 1/20 이다 (실측 2026-08-20, 콘솔 가격 책정: 출력 $20/1M · 입력 $1/1M).
 *
 * **2.5 로 내려봤다가 되돌렸다.** 출력 단가가 정확히 절반($10/1M)이라 공짜 이득처럼 보였는데,
 * **짧은 칸을 두세 번 읽는다.** 실측(같은 날, 브라우저 resource 항목의 바이트/글자):
 *   보통 칸(25~57자)   630~690 B/자
 *   "도착하면 엉또폭포예요."(12자)  2,080 B/자 ← 세 배
 * ⑤칸(도착지)과 ⑥칸(맺음말)은 원래 짧게 쓰라고 정해둔 자리라 이 증상을 정면으로 맞는다.
 * 반값이라도 안내가 두 번 읽히면 못 쓴다.
 *
 * 한때 주석에 "2.5-pro 로 내리면 된다(값이 같다)"고 적어뒀는데 그것도 틀렸다 — Pro 는 Flash 보다 비싸다.
 * 즉 이 모델에서 **내려갈 곳이 없다.** 프리뷰가 내려가면 값이든 품질이든 하나는 포기해야 한다.
 *
 * 캐시 키가 대본 텍스트뿐이라(아래 `캐시`) 모델을 바꿔도 같은 대본이면 예전 오디오가 그대로
 * 나온다. 두 세대를 귀로 견주려면 서버를 다시 띄우고 브라우저 캐시도 없는 창에서 들어야 한다.
 */
const GEMINI_MODEL = "gemini-3.1-flash-tts-preview";

/** 실측 칸 하나에 5~12초. Edge(1.8초) 보다 한참 길어서 따로 잡는다 */
const GEMINI_TIMEOUT_MS = 25000;

/** 액세스 토큰. 1시간짜리라 매 요청 발급하면 300ms 씩 그냥 버린다 */
let 토큰캐시: { 값: string; 만료: number } | null = null;

/** 배포에는 파일이 없다(.gitignore). 환경변수를 먼저 보고 없으면 로컬 파일을 본다 */
function 서비스계정(): { client_email: string; private_key: string } | null {
  try {
    const raw = process.env.GCP_TTS_KEY;
    if (raw) return JSON.parse(raw);
    return JSON.parse(readFileSync("gcp-tts.json", "utf8"));
  } catch {
    return null;
  }
}

async function 토큰(): Promise<string | null> {
  if (토큰캐시 && Date.now() < 토큰캐시.만료) return 토큰캐시.값;
  const key = 서비스계정();
  if (!key) return null;

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const 초 = Math.floor(Date.now() / 1000);
  const 본문 = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: 초,
    exp: 초 + 3600,
  })}`;

  try {
    const 서명 = createSign("RSA-SHA256").update(본문).end().sign(key.private_key, "base64url");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${본문}.${서명}`,
      }),
    });
    if (!r.ok) return null;
    const 값 = (await r.json()).access_token as string;
    // 만료 1분 전에 새로 받는다 — 딱 맞춰 쓰다가 경계에서 401 을 맞을 이유가 없다
    토큰캐시 = { 값, 만료: Date.now() + 59 * 60 * 1000 };
    return 값;
  } catch {
    return null;
  }
}

/**
 * Gemini-TTS (Google Cloud Text-to-Speech).
 *
 * AI Studio 쪽과 **같은 모델이지만 다른 문이다.** 그쪽은 API 키 한 줄로 되는 대신 하루 10회고,
 * 이쪽은 서비스 계정이 필요한 대신 한도가 없다 (사용량 과금). 한동안 하루 10회에 막혀
 * 이 모델을 후보에서 뺐는데, 막힌 건 모델이 아니라 문이었다.
 *
 * 실패하면 null 이고 부르는 쪽이 Edge 로 떨어진다 — 키가 없는 환경(배포처에 환경변수를
 * 안 넣은 경우)도 같은 길로 간다. 그때는 목소리만 예전 것으로 바뀐다.
 */
async function gemini(text: string): Promise<ArrayBuffer | null> {
  const tk = await 토큰();
  if (!tk) return null;

  try {
    const r = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // 지시를 prompt 로 분리한다. text 안에 섞으면 모델이 지시문까지 소리내어 읽는 일이 있다
        input: { prompt: 지시, text },
        voice: { languageCode: "ko-KR", name: "Kore", model_name: GEMINI_MODEL },
        audioConfig: { audioEncoding: "MP3" },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!r.ok) return null;

    const b = Buffer.from((await r.json()).audioContent, "base64");
    if (!b.length) return null;
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } catch {
    return null; // 네트워크·타임아웃·권한 모두 여기로 모인다
  }
}

/**
 * Edge 읽어주기 음성.
 *
 * **비공식 API 다.** 마이크로소프트가 Edge 브라우저의 읽어주기에 쓰는 엔드포인트를 붙인 것이라
 * 예고 없이 막힐 수 있다. 그래서 실패를 정상 경로로 다룬다 — null 을 주면 화면이 내장 음성으로
 * 떨어지고, 사용자는 목소리가 바뀐 것만 느낀다. 대신 **한도가 없다**: 하루에 몇 번을 열든
 * 같은 소리가 난다. 한도 있는 후보를 뺀 이유가 그것이다 (VOICE 주석).
 */
async function edge(text: string): Promise<ArrayBuffer | null> {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(text, PROSODY);

    const 조각: Buffer[] = [];
    await new Promise<void>((끝, 실패) => {
      const 시계 = setTimeout(() => 실패(new Error("timeout")), TIMEOUT_MS);
      audioStream.on("data", (c: Buffer) => 조각.push(c));
      audioStream.on("end", () => (clearTimeout(시계), 끝()));
      audioStream.on("error", (e: Error) => (clearTimeout(시계), 실패(e)));
    });

    const b = Buffer.concat(조각);
    // 빈 응답도 실패다 — 0바이트 오디오를 물리면 재생이 조용히 끝나 고장처럼 보인다
    if (!b.length) return null;
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } catch {
    return null; // 네트워크·타임아웃·차단 모두 여기로 모인다
  }
}

/** 같은 칸을 다시 재생할 때 네트워크를 아예 안 타게 브라우저에도 오래 맡긴다 */
function 오디오(buf: ArrayBuffer) {
  return new Response(buf, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
