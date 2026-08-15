"use client";

// 출발 전 음성 안내 — 고른 길이 어떤 길인지 폰이 읽어준다.
//
// 대본은 lib/ai.ts(AI) 또는 lib/briefing.ts(규칙)가 만든 3~4칸이고, 이 파일은 소리만 낸다.
// 어느 쪽이 왔는지 모른 채 같은 모양으로 그린다 — 칸 구성이 같아서 그럴 수 있다.
//
// **모델을 쓰지 않는다.** 브라우저·OS에 이미 있는 speechSynthesis 로 낸다 —
// 폰 안에서 도니까 인터넷이 끊겨도 소리가 나고, 배포가 늘지 않고, 무료다.
// 목소리 품질을 우리가 통제하려면 서버 TTS 로 갈아야 하는데, 그때 바뀌는 건 speak() 한 곳이다.

import { useCallback, useEffect, useRef, useState } from "react";

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
}: {
  script: string[];
  routeId: string;
}) {
  const { voice, 있나 } = useKoreanVoice();
  /** 지금 읽고 있는 칸. null 이면 멈춰 있다 */
  const [읽는칸, set읽는칸] = useState<number | null>(null);

  /*
   * 재생 세대. cancel() 뒤에 onend 가 오는 브라우저가 있어서, 그걸 그대로 믿고 다음 칸으로
   * 넘어가면 **멈춘 뒤에 소리가 다시 난다**. 세대를 올려두고 안 맞으면 버린다.
   */
  const 세대 = useRef(0);

  const 멈춤 = useCallback(() => {
    세대.current++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    set읽는칸(null);
  }, []);

  // 화면을 떠날 때 반드시 끊는다. speechSynthesis 는 페이지가 아니라 **브라우저**에 붙어 있어서
  // 컴포넌트가 사라져도 혼자 계속 읽는다 (뒤로 가기로 나갔는데 소리가 따라오는 걸 막는다).
  useEffect(() => 멈춤, [멈춤, routeId]);

  function 재생() {
    if (읽는칸 !== null) return 멈춤();

    // 지금 화면의 대본을 붙잡아 둔다. 재생 중에 AI 대본이 도착해 prop 이 바뀌어도
    // 읽던 것을 끝까지 읽는다 — 문장 중간에 다른 대본으로 갈아타면 앞뒤가 안 맞는다.
    const 대본 = script;
    const 내세대 = ++세대.current;

    const 읽기 = (i: number) => {
      if (내세대 !== 세대.current) return;
      if (i >= 대본.length) return set읽는칸(null);

      const u = new SpeechSynthesisUtterance(대본[i]);
      // 음성을 못 고른 기기에서도 lang 만 맞으면 OS 가 알아서 고르는 경우가 있다
      u.lang = "ko-KR";
      if (voice) u.voice = voice;
      // 초보에게 길을 설명하는 자리라 기본 속도는 조금 빠르다
      u.rate = 0.95;
      u.onend = () => 읽기(i + 1);
      u.onerror = () => 내세대 === 세대.current && set읽는칸(null);
      set읽는칸(i);
      speechSynthesis.speak(u);
    };

    /*
     * 칸마다 따로 speak 한다. 하나로 이어 붙이면 크롬이 15초쯤에서 조용히 끊는 알려진 버릇이
     * 있는데, 칸이 120자 안이라 한 번에 몇 초씩만 읽으면 거기 안 걸린다.
     * 읽는 칸을 화면에 표시할 수 있는 것도 이 덕분이다.
     */
    읽기(0);
  }

  // 음성이 없는 기기에서는 아예 안 띄운다. 눌러도 소리가 안 나는 버튼이 제일 나쁘다.
  if (있나 === false) return null;

  return (
    <div className="rounded-[10px] border border-[#ffd9c2] bg-[#fff6f0] px-3 py-[10px]">
      <div className="flex items-center gap-3">
        <button
          onClick={재생}
          // 목록을 아직 못 받았으면(있나 === null) 눌러도 헛돈다 — 그동안만 잠근다
          disabled={있나 === null}
          aria-label={읽는칸 !== null ? "안내 멈추기" : "출발 전 안내 듣기"}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fc7f35] text-[13px] leading-none text-white transition active:scale-95 disabled:opacity-40"
        >
          <span aria-hidden>{읽는칸 !== null ? "■" : "▶"}</span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[18px] font-medium text-[#1f1f1f]">
            출발 전에 이 길 들어보기
          </p>
          {/*
            읽고 있는 문장을 **이 줄에** 얹는다. 귀로는 되감을 수 없어서 어디를 듣고 있는지
            눈으로 확인할 데가 있어야 하는데, 줄을 따로 두면 자리가 없다 —
            시트가 350 이고 경로 카드가 그 자리를 이미 쓴다 (아래 주석).
            한 줄로 잘라 넣으면 높이가 안 변해서 카드도 안 밀리고 지도도 안 줄어든다.
          */}
          <p className="truncate text-[11px] leading-[16px] text-[#9e9e9e]">
            {읽는칸 !== null
              ? `${읽는칸 + 1}/${script.length} · ${script[읽는칸]}`
              : `${script.length}칸 · 30초쯤`}
          </p>
        </div>
      </div>

      {/*
        문장을 보여주는 줄을 **따로 두지 않는다.** 처음엔 읽는 칸을 아래에 펼쳤는데, 재생할 때만
        띄우니 줄이 58 에서 111 로 자라 경로 카드를 57px 밀어냈다. 그래서 높이를 고정했더니
        이번엔 **멈춰 있을 때도** 카드가 잘렸다 — 시트가 350 이고 그 자리는 이미 카드 몫이다.
        늘릴 수도 없다: 시트를 키운 만큼 지도가 줄어든다.

        결국 셋 다 안 되는 자리라, 문장은 위 진행 줄에 한 줄로 잘라 얹었다. 다 못 읽는 대신
        높이가 한 번도 안 변한다 — 들으려고 누른 순간 화면이 흔들리는 것보다 낫다.

        ponytail: 전체 문장을 보여줘야 하면 시트를 66 키우고(SHEET_H) 여기 3줄 상자를 되살린다.
        그만큼 지도가 줄어드는 걸 받아들이는 결정이다.
      */}
      <span className="sr-only" aria-live="polite">
        {읽는칸 !== null ? script[읽는칸] : ""}
      </span>
    </div>
  );
}
