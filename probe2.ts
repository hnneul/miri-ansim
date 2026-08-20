import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { factsOf, promptOf } from "./lib/ai.ts";
import { scoreRoutes, type DriverProfile, type RiskFactor } from "./lib/score.ts";
const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("./data/route-data.json", import.meta.url)), "utf8"));
const f = (type: RiskFactor["type"], label: string, location: string, value: string, exposure: number): RiskFactor =>
  ({ type, label, location, value, exposure, coord: [33.3, 126.6], source: "probe" });
const 경로 = [
  { name: "5.16도로 경유", badge: "내비 최단거리", durationMin: DATA.fast.durationMin, distanceKm: DATA.fast.distanceKm,
    risks: [f("sharpCurve", "연속 급커브", "일대", `급커브 ${DATA.fast.sharpCurve.byRoad["516로"]}곳`, DATA.fast.sharpCurve.exposure),
            f("narrowRoad", "좁은 교행 구간", "5.16도로", `차로수 1 구간 ${DATA.fast.narrow.km}km`, DATA.fast.narrow.exposure)] },
  { name: "평화로 경유", badge: "맞춤 저부담", durationMin: DATA.safe.durationMin, distanceKm: DATA.safe.distanceKm,
    risks: [f("highSpeed", "고속주행 구간", "평화로", `제한속도 80km/h 구간 ${DATA.safe.highSpeed.km}km`, DATA.safe.highSpeed.exposure),
            f("narrowRoad", "좁은 교행 구간", "평화로", `차로수 1 구간 ${DATA.safe.narrow.km}km`, DATA.safe.narrow.exposure)] },
];
const p: DriverProfile = { experienceYears: 1, drivingFrequency: "low", jejuExperience: false, vehicleSize: "compact", timeOfDay: "day" };
const prompt = promptOf(factsOf("제주공항 → 서귀포 매일올레시장", p, scoreRoutes(p, 경로[0], 경로[1]), 경로, undefined, [0]));
console.log("프롬프트", prompt.length, "자");
for (let i = 1; i <= 4; i++) {
  const t = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model: "gpt-5.6-luna", reasoning_effort: "low", max_completion_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  console.log(`${i}: ${res.status} ${((Date.now() - t) / 1000).toFixed(1)}초  (앱 상한 12초)`);
}
