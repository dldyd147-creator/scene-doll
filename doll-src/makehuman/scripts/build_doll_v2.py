"""
build_doll_v2.py -- second generation: rigged, T-posed, helper-free MakeHuman body as GLB with twist bones (MPFB2, headless).

Usage (paths are absolute):
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python build_doll_v2.py -- \
        --gender male --height 1.75 --out C:\\...\\out\\mh2_male.glb --log C:\\...\\logs\\build2_male.json [--blend dbg.blend]

Pipeline (steps 1-6 and 8 are identical to v1 build_doll.py; 7 is extended):
  1. HumanService.create_human(...) with the v1 macro targets (gender 1/0, age/muscle/weight/proportions 0.5)
  2. tune the "height" macro by bisection until the body bounding-box height matches --height
  3. HumanService.add_builtin_rig(human, "mixamo")  -> 52 "mixamorig:*" bones + weights (normalised here)
  4. analytic T-pose (Arm/ForeArm/Hand along +-X, forearm twisted so the palm faces down)
  5. RigService.apply_pose_as_rest_pose(rig)   -> T-pose becomes the rest/bind pose
  6. ExportService.bake_modifiers_remove_helpers -> helper geometry really deleted (13,380 body vertices remain)
  7. skeleton + weights, v2:
     a. strip "mixamorig:", add the 13 weightless Mixamo end bones (as v1)
     b. NEW: 8 twist bones  Left/Right {Arm,ForeArm,UpLeg,Leg}Twist, leaf children of the limb bone, head ON the limb
        axis (Arm/UpLeg at 35 %, ForeArm/Leg at 65 % from the limb head), tail further along the same axis
        (20 % of the limb length), same roll as the limb bone -> identity local rotation in the glTF
     c. NEW: weight cleanup: remove weights that are not part of the bone's main connected region ("islands"),
        drop negligible weights (< 1e-3)
     d. NEW: twist weights generated from the limb weights by a smooth gradient along the limb axis:
          t = clamp(dot(p - head, axis) / length, 0, 1)   (0 = limb head/proximal joint, 1 = limb tail/distal joint)
          proximal twist (ArmTwist, UpLegTwist): share s(t) = 1 - smoothstep(0.0, 0.6, t)   (1 at the joint, 0 from 60 %)
          distal twist (ForeArmTwist, LegTwist): share s(t) = smoothstep(0.2, 1.0, t)       (0 until 20 %, 1 at the joint)
          w_twist = w_limb * s(t),  w_limb' = w_limb * (1 - s(t))      -- the per-vertex total is unchanged
     e. limit to 4 influences, normalise, verify (no zero-weight vertex, no islands), collect statistics
     f. smooth shading (all faces smooth, no sharp edges, no custom split normals)
  8. single plain material, rename objects, re-ground (min z = 0), export GLB (Y-up, facing +Z, rest-position armature)
"""
import sys
import os
import json
import math
import time
from collections import defaultdict, Counter

import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion

T0 = time.time()
BODY_VERTEX_COUNT = 13380  # MakeHuman base mesh: vertices [0, 13380) are the body, the rest are helpers

# twist layout parameters (documented in report_v2.md)
TWIST_HEAD_FRACTION = {"ArmTwist": 0.35, "ForeArmTwist": 0.65, "UpLegTwist": 0.35, "LegTwist": 0.65}
TWIST_LENGTH_FRACTION = 0.20            # twist bone length as fraction of the limb bone length
PROXIMAL_RAMP = (0.0, 0.6)              # share = 1 - smoothstep(a, b, t)
DISTAL_RAMP = (0.2, 1.0)                # share = smoothstep(a, b, t)
TWIST_PARENT = {"ArmTwist": "Arm", "ForeArmTwist": "ForeArm", "UpLegTwist": "UpLeg", "LegTwist": "Leg"}
TWIST_KIND = {"ArmTwist": "proximal", "ForeArmTwist": "distal", "UpLegTwist": "proximal", "LegTwist": "distal"}
TINY_WEIGHT = 1e-3
MAX_INFLUENCES = 4


def log(*args):
    print("[build %6.1fs]" % (time.time() - T0), *args, flush=True)


def smoothstep(a, b, x):
    if x <= a:
        return 0.0
    if x >= b:
        return 1.0
    u = (x - a) / (b - a)
    return u * u * (3.0 - 2.0 * u)


def twist_share(kind, t):
    if kind == "proximal":
        return 1.0 - smoothstep(PROXIMAL_RAMP[0], PROXIMAL_RAMP[1], t)
    return smoothstep(DISTAL_RAMP[0], DISTAL_RAMP[1], t)


# ----------------------------------------------------------------------------------------------------------------------
# args
# ----------------------------------------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    opts = {"gender": "male", "height": None, "out": None, "log": None, "blend": None, "race": "neutral"}
    i = 0
    while i < len(args):
        key = args[i].lstrip("-")
        if key in opts:
            opts[key] = args[i + 1]
            i += 2
        else:
            raise SystemExit("unknown argument: " + args[i])
    if opts["gender"] not in ("male", "female"):
        raise SystemExit("--gender must be male or female")
    if opts["height"] is None:
        opts["height"] = 1.75 if opts["gender"] == "male" else 1.62
    opts["height"] = float(opts["height"])
    if not opts["out"]:
        raise SystemExit("--out <file.glb> is required")
    return opts


OPTS = parse_args()
REPORT = {"options": dict(OPTS), "blender_version": bpy.app.version_string, "pipeline_version": 2,
          "twist_parameters": {"head_fraction": TWIST_HEAD_FRACTION, "length_fraction": TWIST_LENGTH_FRACTION,
                               "proximal_ramp_smoothstep": PROXIMAL_RAMP, "distal_ramp_smoothstep": DISTAL_RAMP,
                               "tiny_weight": TINY_WEIGHT, "max_influences": MAX_INFLUENCES}}

# ----------------------------------------------------------------------------------------------------------------------
# MPFB imports (extension module path for Blender 4.2+ "user_default" repository)
# ----------------------------------------------------------------------------------------------------------------------
import importlib
mpfb_pkg = None
for cand in ("bl_ext.user_default.mpfb", "bl_ext.blender_org.mpfb", "mpfb"):
    try:
        mpfb_pkg = importlib.import_module(cand)
        break
    except ModuleNotFoundError:
        continue
if mpfb_pkg is None:
    raise SystemExit("MPFB is not installed/enabled. Run 00_install_mpfb.py first.")
MPFB = mpfb_pkg.__name__
log("MPFB package:", MPFB, "dir:", os.path.dirname(mpfb_pkg.__file__))

HumanService = importlib.import_module(MPFB + ".services.humanservice").HumanService
TargetService = importlib.import_module(MPFB + ".services.targetservice").TargetService
RigService = importlib.import_module(MPFB + ".services.rigservice").RigService
ExportService = importlib.import_module(MPFB + ".services.exportservice").ExportService
HumanObjectProperties = importlib.import_module(MPFB + ".entities.objectproperties").HumanObjectProperties

manifest_path = os.path.join(os.path.dirname(mpfb_pkg.__file__), "blender_manifest.toml")
mpfb_version = "?"
if os.path.isfile(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip().startswith("version"):
                mpfb_version = line.split("=", 1)[1].strip().strip('"')
REPORT["mpfb_version"] = mpfb_version
log("MPFB version:", mpfb_version, "| Blender:", bpy.app.version_string)

# ----------------------------------------------------------------------------------------------------------------------
# clean scene
# ----------------------------------------------------------------------------------------------------------------------
bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for block in list(coll):
        if block.users == 0:
            coll.remove(block)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

# ----------------------------------------------------------------------------------------------------------------------
# helpers (same as v1)
# ----------------------------------------------------------------------------------------------------------------------
def deselect_all():
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = None


def activate(obj):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def evaluated_body_coords(obj, body_only=True):
    masks = [(m, m.show_viewport) for m in obj.modifiers if m.type == 'MASK']
    for m, _ in masks:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mw = ev.matrix_world
    n = min(len(ev.data.vertices), BODY_VERTEX_COUNT) if body_only else len(ev.data.vertices)
    coords = [mw @ ev.data.vertices[i].co for i in range(n)]
    for m, state in masks:
        m.show_viewport = state
    return coords


def body_bbox(obj):
    coords = evaluated_body_coords(obj)
    xs = [c.x for c in coords]
    ys = [c.y for c in coords]
    zs = [c.z for c in coords]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def pbone_world_head_tail(arm, name):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ pb.head, arm.matrix_world @ pb.tail


def apply_world_rotation(arm, pbone, quat_world):
    mw = arm.matrix_world
    m_world = mw @ pbone.matrix
    head = m_world.translation.copy()
    R = quat_world.to_matrix().to_4x4()
    new_world = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ m_world
    pbone.matrix = mw.inverted() @ new_world
    bpy.context.view_layer.update()


def align_pose_bone(arm, pbone, target_dir):
    mw = arm.matrix_world
    m_world = mw @ pbone.matrix
    cur = (m_world.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    q = cur.rotation_difference(target_dir.normalized())
    apply_world_rotation(arm, pbone, q)
    m_world = mw @ pbone.matrix
    new = (m_world.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    return math.degrees(new.angle(target_dir.normalized()))


def group_weight_table(obj, bone_group_indices):
    table = {}
    for v in obj.data.vertices:
        if v.index >= BODY_VERTEX_COUNT:
            break
        raw = {g.group: g.weight for g in v.groups if g.group in bone_group_indices}
        total = sum(raw.values())
        table[v.index] = {k: w / total for k, w in raw.items()} if total > 1e-9 else {}
    return table


def measure_hand(human, rig, side, prefix, wtable):
    coords = evaluated_body_coords(human)
    hand_name = f"{prefix}{side}Hand"
    hand_idx = human.vertex_groups[hand_name].index
    pts = []
    for vi, groups in wtable.items():
        w_hand = groups.get(hand_idx, 0.0)
        if w_hand < 0.6:
            continue
        w_other = max([w for gi, w in groups.items() if gi != hand_idx] or [0.0])
        if w_hand > w_other:
            pts.append(coords[vi])
    P = np.array([[p.x, p.y, p.z] for p in pts])
    c = P.mean(axis=0)
    cov = np.cov((P - c).T)
    evals, evecs = np.linalg.eigh(cov)
    n = Vector(evecs[:, 0]).normalized()
    arm_axis = Vector((1.0, 0.0, 0.0)) if side == "Left" else Vector((-1.0, 0.0, 0.0))
    t_head, _ = pbone_world_head_tail(rig, f"{prefix}{side}HandThumb1")
    _, t_tail = pbone_world_head_tail(rig, f"{prefix}{side}HandThumb3")
    thumb = (t_tail - t_head)
    thumb_perp = (thumb - thumb.dot(arm_axis) * arm_axis).normalized()
    palm_est = (arm_axis.cross(thumb_perp) if side == "Left" else thumb_perp.cross(arm_axis)).normalized()
    if n.dot(palm_est) < 0:
        n = -n
    hand_head, hand_tail = pbone_world_head_tail(rig, hand_name)
    return {
        "n_points": len(pts),
        "palm_normal": [round(x, 4) for x in n],
        "palm_normal_vs_thumb_estimate_deg": round(math.degrees(n.angle(palm_est)), 2),
        "thumb_dir": [round(x, 4) for x in thumb.normalized()],
        "hand_dir": [round(x, 4) for x in (hand_tail - hand_head).normalized()],
        "palm_down_dot": round(n.dot(Vector((0.0, 0.0, -1.0))), 4),
        "_n": n,
    }


def signed_angle_about_axis(u, v, axis):
    u = (u - u.dot(axis) * axis).normalized()
    v = (v - v.dot(axis) * axis).normalized()
    return math.atan2(u.cross(v).dot(axis), u.dot(v))


# ----------------------------------------------------------------------------------------------------------------------
# 1. create human (same macro settings as v1)
# ----------------------------------------------------------------------------------------------------------------------
macro = TargetService.get_default_macro_info_dict()
macro["gender"] = 1.0 if OPTS["gender"] == "male" else 0.0
macro["age"] = 0.5
macro["muscle"] = 0.5
macro["weight"] = 0.5
macro["proportions"] = 0.5
macro["height"] = 0.5
macro["cupsize"] = 0.5
macro["firmness"] = 0.5
if OPTS["race"] == "neutral":
    macro["race"] = {"asian": 0.33, "caucasian": 0.33, "african": 0.33}
elif OPTS["race"] in ("asian", "caucasian", "african"):
    macro["race"] = {k: (1.0 if k == OPTS["race"] else 0.0) for k in ("asian", "caucasian", "african")}
else:
    raise SystemExit("--race must be neutral|asian|caucasian|african")

log("creating human with macro", macro)
human = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
                                  feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
log("human:", human.name, "verts", len(human.data.vertices), "polys", len(human.data.polygons))
REPORT["basemesh_with_helpers"] = {"vertices": len(human.data.vertices), "polygons": len(human.data.polygons)}

# ----------------------------------------------------------------------------------------------------------------------
# 2. tune height macro
# ----------------------------------------------------------------------------------------------------------------------
def set_height_macro(h):
    HumanObjectProperties.set_value("height", h, entity_reference=human)
    TargetService.reapply_macro_details(human)
    bpy.context.view_layer.update()
    (x0, x1), (y0, y1), (z0, z1) = body_bbox(human)
    return z1 - z0


target_h = OPTS["height"]
lo, hi = 0.0, 1.0
h_lo, h_hi = set_height_macro(lo), set_height_macro(hi)
log("height macro range: 0.0 -> %.4f m, 1.0 -> %.4f m, target %.3f m" % (h_lo, h_hi, target_h))
iterations = []
if not (h_lo <= target_h <= h_hi):
    log("WARNING: target height outside of macro range; clamping")
    best = 0.0 if target_h < h_lo else 1.0
    best_h = set_height_macro(best)
else:
    best, best_h = 0.5, set_height_macro(0.5)
    for it in range(18):
        if best_h < target_h:
            lo = best
        else:
            hi = best
        best = 0.5 * (lo + hi)
        best_h = set_height_macro(best)
        iterations.append((round(best, 6), round(best_h, 5)))
        if abs(best_h - target_h) < 0.0005:
            break
macro["height"] = best
log("height macro = %.5f -> body height %.4f m (target %.3f)" % (best, best_h, target_h))
REPORT["macro"] = macro
REPORT["height_tuning"] = {"range_m": [round(h_lo, 4), round(h_hi, 4)], "iterations": iterations,
                           "final_macro": round(best, 6), "final_height_m": round(best_h, 4)}

# ----------------------------------------------------------------------------------------------------------------------
# 3. rig
# ----------------------------------------------------------------------------------------------------------------------
RIG_NAME = "mixamo"
rig = HumanService.add_builtin_rig(human, RIG_NAME, import_weights=True)
log("rig:", rig.name, "bones:", len(rig.data.bones))
REPORT["source_rig"] = RIG_NAME
REPORT["source_bones"] = [(b.name, b.parent.name if b.parent else None) for b in rig.data.bones]
PREFIX = "mixamorig:"
assert all(b.name.startswith(PREFIX) for b in rig.data.bones), "unexpected bone naming in mixamo rig"

(x0, x1), (y0, y1), (z0, z1) = body_bbox(human)
REPORT["apose_bbox"] = {"x": [round(x0, 4), round(x1, 4)], "y": [round(y0, 4), round(y1, 4)], "z": [round(z0, 4), round(z1, 4)]}

bone_group_idx = {human.vertex_groups[b.name].index for b in rig.data.bones if b.name in human.vertex_groups}
raw_sums = [sum(g.weight for g in v.groups if g.group in bone_group_idx) for v in human.data.vertices if v.index < BODY_VERTEX_COUNT]
REPORT["raw_weight_sum_range"] = [round(min(raw_sums), 3), round(max(raw_sums), 3)]
unweighted = [i for i, s in enumerate(raw_sums) if s <= 1e-6]
log("body vertices without bone weights:", len(unweighted), "| raw weight sum range:", REPORT["raw_weight_sum_range"])
REPORT["unweighted_body_vertices_before"] = len(unweighted)
activate(human)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
wtable = group_weight_table(human, bone_group_idx)

# ----------------------------------------------------------------------------------------------------------------------
# 4. T-pose (same as v1)
# ----------------------------------------------------------------------------------------------------------------------
activate(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.transforms_clear()
bpy.ops.pose.select_all(action='DESELECT')
bpy.context.view_layer.update()

tpose_info = {}
for side, axis in (("Left", Vector((1.0, 0.0, 0.0))), ("Right", Vector((-1.0, 0.0, 0.0)))):
    info = {}
    before = measure_hand(human, rig, side, PREFIX, wtable)
    info["before"] = {k: v for k, v in before.items() if not k.startswith("_")}
    for bone in ("Arm", "ForeArm", "Hand"):
        pb = rig.pose.bones[f"{PREFIX}{side}{bone}"]
        residual = align_pose_bone(rig, pb, axis)
        info[f"{bone}_residual_deg"] = round(residual, 4)
    mid = measure_hand(human, rig, side, PREFIX, wtable)
    info["after_align"] = {k: v for k, v in mid.items() if not k.startswith("_")}
    n = mid["_n"]
    twist = signed_angle_about_axis(n, Vector((0.0, 0.0, -1.0)), Vector((1.0, 0.0, 0.0)))
    info["forearm_twist_deg"] = round(math.degrees(twist), 3)
    if abs(math.degrees(twist)) > 60.0:
        log(f"WARNING: {side} palm twist {math.degrees(twist):.1f} deg is large; check the T-pose visually")
    apply_world_rotation(rig, rig.pose.bones[f"{PREFIX}{side}ForeArm"], Quaternion(Vector((1.0, 0.0, 0.0)), twist))
    after = measure_hand(human, rig, side, PREFIX, wtable)
    info["after_twist"] = {k: v for k, v in after.items() if not k.startswith("_")}
    h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}Arm")
    info["arm_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
    h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}Hand")
    info["hand_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
    tpose_info[side] = info
    log(f"T-pose {side}: arm_dir={info['arm_dir_world']} palm_down_dot before={before['palm_down_dot']} "
        f"after_align={mid['palm_down_dot']} twist={info['forearm_twist_deg']} deg -> after={after['palm_down_dot']}")

for side in ("Left", "Right"):
    for bone in ("UpLeg", "Leg", "Foot", "ToeBase"):
        h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}{bone}")
        tpose_info[side][f"{bone}_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
REPORT["tpose"] = tpose_info
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------------------------------------------------
# 5. apply the T-pose as rest pose
# ----------------------------------------------------------------------------------------------------------------------
RigService.apply_pose_as_rest_pose(rig)
bpy.ops.object.mode_set(mode='OBJECT')
log("rest pose applied; shape keys:", human.data.shape_keys, "modifiers:", [(m.name, m.type) for m in human.modifiers])
assert human.data.shape_keys is None, "shape keys still present after apply_pose_as_rest_pose"
activate(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.transforms_clear()
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------------------------------------------------
# 6. delete helper geometry
# ----------------------------------------------------------------------------------------------------------------------
activate(human)
ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=False)
bpy.ops.object.mode_set(mode='OBJECT')
log("after helper removal: verts", len(human.data.vertices), "polys", len(human.data.polygons),
    "modifiers", [(m.name, m.type) for m in human.modifiers])
assert len(human.data.vertices) == BODY_VERTEX_COUNT, "helper removal did not leave exactly the body vertices"
assert any(m.type == 'ARMATURE' for m in human.modifiers), "armature modifier missing after helper removal"
assert not any(m.type == 'MASK' for m in human.modifiers), "mask modifier still present"

# ----------------------------------------------------------------------------------------------------------------------
# 7a. rename bones, add Mixamo end bones (same as v1)
# ----------------------------------------------------------------------------------------------------------------------
activate(rig)
bpy.ops.object.mode_set(mode='OBJECT')
rename_map = {}
for b in rig.data.bones:
    new = b.name[len(PREFIX):] if b.name.startswith(PREFIX) else b.name
    rename_map[b.name] = new
    b.name = new
for old, new in rename_map.items():
    if old in human.vertex_groups and new not in human.vertex_groups:
        human.vertex_groups[old].name = new
REPORT["rename_map"] = rename_map

END_BONES = [("HeadTop_End", "Head", 0.10)]
for side in ("Left", "Right"):
    END_BONES.append((f"{side}Toe_End", f"{side}ToeBase", 0.02))
    for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        END_BONES.append((f"{side}Hand{finger}4", f"{side}Hand{finger}3", 0.015))

bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for name, parent_name, length in END_BONES:
    parent = eb[parent_name]
    direction = (parent.tail - parent.head).normalized()
    nb = eb.new(name)
    nb.head = parent.tail.copy()
    nb.tail = parent.tail + direction * length
    nb.parent = parent
    nb.use_connect = True
    nb.use_deform = True
    nb.roll = parent.roll

# ----------------------------------------------------------------------------------------------------------------------
# 7b. NEW: twist bones (leaf children on the limb axis, same roll as the limb bone)
# ----------------------------------------------------------------------------------------------------------------------
TWIST_BONES = []  # (twist name, parent name)
twist_geometry = {}
for side in ("Left", "Right"):
    for short, parent_short in TWIST_PARENT.items():
        name = f"{side}{short}"
        parent_name = f"{side}{parent_short}"
        parent = eb[parent_name]
        axis = (parent.tail - parent.head)
        length = axis.length
        axis.normalize()
        frac = TWIST_HEAD_FRACTION[short]
        nb = eb.new(name)
        nb.head = parent.head + axis * (length * frac)
        nb.tail = nb.head + axis * (length * TWIST_LENGTH_FRACTION)
        nb.parent = parent
        nb.use_connect = False
        nb.use_deform = True
        nb.roll = parent.roll
        nb.inherit_scale = parent.inherit_scale
        TWIST_BONES.append((name, parent_name))
        twist_geometry[name] = {"parent": parent_name, "head_fraction": frac, "length_m": round(length * TWIST_LENGTH_FRACTION, 4),
                                "parent_length_m": round(length, 4)}
bpy.ops.object.mode_set(mode='OBJECT')
log("bones after adding end + twist bones:", len(rig.data.bones))

# check the twist bone local orientation really equals the parent's (identity local rotation)
for name, parent_name in TWIST_BONES:
    b = rig.data.bones[name]
    p = rig.data.bones[parent_name]
    rel = p.matrix_local.inverted() @ b.matrix_local
    q = rel.to_quaternion()
    ang = math.degrees(2.0 * math.acos(min(1.0, abs(q.w))))
    twist_geometry[name]["local_rotation_deg_vs_parent"] = round(ang, 5)
    twist_geometry[name]["local_translation"] = [round(c, 5) for c in rel.translation]
    assert ang < 0.01, f"{name} local rotation differs from parent by {ang} deg"
REPORT["twist_geometry"] = twist_geometry

REQUIRED = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End"]
for side in ("Left", "Right"):
    REQUIRED += [f"{side}Shoulder", f"{side}Arm", f"{side}ForeArm", f"{side}Hand",
                 f"{side}UpLeg", f"{side}Leg", f"{side}Foot", f"{side}ToeBase", f"{side}Toe_End"]
    REQUIRED += [f"{side}ArmTwist", f"{side}ForeArmTwist", f"{side}UpLegTwist", f"{side}LegTwist"]
OPTIONAL = [f"{side}Hand{f}{i}" for side in ("Left", "Right") for f in ("Thumb", "Index", "Middle", "Ring", "Pinky") for i in (1, 2, 3, 4)]
bone_names = {b.name for b in rig.data.bones}
missing = [b for b in REQUIRED if b not in bone_names]
extra = [b for b in bone_names if b not in REQUIRED and b not in OPTIONAL]
assert not missing, f"missing required bones: {missing}"
assert not extra, f"unexpected extra bones: {extra}"
for b in rig.data.bones:
    b.use_deform = True

# ----------------------------------------------------------------------------------------------------------------------
# 7c. NEW: vertex-group cleanup: only bone groups, remove weight islands, drop negligible weights
# ----------------------------------------------------------------------------------------------------------------------
activate(human)
bpy.ops.object.mode_set(mode='OBJECT')
removed_groups = []
for g in list(human.vertex_groups):
    if g.name not in bone_names:
        removed_groups.append(g.name)
        human.vertex_groups.remove(g)
log("removed non-bone vertex groups:", len(removed_groups))
REPORT["removed_vertex_groups"] = removed_groups
for b in rig.data.bones:
    if b.name not in human.vertex_groups:
        human.vertex_groups.new(name=b.name)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

mesh = human.data
adjacency = defaultdict(set)
for e in mesh.edges:
    a, b_ = e.vertices
    adjacency[a].add(b_)
    adjacency[b_].add(a)


def read_weights():
    """{bone_name: {vertex_index: weight}} for every bone vertex group."""
    gname = {g.index: g.name for g in human.vertex_groups}
    W = defaultdict(dict)
    for v in mesh.vertices:
        for g in v.groups:
            if g.weight > 0.0:
                W[gname[g.group]][v.index] = g.weight
    return W


def components(vset):
    seen = set()
    comps = []
    for s in vset:
        if s in seen:
            continue
        stack = [s]
        seen.add(s)
        comp = [s]
        while stack:
            x = stack.pop()
            for y in adjacency[x]:
                if y in vset and y not in seen:
                    seen.add(y)
                    stack.append(y)
                    comp.append(y)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def write_weights(W):
    """Replace all bone weights on the mesh by W and normalise per vertex."""
    per_vertex = defaultdict(dict)
    for bone, d in W.items():
        for vi, w in d.items():
            if w > 0.0:
                per_vertex[vi][bone] = w
    all_idx = list(range(len(mesh.vertices)))
    for g in human.vertex_groups:
        g.remove(all_idx)
    for vi, d in per_vertex.items():
        total = sum(d.values())
        for bone, w in d.items():
            human.vertex_groups[bone].add([vi], w / total, 'REPLACE')


def cleanup_islands(W, stage):
    """Keep only the largest connected region per bone. Removed weight is implicitly redistributed to the vertex's
    other bones when write_weights() renormalises. Returns the list of removed islands (for the report)."""
    report = []
    removed_weight = 0.0
    for bone in sorted(W):
        comps = components(set(W[bone]))
        if len(comps) <= 1:
            continue
        for comp in comps[1:]:
            ws = [W[bone][vi] for vi in comp]
            cen = sum((mesh.vertices[vi].co for vi in comp), Vector()) / len(comp)
            entry = {"stage": stage, "bone": bone, "size": len(comp), "max_weight": round(max(ws), 4), "sum_weight": round(sum(ws), 4),
                     "centroid_blender": [round(c, 3) for c in cen], "main_component_size": len(comps[0])}
            for vi in comp:
                others = {g for g in W if g != bone and vi in W[g]}
                if not others:
                    entry["kept_vertices_without_other_weights"] = entry.get("kept_vertices_without_other_weights", 0) + 1
                    continue  # would leave the vertex unweighted; keep it
                removed_weight += W[bone].pop(vi)
            report.append(entry)
    log(f"[{stage}] weight islands removed: {len(report)} entries; total weight removed {removed_weight:.3f}")
    for r in report:
        log("   island", r)
    return report


W = read_weights()
island_report = cleanup_islands(W, "source_weights")

# drop negligible weights (they only cost influence slots)
tiny_removed = 0
for bone in W:
    for vi in [vi for vi, w in W[bone].items() if w < TINY_WEIGHT]:
        if len([g for g in W if vi in W[g]]) > 1:
            del W[bone][vi]
            tiny_removed += 1
REPORT["tiny_weights_removed"] = tiny_removed
write_weights(W)
W = read_weights()
counts_before_twist = {b: len(W.get(b, {})) for b in sorted(bone_names)}
REPORT["bone_vertex_counts_before_twist"] = counts_before_twist

# ----------------------------------------------------------------------------------------------------------------------
# 7d. NEW: twist weights = gradient of the limb weight along the limb axis
# ----------------------------------------------------------------------------------------------------------------------
mw_h = human.matrix_world
twist_stats = {}
for twist_name, parent_name in TWIST_BONES:
    short = twist_name[4:] if twist_name.startswith("Left") else twist_name[5:]
    kind = TWIST_KIND[short]
    pb = rig.data.bones[parent_name]
    head = rig.matrix_world @ pb.head_local
    tail = rig.matrix_world @ pb.tail_local
    axis = (tail - head)
    length = axis.length
    axis.normalize()
    moved = {}
    bins = defaultdict(lambda: [0, 0.0, 0.0])  # t-bin -> [count, sum share, sum w_limb]
    for vi, w in list(W[parent_name].items()):
        p = mw_h @ mesh.vertices[vi].co
        t = (p - head).dot(axis) / length
        s = twist_share(kind, min(1.0, max(0.0, t)))
        k = min(9, max(-1, int(math.floor(t * 10)))) if t >= 0 else -1
        bins[k][0] += 1
        bins[k][1] += s
        bins[k][2] += w
        if s <= 1e-6:
            continue
        moved[vi] = w * s
        rest = w * (1.0 - s)
        if rest > 1e-6:
            W[parent_name][vi] = rest
        else:
            del W[parent_name][vi]
    W[twist_name] = moved
    twist_stats[twist_name] = {
        "kind": kind, "parent": parent_name, "vertices": len(moved), "weight_sum": round(sum(moved.values()), 3),
        "parent_vertices_after": len(W[parent_name]), "parent_weight_sum_after": round(sum(W[parent_name].values()), 3),
        "profile_by_t_bin": {("%.1f-%.1f" % (k / 10, (k + 1) / 10) if k >= 0 else "<0"): {"n": v[0], "mean_share": round(v[1] / v[0], 3)}
                             for k, v in sorted(bins.items())},
    }
    log(f"twist {twist_name}: {len(moved)} verts, weight sum {sum(moved.values()):.2f}; parent {parent_name} keeps {len(W[parent_name])} verts")
REPORT["twist_weights"] = twist_stats
# the limb bone now only owns the part of its old region where share < 1; tiny fragments (e.g. an armpit vertex
# with t slightly > 0 surrounded by t < 0 vertices) can become disconnected -> clean up again
island_report += cleanup_islands(W, "after_twist_split")
write_weights(W)

# ----------------------------------------------------------------------------------------------------------------------
# 7e. influence limit, normalisation, statistics
# ----------------------------------------------------------------------------------------------------------------------
infl_before = Counter(len(v.groups) for v in mesh.vertices)
over = [v for v in mesh.vertices if len(v.groups) > MAX_INFLUENCES]
dropped = []
gname = {g.index: g.name for g in human.vertex_groups}
for v in over:
    ws = sorted(((g.weight, gname[g.group]) for g in v.groups), reverse=True)
    dropped.append({"vertex": v.index, "dropped": [(n, round(w, 4)) for w, n in ws[MAX_INFLUENCES:]], "kept": [(n, round(w, 4)) for w, n in ws[:MAX_INFLUENCES]]})
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=MAX_INFLUENCES)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
REPORT["influence_limit"] = {"vertices_over_limit_before": len(over), "max_dropped_weight": round(max([w for d in dropped for _, w in d["dropped"]] or [0.0]), 4),
                             "influences_histogram_before": dict(sorted(infl_before.items())), "examples": dropped[:12]}
log("vertices with > %d influences before limiting: %d (max dropped weight %.4f)" % (MAX_INFLUENCES, len(over), REPORT["influence_limit"]["max_dropped_weight"]))

W = read_weights()
# dropping the smallest influence can in principle split a bone's region; clean up once more (removal only, so the
# 4-influence limit still holds; write_weights renormalises)
post_limit_islands = cleanup_islands(W, "after_influence_limit")
if post_limit_islands:
    island_report += post_limit_islands
    write_weights(W)
    W = read_weights()
REPORT["weight_islands_removed"] = island_report
sums = [sum(g.weight for g in v.groups) for v in mesh.vertices]
unweighted_after = [i for i, s in enumerate(sums) if s <= 1e-6]
assert not unweighted_after, "some vertices have no bone weights"
infl_after = Counter(len(v.groups) for v in mesh.vertices)
islands_after = {}
for b in W:
    n_comp = len(components(set(W[b])))
    if n_comp != 1:
        islands_after[b] = n_comp
steps = []
for e in mesh.edges:
    a, b_ = e.vertices
    wa = {gname[g.group]: g.weight for g in mesh.vertices[a].groups}
    wb = {gname[g.group]: g.weight for g in mesh.vertices[b_].groups}
    m, mb = 0.0, None
    for k in set(wa) | set(wb):
        dlt = abs(wa.get(k, 0.0) - wb.get(k, 0.0))
        if dlt > m:
            m, mb = dlt, k
    steps.append((m, mb))
hard_steps = [(round(m, 3), b) for m, b in steps if m > 0.5]
REPORT["weights_final"] = {
    "sum_min": round(min(sums), 6), "sum_max": round(max(sums), 6), "sum_mean": round(sum(sums) / len(sums), 6),
    "unweighted_vertices": len(unweighted_after),
    "influences_histogram": dict(sorted(infl_after.items())), "max_influences": max(infl_after),
    "islands_after_cleanup": islands_after,
    "edge_step_histogram": dict(sorted(Counter(round(m, 1) for m, _ in steps).items())),
    "edges_with_step_gt_0_5": len(hard_steps), "hard_step_bones": dict(Counter(b for _, b in hard_steps)),
    "bone_vertex_counts": {b: len(W.get(b, {})) for b in sorted(bone_names)},
    "bone_weight_sums": {b: round(sum(W.get(b, {}).values()), 2) for b in sorted(bone_names)},
}
assert not islands_after, f"weight islands remain: {islands_after}"
assert max(infl_after) <= MAX_INFLUENCES
log("final weights: sums [%.6f, %.6f], influences %s, hard steps %d %s" % (min(sums), max(sums), dict(sorted(infl_after.items())), len(hard_steps), REPORT["weights_final"]["hard_step_bones"]))

# ----------------------------------------------------------------------------------------------------------------------
# 7f. smooth shading
# ----------------------------------------------------------------------------------------------------------------------
activate(human)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()
for e in mesh.edges:
    e.use_edge_sharp = False
if mesh.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
for m in list(human.modifiers):
    if m.type != 'ARMATURE':
        human.modifiers.remove(m)
REPORT["shading"] = {"smooth_polys": sum(1 for p in mesh.polygons if p.use_smooth), "polys": len(mesh.polygons),
                     "sharp_edges": sum(1 for e in mesh.edges if e.use_edge_sharp), "custom_normals": mesh.has_custom_normals}
log("shading:", REPORT["shading"])

# ----------------------------------------------------------------------------------------------------------------------
# 8. material, names, grounding, export (same as v1)
# ----------------------------------------------------------------------------------------------------------------------
mat = bpy.data.materials.new("DollSkin")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.80, 0.68, 0.60, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.65
mat.diffuse_color = (0.80, 0.68, 0.60, 1.0)
mesh.materials.clear()
mesh.materials.append(mat)
for p in mesh.polygons:
    p.material_index = 0

for idblock in (human, human.data, rig, rig.data):
    for key in list(idblock.keys()):
        del idblock[key]

human.name = human.data.name = "Body"
rig.name = rig.data.name = "Armature"
rig.show_in_front = False
rig.data.display_type = 'OCTAHEDRAL'

assert all(abs(v) < 1e-6 for v in rig.location) and all(abs(v) < 1e-6 for v in human.location)
assert human.parent == rig
zs = [v.co.z for v in mesh.vertices]
xs = [v.co.x for v in mesh.vertices]
shift = Vector((-(min(xs) + max(xs)) / 2.0, 0.0, -min(zs)))
log("grounding shift:", [round(c, 5) for c in shift])
if shift.length > 1e-7:
    mesh.transform(Matrix.Translation(shift))
    # v1 shifted head/tail of every edit bone individually; for connected bones Blender keeps the shared joint point
    # in sync, so the shared point moved twice and near-vertical bones (legs) tilted by shift/length (~0.1 deg).
    # Armature.transform() moves every bone rigidly and keeps all relative orientations exact.
    rig.data.transform(Matrix.Translation(shift))
mesh.update()
for name, parent_name in TWIST_BONES:
    rel = rig.data.bones[parent_name].matrix_local.inverted() @ rig.data.bones[name].matrix_local
    q = rel.to_quaternion()
    ang = math.degrees(2.0 * math.acos(min(1.0, abs(q.w))))
    assert ang < 0.01, f"{name} local rotation differs from parent by {ang} deg after grounding"
for b in rig.data.bones:
    if b.parent and b.use_connect:
        assert (b.head_local - b.parent.tail_local).length < 1e-5, f"connected bone {b.name} detached from parent tail after grounding"

zs = [v.co.z for v in mesh.vertices]
xs = [v.co.x for v in mesh.vertices]
ys = [v.co.y for v in mesh.vertices]
tri_count = sum(len(p.vertices) - 2 for p in mesh.polygons)
REPORT["final_mesh"] = {
    "vertices": len(mesh.vertices), "polygons": len(mesh.polygons), "triangles": tri_count,
    "quads": sum(1 for p in mesh.polygons if len(p.vertices) == 4),
    "tris": sum(1 for p in mesh.polygons if len(p.vertices) == 3),
    "ngons": sum(1 for p in mesh.polygons if len(p.vertices) > 4),
    "bbox_blender": {"x": [round(min(xs), 4), round(max(xs), 4)], "y": [round(min(ys), 4), round(max(ys), 4)],
                     "z": [round(min(zs), 4), round(max(zs), 4)]},
    "height_m": round(max(zs) - min(zs), 4),
    "vertex_groups": len(human.vertex_groups),
    "materials": [m.name for m in mesh.materials],
    "uv_layers": [uv.name for uv in mesh.uv_layers],
}
REPORT["final_bones"] = [(b.name, b.parent.name if b.parent else None,
                          [round(c, 4) for c in b.head_local], [round(c, 4) for c in b.tail_local]) for b in rig.data.bones]
REPORT["bone_count"] = len(rig.data.bones)
log("final mesh:", REPORT["final_mesh"], "| bones:", len(rig.data.bones))

out_path = os.path.abspath(OPTS["out"])
os.makedirs(os.path.dirname(out_path), exist_ok=True)
deselect_all()
human.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_skins=True,
    export_animations=False,
    export_yup=True,
    export_morph=False,
    export_materials='EXPORT',
    export_image_format='NONE',
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_def_bones=False,
    export_rest_position_armature=True,
    export_extras=False,
    export_cameras=False,
    export_lights=False,
    export_all_influences=False,
)
size = os.path.getsize(out_path)
log("exported", out_path, size, "bytes")
REPORT["glb"] = {"path": out_path, "bytes": size}

if OPTS["blend"]:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OPTS["blend"]))
    log("saved debug blend", OPTS["blend"])

if OPTS["log"]:
    with open(os.path.abspath(OPTS["log"]), "w", encoding="utf-8") as f:
        json.dump(REPORT, f, indent=2, default=str)
    log("wrote", OPTS["log"])
log("DONE")
