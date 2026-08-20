# 크레딧 사용액 감시 — python3 scripts/credit-watch.py <판독폴더> [경고선$]
#
# 판독을 돌리는 동안 얼마나 쓰고 있는지 지켜본다. 경고선을 넘으면 **즉시 끝난다** —
# 백그라운드로 걸어두면 그 종료가 곧 알림이다.
#
# 왜 필요한가 — Tier 1 은 월 사용한도가 $100 이고 잔액도 유한한데, 4,464건 루프는
# 5시간 동안 사람 없이 돈다. 중간에 한도에 걸리면 그때부터의 요청이 전부 429 로 버려지고,
# **어디까지 됐는지 모른 채 아침을 맞는다.** 넘기 전에 알아야 손을 쓴다.
#
# 금액은 OpenAI 에 묻지 않고 우리 판독 결과의 tok 합으로 센다 (Admin 키가 필요 없고,
# 어차피 우리가 쓴 것만 세면 된다). 반올림 때문에 실제와 몇 센트 차이는 난다.

import json, os, sys, time, glob

# $/1M 토큰 — developers.openai.com/api/docs/pricing (2026-08 확인)
PRICE = {
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-5.4": (2.50, 15.00),
    "gpt-5.5": (5.00, 30.00),
}
OUT_RATIO = 0.03          # 출력 토큰 비중. JSON 한 줄이라 작다 — 넉넉히 잡는다.
INTERVAL = 60


def spent(dir_path):
    """<판독폴더>/verdict-<model>.json 을 모두 훑어 모델별 사용액을 낸다."""
    total, by = 0.0, {}
    for f in glob.glob(os.path.join(dir_path, "verdict-*.json")):
        model = os.path.basename(f)[len("verdict-"):-len(".json")]
        model = model[len("verify-"):] if model.startswith("verify-") else model
        # 단가를 모르는 파일은 API 호출 기록이 아니다 (병합본 등). 세면 없는 지출이 생긴다 —
        # 실제로 병합본을 gpt-5.4 단가로 잡아 $71 을 $230 으로 잘못 알린 적이 있다.
        if model not in PRICE:
            continue
        i, o = PRICE[model]
        try:
            rows = json.load(open(f))
        except (json.JSONDecodeError, OSError):
            continue          # 쓰는 중에 읽으면 깨진다. 다음 회차에 다시 본다.
        tok = sum(r.get("tok") or 0 for r in rows)
        c = tok * (1 - OUT_RATIO) / 1e6 * i + tok * OUT_RATIO / 1e6 * o
        by[model] = (len(rows), tok, c)
        total += c
    return total, by


def main(dir_path, limit):
    print(f"감시 시작 — 경고선 ${limit:.2f} · {INTERVAL}초마다 확인", flush=True)
    while True:
        total, by = spent(dir_path)
        line = " · ".join(f"{m} {n:,}건 ${c:.2f}" for m, (n, _, c) in sorted(by.items()))
        print(f"[{time.strftime('%H:%M')}] 합계 ${total:.2f}  ({line})", flush=True)
        if total >= limit:
            print(f"\n⚠ 경고선 ${limit:.2f} 초과 — 현재 ${total:.2f}", flush=True)
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용법: python3 scripts/credit-watch.py <판독폴더> [경고선$]")
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 60.0)
