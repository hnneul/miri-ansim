# OpenAI 모델별 한도 확인 — python3 scripts/openai-limits.py
#
# 결제 전후로 돌려 그대로 비교한다. 티어별 RPM/TPM 표는 공개 문서에 없고 계정 설정
# 페이지에만 있어서, 코드로 확인하려면 응답 헤더를 읽는 수밖에 없다.
#
# **요청한도(x-ratelimit-limit-requests) 칸이 판정 기준이다.**
#   50  → Free 티어. 하루 50건이라 대량 판독이 불가능하다.
#   500 → Tier 1. 이 값은 RPM 이고 하루 한도(RPD)는 gpt-5 계열에 안 붙는다.
#
# 각 모델에 1토큰짜리 요청을 하나씩 보낸다 — Free 티어에서는 이것도 하루 50건에서 깎인다.

import json, os, sys, urllib.request

MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.1", "gpt-5",
          "gpt-4.1", "gpt-4o", "gpt-4o-mini"]

env = os.path.join(os.path.dirname(__file__), "..", ".env.local")
KEY = next((l.split("=", 1)[1].strip().strip('"') for l in open(env)
            if l.startswith("OPENAI_API_KEY")), None)
if not KEY:
    sys.exit("OPENAI_API_KEY 없음 (.env.local)")

print(f"{'모델':<15}{'요청한도':>9}{'남음':>7}{'토큰/분':>10}{'리셋':>16}")
for m in MODELS:
    body = {"model": m, "max_completion_tokens": 16,
            "messages": [{"role": "user", "content": "hi"}]}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                                 data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {KEY}",
                                          "Content-Type": "application/json"})
    try:
        h = dict(urllib.request.urlopen(req, timeout=60).headers)
        note = ""
    except urllib.error.HTTPError as e:
        h, note = dict(e.headers), f" ({e.code})"   # 429 여도 헤더에 한도는 실려 온다
    except Exception as e:
        print(f"{m:<15} 오류 {e}")
        continue
    g = lambda k: h.get(k, "-")
    print(f"{m:<15}{g('x-ratelimit-limit-requests'):>9}{g('x-ratelimit-remaining-requests'):>7}"
          f"{g('x-ratelimit-limit-tokens'):>10}{g('x-ratelimit-reset-requests'):>16}{note}")

print("\n요청한도 50 = Free 티어 · 500 = Tier 1")
