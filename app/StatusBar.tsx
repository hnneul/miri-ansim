/**
 * 상태바. 와이어프레임에 그려진 목업이라 실제 시각이 아니라 9:41 로 고정한다 —
 * 시연 화면에서 폰처럼 보이게 하는 장식이고, 진짜 시계를 넣으면 리허설 스크린샷마다 값이 달라진다.
 * (9:41 은 애플이 자사 스크린샷에 쓰는 값이다. 배터리·신호를 꽉 채우는 것도 같은 관례다.)
 * 온보딩 진입(/)·프로필 온보딩(/onboarding)·메인화면(/home)이 같이 쓴다.
 *
 * 배치는 실제 아이폰을 따른다 — Dynamic Island(globals.css .phone::before)가 y 11~48 을 차지하고
 * 화면 폭 390 의 가운데 125px 를 먹으므로, 좌우에 133px 씩 "귀"가 남는다.
 * 시각과 아이콘 묶음은 각자 그 귀의 한가운데에 앉는다 — 화면 끝에 붙이면 실물과 달라 보인다.
 *
 * 아이콘은 fill/stroke 가 currentColor 라 tone 의 글자색을 그대로 따라간다 —
 * 스플래시(주황 바탕)와 흰 화면이 서로 다른 톤을 쓴다.
 */
export default function StatusBar({ tone }: { tone: string }) {
  return (
    // pt/pb 가 아일랜드 자리를 만든다. pt-[18px]+leading-[22px] 로 시각의 세로 중심이 29 —
    // 아일랜드 중심(11+37/2 = 29.5)과 맞는다. 아래 pb 까지 더한 59 는 실제 아이폰의
    // safe area top 과 같은 값이라, 이 아래로는 어느 화면이 와도 아일랜드를 안 건드린다.
    <div className={`flex shrink-0 items-center justify-between pt-[18px] pb-[19px] ${tone}`}>
      <span className="w-[133px] text-center text-[17px] leading-[22px] font-semibold">9:41</span>
      {/* 신호·와이파이·배터리. 와이어프레임은 ● ◒ ▮ 문자로 자리만 잡아뒀던 곳이다 */}
      <span aria-hidden className="flex w-[133px] items-center justify-center gap-[5px]">
        <Signal />
        <Wifi />
        <Battery />
      </span>
    </div>
  );
}

/** 신호 세기 — 높이가 커지는 막대 4개 */
function Signal() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
      <rect x="0" y="7" width="3" height="4" rx="1" />
      <rect x="4.7" y="5" width="3" height="6" rx="1" />
      <rect x="9.4" y="2.5" width="3" height="8.5" rx="1" />
      <rect x="14.1" y="0" width="3" height="11" rx="1" />
    </svg>
  );
}

/**
 * 와이파이 — 아래 점에서 퍼지는 부채꼴 세 겹.
 * 각 호는 (8, 11.5)를 중심으로 반지름만 키운 것이고, 끝점은 수직에서 ±55° 자리다.
 */
function Wifi() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M0.3 6.1 A9.4 9.4 0 0 1 15.7 6.1" />
      <path d="M2.84 7.89 A6.3 6.3 0 0 1 13.16 7.89" />
      <path d="M5.38 9.66 A3.2 3.2 0 0 1 10.62 9.66" />
      <circle cx="8" cy="10.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 배터리 — 테두리는 옅게, 잔량은 꽉 차게, 오른쪽 끝에 단자 */
function Battery() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
      <rect x="0.6" y="0.6" width="23.8" height="11.8" rx="3.6" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
      <rect x="2.2" y="2.2" width="20.6" height="8.6" rx="2.4" fill="currentColor" />
      {/* 단자 — 반원이라 배터리 몸통에서 살짝 튀어나온다 */}
      <path d="M25.6 4.6 A2 2 0 0 1 25.6 8.4 Z" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}
