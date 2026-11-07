"""
build_bodies.py -- bodies.json 의 돌을 모두(또는 고른 것만) Blender 헤드리스로 만들고 미리보기를 찍는다.

  python scripts\build_bodies.py                 # 전부
  python scripts\build_bodies.py mh2_sd mh2_m_hero   # 고른 id 만
  python scripts\build_bodies.py --no-render     # GLB 만

출력: out/<glb>.glb, logs/build2_<glb>.log|json, preview_v3/<glb>_{front,side,threequarter,bones}.png,
      preview_v3/bodies_<view>.png (전체 비교 띠, 이름 표시).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLENDER = os.environ.get("BLENDER", r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe")
S = os.path.join(ROOT, "scripts")
OUT, LOGS, PREV = (os.path.join(ROOT, d) for d in ("out", "logs", "preview_v3"))
for d in (OUT, LOGS, PREV):
    os.makedirs(d, exist_ok=True)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
render = "--no-render" not in sys.argv
spec = json.load(open(os.path.join(ROOT, "bodies.json"), encoding="utf-8"))
dolls = [d for d in spec["dolls"] if not args or d["id"] in args]


def run(script, script_args, log_file):
    with open(log_file, "w", encoding="utf-8") as log:
        r = subprocess.run([BLENDER, "-b", "--python", os.path.join(S, script), "--", *script_args], stdout=log, stderr=subprocess.STDOUT)
    return r.returncode


failed = []
for d in dolls:
    glb = os.path.join(OUT, d["glb"] + ".glb")
    a = ["--gender", d["gender"], "--height", str(d["height"]), "--age", str(d["age"]), "--muscle", str(d["muscle"]),
         "--weight", str(d["weight"]), "--proportions", str(d["proportions"]), "--out", glb,
         "--log", os.path.join(LOGS, "build2_%s.json" % d["glb"])]
    if d.get("targets"):
        a += ["--targets", d["targets"]]
    code = run("build_doll_v2.py", a, os.path.join(LOGS, "build2_%s.log" % d["glb"]))
    print("[%s] %s build exit=%d" % (d["id"], d["name"], code), flush=True)
    if code != 0:
        failed.append(d["id"])
        continue
    if render:
        code = run("render_preview.py", [glb, os.path.join(PREV, d["glb"])], os.path.join(LOGS, "preview3_%s.log" % d["glb"]))
        print("[%s] render exit=%d" % (d["id"], code), flush=True)

if render:
    try:
        from PIL import Image, ImageDraw, ImageFont
        try:
            font = ImageFont.truetype(r"C:\Windows\Fonts\malgun.ttf", 28)  # 한글 이름표
        except OSError:
            font = None
        for view in ("front", "threequarter", "side"):
            tiles = []
            for d in dolls:
                p = os.path.join(PREV, "%s_%s.png" % (d["glb"], view))
                if os.path.exists(p):
                    tiles.append((d["name"], Image.open(p).convert("RGB")))
            if not tiles:
                continue
            h = max(i.height for _, i in tiles) + 40
            w = sum(i.width for _, i in tiles)
            strip = Image.new("RGB", (w, h), "white")
            draw = ImageDraw.Draw(strip)
            x = 0
            for name, img in tiles:
                strip.paste(img, (x, 40))
                draw.text((x + 10, 6), name, fill="black", font=font)
                x += img.width
            strip.save(os.path.join(PREV, "bodies_%s.png" % view))
        print("stitched preview_v3/bodies_*.png")
    except ImportError:
        print("PIL 없음 — 비교 띠는 건너뜀")

print("done; failed:", failed)
sys.exit(1 if failed else 0)
