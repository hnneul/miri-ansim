import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

/*
  화면에 적는 앱 버전을 여기서 한 번 꺼낸다 (읽는 곳은 lib/version.ts).

  **화면에서 package.json 을 직접 import 하면 안 된다** — 번들에 그 파일이 통째로 실려서
  의존성 목록과 각 버전까지 브라우저로 나간다 (실제로 그렇게 해 보고 청크에서 확인했다).
  env 는 빌드 때 값 하나를 문자열로 박아 넣으므로 나가는 건 "1.0.0" 뿐이다.

  NEXT_PUBLIC_ 을 안 붙인다: 그 접두사는 .env 로 넣을 때만 뜻이 있고, env 로 적은 것은
  접두사와 상관없이 번들에 들어간다 (next 문서 config/env). 붙이면 .env 에서 온 값처럼 읽힌다.
*/
const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

const nextConfig: NextConfig = {
  env: { APP_VERSION: version },
};

export default nextConfig;
