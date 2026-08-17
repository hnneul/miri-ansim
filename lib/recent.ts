// 최근 검색어. 저장소가 없어 브라우저(localStorage)에 둔다 — 새로고침에 살아남으면 되고,
// 기기 간 동기화는 필요 없다.
//
// **목적지 화면과 길 비교 화면이 같은 목록을 본다.** 한쪽에서 찾은 곳이 다른 쪽에서 안 보이면
// 사용자에게는 같은 앱의 같은 검색인데 기억이 두 벌인 셈이 된다. 그래서 키도 규칙도 여기 한 곳이다.
//
// localStorage 는 서버에 없고, 사파리 비공개 모드에서는 쓰기가 예외를 던진다.
// 여기서 다 막는다 — 최근 검색어 때문에 화면이 죽는 일은 없어야 한다.

const KEY = "gilansim:recent";
const MAX = 5;

/** 저장된 목록. 값이 깨졌거나 못 읽으면 빈 목록으로 시작한다. */
export function loadRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((s) => typeof s === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(list: string[]): string[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 못 써도 이번 화면에서는 목록이 그대로 보인다 — 다음에 열면 없을 뿐이다 */
  }
  return list;
}

/**
 * 맨 앞에 넣는다. **찾은 이름으로 저장한다** — 다시 눌렀을 때 같은 곳이 나오는 게
 * 사용자가 친 오타를 그대로 남기는 것보다 낫다.
 */
export const addRecent = (prev: string[], name: string): string[] =>
  save([name, ...prev.filter((r) => r !== name)].slice(0, MAX));

export const removeRecent = (prev: string[], name: string): string[] =>
  save(prev.filter((r) => r !== name));
