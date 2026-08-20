// 화면에 적는 앱 버전. **package.json 하나만 본다** (next.config.ts 가 빌드 때 넣어준다).
//
// 손으로 적으면 `npm version` 을 쳐도 화면은 옛 숫자를 그대로 말한다. 실제로 홈과 마이가
// 나란히 "1.0.0" 을 적고 있는 동안 package.json 은 create-next-app 이 넣어 둔 0.1.0 이었다.
// lib/serviceinfo.ts 의 "숫자는 손으로 안 적는다" 와 같은 규칙이다.
//
// **문장까지 여기 둔다** — 두 화면이 같은 말을 해야 하는데 두 파일에 나눠 적으면 한쪽만 고쳐진다.
// 대신 컴포넌트로는 안 묶는다: 여백이 화면마다 다르고(홈 mt-[17px], 마이 mt-[23px] pb-6)
// 한 줄짜리 <p> 를 className 받는 컴포넌트로 만들면 감싸는 값이 감싸이는 값보다 많아진다.
//
// process.env.APP_VERSION 은 통째로 적어야 한다 — 빌드가 이 글자를 값으로 바꿔치기하는 것이라
// 구조분해(`const { APP_VERSION } = process.env`)로 꺼내면 바꿔칠 자리가 없어 undefined 가 된다.
export const APP_VERSION = process.env.APP_VERSION ?? "";

/** 홈·마이 화면 맨 아래 한 줄 */
export const APP_FOOTER = `미리 안심 · 앱 버전 ${APP_VERSION}`;
