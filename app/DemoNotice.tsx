/**
 * 시연용 현위치 고정 안내 띠.
 *
 * 위치를 공항으로 박아 두면 화면은 아무 티도 안 낸다 — GPS 가 **성공한 것처럼** 보인다
 * (app/DemoLocation.tsx 가 실패 폴백이 아니라 성공 콜백을 갈아끼우는 탓이고, 그건 의도다).
 * 그래서 보는 사람이 오해한다. 서울에서 여는데 제주가 뜨니 더 그렇다.
 *
 * **홈에만 있으면 소용이 없다.** 링크를 받아 폰으로 여는 사람은 홈을 스쳐 지나가고,
 * 대표 관광지("내 위치 기준")·차 없는 길("내 주변 5km")·탐나는전("도보 N분")·
 * 여행 코스("현재 위치 사용")·길 비교("현재 위치")는 아무 말 없이 그 좌표를 내 위치라 부른다.
 * 위치를 쓰는 화면이면 그 화면에서 밝힌다.
 *
 * 같은 env 로 켜고 끈다 (app/DemoLocation.tsx). 시연이 끝나 값을 비우면 이 줄도 같이
 * 사라지므로, 지우는 걸 잊어서 실사용 화면에 안내가 남는 일이 없다.
 */
export default function DemoNotice() {
  if (!process.env.NEXT_PUBLIC_DEMO_HERE) return null;
  return (
    <p className="shrink-0 border-t border-[#ededed] bg-[#fff0e6] py-[9px] text-center text-[11px] leading-none text-[#8a5a3b]">
      시연을 위해 현재 위치를 제주국제공항으로 고정해 두었습니다
    </p>
  );
}
