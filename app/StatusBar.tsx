/**
 * 상태바. 와이어프레임에 그려진 목업이라 실제 시각이 아니라 9:41 로 고정한다 —
 * 시연 화면에서 폰처럼 보이게 하는 장식이고, 진짜 시계를 넣으면 리허설 스크린샷마다 값이 달라진다.
 * 온보딩 진입(/)과 프로필 온보딩(/onboarding)이 같이 쓴다.
 */
export default function StatusBar({ tone }: { tone: string }) {
  return (
    // pb-3 은 아래 콘텐츠를 Dynamic Island(globals.css .phone::before) 바닥에서 떼어놓는 여백이다.
    // 와이어프레임에는 아일랜드가 없어 앱바가 상태바 바로 밑(top:24)이지만, 그대로 두면 프레임에서 붙어 보인다.
    <div className={`flex shrink-0 justify-between px-4 pt-2 pb-3 text-[11px] leading-4 font-medium ${tone}`}>
      <span>9:41</span>
      {/* 배터리·신호 아이콘 자리 — 와이어프레임이 문자로 그려둔 것을 그대로 쓴다 */}
      <span aria-hidden>●&nbsp;&nbsp;◒&nbsp;&nbsp;▮</span>
    </div>
  );
}
