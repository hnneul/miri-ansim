// 소개 화면만. 온보딩 1단계에서 뒤로 누르면 여기로 온다 (app/onboarding/page.tsx).
//
// 로고를 2.2초 다시 볼 이유가 없어서 스플래시를 뺐다. "처음 방문만 띄우기"로 안 한 이유는
// 시연에서 한 번 보고 나면 다시 못 봐서다 — 주소로 / 를 열면 언제나 스플래시가 재생된다.

import Intro from "../Intro";

export default function IntroPage() {
  return <Intro />;
}
