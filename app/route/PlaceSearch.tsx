"use client";

// 출발지·도착지를 고쳐 잡는 검색 패널. 길 비교 화면(/route)의 카드를 누르면 열린다.
//
// 지오코딩은 /destination 이 쓰는 서버 액션을 그대로 부른다 — 같은 카카오 장소 검색이라
// 새로 만들 게 없다. 화면만 여기 있고 검색 규칙은 lib/geocode.ts 한 곳이다.

import { useEffect, useRef, useState } from "react";
import StatusBar from "../StatusBar";
import type { Place } from "@/lib/geocode";
import { suggestPlaces } from "../destination/actions";

/** 타이핑이 멎고 나서 후보를 부르기까지 (/destination 과 같은 값) */
const TYPING_MS = 250;

export default function PlaceSearch({
  label,
  onPick,
  onClose,
}: {
  /** "출발지" / "도착지" — 자리표시자와 읽어주는 이름에 쓴다 */
  label: string;
  onPick: (place: Place) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  /*
    적는 동안 후보를 불러온다. 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때
    먼저 보낸 긴 검색어의 결과가 나중에 도착해 목록을 덮는다 (/destination 과 같은 이유).
  */
  useEffect(() => {
    if (!text.trim()) return setFound([]);

    let alive = true;
    const timer = setTimeout(() => {
      suggestPlaces(text).then((r) => alive && setFound(r));
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white">
      <StatusBar tone="text-[#525252]" />

      {/* 검색바 모양은 메인화면·목적지 화면과 같다 — 흰 바탕에 주황 테두리 */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className="mx-[15px] mt-[9px] flex h-[54px] shrink-0 items-center gap-[10px] rounded-[16px] border border-[#fc7f35] bg-white px-[14px]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="검색 닫기"
          className="shrink-0 transition active:scale-90"
        >
          <img src="/icon-arrow-left.svg" alt="" className="size-6" />
        </button>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`${label}를 검색해 주세요`}
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#1f1f1f] outline-none placeholder:text-[#7d7d7d]"
        />
        {text && (
          <button
            type="button"
            onClick={() => setText("")}
            aria-label="지우기"
            className="shrink-0 transition active:scale-90"
          >
            <img src="/home/icon-close.svg" alt="" className="size-6" />
          </button>
        )}
      </form>

      {/* 목록이 길면 여기만 스크롤한다 */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        {!text.trim() ? null : found.length > 0 ? (
          <ul>
            {found.map((p) => (
              /* 같은 이름이 여럿이라 key 는 좌표까지 붙인다 ("스타벅스"가 제주에만 수십 곳이다) */
              <li key={`${p.label}${p.coord}`}>
                <button
                  onClick={() => onPick(p)}
                  className="flex w-full items-start gap-3 py-[10px] text-left"
                >
                  <img
                    src="/home/icon-search.svg"
                    alt=""
                    aria-hidden
                    className="mt-[5px] size-[15px] shrink-0 opacity-60"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-[7px]">
                      <span className="truncate text-[14px] leading-[22px] text-[#1f1f1f]">
                        {p.label}
                      </span>
                      {p.type && (
                        <span className="shrink-0 text-[11px] text-[#9e9e9e]">{p.type}</span>
                      )}
                    </span>
                    {/* 주소가 있어야 같은 이름 중에 어느 지점인지 갈린다 — 없는 곳은 그 줄만 빠진다 */}
                    {(p.road || p.jibun) && (
                      <span className="mt-[2px] block truncate text-[12px] text-[#9e9e9e]">
                        {p.road || p.jibun}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          /* 아직 안 왔거나(디바운스 중) 제주에 없는 이름이다. 둘을 가려 말할 방법이 없어 한 줄로 둔다 */
          <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">검색 결과를 찾는 중…</p>
        )}
      </div>
    </div>
  );
}
