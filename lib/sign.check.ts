import assert from "node:assert/strict";
import { 붙인칸, 서명길이, 서명맞나 } from "./sign.ts";

const 전값 = process.env.TTS_SIGN_SECRET;
const 대본 = "안전하게 잘 다녀오세요.";

try {
  delete process.env.TTS_SIGN_SECRET;
  const 비서명 = 붙인칸(대본);
  assert.equal(비서명.slice(서명길이 + 1), 대본, "비밀키가 없어도 화면용 대본은 보존해야 한다");
  assert.equal(서명맞나(대본, 비서명.slice(0, 서명길이)), false, "비서명 대본은 TTS API를 통과하면 안 된다");

  process.env.TTS_SIGN_SECRET = "qa-secret";
  const 서명됨 = 붙인칸(대본);
  assert.equal(서명됨.slice(서명길이 + 1), 대본);
  assert.equal(서명맞나(대본, 서명됨.slice(0, 서명길이)), true, "비밀키가 있으면 정상 서명해야 한다");
} finally {
  if (전값 === undefined) delete process.env.TTS_SIGN_SECRET;
  else process.env.TTS_SIGN_SECRET = 전값;
}

console.log("✅ TTS 대본 서명 fallback 정상");
