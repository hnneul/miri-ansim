"use client";

// 출발지·도착지를 고쳐 잡을 때 카드 **아래**에 깔리는 목록 (와이어프레임 "목적지 → 출발 선택" 2212:2649).
//
// 검색칸을 여기 두지 않는다 — 적는 자리는 route-editor 카드의 그 칸이다. 검색창을 따로 띄우면
// 방금 누른 칸과 지금 적는 칸이 화면에서 떨어져서, 어느 쪽을 고치는 중인지가 다시 흐려진다.
//
// 목록은 두 갈래다: 적는 중이면 후보, 비어 있으면 최근 검색어.
// 둘을 같이 띄우지 않는 이유는 자리가 아니라 뜻이다 — 후보가 떠 있는 동안 최근 검색어는
// 지금 적고 있는 것과 상관없는 목록이라 손이 잘못 간다 (/destination 과 같은 규칙).

import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/geocode";
import { loadRecent, removeRecent } from "@/lib/recent";
import { findPlace, suggestPlaces } from "../destination/actions";
import { 이어친목록 } from "@/lib/geocode";

/** 타이핑이 멎고 나서 후보를 부르기까지 (/destination 과 같은 값) */
const TYPING_MS = 250;

export default function PlaceSearch({
  text,
  onPick,
}: {
  /** 카드의 그 칸에 적고 있는 글자. 여기서는 읽기만 한다. */
  text: string;
  onPick: (place: Place) => void;
}) {
  const [found, setFound] = useState<Place[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  /**
   * 지금 떠 있는 후보가 어느 검색어의 결과인가. null 이면 아직 안 왔다는 뜻이다 —
   * 이게 없으면 "아직 안 옴"과 "찾아봤는데 없음"이 둘 다 빈 배열이라 구분되지 않는다
   * (/destination 과 같은 규칙·같은 이유).
   */
  const [찾은말, set찾은말] = useState<string | null>(null);
  /**
   * 그 검색어를 **물어보기는 했나**. false 면 목록이 빈 이유가 "제주에 없어서"가 아니라
   * 카카오에 못 물어봐서다 (타임아웃·네트워크·키). 없다고 단정하면 안 되는 자리다
   * (app/destination/actions.ts suggestPlaces).
   */
  const [물어봤나, set물어봤나] = useState(true);
  /** 마지막으로 결과가 나온 검색어와 그 목록. 치는 중에 붙들 근거다 (lib/geocode.ts 이어친목록) */
  const 앞결과 = useRef<{ 말: string; 목록: Place[] }>({ 말: "", 목록: [] });

  useEffect(() => setRecent(loadRecent()), []);

  /*
    적는 동안 후보를 불러온다. 늦게 온 앞선 응답은 버린다 — 안 버리면 글자를 지웠을 때
    먼저 보낸 긴 검색어의 결과가 나중에 도착해 목록을 덮는다.
  */
  useEffect(() => {
    if (!text.trim()) {
      set찾은말(null);
      앞결과.current = { 말: "", 목록: [] };
      return setFound([]);
    }

    let alive = true;
    set찾은말(null); // 글자가 바뀌면 앞 결과는 이 검색어의 것이 아니다
    const timer = setTimeout(() => {
      suggestPlaces(text).then((r) => {
        if (!alive) return;
        const 목록 = r.places.length ? r.places : 이어친목록(앞결과.current, text);
        if (목록.length) 앞결과.current = { 말: text, 목록 };
        setFound(목록);
        set물어봤나(r.물어봤나);
        set찾은말(text);
      });
    }, TYPING_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);

  /** 최근 검색어는 이름만 있다. 좌표가 있어야 길을 만들 수 있어 한 번 더 찾는다. */
  function pickName(name: string) {
    findPlace(name).then((r) => !("error" in r) && onPick(r));
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 pt-4 pb-4">
      {text.trim() ? (
        found.length > 0 ? (
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
                      {p.type && <span className="shrink-0 text-[11px] text-[#9e9e9e]">{p.type}</span>}
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
        ) : 찾은말 === text ? (
          /* 물어본 끝에 없는 것과, 못 물어본 것. 뒤엣것에 "없어요"를 붙이면 앱이 거짓말을 한다 */
          물어봤나 ? (
            /*
              **"제주에 없다"고는 안 한다.** 카카오가 0을 준 건 "이 조각으로는 못 맞췄다"까지고,
              실제로 "스타벅"은 0인데 "스타벅스"는 세 곳이 나온다. 알 수 없는 것을 단정하지 않는다
              (엔터로 확정할 때는 findPlace 가 사유를 말한다 — 거긴 다 친 뒤라 단정해도 된다).
            */
            <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">
              &lsquo;{text}&rsquo;로는 못 찾았어요.
              <br />
              이름을 조금 더 적어보세요.
            </p>
          ) : (
            <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">
              지금은 장소를 찾아볼 수 없어요.
              <br />
              잠시 뒤에 다시 쳐보세요.
            </p>
          )
        ) : (
          <p className="py-2 text-[13px] leading-[22px] text-[#9e9e9e]">검색 결과를 찾는 중…</p>
        )
      ) : (
        /* 최근 검색어. 없으면 목록째 빠진다 (빈 제목만 남으면 고장 난 것처럼 보인다) */
        recent.length > 0 && (
          <>
            <h2 className="text-[14px] leading-[22px] font-bold text-[#1f1f1f]">최근 검색어</h2>
            <ul className="mt-2">
              {recent.map((r) => (
                /*
                  한 줄에 두 버튼이라 <li> 를 flex 로 두고 버튼을 나란히 놓는다 — 버튼 안에 버튼을
                  못 넣으니 검색과 삭제를 형제로 가른다 (/destination 과 같은 모양).
                */
                <li key={r} className="flex items-center gap-2 py-2">
                  <button
                    onClick={() => pickName(r)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <img
                      src="/home/icon-search.svg"
                      alt=""
                      aria-hidden
                      className="size-[15px] shrink-0 opacity-60"
                    />
                    <span className="truncate text-[14px] leading-[22px] text-[#1f1f1f]">{r}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecent((prev) => removeRecent(prev, r))}
                    aria-label={`최근 검색어에서 ${r} 삭제`}
                    className="shrink-0 p-1 transition hover:opacity-40 active:scale-90"
                  >
                    <img
                      src="/home/icon-close.svg"
                      alt=""
                      aria-hidden
                      /* 평소에도 옅다 — 목록에서 지우기가 이름보다 세면 안 된다. 호버는 버튼이 맡는다 */
                      className="size-4 opacity-70"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </div>
  );
}
