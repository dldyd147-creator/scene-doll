"""
build_doll.py -- build one rigged, T-posed, helper-free MakeHuman body as GLB using MPFB2 (headless Blender 4.2+).

Usage (from anywhere; paths are absolute):
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python build_doll.py -- \
        --gender male --height 1.75 --out C:\\...\\out\\mh_male.glb --log C:\\...\\logs\\build_male.json

Pipeline:
  1. HumanService.create_human(...) with macro targets (gender/age/muscle/weight/proportions/height/...)
  2. tune the MakeHuman "height" macro by bisection until the body bounding-box height matches --height
  3. HumanService.add_builtin_rig(human, "mixamo")  -> 52 bones named "mixamorig:<Mixamo name>" + weights
  4. pose the armature into a T-pose analytically (Arm/ForeArm/Hand aligned to +-X, forearm twisted so the
     palm plane -- measured from the deformed hand vertices -- faces down)
  5. RigService.apply_pose_as_rest_pose(rig): bakes shape keys, applies the Armature modifier, pose.armature_apply,
     re-creates the Armature modifier -> the T-pose is now the rest/bind pose
  6. ExportService.bake_modifiers_remove_helpers(...): applies the "body" MASK modifier -> helper geometry
     (eyes/eyebrows/eyelashes/teeth/tongue/hair/tights/skirt helpers, joint cubes) is really deleted (13380 verts remain)
  7. strip the "mixamorig:" prefix from all bones (vertex groups follow), add Mixamo end bones
     (HeadTop_End, Left/RightToe_End, *Hand<Finger>4), remove every non-bone vertex group, normalize weights
  8. single plain material, rename objects, re-ground (min z = 0), export GLB (Y-up, facing +Z)
"""
import sys
import os
import json
import math
import time

import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion

T0 = time.time()
BODY_VERTEX_COUNT = 13380  # MakeHuman base mesh: vertices [0, 13380) are the body, the rest are helpers


def log(*args):
    print("[build %6.1fs]" % (time.time() - T0), *args, flush=True)


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
REPORT = {"options": dict(OPTS), "blender_version": bpy.app.version_string}

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
ObjectService = importlib.import_module(MPFB + ".services.objectservice").ObjectService
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
# clean scene (keep preferences/add-ons as they are; just remove the default objects)
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
# helpers
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
    """Return deformed (modifier-evaluated) vertex coordinates in world space with original indexing.
    MASK modifiers are temporarily disabled so indices stay aligned with the original mesh."""
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
    """Rotate a pose bone (and thereby its children) by a world-space quaternion around the bone's head."""
    mw = arm.matrix_world
    m_world = mw @ pbone.matrix
    head = m_world.translation.copy()
    R = quat_world.to_matrix().to_4x4()
    new_world = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ m_world
    pbone.matrix = mw.inverted() @ new_world
    bpy.context.view_layer.update()


def align_pose_bone(arm, pbone, target_dir):
    """Shortest-arc rotation so that the bone's direction (head->tail) becomes target_dir (world space)."""
    mw = arm.matrix_world
    m_world = mw @ pbone.matrix
    cur = (m_world.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    q = cur.rotation_difference(target_dir.normalized())
    apply_world_rotation(arm, pbone, q)
    m_world = mw @ pbone.matrix
    new = (m_world.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    return math.degrees(new.angle(target_dir.normalized()))


def group_weight_table(obj, bone_group_indices):
    """{vertex_index: {group_index: normalized_weight}} for body vertices, bone groups only.
    (The MPFB mixamo weight file is not normalized; Blender's armature modifier and the glTF exporter
    normalize per vertex internally, so we do the same here for the measurements.)"""
    table = {}
    for v in obj.data.vertices:
        if v.index >= BODY_VERTEX_COUNT:
            break
        raw = {g.group: g.weight for g in v.groups if g.group in bone_group_indices}
        total = sum(raw.values())
        table[v.index] = {k: w / total for k, w in raw.items()} if total > 1e-9 else {}
    return table


def measure_hand(human, rig, side, prefix, wtable):
    """Measure the deformed hand: PCA plane normal of the palm/back vertices, thumb direction, etc.
    Returns dict with 'palm_normal' (unit vector, pointing out of the palm), 'arm_axis', etc."""
    coords = evaluated_body_coords(human)
    hand_name = f"{prefix}{side}Hand"
    hand_idx = human.vertex_groups[hand_name].index
    finger_idx = {g.index for g in human.vertex_groups if g.name.startswith(hand_name) and g.name != hand_name}
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
    n = Vector(evecs[:, 0]).normalized()  # smallest variance axis = hand plane normal (sign ambiguous)

    arm_axis = Vector((1.0, 0.0, 0.0)) if side == "Left" else Vector((-1.0, 0.0, 0.0))
    t_head, _ = pbone_world_head_tail(rig, f"{prefix}{side}HandThumb1")
    _, t_tail = pbone_world_head_tail(rig, f"{prefix}{side}HandThumb3")
    thumb = (t_tail - t_head)
    thumb_perp = (thumb - thumb.dot(arm_axis) * arm_axis).normalized()
    # anatomical rule: with the arm out to the side, palm down <=> thumb points forward.
    # palm normal estimate = arm_axis x thumb (left) / thumb x arm_axis (right)
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
# 1. create human
# ----------------------------------------------------------------------------------------------------------------------
macro = TargetService.get_default_macro_info_dict()
macro["gender"] = 1.0 if OPTS["gender"] == "male" else 0.0   # MakeHuman: 0.0 = female, 1.0 = male
macro["age"] = 0.5          # ~25 years
macro["muscle"] = 0.5       # average
macro["weight"] = 0.5       # average
macro["proportions"] = 0.5  # average proportions
macro["height"] = 0.5       # start value, tuned below
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
# 2. tune height macro (bisection on the body bounding-box height)
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

# weights sanity before we touch anything; normalize the (raw, un-normalized) MPFB weights over the deform bones only
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
# 4. T-pose
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
    # twist the forearm (pronation/supination happens in the forearm) so the palm faces straight down
    n = mid["_n"]
    twist = signed_angle_about_axis(n, Vector((0.0, 0.0, -1.0)), Vector((1.0, 0.0, 0.0)))
    info["forearm_twist_deg"] = round(math.degrees(twist), 3)
    if abs(math.degrees(twist)) > 60.0:
        log(f"WARNING: {side} palm twist {math.degrees(twist):.1f} deg is large; check the T-pose visually")
    apply_world_rotation(rig, rig.pose.bones[f"{PREFIX}{side}ForeArm"], Quaternion(Vector((1.0, 0.0, 0.0)), twist))
    after = measure_hand(human, rig, side, PREFIX, wtable)
    info["after_twist"] = {k: v for k, v in after.items() if not k.startswith("_")}
    # arm direction check
    h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}Arm")
    info["arm_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
    h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}Hand")
    info["hand_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
    tpose_info[side] = info
    log(f"T-pose {side}: arm_dir={info['arm_dir_world']} palm_down_dot before={before['palm_down_dot']} "
        f"after_align={mid['palm_down_dot']} twist={info['forearm_twist_deg']} deg -> after={after['palm_down_dot']}")

# legs/feet: MakeHuman's default already has straight legs and feet pointing forward (-Y); report them
for side in ("Left", "Right"):
    for bone in ("UpLeg", "Leg", "Foot", "ToeBase"):
        h, t = pbone_world_head_tail(rig, f"{PREFIX}{side}{bone}")
        tpose_info[side][f"{bone}_dir_world"] = [round(c, 4) for c in (t - h).normalized()]
REPORT["tpose"] = tpose_info

bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------------------------------------------------
# 5. apply the T-pose as rest pose (bakes targets, applies the armature modifier, armature_apply, re-adds modifier)
# ----------------------------------------------------------------------------------------------------------------------
RigService.apply_pose_as_rest_pose(rig)
bpy.ops.object.mode_set(mode='OBJECT')
log("rest pose applied; shape keys:", human.data.shape_keys, "modifiers:", [(m.name, m.type) for m in human.modifiers])
assert human.data.shape_keys is None, "shape keys still present after apply_pose_as_rest_pose"
# verify every pose bone is at identity now
activate(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.transforms_clear()
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------------------------------------------------
# 6. delete helper geometry for real (apply the "body" MASK modifier)
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
# 7. rename bones (Mixamo names without prefix), add Mixamo end bones, clean vertex groups
# ----------------------------------------------------------------------------------------------------------------------
activate(rig)
bpy.ops.object.mode_set(mode='OBJECT')
rename_map = {}
for b in rig.data.bones:
    new = b.name[len(PREFIX):] if b.name.startswith(PREFIX) else b.name
    rename_map[b.name] = new
    b.name = new  # Blender renames the matching vertex groups on meshes deformed by this armature
# make sure the vertex groups really followed the rename
for old, new in rename_map.items():
    if old in human.vertex_groups and new not in human.vertex_groups:
        human.vertex_groups[old].name = new
REPORT["rename_map"] = rename_map

END_BONES = []  # (name, parent, length_m)
END_BONES.append(("HeadTop_End", "Head", 0.10))
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
bpy.ops.object.mode_set(mode='OBJECT')
log("bones after adding end bones:", len(rig.data.bones))

REQUIRED = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End"]
for side in ("Left", "Right"):
    REQUIRED += [f"{side}Shoulder", f"{side}Arm", f"{side}ForeArm", f"{side}Hand",
                 f"{side}UpLeg", f"{side}Leg", f"{side}Foot", f"{side}ToeBase", f"{side}Toe_End"]
OPTIONAL = [f"{side}Hand{f}{i}" for side in ("Left", "Right") for f in ("Thumb", "Index", "Middle", "Ring", "Pinky") for i in (1, 2, 3, 4)]
bone_names = {b.name for b in rig.data.bones}
missing = [b for b in REQUIRED if b not in bone_names]
extra = [b for b in bone_names if b not in REQUIRED and b not in OPTIONAL]
assert not missing, f"missing required bones: {missing}"
assert not extra, f"unexpected extra bones: {extra}"
for b in rig.data.bones:
    b.use_deform = True

# vertex groups: keep only bone groups
activate(human)
removed_groups = []
for g in list(human.vertex_groups):
    if g.name not in bone_names:
        removed_groups.append(g.name)
        human.vertex_groups.remove(g)
log("removed non-bone vertex groups:", len(removed_groups))
REPORT["removed_vertex_groups"] = removed_groups
# make sure every bone has a vertex group (end bones get empty groups -> exporter maps joints consistently)
for b in rig.data.bones:
    if b.name not in human.vertex_groups:
        human.vertex_groups.new(name=b.name)

bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
unweighted_after = [v.index for v in human.data.vertices if sum(g.weight for g in v.groups) <= 1e-6]
log("vertices without weights after cleanup:", len(unweighted_after))
REPORT["unweighted_vertices_after"] = len(unweighted_after)
assert not unweighted_after, "some vertices have no bone weights"

# ----------------------------------------------------------------------------------------------------------------------
# 8. material, names, grounding, export
# ----------------------------------------------------------------------------------------------------------------------
mat = bpy.data.materials.new("DollSkin")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.80, 0.68, 0.60, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.65
mat.diffuse_color = (0.80, 0.68, 0.60, 1.0)
human.data.materials.clear()
human.data.materials.append(mat)
for p in human.data.polygons:
    p.material_index = 0

# drop MPFB custom properties (not exported anyway, but keep the file clean)
for idblock in (human, human.data, rig, rig.data):
    for key in list(idblock.keys()):
        del idblock[key]

human.name = human.data.name = "Body"
rig.name = rig.data.name = "Armature"
rig.show_in_front = False
rig.data.display_type = 'OCTAHEDRAL'

# re-ground: shift mesh data and bones so the lowest body vertex is at z = 0 and the model is centred in x
assert all(abs(v) < 1e-6 for v in rig.location) and all(abs(v) < 1e-6 for v in human.location)
assert human.parent == rig
mesh = human.data
zs = [v.co.z for v in mesh.vertices]
xs = [v.co.x for v in mesh.vertices]
shift = Vector((-(min(xs) + max(xs)) / 2.0, 0.0, -min(zs)))
log("grounding shift:", [round(c, 5) for c in shift])
if shift.length > 1e-7:
    mesh.transform(Matrix.Translation(shift))
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for b in rig.data.edit_bones:
        b.head += shift
        b.tail += shift
    bpy.ops.object.mode_set(mode='OBJECT')
mesh.update()

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
log("final mesh:", REPORT["final_mesh"])

# export
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
