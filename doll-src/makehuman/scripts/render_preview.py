"""
render_preview.py -- import a GLB and render front + side + top-down-ish preview PNGs (Workbench, headless).

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python render_preview.py -- <file.glb> <out_prefix>
Produces <out_prefix>_front.png, <out_prefix>_side.png, <out_prefix>_bones.png (bones drawn in front of the mesh).
"""
import sys
import os
import math
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    raise SystemExit("usage: ... -- <file.glb> <out_prefix>")
glb_path = os.path.abspath(args[0])
out_prefix = os.path.abspath(args[1])
os.makedirs(os.path.dirname(out_prefix), exist_ok=True)

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
try:
    bpy.ops.import_scene.gltf(filepath=glb_path, bone_heuristic='TEMPERANCE')
except TypeError:
    bpy.ops.import_scene.gltf(filepath=glb_path)

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.modifiers)
ws = [body.matrix_world @ v.co for v in body.data.vertices]
lo = Vector((min(v.x for v in ws), min(v.y for v in ws), min(v.z for v in ws)))
hi = Vector((max(v.x for v in ws), max(v.y for v in ws), max(v.z for v in ws)))
center = (lo + hi) / 2
height = hi.z - lo.z
span = max(hi.x - lo.x, height) * 1.1

# ground grid for reference
bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=10, size=2.0, location=(0, 0, 0))
grid = bpy.context.object
grid.display_type = 'WIRE'
grid.name = "GroundGrid"

cam_data = bpy.data.cameras.new("PreviewCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = span
cam = bpy.data.objects.new("PreviewCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.show_object_outline = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1000
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new("W") if scene.world is None else scene.world
scene.world = world
world.color = (0.9, 0.9, 0.9)

# Armatures are never rendered, so build a "bone cone" mesh (one thin cone per bone, head -> tail) for the bones view.
bone_mat = bpy.data.materials.new("BoneViz")
bone_mat.diffuse_color = (0.95, 0.25, 0.1, 1.0)
joint_mat = bpy.data.materials.new("JointViz")
joint_mat.diffuse_color = (0.1, 0.3, 0.95, 1.0)
bone_objs = []
for b in arm.data.bones:
    h = arm.matrix_world @ b.head_local
    t = arm.matrix_world @ b.tail_local
    d = t - h
    if d.length < 1e-6:
        continue
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=min(0.012, d.length * 0.2), radius2=0.002, depth=d.length,
                                    location=h + d / 2)
    cone = bpy.context.object
    cone.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    cone.data.materials.append(bone_mat)
    cone.hide_render = True
    bone_objs.append(cone)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.012, location=h)
    sph = bpy.context.object
    sph.data.materials.append(joint_mat)
    sph.hide_render = True
    bone_objs.append(sph)


def shoot(name, cam_loc, look_at, show_bones=False):
    cam.location = cam_loc
    direction = Vector(look_at) - Vector(cam_loc)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    for o in bone_objs:
        o.hide_render = not show_bones
    scene.display.shading.show_xray = show_bones
    scene.display.shading.xray_alpha = 0.35
    scene.display.shading.color_type = 'MATERIAL'
    scene.render.filepath = f"{out_prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
    print("[preview] wrote", scene.render.filepath)

# Blender axes: character faces -Y; front camera sits at -Y looking +Y
shoot("front", (center.x, center.y - 5.0, center.z), center)
shoot("side", (center.x + 5.0, center.y, center.z), center)
shoot("bones", (center.x, center.y - 5.0, center.z), center, show_bones=True)
# 3/4 view from front-left-above for a quick look at palms/elbows
shoot("threequarter", (center.x - 3.5, center.y - 3.5, center.z + 1.5), center)
print("[preview] DONE")
