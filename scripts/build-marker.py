# 목적지 마커(public/icon-pin-character.png) 생성 — 저장소 루트에서 python3 scripts/build-marker.py
#
# 흰 원 배지 안에 마스코트, 아래로 뾰족한 꼬리. 꼬리 끝이 좌표에 앉는다.
#
# 캐릭터만 마커로 쓰면 카카오가 그리는 제 POI 아이콘들 사이에 묻히고, 어디가 정확히 목적지인지도
# 안 보인다 — 핀 실루엣이 그 두 가지를 동시에 푼다.
#
# 크기와 대비가 이 그림의 본론이다. 처음엔 44px 로 만들었는데 지도 아이콘(20~24px)과 덩치가
# 비슷해 눈에 안 들어왔다. 세 가지를 같이 올린다:
#   1) 56px 로 키운다 — 지도 아이콘의 두 배가 넘어야 "이건 다른 종류"로 읽힌다
#   2) 주황 테두리 바깥에 흰 테두리를 한 겹 더 — 초록 공원이든 노란 도로든 어디 위에서나 윤곽이 산다
#   3) 그림자 — 지도에서 한 겹 떠 보이게 한다. 납작하면 지도 무늬의 일부로 보인다
#
# PIL 다각형은 안티에일리어싱이 없어서 4배로 그린 뒤 줄인다.
# 결과는 표시 크기의 2배로 저장한다 — 레티나에서 안 뭉개질 만큼이고, 그 이상은 용량만 는다.

from PIL import Image, ImageDraw, ImageFilter

S = 4                       # 초과표본 배수
DW, DH = 56, 74             # 표시 크기 (그림자 자리 포함)
TIP_PAD = 6                 # 꼬리 끝 아래로 남기는 그림자 자리
W, H = DW * S, DH * S
TIP_Y = H - TIP_PAD * S     # 좌표에 앉는 점
R = 26 * S                  # 바깥 원 반지름
CX, CY = W // 2, R + 1 * S
WHITE_RING = 3 * S          # 바깥 흰 테두리
ORANGE_RING = 3 * S         # 그 안쪽 주황 테두리
ORANGE = (252, 127, 53, 255)
WHITE = (255, 255, 255, 255)


def pin(draw: ImageDraw.ImageDraw, grow: int, fill) -> None:
    """핀 실루엣(원 + 꼬리) 한 겹. grow 만큼 부풀려 테두리·그림자로 쓴다."""
    r = R + grow
    draw.polygon(
        [(CX - 11 * S - grow, CY + r - 6 * S), (CX + 11 * S + grow, CY + r - 6 * S), (CX, TIP_Y + grow)],
        fill=fill,
    )
    draw.ellipse([CX - r, CY - r, CX + r, CY + r], fill=fill)


img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# 그림자 — 실루엣을 흐린 뒤 아래로 조금 내린다. 진하면 때처럼 보여서 옅게 깐다.
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pin(ImageDraw.Draw(shadow), 0, (0, 0, 0, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(3 * S))
img.alpha_composite(shadow, (0, 2 * S))

d = ImageDraw.Draw(img)
pin(d, 0, WHITE)                                  # 바깥 흰 테두리
pin(d, -WHITE_RING, ORANGE)                       # 주황 테두리
d.ellipse(                                        # 속을 흰색으로 파낸다
    [
        CX - R + WHITE_RING + ORANGE_RING,
        CY - R + WHITE_RING + ORANGE_RING,
        CX + R - WHITE_RING - ORANGE_RING,
        CY + R - WHITE_RING - ORANGE_RING,
    ],
    fill=WHITE,
)

# 마스코트를 원 안에 담는다.
# **투명 여백을 먼저 잘라낸다.** splash.png 는 675x900 중 캐릭터가 (131,232)~(548,697) 뿐이라
# 넓이의 68% 가 빈 공간이다. 그대로 넣으면 원에 맞춘 건 그림이고 캐릭터는 그 절반만 한 크기로 앉는다 —
# 마커를 56px 로 키우고도 캐릭터가 작아 보였던 이유가 이것이다.
mascot = Image.open("public/character/splash.png").convert("RGBA")
mascot = mascot.crop(mascot.getbbox())

inner = (R - WHITE_RING - ORANGE_RING) * 2 - 2 * S
mascot.thumbnail((inner, inner), Image.LANCZOS)
img.alpha_composite(mascot, (CX - mascot.width // 2, CY - mascot.height // 2))

img.resize((DW * 2, DH * 2), Image.LANCZOS).save("public/icon-pin-character.png")
print(f"public/icon-pin-character.png  표시 {DW}x{DH}, 앵커 ({DW // 2}, {TIP_Y // S})")
