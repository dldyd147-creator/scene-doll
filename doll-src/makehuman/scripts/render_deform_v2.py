"""
render_deform_v2.py -- import a GLB (the exported file, not the working scene), apply the v2 deformation test poses and
render PNGs with a neutral grey material (Workbench, studio light, cavity on), 900 x 1000 px.

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python render_deform_v2.py -- <file.glb> <out_dir> <prefix>

Poses (Blender axes: character faces -Y, +X is the character's left, Z up; all rotations are world-space rotations of
the pose bone about its own head, so the result does not depend on the bone's local axes):
  1 rest           T-pose, front
  2 armsdown       LeftArm/RightArm rotated 85 deg so the arms hang at the sides; front, back, left-shoulder close-up
  3 elbow110       from T-pose, elbows bent 110 deg with the forearms pointing forward; front
  4 twist          from 3: LeftHand twisted 70 deg about the left forearm axis with LeftForeArmTwist at +35 deg (half);
                   RightHand twisted 70 deg with no twist-bone rotation; front, top, forearm close-up
  5 sit            Hips lowered 0.25 m, thighs 45 deg forward, knees bent 90 deg (shins 45 deg back), feet kept flat; 3/4, side
  6 torso          Spine/Spine1/Spine2 each bent 12 deg forward and twisted 10 deg about their own axis; 3/4, back
If a bone is missing (e.g. a v1 file without twist bones) the corresponding rotation is skipped and reported.
"""
import sys
import os
import math
import bpy
from mathutils import Vector, Matrix, Quaternion

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 3:
    raise SystemExit("usage: ... -- <file.glb> <out_dir> <prefix>")
glb_path = os.path.abspath(args[0])
out_dir = os.path.abspath(args[1])
prefix = args[2]
os.makedirs(out_dir, exist_ok=True)

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
try:
    bpy.ops.import_scene.gltf(filepath=glb_path, bone_heuristic='TEMPERANCE')
except TypeError:
    bpy.ops.import_scene.gltf(filepath=glb_path)

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.modifiers)
missing = []

# --- render setup -----------------------------------------------------------------------------------------------------
cam_data = bpy.data.cameras.new("DeformCam")
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new("DeformCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'SINGLE'
scene.display.shading.single_color = (0.58, 0.58, 0.58)
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.display.shading.curvature_ridge_factor = 1.0
scene.display.shading.curvature_valley_factor = 1.2
scene.display.shading.cavity_ridge_factor = 1.0
scene.display.shading.cavity_valley_factor = 1.5
scene.display.shading.show_object_outline = True
scene.display.shading.show_specular_highlight = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new("W") if scene.world is None else scene.world
scene.world = world
world.color = (0.92, 0.92, 0.92)
# ground reference grid
bpy.ops.mesh.primitive_grid_add(x_subdivisions=8, y_subdivisions=8, size=1.6, location=(0, 0, 0))
grid = bpy.context.object
grid.display_type = 'WIRE'
grid.name = "GroundGrid"
grid.hide_render = True


# --- pose helpers -----------------------------------------------------------------------------------------------------
def pb(name):
    b = arm.pose.bones.get(name)
    if b is None and name not in missing:
        missing.append(name)
    return b


def update():
    bpy.context.view_layer.update()


def reset_pose():
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    update()


def rotate_world(name, axis_world, deg):
    b = pb(name)
    if b is None:
        return
    q = Quaternion(Vector(axis_world).normalized(), math.radians(deg))
    m = arm.matrix_world @ b.matrix
    head = m.translation.copy()
    new = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
    b.matrix = arm.matrix_world.inverted() @ new
    update()


def translate_world(name, vec):
    b = pb(name)
    if b is None:
        return
    m = arm.matrix_world @ b.matrix
    b.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(Vector(vec)) @ m)
    update()


def bone_axis_world(name):
    b = pb(name)
    if b is None:
        return Vector((1, 0, 0))
    return (arm.matrix_world.to_3x3() @ (b.tail - b.head)).normalized()


def joint_world(name):
    b = pb(name)
    return arm.matrix_world @ b.head if b else Vector((0, 0, 0))


def posed_coords():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    mw = ev.matrix_world
    return [mw @ v.co for v in ev.data.vertices]


# --- camera / shooting ------------------------------------------------------------------------------------------------
VIEWS = {
    # name: (direction from centre to camera, up vector)
    "front": (Vector((0, -1, 0)), Vector((0, 0, 1))),
    "back": (Vector((0, 1, 0)), Vector((0, 0, 1))),
    "side": (Vector((1, 0, 0)), Vector((0, 0, 1))),            # camera on the character's left side
    "side_r": (Vector((-1, 0, 0)), Vector((0, 0, 1))),         # camera on the character's right side
    "threequarter": (Vector((-0.66, -0.66, 0.36)), Vector((0, 0, 1))),   # front-right-above (character's right)
    "threequarter_l": (Vector((0.66, -0.66, 0.36)), Vector((0, 0, 1))),  # front-left-above
    "top": (Vector((0, 0, 1)), Vector((0, -1, 0))),              # looking down, character forward = image up
    "frontabove": (Vector((0, -0.8, 0.6)), Vector((0, 0, 1))),
}


def shoot(name, view, center=None, scale=None, margin=1.08):
    direction, up = VIEWS[view]
    coords = posed_coords()
    if center is None:
        lo = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
        hi = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
        center = (lo + hi) / 2
    cam.location = center + direction.normalized() * 6.0
    rot = direction.normalized().to_track_quat('Z', 'Y')  # camera looks along its -Z: -Z must point from cam to centre => +Z = direction
    # fix the up vector: rotate about the view axis so that camera +Y aligns best with 'up'
    cam.rotation_euler = rot.to_euler()
    update()
    R = cam.matrix_world.to_3x3()
    cam_y = R @ Vector((0, 1, 0))
    axis = direction.normalized()
    up_proj = (up - up.dot(axis) * axis)
    if up_proj.length > 1e-6:
        up_proj.normalize()
        ang = math.atan2(axis.dot(cam_y.cross(up_proj)), cam_y.dot(up_proj))
        cam.rotation_euler = (Quaternion(axis, ang) @ rot).to_euler()
        update()
    if scale is None:
        Rinv = cam.matrix_world.to_3x3().inverted()
        proj = [Rinv @ (v - center) for v in coords]
        ext_x = max(p.x for p in proj) - min(p.x for p in proj)
        ext_y = max(p.y for p in proj) - min(p.y for p in proj)
        aspect = scene.render.resolution_x / scene.render.resolution_y
        scale = max(ext_y, ext_x / aspect) * margin
        # re-centre the framing on the projected bbox centre
        mid = Vector(((max(p.x for p in proj) + min(p.x for p in proj)) / 2, (max(p.y for p in proj) + min(p.y for p in proj)) / 2, 0))
        cam.location = cam.location + cam.matrix_world.to_3x3() @ mid
    cam_data.ortho_scale = scale
    scene.render.filepath = os.path.join(out_dir, f"{prefix}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("[deform] wrote", scene.render.filepath)


def between(a, b, t=0.5):
    return joint_world(a) * (1 - t) + joint_world(b) * t


# --- 1. rest ----------------------------------------------------------------------------------------------------------
reset_pose()
shoot("1_rest_front", "front")

# --- 2. arms down -----------------------------------------------------------------------------------------------------
reset_pose()
rotate_world("LeftArm", (0, 1, 0), 85.0)
rotate_world("RightArm", (0, 1, 0), -85.0)
shoot("2_armsdown_front", "front")
shoot("2_armsdown_back", "back")
shoot("2_armsdown_shoulder_closeup", "front", center=between("LeftShoulder", "LeftArm", 0.8) + Vector((0.02, 0, -0.06)), scale=0.42)
shoot("2_armsdown_shoulder_closeup_back", "back", center=between("LeftShoulder", "LeftArm", 0.8) + Vector((0.02, 0, -0.06)), scale=0.42)

# --- 3. elbows 110 deg, forearms forward ------------------------------------------------------------------------------
reset_pose()
rotate_world("LeftForeArm", (0, 0, 1), -110.0)
rotate_world("RightForeArm", (0, 0, 1), 110.0)
shoot("3_elbow110_front", "front")
shoot("3_elbow110_top", "top")
shoot("3_elbow110_elbow_closeup", "top", center=joint_world("LeftForeArm") + Vector((0, -0.05, 0)), scale=0.45)

# --- 4. forearm twist: left with twist bone (half), right without -----------------------------------------------------
la = bone_axis_world("LeftForeArm")
ra = bone_axis_world("RightForeArm")
rotate_world("LeftHand", la, 70.0)
rotate_world("LeftForeArmTwist", la, 35.0)
rotate_world("RightHand", ra, -70.0)
shoot("4_twist_front", "front")
shoot("4_twist_top", "top")
shoot("4_twist_forearms_closeup", "frontabove", center=(joint_world("LeftHand") + joint_world("RightHand")) / 2 - Vector((0, 0.1, 0)), scale=0.95)
shoot("4_twist_left_side", "side", center=between("LeftForeArm", "LeftHand", 0.6), scale=0.5)       # with twist bone (half)
shoot("4_twist_right_side", "side_r", center=between("RightForeArm", "RightHand", 0.6), scale=0.5)  # without twist bone
shoot("4_twist_top_closeup", "top", center=(between("LeftForeArm", "LeftHand", 0.6) + between("RightForeArm", "RightHand", 0.6)) / 2, scale=0.8)

# --- 5. sitting-like: hips down 25 cm, knees 90 deg -------------------------------------------------------------------
reset_pose()
translate_world("Hips", (0, 0, -0.25))
for s in ("Left", "Right"):
    rotate_world(f"{s}UpLeg", (1, 0, 0), -45.0)
    rotate_world(f"{s}Leg", (1, 0, 0), 90.0)
    rotate_world(f"{s}Foot", (1, 0, 0), -45.0)
shoot("5_sit_threequarter", "threequarter")
shoot("5_sit_side", "side")
shoot("5_sit_hips_closeup", "threequarter", center=between("Hips", "LeftLeg", 0.45), scale=0.9)
shoot("5_sit_knee_closeup", "side", center=joint_world("LeftLeg") + Vector((0, 0, 0.02)), scale=0.5)

# --- 6. torso bend + twist --------------------------------------------------------------------------------------------
reset_pose()
for name in ("Spine", "Spine1", "Spine2"):
    rotate_world(name, (1, 0, 0), 12.0)
    rotate_world(name, bone_axis_world(name), 10.0)
shoot("6_torso_threequarter", "threequarter")
shoot("6_torso_back", "back")
shoot("6_torso_closeup", "threequarter", center=between("Hips", "Spine2", 0.5), scale=0.9)

reset_pose()
print("[deform] missing bones (rotations skipped):", missing)
print("[deform] DONE")
