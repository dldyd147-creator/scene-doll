"""
verify_glb_v2.py -- re-import a v2 GLB in headless Blender and check the Scene Doll v2 requirements.

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python verify_glb_v2.py -- <file.glb> [<report.json>]

v1 checks (kept): raw GLB JSON (single mesh/skin/material, no animations/textures, triangle budget), bones + parents,
required Mixamo chain, no prefix, mesh counts, bbox/height/grounding/centring, facing +Z, T-pose (arms along +-X,
palms down), head/feet placement, all vertices weighted, <= 4 influences, armature modifier.

v2 additions:
  * the 8 twist bones: present, parent, leaf, head ON the parent axis at 35 % / 65 %, identity local rotation (same roll)
  * raw skin data decoded from the binary chunk: per-vertex weight sums, influence histogram, per-joint vertex counts
  * weight islands per bone on the re-imported mesh (adjacency merged across UV-split duplicate vertices)
  * twist weight layout profile along each limb (mean twist share per 10 % bin of the limb axis)
  * smooth shading: all faces smooth, no normal seams between UV-split duplicate vertices (same position => same normal)
"""
import sys
import os
import json
import struct
import math
from collections import defaultdict, Counter

import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if not args:
    raise SystemExit("usage: ... -- <file.glb> [<report.json>]")
glb_path = os.path.abspath(args[0])
json_out = os.path.abspath(args[1]) if len(args) > 1 else None

RESULT = {"glb": glb_path, "bytes": os.path.getsize(glb_path), "blender_version": bpy.app.version_string, "checks": {}}
PASS = True

TWIST = {}  # twist bone -> (parent, limb child used for the parent's axis, head fraction)
for s in ("Left", "Right"):
    TWIST[f"{s}ArmTwist"] = (f"{s}Arm", f"{s}ForeArm", 0.35)
    TWIST[f"{s}ForeArmTwist"] = (f"{s}ForeArm", f"{s}Hand", 0.65)
    TWIST[f"{s}UpLegTwist"] = (f"{s}UpLeg", f"{s}Leg", 0.35)
    TWIST[f"{s}LegTwist"] = (f"{s}Leg", f"{s}Foot", 0.65)


def check(name, ok, detail=""):
    global PASS
    RESULT["checks"][name] = {"ok": bool(ok), "detail": detail}
    PASS = PASS and bool(ok)
    print(f"[verify] {'PASS' if ok else 'FAIL'}  {name}  {detail}")


# ----------------------------------------------------------------------------------------------------------------------
# raw GLB inspection (stdlib + numpy)
# ----------------------------------------------------------------------------------------------------------------------
with open(glb_path, "rb") as f:
    data = f.read()
magic, version, length = struct.unpack_from("<III", data, 0)
assert magic == 0x46546C67, "not a GLB file"
chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
assert chunk_type == 0x4E4F534A, "first chunk is not JSON"
gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))
bin_off = 20 + chunk_len
bin_len, bin_type = struct.unpack_from("<II", data, bin_off)
assert bin_type == 0x004E4942, "second chunk is not BIN"
BIN = data[bin_off + 8: bin_off + 8 + bin_len]


def read_accessor(idx):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    dtype = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc["componentType"]]
    count = acc["count"]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride")
    itemsize = np.dtype(dtype).itemsize * ncomp
    if stride and stride != itemsize:
        out = np.empty((count, ncomp), dtype)
        for i in range(count):
            out[i] = np.frombuffer(BIN, dtype=dtype, count=ncomp, offset=offset + i * stride)
        return out
    return np.frombuffer(BIN, dtype=dtype, count=count * ncomp, offset=offset).reshape(count, ncomp)


raw = {
    "asset": gltf.get("asset"),
    "nodes": len(gltf.get("nodes", [])),
    "meshes": len(gltf.get("meshes", [])),
    "skins": len(gltf.get("skins", [])),
    "joints_per_skin": [len(s.get("joints", [])) for s in gltf.get("skins", [])],
    "materials": [m.get("name") for m in gltf.get("materials", [])],
    "textures": len(gltf.get("textures", [])),
    "images": len(gltf.get("images", [])),
    "animations": len(gltf.get("animations", [])),
    "extensionsUsed": gltf.get("extensionsUsed", []),
}
tri_total = 0
prim_info = []
for mesh in gltf.get("meshes", []):
    for prim in mesh.get("primitives", []):
        mode = prim.get("mode", 4)
        idx = prim.get("indices")
        count = gltf["accessors"][idx]["count"] if idx is not None else gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
        tris = count // 3 if mode == 4 else None
        tri_total += tris or 0
        prim_info.append({"mesh": mesh.get("name"), "mode": mode, "index_count": count, "triangles": tris,
                          "attributes": sorted(prim["attributes"].keys()),
                          "positions": gltf["accessors"][prim["attributes"]["POSITION"]]["count"],
                          "position_min": gltf["accessors"][prim["attributes"]["POSITION"]].get("min"),
                          "position_max": gltf["accessors"][prim["attributes"]["POSITION"]].get("max"),
                          "targets": len(prim.get("targets", []))})
raw["primitives"] = prim_info
raw["triangles_total"] = tri_total
RESULT["raw_gltf"] = raw
print("[verify] raw glTF:", json.dumps(raw, indent=1))
check("single_mesh", raw["meshes"] == 1, f"meshes={raw['meshes']}")
check("single_skin", raw["skins"] == 1, f"skins={raw['skins']}")
check("no_animations", raw["animations"] == 0, f"animations={raw['animations']}")
check("no_textures", raw["textures"] == 0 and raw["images"] == 0)
check("one_material", len(raw["materials"]) == 1, f"materials={raw['materials']}")
check("no_morph_targets", all(p["targets"] == 0 for p in prim_info))
check("triangles_le_50k", tri_total <= 50000, f"triangles={tri_total}")
check("single_primitive", len(prim_info) == 1, f"primitives={len(prim_info)}")
pmin = prim_info[0]["position_min"]
pmax = prim_info[0]["position_max"]
if pmin and pmax:
    check("raw_min_y_is_zero", abs(pmin[1]) < 0.002, f"min y = {pmin[1]:.5f} (glTF Y-up)")
    check("raw_height", True, f"height = {pmax[1] - pmin[1]:.4f} m; x [{pmin[0]:.3f},{pmax[0]:.3f}] z [{pmin[2]:.3f},{pmax[2]:.3f}]")

# node hierarchy + world transforms (glTF space, Y-up)
nodes = gltf["nodes"]
children_of = {i: n.get("children", []) for i, n in enumerate(nodes)}
parent_of = {c: p for p, cs in children_of.items() for c in cs}
name_to_node = {n.get("name"): i for i, n in enumerate(nodes)}


def local_matrix(n):
    if "matrix" in n:
        m = n["matrix"]
        return Matrix([[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]])
    t = Matrix.Translation(Vector(n.get("translation", [0, 0, 0])))
    q = n.get("rotation", [0, 0, 0, 1])
    r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    s = n.get("scale", [1, 1, 1])
    sm = Matrix.Diagonal(Vector(s)).to_4x4()
    return t @ r @ sm


world = {}


def world_matrix(i):
    if i in world:
        return world[i]
    m = local_matrix(nodes[i])
    if i in parent_of:
        m = world_matrix(parent_of[i]) @ m
    world[i] = m
    return m


skin = gltf["skins"][0]
joint_nodes = skin["joints"]
joint_names = [nodes[j].get("name") for j in joint_nodes]
joint_pos = {nodes[j].get("name"): world_matrix(j).translation.copy() for j in joint_nodes}
RESULT["joint_positions_gltf"] = {k: [round(c, 4) for c in v] for k, v in joint_pos.items()}
mesh_nodes = [i for i, n in enumerate(nodes) if "mesh" in n]
check("file_has_no_stray_mesh_nodes", len(mesh_nodes) == 1, f"mesh nodes={[nodes[i].get('name') for i in mesh_nodes]}")

# twist node checks on the raw hierarchy
twist_raw = {}
for tname, (pname, cname, frac) in TWIST.items():
    ok = tname in name_to_node and pname in name_to_node and cname in name_to_node
    if not ok:
        check(f"twist_node_{tname}", False, "missing node(s)")
        continue
    ni = name_to_node[tname]
    n = nodes[ni]
    rot = n.get("rotation", [0, 0, 0, 1])
    q = Quaternion((rot[3], rot[0], rot[1], rot[2]))
    rot_deg = math.degrees(2.0 * math.acos(min(1.0, abs(q.w))))
    P, C, T = joint_pos[pname], joint_pos[cname], joint_pos[tname]
    axis = (C - P)
    L = axis.length
    axis.normalize()
    along = (T - P).dot(axis)
    off_axis = ((T - P) - axis * along).length
    frac_actual = along / L
    is_leaf = len(children_of.get(ni, [])) == 0
    parent_ok = parent_of.get(ni) == name_to_node[pname]
    twist_raw[tname] = {"parent_ok": parent_ok, "leaf": is_leaf, "local_rotation_deg": round(rot_deg, 4), "fraction_along_parent": round(frac_actual, 4),
                        "off_axis_m": round(off_axis, 5), "translation": n.get("translation"), "parent_length_m": round(L, 4)}
    check(f"twist_{tname}", parent_ok and is_leaf and rot_deg < 0.05 and off_axis < 0.001 and abs(frac_actual - frac) < 0.02,
          f"parent_ok={parent_ok} leaf={is_leaf} local_rot={rot_deg:.3f}deg frac={frac_actual:.3f} (target {frac}) off_axis={off_axis * 1000:.2f}mm")
RESULT["twist_nodes_raw"] = twist_raw

# raw skin weights
prim = gltf["meshes"][0]["primitives"][0]
attrs = prim["attributes"]
check("single_weight_set", "WEIGHTS_1" not in attrs and "JOINTS_1" not in attrs, f"attributes={sorted(attrs)}")
POS = read_accessor(attrs["POSITION"]).astype(np.float64)
NRM = read_accessor(attrs["NORMAL"]).astype(np.float64)
J = read_accessor(attrs["JOINTS_0"]).astype(np.int64)
Wt = read_accessor(attrs["WEIGHTS_0"]).astype(np.float64)
if gltf["accessors"][attrs["WEIGHTS_0"]].get("normalized"):
    Wt = Wt / np.iinfo(read_accessor(attrs["WEIGHTS_0"]).dtype).max
sums = Wt.sum(axis=1)
infl = (Wt > 0).sum(axis=1)
RESULT["raw_weights"] = {
    "vertices": int(len(Wt)), "sum_min": float(sums.min()), "sum_max": float(sums.max()), "sum_mean": float(sums.mean()),
    "zero_weight_vertices": int((sums <= 1e-6).sum()), "influence_histogram": {int(k): int(v) for k, v in zip(*np.unique(infl, return_counts=True))},
    "max_influences": int(infl.max()),
}
check("raw_weights_normalised", abs(sums.min() - 1.0) < 2e-3 and abs(sums.max() - 1.0) < 2e-3, f"sum range [{sums.min():.5f}, {sums.max():.5f}]")
check("raw_no_zero_weight_vertex", RESULT["raw_weights"]["zero_weight_vertices"] == 0, f"zero={RESULT['raw_weights']['zero_weight_vertices']}")
check("raw_max_4_influences", infl.max() <= 4, f"histogram={RESULT['raw_weights']['influence_histogram']}")
joint_vertex_counts = Counter()
joint_weight_sums = defaultdict(float)
for row_j, row_w in zip(J, Wt):
    for j, w in zip(row_j, row_w):
        if w > 0:
            joint_vertex_counts[joint_names[j]] += 1
            joint_weight_sums[joint_names[j]] += w
RESULT["raw_joint_vertex_counts_split_mesh"] = dict(sorted(joint_vertex_counts.items()))
RESULT["raw_joint_weight_sums_split_mesh"] = {k: round(v, 2) for k, v in sorted(joint_weight_sums.items())}
end_bones = ["HeadTop_End", "LeftToe_End", "RightToe_End"] + [f"{s}Hand{f}4" for s in ("Left", "Right") for f in ("Thumb", "Index", "Middle", "Ring", "Pinky")]
check("end_bones_weightless", all(joint_vertex_counts.get(b, 0) == 0 for b in end_bones), f"weighted end bones={[b for b in end_bones if joint_vertex_counts.get(b, 0)]}")
check("twist_bones_weighted", all(joint_vertex_counts.get(b, 0) > 50 for b in TWIST), f"{ {b: joint_vertex_counts.get(b, 0) for b in TWIST} }")

# normal seams: identical positions must carry identical normals (UV-split duplicates)
pos_key = defaultdict(list)
for i, p in enumerate(np.round(POS, 6)):
    pos_key[tuple(p)].append(i)
max_seam_deg = 0.0
n_dup_groups = 0
for key, idxs in pos_key.items():
    if len(idxs) < 2:
        continue
    n_dup_groups += 1
    ref = NRM[idxs[0]]
    for i in idxs[1:]:
        c = float(np.clip(np.dot(ref, NRM[i]) / (np.linalg.norm(ref) * np.linalg.norm(NRM[i]) + 1e-12), -1.0, 1.0))
        max_seam_deg = max(max_seam_deg, math.degrees(math.acos(c)))
RESULT["normals"] = {"unique_positions": len(pos_key), "split_vertices": int(len(POS)), "duplicate_position_groups": n_dup_groups, "max_normal_angle_between_duplicates_deg": round(max_seam_deg, 4)}
check("no_normal_seams", max_seam_deg < 0.5, f"max normal angle between co-located vertices = {max_seam_deg:.3f} deg over {n_dup_groups} duplicate groups; {len(pos_key)} unique positions")

# ----------------------------------------------------------------------------------------------------------------------
# import into Blender
# ----------------------------------------------------------------------------------------------------------------------
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
try:
    bpy.ops.import_scene.gltf(filepath=glb_path, bone_heuristic='TEMPERANCE')
except TypeError:
    bpy.ops.import_scene.gltf(filepath=glb_path)
objs = list(bpy.context.scene.objects)
arms = [o for o in objs if o.type == 'ARMATURE']
shape_meshes = set()
for a in arms:
    for pb in a.pose.bones:
        if pb.custom_shape is not None:
            shape_meshes.add(pb.custom_shape.name)
meshes = [o for o in objs if o.type == 'MESH' and o.name not in shape_meshes]
check("one_armature_one_mesh", len(arms) == 1 and len(meshes) == 1, f"armatures={len(arms)} meshes={len(meshes)}")
arm = arms[0]
mesh_obj = meshes[0]

bones = [(b.name, b.parent.name if b.parent else None) for b in arm.data.bones]
RESULT["bones"] = bones
print("[verify] bones (%d):" % len(bones))
for name, parent in bones:
    print(f"    {name} <- {parent}")

REQUIRED_PARENTS = {"Hips": None, "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2", "Head": "Neck", "HeadTop_End": "Head"}
for s in ("Left", "Right"):
    REQUIRED_PARENTS.update({
        f"{s}Shoulder": "Spine2", f"{s}Arm": f"{s}Shoulder", f"{s}ForeArm": f"{s}Arm", f"{s}Hand": f"{s}ForeArm",
        f"{s}UpLeg": "Hips", f"{s}Leg": f"{s}UpLeg", f"{s}Foot": f"{s}Leg", f"{s}ToeBase": f"{s}Foot", f"{s}Toe_End": f"{s}ToeBase",
        f"{s}ArmTwist": f"{s}Arm", f"{s}ForeArmTwist": f"{s}ForeArm", f"{s}UpLegTwist": f"{s}UpLeg", f"{s}LegTwist": f"{s}Leg",
    })
OPTIONAL_PARENTS = {}
for s in ("Left", "Right"):
    for fng in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        OPTIONAL_PARENTS[f"{s}Hand{fng}1"] = f"{s}Hand"
        for i in (2, 3, 4):
            OPTIONAL_PARENTS[f"{s}Hand{fng}{i}"] = f"{s}Hand{fng}{i - 1}"
bone_dict = dict(bones)
missing = [b for b in REQUIRED_PARENTS if b not in bone_dict]
wrong_parent = [(b, bone_dict.get(b), p) for b, p in REQUIRED_PARENTS.items() if b in bone_dict and bone_dict[b] != p]
wrong_parent += [(b, bone_dict.get(b), p) for b, p in OPTIONAL_PARENTS.items() if b in bone_dict and bone_dict[b] != p]
extra = [b for b in bone_dict if b not in REQUIRED_PARENTS and b not in OPTIONAL_PARENTS]
prefixed = [b for b in bone_dict if ":" in b]
missing_optional = [b for b in OPTIONAL_PARENTS if b not in bone_dict]
check("required_bones_present", not missing, f"missing={missing}")
check("parent_chain", not wrong_parent, f"wrong={wrong_parent}")
check("no_extra_bones", not extra, f"extra={extra}")
check("no_prefix", not prefixed, f"prefixed={prefixed}")
check("finger_bones", not missing_optional, f"missing optional={missing_optional}")
check("bone_count", len(bones) == 73, f"{len(bones)} bones (expected 73 = 65 Mixamo + 8 twist)")
check("skin_joints_match_bones", raw["joints_per_skin"] == [len(bones)], f"joints={raw['joints_per_skin']} bones={len(bones)}")
for t in TWIST:
    if t in arm.data.bones:
        check(f"twist_leaf_{t}", len(arm.data.bones[t].children) == 0, f"children={[c.name for c in arm.data.bones[t].children]}")

me = mesh_obj.data
tri = sum(len(p.vertices) - 2 for p in me.polygons)
mesh_stats = {"vertices": len(me.vertices), "polygons": len(me.polygons), "triangles": tri,
              "vertex_groups": len(mesh_obj.vertex_groups), "materials": [m.name for m in me.materials],
              "smooth_polys": sum(1 for p in me.polygons if p.use_smooth), "has_custom_normals": me.has_custom_normals,
              "sharp_edges": sum(1 for e in me.edges if e.use_edge_sharp)}
RESULT["mesh"] = mesh_stats
print("[verify] mesh:", mesh_stats)
check("all_faces_smooth", mesh_stats["smooth_polys"] == mesh_stats["polygons"], f"smooth {mesh_stats['smooth_polys']}/{mesh_stats['polygons']}, sharp edges {mesh_stats['sharp_edges']}")

mw = mesh_obj.matrix_world
ws = [mw @ v.co for v in me.vertices]
bx = (min(v.x for v in ws), max(v.x for v in ws))
by = (min(v.y for v in ws), max(v.y for v in ws))
bz = (min(v.z for v in ws), max(v.z for v in ws))
height = bz[1] - bz[0]
RESULT["bbox_blender_zup"] = {"x": bx, "y": by, "z": bz}
RESULT["bbox_gltf_yup"] = {"x": bx, "y": bz, "z": (-by[1], -by[0])}
RESULT["height_m"] = height
check("height", True, f"height={height:.4f} m  bbox(glTF) x[{bx[0]:.3f},{bx[1]:.3f}] y[{bz[0]:.3f},{bz[1]:.3f}] z[{-by[1]:.3f},{-by[0]:.3f}]")
check("feet_on_ground", abs(bz[0]) < 0.002, f"min y (glTF) = {bz[0]:.5f}")
check("centred_x", abs((bx[0] + bx[1]) / 2) < 0.01, f"x centre = {(bx[0] + bx[1]) / 2:.4f}")


def bone_head(name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def limb_dir(name, child):
    """direction from a joint to its limb child joint (independent of the importer's bone-tail heuristic)."""
    h = bone_head(name)
    t = bone_head(child)
    return (t - h).normalized(), h, t


facing_ok = True
for s in ("Left", "Right"):
    d, h, t = limb_dir(f"{s}Foot", f"{s}ToeBase")
    facing_ok = facing_ok and d.y < -0.5
    RESULT[f"{s}Foot_dir_blender"] = list(d)
head_h = bone_head("Head")
head_t = bone_head("HeadTop_End")
head_z0, head_z1 = min(head_h.z, head_t.z), max(head_h.z, head_t.z)
head_verts = [v for v in ws if head_z0 <= v.z <= head_z1]
nose = min(head_verts, key=lambda v: v.y)
back = max(head_verts, key=lambda v: v.y)
nose_forward = (head_h.y - nose.y) > (back.y - head_h.y)
check("facing_plus_z_gltf", facing_ok and nose_forward,
      f"feet dir (Blender) L={[round(c, 3) for c in RESULT['LeftFoot_dir_blender']]} nose y={nose.y:.3f} head y={head_h.y:.3f} back y={back.y:.3f}")

for s, sign in (("Left", 1.0), ("Right", -1.0)):
    for b, c in (("Arm", "ForeArm"), ("ForeArm", "Hand"), ("Hand", "HandMiddle1")):
        d, h, t = limb_dir(f"{s}{b}", f"{s}{c}")
        ang_from_x = math.degrees(d.angle(Vector((sign, 0.0, 0.0))))
        RESULT[f"{s}{b}_dir_blender"] = [round(c_, 4) for c_ in d]
        check(f"tpose_{s}{b}_along_{'+' if sign > 0 else '-'}X", ang_from_x < 3.0 if b != "Hand" else ang_from_x < 10.0,
              f"dir={[round(c_, 4) for c_ in d]} angle from +-X = {ang_from_x:.2f} deg")
    d, h, t = limb_dir(f"{s}Arm", f"{s}ForeArm")
    check(f"tpose_{s}Arm_shoulder_height", abs(h.z - t.z) < 0.02, f"arm head z={h.z:.3f} elbow z={t.z:.3f}")
    hand_name = f"{s}Hand"
    gi = mesh_obj.vertex_groups[hand_name].index
    pts = []
    for v in me.vertices:
        w = {g.group: g.weight for g in v.groups}
        wh = w.get(gi, 0.0)
        if wh >= 0.6 and wh >= max(w.values()):
            pts.append(mw @ v.co)
    P = np.array([[p.x, p.y, p.z] for p in pts])
    c0 = P.mean(axis=0)
    evals, evecs = np.linalg.eigh(np.cov((P - c0).T))
    n = Vector(evecs[:, 0]).normalized()
    axis = Vector((sign, 0.0, 0.0))
    th_h = bone_head(f"{s}HandThumb1")
    th_t = bone_head(f"{s}HandThumb4")
    thumb = th_t - th_h
    thumb_perp = (thumb - thumb.dot(axis) * axis).normalized()
    palm_est = (axis.cross(thumb_perp) if s == "Left" else thumb_perp.cross(axis)).normalized()
    if n.dot(palm_est) < 0:
        n = -n
    palm_down = n.dot(Vector((0.0, 0.0, -1.0)))
    RESULT[f"{s}_palm_normal_blender"] = [round(x, 4) for x in n]
    check(f"palm_down_{s}", palm_down > 0.9, f"palm normal (Blender) = {[round(x, 3) for x in n]}  dot(-Z) = {palm_down:.3f}  thumb dir = {[round(x, 3) for x in thumb.normalized()]}")

check("head_at_top", head_t.z > 0.85 * height, f"HeadTop_End z={head_t.z:.3f} of height {height:.3f}")
for s in ("Left", "Right"):
    h = bone_head(f"{s}Foot")
    check(f"{s}Foot_at_bottom", h.z < 0.1 * height, f"{s}Foot head z={h.z:.3f}")
    d, h, t = limb_dir(f"{s}Leg", f"{s}Foot")
    check(f"{s}Leg_straight_down", d.z < -0.95, f"dir={[round(c_, 3) for c_ in d]}")

# imported-mesh skin weights
unweighted = sum(1 for v in me.vertices if sum(g.weight for g in v.groups) <= 1e-6)
check("all_vertices_weighted", unweighted == 0, f"unweighted={unweighted}")
max_influences = max(len(v.groups) for v in me.vertices)
check("max_4_influences", max_influences <= 4, f"max influences per vertex = {max_influences}")
check("armature_modifier", any(m.type == 'ARMATURE' and m.object == arm for m in mesh_obj.modifiers))

# islands per bone, with adjacency merged across co-located (UV-split) vertices
gname = {g.index: g.name for g in mesh_obj.vertex_groups}
key_of = {}
keys = {}
for v in me.vertices:
    k = tuple(np.round([v.co.x, v.co.y, v.co.z], 6))
    key_of[v.index] = keys.setdefault(k, len(keys))
adj = defaultdict(set)
for e in me.edges:
    a, b = (key_of[e.vertices[0]], key_of[e.vertices[1]])
    adj[a].add(b)
    adj[b].add(a)
Wb = defaultdict(dict)  # bone -> {merged vertex key: weight}
for v in me.vertices:
    for g in v.groups:
        if g.weight > 1e-4:
            Wb[gname[g.group]][key_of[v.index]] = max(g.weight, Wb[gname[g.group]].get(key_of[v.index], 0.0))


def components(vset):
    seen = set()
    comps = []
    for s0 in vset:
        if s0 in seen:
            continue
        stack = [s0]
        seen.add(s0)
        size = 1
        while stack:
            x = stack.pop()
            for y in adj[x]:
                if y in vset and y not in seen:
                    seen.add(y)
                    stack.append(y)
                    size += 1
        comps.append(size)
    return sorted(comps, reverse=True)


island_info = {}
multi = {}
for bone, d in Wb.items():
    comps = components(set(d))
    island_info[bone] = {"vertices_merged": len(d), "islands": len(comps), "sizes": comps[:5]}
    if len(comps) > 1:
        multi[bone] = comps
RESULT["bone_vertex_counts_merged_mesh"] = {b: island_info[b]["vertices_merged"] for b in sorted(island_info)}
RESULT["islands"] = island_info
check("no_weight_islands", not multi, f"bones with >1 island: {multi}" if multi else f"all {len(island_info)} weighted bones are single connected regions")
check("unique_positions_match_blender_body", len(keys) == 13380, f"unique positions={len(keys)} (MakeHuman body = 13380)")

# edge steps on the merged mesh
steps = []
vw = defaultdict(dict)
for v in me.vertices:
    for g in v.groups:
        vw[key_of[v.index]][gname[g.group]] = g.weight
for a, nbrs in adj.items():
    for b in nbrs:
        if b <= a:
            continue
        m = 0.0
        for k in set(vw[a]) | set(vw[b]):
            m = max(m, abs(vw[a].get(k, 0.0) - vw[b].get(k, 0.0)))
        steps.append(m)
RESULT["edge_step_histogram"] = {str(k): v for k, v in sorted(Counter(round(s0, 1) for s0 in steps).items())}
RESULT["edges_with_step_gt_0_5"] = sum(1 for s0 in steps if s0 > 0.5)
RESULT["edges_with_step_gt_0_3_fraction"] = sum(1 for s0 in steps if s0 > 0.3) / len(steps)
# informational: the imported mesh is triangulated, so quad diagonals are counted as edges too. The remaining
# > 0.5 steps are a handful of edges at the inner elbow crease, thumb base / palm, heel and finger webbing that are
# present in the MakeHuman/MPFB source weights. Fail only if the mesh is not predominantly smooth (> 5 % of edges
# with a step above 0.3) or if any single edge jumps by more than 0.9.
check("weights_smooth", RESULT["edges_with_step_gt_0_3_fraction"] < 0.05 and max(steps) <= 0.9,
      f"edges with step > 0.3: {RESULT['edges_with_step_gt_0_3_fraction'] * 100:.2f} %; > 0.5: {RESULT['edges_with_step_gt_0_5']} / {len(steps)} (tri mesh); max step {max(steps):.3f}; histogram {RESULT['edge_step_histogram']}")

# twist layout profiles along each limb
profiles = {}
for tname, (pname, cname, frac) in TWIST.items():
    if tname not in Wb:
        continue
    d, h, t = limb_dir(pname, cname)
    L = (t - h).length
    bins = defaultdict(lambda: [0, 0.0, 0.0])
    pos_of_key = {}
    for v in me.vertices:
        pos_of_key.setdefault(key_of[v.index], mw @ v.co)
    for k in set(Wb[tname]) | set(Wb[pname]):
        tt = (pos_of_key[k] - h).dot(d) / L
        bi = min(9, int(math.floor(tt * 10))) if tt >= 0 else -1
        wt = Wb[tname].get(k, 0.0)
        wp = Wb[pname].get(k, 0.0)
        bins[bi][0] += 1
        bins[bi][1] += wt
        bins[bi][2] += wp
    prof = {}
    for bi in sorted(bins):
        n_, st, sp = bins[bi]
        prof[("%.1f-%.1f" % (bi / 10, (bi + 1) / 10)) if bi >= 0 else "<0"] = {"n": n_, "twist_share": round(st / (st + sp), 3) if st + sp > 0 else None}
    profiles[tname] = prof
    shares = [v["twist_share"] for k_, v in prof.items() if v["twist_share"] is not None and k_ != "<0"]
    kind = "proximal" if "Arm" in tname and "Fore" not in tname or "UpLeg" in tname else "distal"
    if kind == "proximal":
        ok = prof.get("0.0-0.1", {}).get("twist_share", 0) > 0.85 and all(v["twist_share"] < 0.02 for k_, v in prof.items() if k_ >= "0.6" and k_ != "<0" and v["twist_share"] is not None)
    else:
        ok = prof.get("0.9-1.0", {}).get("twist_share", 0) > 0.85 and all(v["twist_share"] < 0.02 for k_, v in prof.items() if k_ < "0.2" and k_ != "<0" and v["twist_share"] is not None)
    check(f"twist_layout_{tname}", ok, f"{kind}: " + " ".join(f"{k_}:{v['twist_share']}" for k_, v in prof.items()))
RESULT["twist_profiles"] = profiles

RESULT["pass"] = PASS
print("[verify] OVERALL:", "PASS" if PASS else "FAIL")
if json_out:
    with open(json_out, "w", encoding="utf-8") as f:
        json.dump(RESULT, f, indent=2, default=str)
    print("[verify] wrote", json_out)
