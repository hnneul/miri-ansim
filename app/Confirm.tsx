/**
 * 물음 창. 브라우저 confirm() 대신 쓴다 — 그건 폰 밖(브라우저)에서 뜨고 글꼴·버튼이 앱과 따로 논다.
 * 여기서는 화면을 어둡게 덮고 가운데 흰 상자로 묻는다.
 *
 * **되돌릴 수 없는 일에만 쓴다.** 지금 기준은 "서버에 남는가"다 — 여행 기록과 주행 저장은 묻고,
 * 기기에만 있는 초안은 안 묻는다 (다시 쓰면 되는 글이고, 매번 두 번 눌리면 오히려 성가시다).
 * 세 자리가 같은 ✕ 아이콘을 같은 좌표에 쓰는데 규칙이 제각각이면 손이 예측을 못 한다.
 *
 * **여행 기록 화면 안에 있던 것을 여기로 옮겼다.** 주행 저장의 ✕ 는 서버에서 지우면서 아무것도
 * 안 물었는데, 그쪽에 창을 복제하면 같은 창이 두 벌 생겨 나중에 한쪽만 고쳐진다.
 *
 * 덮는 범위는 **부모가 정한다** — 이 상자는 absolute 라, 쓰는 화면의 바깥 상자가 relative 여야
 * 폰 프레임 안에서만 덮는다. 아니면 브라우저 여백까지 어두워진다.
 */
export default function Confirm({
  title,
  body,
  onCancel,
  onOk,
}: {
  title: string;
  body: string;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/35 px-8">
      {/* 어둠막을 눌러도 닫힌다 — 창 밖을 누르는 건 "아니오"와 같은 뜻이다 */}
      <button aria-label="닫기" onClick={onCancel} className="absolute inset-0" />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-[280px] rounded-[18px] bg-white px-5 pt-6 pb-4 text-center shadow-[0_12px_32px_0_rgba(0,0,0,0.18)]"
      >
        <p className="text-[15px] leading-[22px] font-bold break-keep text-[#262626]">{title}</p>
        <p className="mt-2 text-[13px] leading-5 text-[#7d7d7d]">{body}</p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            /*
              흰 버튼의 호버는 **중립 회색**이다 (#f7f7f7, TIP 상자와 같은 색).
              옅은 주황으로 하면 옆의 주황 버튼과 같은 무게로 보인다 — 이 앱에서 주황은
              "이걸 누르세요"라는 뜻이라, 되돌릴 수 없는 쪽(지우기)이 눈에 덜 띄면 안 된다.
            */
            className="h-11 flex-1 rounded-[12px] border border-[#eae7e2] bg-white text-[14px] font-medium text-[#262626] transition hover:bg-[#f7f7f7] active:scale-[0.98]"
          >
            취소
          </button>
          <button
            onClick={onOk}
            className="h-11 flex-1 rounded-[12px] bg-[#ff7d32] text-[14px] font-medium text-white transition hover:bg-[#ff6114] active:scale-[0.98]"
          >
            지우기
          </button>
        </div>
      </div>
    </div>
  );
}
