// 실제 모델 호출 확인 — node --experimental-strip-types --env-file=.env.local lib/ai.smoke.ts
//
// ai.check.ts 와 역할이 다르다. 저기는 "나쁜 응답을 버리는가"를 네트워크 없이 보고,
// 여기는 "실제 모델 응답이 그 검증기를 통과하는가"를 본다. 통과하지 못하면 화면에는
// 규칙 기반 문장만 나오므로, 조용히 폴백만 뜨는 상태를 여기서 먼저 잡는다.
//
// 키가 필요해 CI에 넣을 수 없다. 프롬프트나 모델을 바꿨을 때 손으로 한 번 돌린다.
//
// 1분 안팎 걸린다. 실제 호출은 넷이다: 초보 · 베테랑 · 부담 유형 · 캐시.
// 호출당 5~15초로 흔들려 12초 상한에 잘리는 일이 잦다 — 두번까지() 주석 참고.
//
// scenario.ts 를 import 하지 않는다 — 거기는 `@/` 별칭을 써서 번들러 없이는 안 읽힌다.
// 대신 산출물 JSON을 직접 읽어 요인을 같은 모양으로 만든다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { askModel, verify, factsOf, promptOf, aiSentences } from "./ai.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./score.ts";

const DATA = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/route-data.json", import.meta.url)), "utf8"),
);

const 경로 = [
  {
    name: "5.16도로 경유",
    badge: "내비 최단거리",
    durationMin: DATA.fast.durationMin,
    distanceKm: DATA.fast.distanceKm,
    risks: [
      factor("sharpCurve", "5.16도로 연속 급커브", `${DATA.fast.sharpCurve.densest.region} 일대`, `급커브 ${DATA.fast.sharpCurve.byRoad["516로"]}곳`, DATA.fast.sharpCurve.exposure),
      factor("narrowRoad", "좁은 교행 구간", `5.16도로 (${DATA.fast.narrow.byRoad["516로"]}km)`, `차로수 1 구간 ${DATA.fast.narrow.km}km`, DATA.fast.narrow.exposure),
    ],
  },
  {
    name: "평화로 경유",
    badge: "맞춤 저부담",
    durationMin: DATA.safe.durationMin,
    distanceKm: DATA.safe.distanceKm,
    risks: [
      factor("highSpeed", "고속주행 구간", `평화로 ${DATA.safe.highSpeed.byRoad["평화로"]}km`, `제한속도 80km/h 구간 ${DATA.safe.highSpeed.km}km`, DATA.safe.highSpeed.exposure),
      factor("narrowRoad", "좁은 교행 구간", `평화로 (${DATA.safe.narrow.byRoad["평화로"]}km)`, `차로수 1 구간 ${DATA.safe.narrow.km}km`, DATA.safe.narrow.exposure),
    ],
  },
];

function factor(
  type: RiskFactor["type"],
  label: string,
  location: string,
  value: string,
  exposure: number,
): RiskFactor {
  return { type, label, location, value, exposure, coord: [33.3, 126.6], source: "스모크" };
}

const 프로필: Record<string, DriverProfile> = {
  초보: { experienceYears: 1, drivingFrequency: "low", jejuExperience: false, vehicleSize: "compact", timeOfDay: "day" },
  베테랑: { experienceYears: 10, drivingFrequency: "high", jejuExperience: true, vehicleSize: "sedan", timeOfDay: "night" },
};

/**
 * 한 번 더 부른다. **raw=null 의 주범은 한도가 아니라 TIMEOUT_MS(12초)다.**
 *
 * 같은 프롬프트를 상한 없이 재보니 4.7초 · 14.9초 · 60초 초과로 흔들렸다 (2026-08-20 실측).
 * 12초를 넘긴 호출은 AbortSignal 에 잘려 openai() 의 catch 가 null 을 돌려준다 — 응답이
 * 나쁜 게 아니라 **늦은 것**이다. 한 번 실패로 ❌ 를 찍으면 이 파일이 없는 문제를 신고한다.
 * (한도가 아니라는 근거: 같은 키로 짧은 프롬프트 3연속이 2초 안팎에 200 으로 돌아온다.)
 *
 * 앱은 재시도하지 않는다 — 늦으면 규칙 대본이 그대로 앉는 게 의도된 설계다
 * (app/route/actions.ts aiRadio). 여기서만 재시도하는 건 이 파일이 묻는 게 "빠른가"가 아니라
 * **"실제 응답이 검증기를 통과하는가"**이기 때문이다.
 */
async function 두번까지(prompt: string): Promise<unknown | null> {
  return (await askModel(prompt)) ?? (await askModel(prompt));
}

let 실패 = 0;
/** 부담 유형 A/B 의 대조군 — 아무것도 안 고른 초보가 ②에서 무엇을 골랐는지 (아래 블록) */
const 안고른초보: { briefing?: string[] } = {};
for (const [이름, p] of Object.entries(프로필)) {
  const result = scoreRoutes(p, 경로[0], 경로[1]);
  const facts = factsOf("제주공항 → 서귀포 매일올레시장", p, result, 경로);

  const prompt = promptOf(facts);
  const t = Date.now();
  const raw = await 두번까지(prompt);
  const out = verify(raw, facts);
  const 초 = ((Date.now() - t) / 1000).toFixed(1);

  console.log(`\n=== ${이름} (${초}초) — 계산: ${result.recommendedRoute} / fast ${result.fastScore} vs safe ${result.safeScore}`);
  if (!out) {
    실패++;
    // raw 가 null 이면 호출 자체가 실패한 것이다. 연달아 돌리면 분당 토큰 한도(8,000)에
    // 걸리는 게 가장 흔하다 — 호출당 약 2,035토큰이라 1분에 3~4번이 상한이다.
    console.log(`  ❌ 검증 실패 → 폴백 (프롬프트 ${prompt.length}자). 모델이 준 원본:`);
    if (raw === null) console.log("   (raw=null — 두 번 다 실패. 대부분 TIMEOUT_MS 12초 초과다)");
    console.log("  ", JSON.stringify(raw, null, 1).replaceAll("\n", "\n  "));
    // 어느 숫자가 사실에 없었는지 — 가장 흔한 탈락 이유다
    const nums = [...new Set(JSON.stringify(raw).match(/\d+(\.\d+)?/g) ?? [])].filter((n) => !prompt.includes(n));
    if (nums.length) console.log("   사실에 없는 숫자:", nums.join(", "));
    continue;
  }
  console.log("  요약:", out.summary);
  out.briefing.forEach((s, i) => console.log(`  ${i + 1}.`, s));
  // 경로별 판정 — 근거 팝업 머리말. 어느 카드에 붙는 문장인지 이름과 함께 본다
  out.verdicts.forEach((s, i) => console.log(`  [${경로[i].name}]`, s));
  // 초보·부담유형 없음 = 아래 A/B 의 A. 여기서 안 챙겨두면 A 를 부르느라 호출이 하나 더 든다.
  if (이름 === "초보") 안고른초보.briefing = out.briefing;
}

/**
 * 부담 유형이 **무엇을 먼저 말할지**를 바꾸는가 (lib/ai.ts RULES 의 "부담유형" 항).
 *
 * 온보딩 4단계에서 고른 값은 실제 데이터가 있는 유형이면 점수에 반영되고, AI 대본에서는
 * 무엇을 먼저 말할지도 바꾼다. 규칙이 무시되면 설명이 사용자 선택과 어긋난다.
 * ai.check.ts 는 값이 프롬프트에 실렸는지까지만 본다 — 모델이 그걸 따르는지는 여기서만 안다.
 *
 * A 는 위 루프의 초보(부담유형 없음)를 그대로 쓴다. 여기서 새로 부르는 건 B 하나뿐이다.
 * 이 경로에서 초보 추천은 평화로 경유고, 가중치 1등은 고속주행이다 — 그래서 A 는 고속주행을
 * 고르고, "좁은 골목길"을 고른 B 는 좁은 교행으로 옮겨가야 한다.
 */
{
  const p = 프로필.초보;
  const facts = factsOf(
    "제주공항 → 서귀포 매일올레시장",
    p,
    scoreRoutes(p, 경로[0], 경로[1]),
    경로,
    undefined,
    [0], // "좁은 골목길" — 짝이 되는 요인은 "좁은 교행 구간"
  );
  const prompt = promptOf(facts);
  const raw = await 두번까지(prompt);
  const out = verify(raw, facts);

  console.log(`\n=== 부담 유형: ${JSON.stringify(facts.부담유형)}`);
  if (!out) {
    실패++;
    if (raw === null) {
      console.log("  ❌ 두 번 다 호출 실패 → 폴백 (대부분 TIMEOUT_MS 12초 초과다)");
    } else {
      console.log("  ❌ 검증 실패 → 폴백. 모델이 준 원본:");
      const nums = [...new Set(JSON.stringify(raw).match(/\d+(\.\d+)?/g) ?? [])].filter((n) => !prompt.includes(n));
      if (nums.length) console.log("   사실에 없는 숫자:", nums.join(", "));
      console.log("  ", JSON.stringify(raw, null, 1).replaceAll("\n", "\n  "));
    }
  } else {
    out.briefing.forEach((s, i) => console.log(`  ${i + 1}.`, s));

    const 글 = out.briefing.join(" ");
    if (!글.includes("좁은")) {
      실패++;
      console.log('  ❌ "좁은 골목길"을 골랐는데 좁은 교행 얘기가 없다 — 규칙이 안 먹었다');
    }
    // 안 고른 초보가 이미 좁은 교행을 말하고 있었으면 위 통과는 우연이다. 그때는 A/B 가 못 가른다.
    if (안고른초보.briefing?.join(" ").includes("좁은")) {
      console.log("  ⚠️  A(안 고름)도 좁은 교행을 말한다 — 이 판정은 이번엔 의미가 없다");
    }
    // 고른 값을 그대로 읽어주는 건 안내가 아니라 설문 낭독이다 (RULES 가 금지한 것)
    const 낭독 = ["고르셨", "하셨으니", "말씀하신", "부담이라고", "선택하신"].find((w) => 글.includes(w));
    if (낭독) {
      실패++;
      console.log(`  ❌ 고른 값을 입에 올렸다 ("${낭독}") — 무엇을 먼저 말할지만 바꿔야 한다`);
    }
  }
}

// 캐시가 실제로 호출을 막는가 — 무료 한도가 하루 단위라 이게 새면 시연 중에 폴백이 뜬다.
//
// 처음엔 "1회 성공 && 2회 50ms 미만"만 봤는데, 1회가 검증에 실패하면 조건 자체가
// 성립하지 않아 조용히 넘어갔다. 그래서 두 호출을 다 따로 판정한다.
{
  const p = 프로필.초보;
  const facts = factsOf("캐시 확인", p, scoreRoutes(p, 경로[0], 경로[1]), 경로);
  const 재기 = async () => {
    const t = Date.now();
    const out = await aiSentences(facts);
    return { out, ms: Date.now() - t };
  };
  const a = await 재기();
  const b = await 재기();
  console.log(
    `\n=== 캐시: 1회 ${a.ms}ms ${a.out ? "성공" : "실패"} → 2회 ${b.ms}ms ${b.out ? "성공" : "실패"}`,
  );
  if (!a.out || !b.out) {
    실패++;
    console.log("  ❌ 캐시 확인용 호출이 검증을 통과하지 못했다 (폴백 상태)");
  } else if (b.ms >= 50) {
    실패++;
    console.log("  ❌ 두 번째 호출이 캐시를 타지 않았다 — 같은 프롬프트인데 다시 불렀다");
  } else if (JSON.stringify(a.out) !== JSON.stringify(b.out)) {
    실패++;
    console.log("  ❌ 캐시가 다른 문장을 돌려줬다");
  }
}

console.log(실패 ? `\n❌ ${실패}건이 검증을 통과하지 못했다` : "\n✅ 실제 응답이 모두 검증을 통과한다");
process.exitCode = 실패 ? 1 : 0;
