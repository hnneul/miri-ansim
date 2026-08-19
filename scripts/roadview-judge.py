# 로드뷰 사진으로 비보호 좌회전 판독 —
#   python3 scripts/roadview-judge.py <수집폴더>/index.json [모델]
#
# roadview-fetch.py 가 받아둔 사진을 비전 모델에 보내 verdict 를 채운다. 사람이 로드뷰를
# 하나씩 열어 판독하던 걸 대신한다 (public/roadview-tag.html · scripts/left-turn-set.mjs).
#
# **판정 기준은 roadview-tag.html 의 것을 그대로 쓴다.** 사람과 같은 기준으로 판정해야
# 이미 사람이 채워둔 지점이 정답지로 쓰인다.
#
# 실측 (판독표 15곳, 사람 판정과 대조):
#   1장씩 보낼 때   일치 6/15 · 판단불가 8 · 거짓 비보호 0
#   6장씩 보낼 때   일치 9/15 · 판단불가 4 · 거짓 비보호 0
#   gpt-5.4-mini 는 좌회전"금지" 원형표지를 비보호로 읽은 적이 있다 — **쓰지 말 것.**
#   토큰 차이가 27% 뿐인데 뒤집는 방향의 오판이라 값어치가 없다.
#
# 안 보이면 반드시 판단불가로 떨어뜨린다. lib/unprotected.ts 가 판단불가를 만나면 null 을
# 내고 화면이 "확인 안 됨"으로 적으므로, **틀린 숫자는 나가지 않는다.**

import json, sys, os, base64, time, urllib.request

MODEL = "gpt-5.4"
SLEEP = 3       # 초. 주기 ~6초 = 분당 10건 = 124,000 TPM (한도 200,000 의 62%).
                # 여유를 두지 않으면 429 로 되돌아온다. 급하면 줄이되 Retry-After 를 지킬 것.

PROMPT = """같은 교차로를 카카오 로드뷰의 서로 다른 위치·배율로 찍은 사진들이다.
사진 한가운데 방향이 차량이 이 교차로로 진입하는 방향이다. 'wide'는 180° 전경,
'zoom'은 같은 장면의 신호등 높이를 확대한 것이다.
이 진입 방향에서 좌회전할 때 비보호 좌회전인지 판정하라.

판정 기준:
- 비보호 : "비보호" 규제표지(파란 바탕 + 좌회전 화살표 + "비보호" 글자)가 붙어 있다.
           **주의: 빨간 테두리 원형에 좌회전 화살표를 사선으로 그은 것은 좌회전"금지"다.
           비보호가 아니라 정반대다. 혼동하지 마라.**
- 보호   : 좌회전 화살표 등화가 있다(4구 신호등). 유턴 표지의 "좌회전시" 문구도 같은 뜻이다.
- 무신호 : 교차로에 차량 신호등이 없다. **신호등이 안 보이는 것 자체가 무신호의 근거다** —
           교차로 전체가 사진에 들어와 있는데 기둥식·현수식 신호등이 하나도 없으면
           무신호로 판정하라. 이때는 판단불가가 아니다.
- 판단불가: 교차로가 사진 밖으로 잘렸거나 가려져서 신호등 유무 자체를 못 본다 /
           신호등은 보이는데 등화 개수와 표지를 끝내 못 읽는다.

**보호·비보호는 확실할 때만 적어라.** 안 보이는 것을 보호로 적으면 확인한 사실처럼 읽힌다.
사진 여러 장 중 **한 장에서라도 확정 근거가 보이면 그것으로 판정한다.**

JSON 만 출력: {"verdict":"비보호|보호|무신호|판단불가","basis":"어느 사진의 무엇을 보고 정했나","confidence":0.0~1.0}"""


# 2차 재확인용. 1차(mini)가 비보호라 했거나 확신이 낮았던 것만 비싼 모델로 다시 본다.
#
# **1차 판정은 알려주지 않는다.** 보여주면 거기에 끌려가서 재확인이 추인으로 바뀐다.
#
# 색 조건을 못 박은 이유 — 1차 실측에서 비보호 근거를 "중앙 빨간 표지", "녹색 안내표지"로
# 적은 건이 나왔다. 비보호 규제표지는 파란 바탕뿐이라 이 둘은 각각 금지표지와 방향안내판이다.
# 색은 사진이 흐려도 남는 단서라 판정을 붙들어 매기에 좋다.
VERIFY_PROMPT = """같은 교차로를 카카오 로드뷰의 서로 다른 위치·배율로 찍은 사진들이다.
사진 한가운데 방향이 차량이 이 교차로로 진입하는 방향이다. 'wide'는 180° 전경,
'zoom'은 같은 장면의 신호등 높이를 확대한 것이다.
이 진입 방향에서 좌회전할 때 비보호 좌회전인지 판정하라.

**비보호 표지는 파란 바탕이다. 색부터 확인하라.**
- 비보호 규제표지 = **파란 바탕** + 흰 좌회전 화살표 + 흰 "비보호" 글자. 이것만이 비보호 근거다.
- **빨간 테두리 원형**에 좌회전 화살표를 사선으로 그은 것 = 좌회전"금지". 정반대다.
- **녹색·파란 대형 방향안내판**(지명·도로번호가 적힌 판)은 규제표지가 아니다.
  거기 좌회전 화살표가 있어도 비보호 근거가 **아니다**.
- 파란 바탕 규제표지를 확인하지 못했으면 **비보호로 판정하지 마라.**

나머지 기준:
- 보호   : 좌회전 화살표 등화가 있다(4구 신호등). 유턴 표지의 "좌회전시" 문구도 같은 뜻이다.
- 무신호 : 교차로에 차량 신호등이 없다. 신호등이 안 보이는 것 자체가 무신호의 근거다 —
           교차로 전체가 사진에 들어와 있는데 기둥식·현수식 신호등이 하나도 없으면 무신호다.
- 판단불가: 교차로가 사진 밖으로 잘렸거나 가려져 신호등 유무 자체를 못 본다 /
           신호등은 보이는데 등화 개수와 표지를 끝내 못 읽는다.

JSON 만 출력: {"verdict":"비보호|보호|무신호|판단불가","basis":"표지 색을 포함해, 어느 사진의 무엇을 보고 정했나","confidence":0.0~1.0}"""


def targets(index_path, first_model):
    """2차 대상 — 비보호 / 판단불가 / 확신 0.85 미만. 나머지는 1차 판정을 그대로 쓴다."""
    first = json.load(open(index_path.replace("index.json", f"verdict-{first_model}.json")))
    by = {o["key"]: o for o in first}
    picked = [o for o in first
              if o["verdict"] in ("비보호", "판단불가", "ERR", None)
              or (o.get("confidence") or 1) < 0.85]
    return picked, by


def key():
    env = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    for line in open(env):
        if line.startswith("OPENAI_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("OPENAI_API_KEY 없음 (.env.local)")


KEY = key()


def ask(model, files, prompt=PROMPT):
    content = [{"type": "text", "text": prompt}]
    for f in files:
        content.append({"type": "text", "text": os.path.basename(f).replace(".jpg", "")})
        content.append({"type": "image_url", "image_url": {
            "url": "data:image/jpeg;base64," + base64.b64encode(open(f, "rb").read()).decode(),
            "detail": "high"}})
    body = {"model": model, "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": content}]}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                                 data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {KEY}",
                                          "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.load(r)
            return json.loads(d["choices"][0]["message"]["content"]), d["usage"]["total_tokens"]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 503):
                return {"verdict": "ERR", "basis": e.read().decode()[:150]}, 0
            # **서버가 알려주는 만큼만 기다린다.** 임의 백오프를 쓰다가 하루 한도가 이미
            # 바닥난 상태에서 46분을 잠든 적이 있다.
            wait = float(e.headers.get("retry-after", 20))
            print(f"   HTTP {e.code} — {wait:.0f}초 대기 ({attempt+1}/5)", flush=True)
            if wait > 120:
                return {"verdict": "ERR", "basis": f"쿼터 소진 (재시도까지 {wait:.0f}초)"}, 0
            time.sleep(wait + 2)
        except Exception as e:
            print(f"   재시도 {attempt+1}/5 — {type(e).__name__}: {str(e)[:80]}", flush=True)
            time.sleep(5)
    return {"verdict": "ERR", "basis": "retry 소진"}, 0


def main(index_path, model, verify_of=None):
    if verify_of:
        # 2차 — 1차가 미심쩍다고 남긴 것만 본다. 프롬프트도 색 조건이 들어간 쪽으로 바꾼다.
        idx, _ = targets(index_path, verify_of)
        prompt = VERIFY_PROMPT
        out_path = index_path.replace("index.json", f"verdict-verify-{model}.json")
        print(f"2차 재확인 {len(idx):,}건 (1차 {verify_of} 기준)", flush=True)
    else:
        idx = json.load(open(index_path))
        prompt = PROMPT
        out_path = index_path.replace("index.json", f"verdict-{model}.json")
    # 이미 판정된 지점은 건너뛴다 — 판정은 돈이 든다. 한 번 받은 답을 다시 사지 않는다.
    done = {o["key"]: o for o in json.load(open(out_path))} if os.path.exists(out_path) else {}

    out, spent = [], 0
    for n, o in enumerate(idx):
        if o["key"] in done and done[o["key"]].get("verdict") != "ERR":
            out.append(done[o["key"]])
            continue
        if not o["files"]:
            out.append({**o, "verdict": "판단불가", "basis": "로드뷰 없음", "confidence": 0})
            continue
        time.sleep(SLEEP)
        v, tok = ask(model, o["files"], prompt)
        spent += tok
        out.append({**o, "verdict": v.get("verdict"), "basis": v.get("basis"),
                    "confidence": v.get("confidence"), "tok": tok})
        print(f"{n:>6} {o['label']:<16} {str(v.get('verdict')):<5} ({v.get('confidence')}) "
              f"{str(v.get('basis'))[:60]}", flush=True)
        json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1)

    from collections import Counter
    print(f"\n{Counter(o['verdict'] for o in out).most_common()}")
    print(f"이번 실행 토큰 {spent:,} → {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용법: python3 scripts/roadview-judge.py <수집폴더>/index.json [모델] [--verify-of=<1차모델>]")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    v = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--verify-of=")), None)
    main(args[0], args[1] if len(args) > 1 else MODEL, v)
