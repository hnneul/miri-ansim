"use client";

// 출발 전 음성 안내 — 고른 길이 어떤 길인지 폰이 읽어준다.
//
// 대본은 lib/ai.ts(AI) 또는 lib/briefing.ts(규칙)가 만든 3~4칸이고, 이 파일은 소리만 낸다.
// 어느 쪽이 왔는지 모른 채 같은 모양으로 그린다 — 칸 구성이 같아서 그럴 수 있다.
//
// 소리는 두 겹이다:
//   ① 서버 음성 (app/api/tts) — Edge 의 한국어 SunHi. 기기와 무관하게 늘 같은 소리가 난다
//   ② 브라우저 내장 음성 — ①이 실패하면 여기로 떨어진다. 어색하지만 인터넷 없이도 난다
//
// ②만 쓰던 시절이 있었는데 목소리를 기기가 정해서 어색했다. 그렇다고 ②를 지우지는 않는다 —
// ①은 비공식 API 라 언제든 막힐 수 있고, 그때 재생 버튼이 먹통이 되는 것보다 낫다.
//
// 한도 있는 후보(Gemini·OpenAI)는 쓰지 않는다. 이유는 app/api/tts/route.ts 의 VOICE 주석에 있다.

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 대본 한 칸의 음성 주소 (app/api/tts/route.ts).
 *
 * **칸마다 따로 부른다.** 한때 한 덩어리로 몰아 불렀는데 그건 한도를 아끼려던 것이고
 * (모델당 하루 10회짜리 후보를 쓰던 시절), 지금 쓰는 Edge 는 한도가 없어서 그럴 이유가 없다.
 * 칸으로 쪼개면 셋을 얻는다: 첫 칸만 오면 재생을 시작할 수 있고, 지금 어느 칸인지 정확히 알며,
 * 칸 사이에 우리가 원하는 만큼 쉼을 줄 수 있다.
 *
 * 주소가 곧 캐시 키다 — 같은 칸을 다시 재생하면 브라우저가 네트워크를 아예 안 탄다.
 */
const 주소 = (칸: string) =>
  `/api/tts?t=${encodeURIComponent(글(칸))}&s=${칸.slice(0, 서명길이)}`;

/**
 * 서버가 준 칸은 `<서명 16자>.<대본>` 이다 (lib/sign.ts 붙인칸).
 * 이 파일은 클라이언트라 서명을 만들 수는 없고, 떼어 쓰기만 한다 —
 * 주소에는 둘 다 실어 보내고, 화면에는 글만 그린다.
 */
const 서명길이 = 16;
const 글 = (칸: string) => 칸.slice(서명길이 + 1);

/**
 * 칸 사이 쉼. 사람은 한 덩어리를 말하고 나서 한 박자 쉬는데, 오디오를 곧바로 이으면
 * 네 칸이 한 문단처럼 쏟아진다.
 *
 * SSML `<break>` 로 넣으려 했지만 무료 엔드포인트가 평문만 받는다(route.ts PROSODY 주석).
 * 재생을 우리가 쥐고 있으니 그냥 여기서 기다리면 된다 — 서비스가 못 해주는 걸
 * 우회한 게 아니라, 원래 이쪽이 제자리다.
 */
const 칸사이쉼 = 500;

/**
 * 이 기기에 한국어 음성이 있는가. **null 은 "아직 모름"이다** — 셋을 갈라야 한다.
 *
 * getVoices() 는 첫 호출에 빈 배열을 주는 브라우저가 많고(목록을 비동기로 채운다),
 * 그걸 "없음"으로 읽으면 멀쩡한 기기에서 버튼이 사라진다. voiceschanged 를 기다려야 한다.
 *
 * 목록이 찼는데 한국어가 없으면 그때는 진짜 없는 것이다. 그 경우 버튼을 숨긴다 —
 * 영어 음성으로 한국어를 읽히면 소리는 나지만 알아들을 수가 없다.
 */
function useKoreanVoice() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [있나, set있나] = useState<boolean | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      set있나(false);
      return;
    }
    const 고르기 = () => {
      const all = speechSynthesis.getVoices();
      if (!all.length) return; // 아직 안 채워졌다 — voiceschanged 를 기다린다
      // iOS 는 "ko-KR", 안드로이드가 "ko_KR" 로 주는 경우가 있다
      const ko = all.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
      // 기기에 내장된 것을 먼저 쓴다 — 네트워크 음성은 비행기모드·터널에서 조용히 실패한다
      setVoice(ko.find((v) => v.localService) ?? ko[0] ?? null);
      set있나(ko.length > 0);
    };
    고르기();
    speechSynthesis.addEventListener("voiceschanged", 고르기);
    return () => speechSynthesis.removeEventListener("voiceschanged", 고르기);
  }, []);

  return { voice, 있나 };
}

export default function RouteRadio({
  script,
  /** 고른 경로가 바뀌면 읽던 걸 멈춘다 — 화면과 소리가 다른 길을 가리키면 안 된다 */
  routeId,
  펼침,
}: {
  script: string[];
  routeId: string;
  /**
   * 대본 전체를 글로 편다 (`?대본=1`). 기본은 꺼짐이다 — 아래 주석대로 이 줄이 자라면
   * 그만큼 지도가 줄어서, 평소에는 위 진행 줄에 한 줄로 잘라 얹는다.
   * 소리를 못 듣는 자리(시연장·이어폰 없음)에서 내용을 확인할 때만 쿼리로 연다.
   */
  펼침?: boolean;
}) {
  const { voice, 있나 } = useKoreanVoice();
  /** 지금 읽고 있는 칸. null 이면 멈춰 있다 */
  const [읽는칸, set읽는칸] = useState<number | null>(null);
  /** 서버 음성을 기다리는 중. 첫 칸이 오기까지 몇 초 걸려서 눌린 걸 알려줘야 한다 */
  const [받는중, set받는중] = useState(false);

  /*
   * 재생 세대. cancel() 뒤에 onend 가 오는 브라우저가 있어서, 그걸 그대로 믿고 다음 칸으로
   * 넘어가면 **멈춘 뒤에 소리가 다시 난다**. 세대를 올려두고 안 맞으면 버린다.
   * 서버 음성에서도 같은 일을 한다 — 늦게 도착한 오디오가 멈춘 뒤에 울리면 안 된다.
   */
  const 세대 = useRef(0);
  /** 재생 중인 <audio>. 멈출 때 이것도 끊어야 한다 */
  const 소리 = useRef<HTMLAudioElement | null>(null);

  const 멈춤 = useCallback(() => {
    세대.current++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    소리.current?.pause();
    소리.current = null;
    set받는중(false);
    set읽는칸(null);
  }, []);

  // 화면을 떠날 때 반드시 끊는다. speechSynthesis 는 페이지가 아니라 **브라우저**에 붙어 있어서
  // 컴포넌트가 사라져도 혼자 계속 읽는다 (뒤로 가기로 나갔는데 소리가 따라오는 걸 막는다).
  useEffect(() => 멈춤, [멈춤, routeId]);

  /** 이 경로에서 이미 데웠는가. 대본이 바뀌어도 다시 데우지 않으려고 경로로 잡아둔다 */
  const 데운경로 = useRef<string | null>(null);

  /*
   * 화면이 뜨면 **첫 칸만** 미리 받아 둔다. 서버 음성은 한 칸에 몇 초 걸려서, 누른 뒤에
   * 부르면 그만큼 기다린다. 데우는 목적은 **누른 순간 소리가 나는 것**이고 그건 첫 칸이면
   * 이룬다 — 둘째 칸은 첫 칸을 읽는 동안 받으면 늦지 않다 (재생 쪽이 이미 그렇게 한다).
   *
   * 한때 전 칸을 다 던졌는데 그건 Edge 가 무료라 던져도 공짜였을 때 얘기다. 지금 음성은
   * 글자 수로 값을 매기므로 **재생을 안 누른 화면에서 네 칸을 만드는 건 그냥 버리는 것**이다.
   *
   * 경로로 한 번만 건다. 의존성을 script 로 두면 AI 대본이 도착해 prop 이 바뀔 때
   * 한 벌을 통째로 다시 데운다 — 누르지도 않은 화면에서 두 배가 나가던 자리다.
   *
   * 던져만 두고 기다리지 않는다 — 실패해도 재생 때 다시 시도하고, 그때도 안 되면
   * 내장 음성으로 떨어진다. 여기서 잡을 오류가 없다.
   */
  useEffect(() => {
    const 첫칸 = script[0];
    if (!첫칸 || 데운경로.current === routeId) return;
    데운경로.current = routeId;
    fetch(주소(첫칸)).catch(() => {});
  }, [routeId, script]);

  async function 재생() {
    if (읽는칸 !== null || 받는중) return 멈춤();

    // 지금 화면의 대본을 붙잡아 둔다. 재생 중에 AI 대본이 도착해 prop 이 바뀌어도
    // 읽던 것을 끝까지 읽는다 — 문장 중간에 다른 대본으로 갈아타면 앞뒤가 안 맞는다.
    const 대본 = script;
    const 내세대 = ++세대.current;

    /** 브라우저 내장 음성. 서버가 죽었거나 한도가 말랐을 때 여기로 떨어진다 */
    const 내장으로읽기 = (i: number) => {
      if (내세대 !== 세대.current) return;
      if (i >= 대본.length) return set읽는칸(null);

      const u = new SpeechSynthesisUtterance(글(대본[i]));
      // 음성을 못 고른 기기에서도 lang 만 맞으면 OS 가 알아서 고르는 경우가 있다
      u.lang = "ko-KR";
      if (voice) u.voice = voice;
      // 초보에게 길을 설명하는 자리라 기본 속도는 조금 빠르다
      u.rate = 0.95;
      u.onend = () => 내장으로읽기(i + 1);
      u.onerror = () => 내세대 === 세대.current && set읽는칸(null);
      set읽는칸(i);
      speechSynthesis.speak(u);
    };

    /*
     * 서버 음성. 칸마다 받아 순서대로 튼다 — 첫 칸만 오면 시작할 수 있고, 그 칸을 읽는 동안
     * 나머지가 도착한다. 미리 받아두는 위 useEffect 가 이미 병렬로 던져놨으므로 대개 즉시 온다.
     */
    const 서버로읽기 = async (i: number): Promise<boolean> => {
      if (내세대 !== 세대.current) return true;
      if (i >= 대본.length) {
        set읽는칸(null);
        return true;
      }

      let 소스: string;
      try {
        const r = await fetch(주소(대본[i]));
        if (!r.ok) return false;
        소스 = URL.createObjectURL(await r.blob());
      } catch {
        return false;
      }
      if (내세대 !== 세대.current) return URL.revokeObjectURL(소스), true;

      const a = new Audio(소스);
      소리.current = a;
      set받는중(false);
      set읽는칸(i);
      try {
        await a.play();

        /*
         * 이 칸을 트는 동안 **다음 칸을 미리 부른다.** 아래 재귀는 재생이 끝난 뒤에야
         * 다음 칸을 받으러 가는데, 그러면 만드는 시간만큼 칸 사이가 통째로 빈다.
         * Edge 는 1.8초라 티가 안 났지만 생성형 음성은 5~6초라 침묵이 들린다.
         *
         * 여기서 던져두면 이 칸을 읽는 동안(대개 10초) 다음 칸이 도착한다 —
         * 만드는 게 읽는 것보다 빠르므로 한 번 시작하면 끝까지 안 끊긴다.
         *
         * 화면이 뜰 때 네 칸을 다 던지지 않는 것과 같은 이유로 **한 칸 앞만** 본다:
         * 듣다가 멈춘 사람 몫까지 만들어두면 그건 버리는 것이다.
         */
        if (i + 1 < 대본.length) fetch(주소(대본[i + 1])).catch(() => {});
      } catch {
        // iOS 는 사용자 제스처 없이 play() 를 막는다. 버튼에서 불렀으니 대개 통과하지만
        // 앞 칸을 기다리는 사이 제스처가 만료되면 여기로 온다 — 그때는 내장 음성이 낫다.
        URL.revokeObjectURL(소스);
        return false;
      }
      await new Promise<void>((끝) => {
        a.onended = () => 끝();
        a.onerror = () => 끝();
      });
      URL.revokeObjectURL(소스);

      // 한 박자 쉬고 다음 칸으로 (칸사이쉼 주석). 마지막 칸 뒤에는 쉴 이유가 없다.
      if (i + 1 < 대본.length)
        await new Promise((끝) => setTimeout(끝, 칸사이쉼));
      return 서버로읽기(i + 1);
    };

    set받는중(true);
    const 됐나 = await 서버로읽기(0);
    if (내세대 !== 세대.current) return;
    if (!됐나) {
      // 서버 음성이 어느 칸에서든 실패하면 **처음부터** 내장 음성으로 다시 읽는다.
      // 중간부터 이어 읽으면 목소리가 바뀌어서 다른 안내가 시작된 것처럼 들린다.
      set받는중(false);
      내장으로읽기(0);
    }
  }

  // 음성이 없는 기기에서는 아예 안 띄운다. 눌러도 소리가 안 나는 버튼이 제일 나쁘다.
  // 서버 음성은 기기와 무관하게 나므로 그쪽이 살아 있으면 띄워도 되지만, 살았는지는
  // 눌러봐야 안다 — 못 띄우는 쪽이 아니라 눌렀는데 조용한 쪽이 더 나쁘므로 내장 기준을 따른다.
  if (있나 === false) return null;

  return (
    /*
      와이어프레임(2153:3981 + 2554:445)은 확성기 하나에 회색 글씨 한 줄이다 — 카드도 테두리도
      주황 배경도 없다. 이 화면의 주인공은 표와 버튼이고, 이 줄은 옆에 조용히 있는 문이다.
      주황 카드로 그렸더니 표만큼 눈에 띄어서 두 개가 서로 경쟁했다.

      대신 **재생 상태는 글씨로 남긴다.** 소리가 나기 시작했는지, 지금 어느 칸인지 볼 데가
      없으면 눌러놓고 기다리는 사람이 고장인 줄 안다 — 그건 모양보다 앞선다.
    */
    <div>
      <button
        onClick={재생}
        // 목록을 아직 못 받았으면(있나 === null) 눌러도 헛돈다 — 그동안만 잠근다
        disabled={있나 === null}
        aria-label={읽는칸 !== null || 받는중 ? "안내 멈추기" : "출발 전 안내 듣기"}
        /*
          글씨가 왼쪽, 확성기가 **오른쪽 끝**이다 (와이어프레임 3961:721 + 3926:684 — 확성기가
          390 을 살짝 넘어간다). 판정 카드 오른쪽에 붙는 좁은 칸이라 아이콘을 왼쪽에 두면
          글씨가 밀려 잘린다. -mr 로 오른쪽 여백을 먹어 확성기를 화면 가장자리까지 붙인다.
        */
        className="-mr-2 flex w-full items-center justify-end gap-[4px] py-1 text-right transition active:scale-[0.99] disabled:opacity-40"
      >
        {/*
          칸이 좁아서 읽는 문장을 그대로 못 얹는다 (여기는 판정 카드 옆 100px 남짓이다).
          문장 대신 **몇 번째 칸인지**만 남긴다 — 눌렀는데 조용한 게 아니라는 신호가 목적이고
          그건 진행 숫자로 이룬다. 문장 전체는 `?대본=1` 과 아래 aria-live 몫이다.
        */}
        <span className="min-w-0 truncate text-[12px] leading-[18px] text-[#949494]">
          {읽는칸 !== null
            ? `${읽는칸 + 1}/${script.length} 읽는 중`
            : 받는중
              ? "목소리 받는 중…"
              : "경로 설명듣기"}
        </span>
        {/*
          재생 중에는 ■, 그 밖에는 확성기 — 아이콘 자리가 곧 멈춤 버튼이다.
          확성기는 와이어프레임 3926:684 에서 받은 그림이다 (시스템 이모지 📢 는 기기마다
          다른 데다 안드로이드에서는 회색이라, 이 화면에서 유일하게 색이 있는 그림이
          주황 표·주황 버튼과 안 어울렸다). 자리를 둘이 나눠 쓰므로 상자 크기를 고정한다 —
          안 그러면 누를 때마다 줄 높이가 튄다.
        */}
        <span
          aria-hidden
          className={`grid size-[36px] shrink-0 place-items-center ${받는중 ? "animate-pulse" : ""}`}
        >
          {읽는칸 !== null || 받는중 ? (
            <span className="text-[20px] leading-none">■</span>
          ) : (
            <img src="/route/megaphone.png" alt="" className="size-[36px]" />
          )}
        </span>
      </button>

      {/*
        문장을 보여주는 줄을 **따로 두지 않는다.** 처음엔 읽는 칸을 아래에 펼쳤는데, 재생할 때만
        띄우니 줄이 58 에서 111 로 자라 경로 카드를 57px 밀어냈다. 그래서 높이를 고정했더니
        이번엔 **멈춰 있을 때도** 카드가 잘렸다 — 시트가 350 이고 그 자리는 이미 카드 몫이다.
        늘릴 수도 없다: 시트를 키운 만큼 지도가 줄어든다.

        결국 셋 다 안 되는 자리라, 문장은 위 진행 줄에 한 줄로 잘라 얹었다. 다 못 읽는 대신
        높이가 한 번도 안 변한다 — 들으려고 누른 순간 화면이 흔들리는 것보다 낫다.

        ponytail: 전체 문장을 보여줘야 하면 시트를 66 키우고(SHEET_H) 여기 3줄 상자를 되살린다.
        그만큼 지도가 줄어드는 걸 받아들이는 결정이다. `?대본=1` 이 그 문이다 — 높이가 자라는
        걸 받아들이는 대신, 켠 사람만 본다.
      */}
      {펼침 && (
        <ol className="mt-1 space-y-[2px] text-[12px] leading-[18px] text-[#949494]">
          {script.map((칸, i) => (
            // 지금 읽는 칸만 진하게 — 어디를 읽는지 소리 없이도 따라갈 수 있어야 편 의미가 있다
            <li key={i} className={i === 읽는칸 ? "text-[#1a1a1a]" : ""}>
              {글(칸)}
            </li>
          ))}
        </ol>
      )}

      <span className="sr-only" aria-live="polite">
        {읽는칸 !== null ? script[읽는칸] : ""}
      </span>
    </div>
  );
}
