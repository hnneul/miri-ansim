# 로드뷰 사진 수집 — python3 scripts/roadview-fetch.py <입력.json> <출력폴더>
#
# 비보호 좌회전을 제주 전역에서 판독하려면 지점마다 로드뷰 사진이 필요하다.
# 카카오는 로드뷰 정적 이미지 API를 주지 않아서 원래는 브라우저로 띄워 캡처해야 했는데,
# SDK가 부르는 내부 엔드포인트를 그대로 부르면 브라우저 없이 받아진다. 2만 지점을
# 감당할 수 있는 건 이 형태뿐이다 — 헤드리스 브라우저면 지점당 몇 초씩 걸려 못 돌린다.
#
#   ① lat/lng → EPSG:5181 → ×2.5 = WCONG   (아래 상수, 응답의 wtmx/wcongx 로 검증했다)
#   ② rv.map.kakao.com/roadview-search/v2/nodes  → id, img_path, angle, shot_date  (인증 불필요)
#   ③ map.daumcdn.net/map_roadview{img_path}_cube/{면}_1200.jpg
#
# **공개 문서에 없는 내부 엔드포인트다.** 예고 없이 바뀔 수 있고, 대량 호출 전에
# 이용약관 확인과 호출 간격은 짚고 가야 한다. 그래서 SLEEP 을 기본으로 둔다.
#
# 입력 JSON: [{"key":"33.5,126.5", "lat":33.5, "lng":126.5, "bearing":142, "label":"..."}]
# 출력: <출력폴더>/<key>_<n>_{wide,zoom}.jpg + index.json
#
# 필요 패키지: pip3 install pyproj pillow

import json, sys, os, io, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from pyproj import Transformer
from PIL import Image

# 카카오 WCONG = WTM × 2.5. WTM 은 EPSG:5181 이다 — 응답에 wtmx/wcongx 가 같이 실려 와서
# 그걸로 맞춰 확인했다 (오차 0.1m 이내). 추측이 아니라 검증된 값이다.
WTM = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs"
T = Transformer.from_crs("EPSG:4326", WTM, always_xy=True)

NODES = "https://rv.map.kakao.com/roadview-search/v2/nodes"
TILE = "http://map.daumcdn.net/map_roadview{}_cube/{}_1200.jpg"
ORDER = ["front", "right", "back", "left"]  # 시계방향 90° 간격. front 면의 방위가 응답의 angle 이다.

# 지점당 볼 파노라마 수. 한 자리에서 표지가 안 보여도 다른 자리에서 보인다 —
# 1개만 쓰던 때 15곳 중 4곳이 "교차로가 프레임 밖"으로 판독 불가였다.
# 판단불가로 남은 지점만 다시 볼 때는 환경변수로 늘린다 (PANOS=6 RADIUS=120).
PANOS = int(os.environ.get("PANOS", 3))
RADIUS = int(os.environ.get("RADIUS", 70))  # m. 파노라마는 교차로 한복판이 아니라 진입 도로 위에 있다.
ZOOM_DEG = int(os.environ.get("ZOOM_DEG", 45))  # zoom 사진의 시야각. 좁힐수록 배율이 오른다.
SLEEP = 0.3    # 호출 간격 (초) — 순차 경로용
WORKERS = 8    # 동시 실행 수. 지점당 HTTP 13회라 순차로는 몇 시간이다.


def nodes(lat, lng):
    x, y = T.transform(lng, lat)
    q = urllib.parse.urlencode({"PX": x * 2.5, "PY": y * 2.5, "RAD": RADIUS,
                                "INPUT": "wcong", "PAGE_SIZE": 10, "SERVICE": "mapjsapiv3"})
    with urllib.request.urlopen(f"{NODES}?{q}", timeout=20) as r:
        return json.load(r)["street_view"]["streetList"] or []


def stitch(img_path):
    """4면을 이어 붙인 3600×1200 띠. front 면이 x=0..1200 이다."""
    im = Image.new("RGB", (3600, 1200))
    for k, f in enumerate(ORDER):
        with urllib.request.urlopen(TILE.format(img_path, f), timeout=30) as r:
            im.paste(Image.open(io.BytesIO(r.read())).convert("RGB"), (k * 1200, 0))
    return im


def frames(p, bearing):
    """진입 방위를 한가운데 두는 두 장. 면 경계에서 표지가 잘리는 걸 없앤다."""
    rel = (bearing - float(p["angle"])) % 360
    i = int((rel + 45) // 90) % 4
    # rel 이 360° 근처면 i 가 0 으로 감긴다. -45..45 로 되감지 않으면 crop 이 범위를 벗어나
    # 새까만 이미지가 나온다 (실제로 한 번 그랬다).
    off = ((rel - i * 90 + 180) % 360) - 180
    c = 1800 + off / 90 * 1200
    assert 900 <= c <= 2700, f"crop 중심 {c} 이 범위 밖"

    im = stitch(p["img_path"])
    wide = im.crop((int(c - 900), 200, int(c + 900), 1100))              # 180° 전경
    # 신호등·표지는 지평선 위 좁은 띠에 몰려 있다. 잘라 키운다 —
    # "등화 개수를 셀 수 없다"로 판단불가가 나던 걸 이걸로 줄였다.
    #
    # ZOOM_DEG 로 시야를 좁힐수록 배율이 오른다 (45° → 40px/°, 20° → 90px/°).
    # 기본 45°로는 100m 밖 신호등의 등 칸이 몇 픽셀이라 3구·4구가 안 갈린다.
    # 좁히면 그만큼 교차로 전경을 잃으므로, 그 판정이 필요한 지점에만 좁혀서 다시 받는다.
    half = int(1200 * ZOOM_DEG / 90 / 2)
    zoom = im.crop((int(c - half), 260, int(c + half), 710)).resize((1800, 900))
    return wide, zoom


def one(s, out_dir):
    """지점 하나. 파노라마 PANOS 개까지 훑어 wide/zoom 을 저장한다."""
    seen, files, shots = set(), [], []
    for p in nodes(s["lat"], s["lng"]):
        if p["img_path"] in seen:
            continue
        seen.add(p["img_path"])
        try:
            wide, zoom = frames(p, s["bearing"])
        except Exception as e:
            print(f"  {s['label']}: {e}", file=sys.stderr)
            continue
        k = len(shots)
        safe = s["key"].replace(",", "_")
        for tag, img in (("wide", wide), ("zoom", zoom)):
            f = f"{out_dir}/{safe}_{k}_{tag}.jpg"
            img.save(f, quality=88)
            files.append(f)
        shots.append(p["shot_date"][:10])
        if len(shots) >= PANOS:
            break
    return {**s, "files": files, "shots": shots}


def main(src_path, out_dir):
    src = json.load(open(src_path))
    os.makedirs(out_dir, exist_ok=True)
    index_path = f"{out_dir}/index.json"
    # 이미 받은 지점은 건너뛴다 — 수천 지점이면 중간에 끊기는 게 정상이고, 매번 처음부터
    # 다시 받으면 카카오에도 폐다.
    done = {o["key"]: o for o in json.load(open(index_path))} if os.path.exists(index_path) else {}
    todo = [s for s in src if s["key"] not in done]
    print(f"전체 {len(src):,} · 완료 {len(done):,} · 남은 것 {len(todo):,}", flush=True)

    # 지점당 파노라마 조회 1 + 타일 12 회다. 순차로는 몇 시간이 걸려서 동시에 돌린다.
    # WORKERS 를 더 올리지 않는 건 문서에 없는 내부 엔드포인트를 두드리는 일이라서다 —
    # 빨리 끝내자고 남의 서버를 때릴 이유는 없다.
    lock = Lock()
    n = [0]
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(one, s, out_dir): s for s in todo}
        for fut in as_completed(futs):
            s = futs[fut]
            try:
                r = fut.result()
            except Exception as e:
                print(f"  {s['label']}: {e}", file=sys.stderr)
                continue
            with lock:
                done[s["key"]] = r
                n[0] += 1
                if n[0] % 100 == 0:
                    json.dump(list(done.values()), open(index_path, "w"), ensure_ascii=False)
                    print(f"  {len(done):,}/{len(src):,}", flush=True)

    json.dump(list(done.values()), open(index_path, "w"), ensure_ascii=False)
    총 = sum(len(o["files"]) for o in done.values())
    빈것 = sum(1 for o in done.values() if not o["files"])
    print(f"\n{len(done):,}지점 · 사진 {총:,}장 · 로드뷰 없음 {빈것:,} → {index_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("사용법: python3 scripts/roadview-fetch.py <입력.json> <출력폴더>")
    main(sys.argv[1], sys.argv[2])
