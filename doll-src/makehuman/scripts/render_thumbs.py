"""
render_thumbs.py -- 돌 GLB 여러 개를 **같은 축척**(바닥 맞춤, 2.0 m 틀) 정면으로 찍어 뎃생 돌 고르기 썸네일을 만든다.
한 Blender 프로세스에서 차례로 불러와 찍는다(프로세스 21번 띄우는 것보다 빠르다). 배경은 투명.

  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python render_thumbs.py -- <out_dir> <glb> [<glb> ...]
  (glb 는 out/<이름>.glb 의 경로. 결과: <out_dir>/<이름>.png, 300×400)

돌마다 축척을 맞추는 preview 와 달리 틀이 고정이라 SD·유아·모델핏의 키·등신 차이가 그대로 보인다.
"""
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    raise SystemExit("usage: ... -- <out_dir> <glb> [<glb> ...]")
out_dir = os.path.abspath(args[0])
os.makedirs(out_dir, exist_ok=True)
glbs = [os.path.abspath(p) for p in args[1:]]

FRAME_H = 2.0  # m — 가장 큰 돌(190cm)도 머리 위 여유가 남는다
RES = (300, 400)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.show_object_outline = True
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.film_transparent = True
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


for glb in glbs:
    clear()
    try:
        bpy.ops.import_scene.gltf(filepath=glb, bone_heuristic='TEMPERANCE')
    except TypeError:
        bpy.ops.import_scene.gltf(filepath=glb)
    body = next(o for o in scene.objects if o.type == 'MESH' and o.modifiers)
    ws = [body.matrix_world @ v.co for v in body.data.vertices]
    lo = Vector((min(v.x for v in ws), min(v.y for v in ws), min(v.z for v in ws)))
    hi = Vector((max(v.x for v in ws), max(v.y for v in ws), max(v.z for v in ws)))
    cx = (lo.x + hi.x) / 2
    cy = (lo.y + hi.y) / 2

    cam_data = bpy.data.cameras.new("ThumbCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = FRAME_H  # 세로가 긴 틀이라 세로 = FRAME_H
    cam = bpy.data.objects.new("ThumbCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # 발바닥이 틀 바닥에서 조금 위에 오도록(바닥 맞춤) — 캐릭터는 -Y 를 본다
    look = Vector((cx, cy, lo.z + FRAME_H / 2 - 0.05))
    cam.location = Vector((cx, cy - 5.0, look.z))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()

    name = os.path.splitext(os.path.basename(glb))[0]
    scene.render.filepath = os.path.join(out_dir, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("[thumb] %s  height=%.3fm -> %s" % (name, hi.z - lo.z, scene.render.filepath), flush=True)

print("[thumb] DONE")
