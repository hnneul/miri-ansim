"use client";

// 시연용 현위치 고정 — GPS 대신 정해둔 좌표를 준다.
//
// 시연은 서울에서 하는데 이 앱은 전부 제주 기준이다. 진짜 GPS 를 쓰면 현위치가 서울로 잡혀서
// 관광지 목록은 45km 띠 밖이라 텅 비고(lib/spots.ts MAX_DIRECT_KM), 길 비교는 바다를 건너는
// 경로를 그린다. 위치를 제주공항으로 박아야 화면들이 원래 뜻대로 돈다.
//
// **왜 화면마다 안 고치고 여기서 한 번 막나.** 위치를 묻는 곳이 여섯이다 —
// /home · /nearby · /route · /around · /calm · /trip. 여섯 군데에 시연 분기를 심으면
// 시연이 끝나고 여섯 군데를 다시 걷어내야 하고, 나중에 위치를 쓰는 화면이 하나 더 생기면
// 그 화면만 조용히 서울을 가리킨다. 브라우저 API 를 한 번 갈아끼우면 여섯이 그대로 따라온다.
//
// **성공 콜백으로 준다** (실패 폴백이 아니라). 화면들이 실패했을 때는 "공항 기준"이라고 밝히는데
// (app/nearby/page.tsx 내위치), 시연에서는 진짜 거기 서 있는 것처럼 "내 위치"로 보여야 한다.
//
// 끄는 법은 .env 에서 NEXT_PUBLIC_DEMO_HERE 를 비우는 것뿐이다 — 코드는 안 건드린다.

/** "위도,경도". 비어 있으면 진짜 GPS 를 그대로 쓴다. */
const HERE = process.env.NEXT_PUBLIC_DEMO_HERE;

/*
 * 모듈 최상단에서 갈아끼운다 — 컴포넌트 effect 안에서 하면 늦는다. React 는 effect 를 자식부터
 * 돌리므로 레이아웃의 effect 는 화면들의 effect 보다 **뒤**다. 클라이언트 청크가 실행되는
 * 이 시점은 hydration 전이라 어떤 화면의 effect 보다도 앞선다.
 */
// navigator 존재만 보면 안 된다 — Node 24 에도 globalThis.navigator 가 있고(userAgent 만 든),
// geolocation 이 없어 SSR 에서 "Cannot set properties of undefined" 로 터진다.
if (HERE && typeof navigator !== "undefined" && navigator.geolocation) {
  const [lat, lng] = HERE.split(",").map(Number);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // 진짜 API 처럼 비동기로 돌려준다 — 같은 tick 에 답하면 setState 가 effect 안에서
    // 동기로 도는 셈이라, 실제 GPS 와 순서가 달라지는 화면이 나올 수 있다.
    navigator.geolocation.getCurrentPosition = (ok) =>
      window.setTimeout(
        () =>
          ok({
            coords: { latitude: lat, longitude: lng, accuracy: 20 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        0,
      );
  }
}

export default function DemoLocation() {
  return null;
}
