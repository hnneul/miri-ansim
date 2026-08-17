"""스플래시 로고("미리 안심")를 SVG 외곽선으로 뜬다 → app/page.tsx 의 LOGO_PATH.

왜 글자가 아니라 패스인가
    로고 서체(여기어때 잘난체 2)는 파일이 2.7MB 다. 다섯 글자 쓰자고 한글 11,172자를 받아오는
    셈이었고, 서브셋으로 줄이는 건 라이선스가 막는다("임의 수정·개작하여 재배포" 금지).
    글자를 이미지·로고로 쓰는 건 허용되므로, 외곽선만 떠서 페이지에 넣는다 (1.9KB).

    덤으로 font-display: swap 이 만들던 깜빡임이 없어진다 — 폰트가 늦게 오면 Noto 로 먼저
    그렸다가 바뀌었고, 스플래시가 1.6초뿐이라 첫 방문에서는 Noto 인 채로 지나갈 수 있었다.

쓰는 법
    로고 문구나 크기를 바꿀 때만 돌린다. **폰트 파일은 저장소에 없다** — 2.7MB 를 뺀 게 이
    작업의 목적이라서다. 공식 배포처(gccompany.co.kr/font)에서 Jalnan2.otf 를 받아 경로로 준다.

        python3 scripts/build-logo.py ~/Downloads/Jalnan2.otf

    찍히는 두 줄(viewBox, const LOGO_PATH)을 app/page.tsx 에 그대로 옮긴다.

    fonttools 가 필요하다: python3 -m pip install fonttools
"""

import sys

from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

TEXT = "미리 안심"
# app/page.tsx 가 쓰던 글자 크기 그대로다 (와이어프레임 값).
SIZE = 43.267


def main(otf: str) -> None:
    font = TTFont(otf)
    scale = SIZE / font["head"].unitsPerEm
    glyphs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    ascent = font["hhea"].ascent * scale

    # 좌표는 소수 첫째 자리까지만. 그대로 두면 4.9KB 인데 51px 짜리 그림에서 그 아래 자리는
    # 화면에 나타나지 않는다 (1.9KB 로 준다).
    ntos = lambda v: f"{round(v, 1):g}"  # noqa: E731

    x, parts = 0.0, []
    for ch in TEXT:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs, ntos=ntos)
        # y 를 뒤집고(폰트는 위가 +) ascent 만큼 내려 viewBox 원점을 글자 위쪽에 맞춘다
        glyphs[name].draw(TransformPen(pen, Transform(scale, 0, 0, -scale, x, ascent)))
        if d := pen.getCommands():
            parts.append(d)
        x += hmtx[name][0] * scale

    height = (font["hhea"].ascent - font["hhea"].descent) * scale
    print(f'viewBox="0 0 {round(x, 1):g} {round(height, 1):g}"')
    print(f'className="h-[{round(height, 1):g}px] w-[{round(x, 1):g}px]"')
    print()
    print(f'const LOGO_PATH =\n  "{" ".join(parts)}";')


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(f"쓰는 법: python3 {sys.argv[0]} <Jalnan2.otf 경로>")
    main(sys.argv[1])
