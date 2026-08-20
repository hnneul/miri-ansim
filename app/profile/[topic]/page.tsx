"use client";

// 서비스 정보 상세 — 마이 화면(app/profile)의 네 줄이 여는 자리다 (Figma SETTING-01~04).
//
// **네 화면이 한 라우트다.** 글의 모양이 넷 다 같아서다 — 소제목 · 문단 · 카드 목록 세 가지로
// 다 그려진다 (lib/serviceinfo.ts Block). 파일을 넷으로 나누면 같은 껍데기를 네 번 적게 된다.
//
// 글은 여기 없다. lib/serviceinfo.ts 에 있고 목록 화면도 같은 표를 읽는다 —
// 목록의 제목과 상세의 제목이 갈리지 않게 하려는 것이다.
//
// 쿼리는 그대로 물고 다닌다. 뒤로 가면 마이 화면이고, 거기서 프로필을 되읽어야 한다 (lib/profile.ts).

import { Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { notFound } from "next/navigation";
import StatusBar from "../../StatusBar";
import { topicOf, type Block } from "@/lib/serviceinfo";

// useSearchParams 는 프리렌더 때 Suspense 경계가 필요하다 (Next 16 문서 use-search-params.md)
export default function TopicPage() {
  return (
    <Suspense>
      <Topic />
    </Suspense>
  );
}

function Topic() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 동적 조각은 클라이언트에서 useParams 로 읽는다 (Next 16 문서 use-params.md)
  const { topic } = useParams<{ topic: string }>();
  const t = topicOf(topic);
  if (!t) notFound();

  return (
    <div className="flex flex-1 flex-col bg-white">
      <StatusBar tone="text-[#1f1f1f]" />

      {/*
        제목이 길어 마이 화면처럼 가운데 두지 않는다 ("추천점수 계산 기준"이 뒤로가기와 겹친다).
        와이어프레임(SETTING-01)도 뒤로가기 오른쪽에 왼쪽맞춤으로 크게 적고 아래 실선을 둔다.
      */}
      <div className="flex h-14 shrink-0 items-center border-b border-[#ededed] pr-4">
        <button
          // 시작 화면의 약관 줄에서 들어오면 거기로 돌려보낸다 (app/Intro.tsx Legal) —
          // 기본값인 마이 화면으로 보내면 아직 프로필도 안 만든 사람이 온보딩을 건너뛴 자리에 떨어진다
          onClick={() =>
            router.push(searchParams.get("back") === "intro" ? "/intro" : `/profile?${searchParams}`)
          }
          aria-label="뒤로"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-[#262626] transition hover:bg-[#fff0e6] active:scale-90"
        >
          ‹
        </button>
        <h1 className="min-w-0 truncate text-[19px] leading-none font-bold text-[#1f1f1f]">{t.title}</h1>
      </div>

      {/* 안쪽에 스크롤을 따로 두지 않는다 — 폰 프레임(.phone)이 이미 스크롤이다 (app/profile 과 같다) */}
      <div className="px-4 pt-4 pb-10">
        <p className="rounded-[12px] bg-[#fff0e6] px-[13px] py-3 text-[13px] leading-[1.6] whitespace-pre-line text-[#616161]">
          {t.lead}
        </p>
        {t.blocks.map((b, i) => (
          <Chunk key={i} block={b} />
        ))}
      </div>
    </div>
  );
}

/**
 * 덩이 하나. 소제목은 위 여백을 크게 두어 앞 덩이와 갈라 놓는다 —
 * 문단과 카드가 이어질 때는 그만큼의 틈이 필요 없다.
 */
function Chunk({ block }: { block: Block }) {
  if ("h" in block)
    return (
      <h2 className="mt-7 mb-2 pl-[13px] text-[15px] leading-normal font-bold text-[#1f1f1f]">{block.h}</h2>
    );

  // \n 을 살린다 — 계산식처럼 줄을 나눠야 읽히는 문단이 있다 (lib/serviceinfo.ts "점수를 매기는 식")
  if ("p" in block)
    // label 이 달린 문단은 화면이 꼭 쥐고 가야 하는 한 줄이다 — 주황 제목을 얹고 바탕을 바꾼다.
    // 소제목(h)을 따로 두지 않는다. 라벨이 그 자리라 둘 다 적으면 같은 말이 두 번 나온다.
    return (
      <div
        className={`mt-2 rounded-[12px] px-[13px] py-3 ${block.label ? "bg-[#fff0e6]" : "bg-[#f5f7f7]"}`}
      >
        {block.label && (
          <p className="mb-1.5 text-[12px] leading-normal font-bold text-[#ff6114]">{block.label}</p>
        )}
        <p className="text-[12.5px] leading-[1.7] whitespace-pre-line text-[#616161]">{block.p}</p>
      </div>
    );

  return (
    <div className="mt-2 flex flex-col gap-2">
      {block.rows.map((r, i) => (
        <div
          key={r.k}
          className="flex items-start justify-between gap-3 rounded-[12px] border border-[#e6e6e6] bg-white px-[13px] py-3"
        >
          {/*
            번호 뱃지. 와이어프레임은 카드를 122~163px 로 잡아 글 아래가 비는데 그 여백은 뺐다 —
            채울 것이 없는 빈칸이라, 그대로 옮기면 뭔가 안 그려진 카드로 보인다.
            뱃지는 아이콘이 아니라 세는 수라 aria-hidden 하지 않는다 (읽어 주면 "01 카카오…" 로 들린다).
          */}
          {block.numbered && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#fff0e6] text-[13px] leading-none font-bold text-[#ff6114]">
              {String(i + 1).padStart(2, "0")}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-normal font-medium text-[#1f1f1f]">{r.k}</p>
            {r.d && <p className="mt-1 text-[12px] leading-[1.55] text-[#616161]">{r.d}</p>}
          </div>
          {/* 값은 줄바꿈 없이 오른쪽에 붙는다 — "×1.6" 이 두 줄로 쪼개지면 숫자로 안 읽힌다 */}
          {r.v && <span className="shrink-0 pt-px text-[13px] leading-normal font-medium text-[#ff6114]">{r.v}</span>}
        </div>
      ))}
    </div>
  );
}
