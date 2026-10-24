"""
verify_glb.py -- re-import a GLB in headless Blender and check the Scene Doll requirements.

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python verify_glb.py -- <file.glb> [<report.json>]

Checks / prints:
  * raw GLB JSON chunk: nodes, meshes, skins (joint count), materials, animations, extensions, triangle count
  * bones + parents after import; required Mixamo bone set; extras
  * mesh vertex/face/triangle counts; bounding box (Blender Z-up and glTF Y-up); height; min y ~ 0
  * facing direction (feet -> toes and face/nose direction) -- expected +Z in glTF
  * LeftArm/RightArm directions (expected +-X, horizontal) -> T-pose check; hand/palm orientation
  * every vertex has skin weights
"""
import sys
import os
import json
import struct
import math
import bpy
from mathutils import Vector

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if not args:
    raise SystemExit("usage: ... -- <file.glb> [<report.json>]")
glb_path = os.path.abspath(args[0])
json_out = os.path.abspath(args[1]) if len(args) > 1 else None

RESULT = {"glb": glb_path, "bytes": os.path.getsize(glb_path), "blender_version": bpy.app.version_string, "checks": {}}
PASS = True


def check(name, ok, detail=""):
    global PASS
    RESULT["checks"][name] = {"ok": bool(ok), "detail": detail}
    PASS = PASS and bool(ok)
    print(f"[verify] {'PASS' if ok else 'FAIL'}  {name}  {detail}")


# ----------------------------------------------------------------------------------------------------------------------
# raw GLB inspection (stdlib only)
# ----------------------------------------------------------------------------------------------------------------------
with open(glb_path, "rb") as f:
    data = f.read()
magic, version, length = struct.unpack_from("<III", data, 0)
assert magic == 0x46546C67, "not a GLB file"
chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
assert chunk_type == 0x4E4F534A, "first chunk is not JSON"
gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))

ACC_COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
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
    "node_names": [n.get("name") for n in gltf.get("nodes", [])],
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
check("triangles_le_30k_ideal", tri_total <= 30000, f"triangles={tri_total}")
pmin = prim_info[0]["position_min"]
pmax = prim_info[0]["position_max"]
if pmin and pmax:
    check("raw_min_y_is_zero", abs(pmin[1]) < 0.002, f"min y = {pmin[1]:.5f} (glTF Y-up)")
    check("raw_height", True, f"height = {pmax[1] - pmin[1]:.4f} m; x [{pmin[0]:.3f},{pmax[0]:.3f}] z [{pmin[2]:.3f},{pmax[2]:.3f}]")

# ----------------------------------------------------------------------------------------------------------------------
# import into Blender
# ----------------------------------------------------------------------------------------------------------------------
# node hierarchy of the file itself (independent of the importer)
children_of = {i: n.get("children", []) for i, n in enumerate(gltf.get("nodes", []))}
parent_of = {c: p for p, cs in children_of.items() for c in cs}
roots = [i for i in children_of if i not in parent_of]
mesh_nodes = [i for i, n in enumerate(gltf.get("nodes", [])) if "mesh" in n]
raw["scene_root_nodes"] = [gltf["nodes"][i].get("name") for i in roots]
raw["mesh_node_parents"] = [(gltf["nodes"][i].get("name"), gltf["nodes"][parent_of[i]].get("name") if i in parent_of else None) for i in mesh_nodes]
skin_roots = [gltf["nodes"][s["skeleton"]].get("name") if "skeleton" in s else None for s in gltf.get("skins", [])]
raw["skin_skeleton_roots"] = skin_roots
print("[verify] file hierarchy: roots", raw["scene_root_nodes"], "| mesh nodes (name, parent)", raw["mesh_node_parents"], "| skin skeleton roots", skin_roots)
check("file_has_no_stray_mesh_nodes", len(mesh_nodes) == 1, f"mesh nodes={raw['mesh_node_parents']}")

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
try:
    # TEMPERANCE: plain bone import. (The default 'BLENDER' heuristic in Blender 4.2+ adds an 'Icosphere' helper
    # object used as a custom bone shape -- that object is created by the importer, it is not part of the GLB.)
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
print("[verify] imported objects:", [(o.name, o.type, o.parent.name if o.parent else None) for o in objs],
      "| importer bone-shape helper objects:", sorted(shape_meshes))
check("one_armature_one_mesh", len(arms) == 1 and len(meshes) == 1, f"armatures={len(arms)} meshes={len(meshes)}")
arm = arms[0]
mesh_obj = meshes[0]

# bones
bones = [(b.name, b.parent.name if b.parent else None) for b in arm.data.bones]
RESULT["bones"] = bones
print("[verify] bones (%d):" % len(bones))
for name, parent in bones:
    print(f"    {name} <- {parent}")

REQUIRED_PARENTS = {
    "Hips": None, "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2", "Head": "Neck", "HeadTop_End": "Head",
}
for s in ("Left", "Right"):
    REQUIRED_PARENTS.update({
        f"{s}Shoulder": "Spine2", f"{s}Arm": f"{s}Shoulder", f"{s}ForeArm": f"{s}Arm", f"{s}Hand": f"{s}ForeArm",
        f"{s}UpLeg": "Hips", f"{s}Leg": f"{s}UpLeg", f"{s}Foot": f"{s}Leg", f"{s}ToeBase": f"{s}Foot", f"{s}Toe_End": f"{s}ToeBase",
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
check("bone_count", True, f"{len(bones)} bones")
check("skin_joints_match_bones", raw["joints_per_skin"] == [len(bones)], f"joints={raw['joints_per_skin']} bones={len(bones)}")

# mesh counts
me = mesh_obj.data
tri = sum(len(p.vertices) - 2 for p in me.polygons)
mesh_stats = {"vertices": len(me.vertices), "polygons": len(me.polygons), "triangles": tri,
              "vertex_groups": len(mesh_obj.vertex_groups), "materials": [m.name for m in me.materials]}
RESULT["mesh"] = mesh_stats
print("[verify] mesh:", mesh_stats)

# bbox (world, Blender Z-up) -> also as glTF Y-up (x, y_up = z_blender, z_fwd = -y_blender)
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

# facing: foot -> toe direction, and nose direction relative to head bone (glTF forward is +Z = Blender -Y)
def bone_dir(name):
    b = arm.data.bones[name]
    h = arm.matrix_world @ b.head_local
    t = arm.matrix_world @ b.tail_local
    return (t - h).normalized(), h, t

facing_ok = True
for s in ("Left", "Right"):
    d, h, t = bone_dir(f"{s}Foot")
    facing_ok = facing_ok and d.y < -0.5
    RESULT[f"{s}Foot_dir_blender"] = list(d)
head_dir, head_h, head_t = bone_dir("Head")
head_z0, head_z1 = min(head_h.z, head_t.z), max(head_h.z, head_t.z)
head_verts = [v for v in ws if head_z0 <= v.z <= head_z1]
nose = min(head_verts, key=lambda v: v.y)  # most forward (-Y) point around head height
back = max(head_verts, key=lambda v: v.y)
nose_forward = (head_h.y - nose.y) > (back.y - head_h.y)  # the face protrudes further forward than the back of the head
RESULT["nose_point_blender"] = list(nose)
RESULT["head_bone_head_blender"] = list(head_h)
check("facing_plus_z_gltf", facing_ok and nose_forward,
      f"feet dir (Blender) L={[round(c, 3) for c in RESULT['LeftFoot_dir_blender']]} nose y={nose.y:.3f} head y={head_h.y:.3f} back y={back.y:.3f}")

# T-pose check: arms horizontal along +-X, head top, feet bottom
for s, sign in (("Left", 1.0), ("Right", -1.0)):
    for b in ("Arm", "ForeArm", "Hand"):
        d, h, t = bone_dir(f"{s}{b}")
        ang_from_x = math.degrees(d.angle(Vector((sign, 0.0, 0.0))))
        RESULT[f"{s}{b}_dir_blender"] = [round(c, 4) for c in d]
        check(f"tpose_{s}{b}_along_{'+' if sign > 0 else '-'}X", ang_from_x < 3.0, f"dir={[round(c, 4) for c in d]} angle from +-X = {ang_from_x:.2f} deg")
    d, h, t = bone_dir(f"{s}Arm")
    check(f"tpose_{s}Arm_shoulder_height", abs(h.z - t.z) < 0.02, f"arm head z={h.z:.3f} tail z={t.z:.3f}")
    # palm orientation: PCA of hand vertices (dominant LeftHand/RightHand weight), normal sign from thumb rule
    import numpy as np
    hand_name = f"{s}Hand"
    gi = mesh_obj.vertex_groups[hand_name].index
    pts = []
    for v in me.vertices:
        w = {g.group: g.weight for g in v.groups}
        wh = w.get(gi, 0.0)
        if wh >= 0.6 and wh >= max(w.values()):
            pts.append(mw @ v.co)
    P = np.array([[p.x, p.y, p.z] for p in pts])
    c = P.mean(axis=0)
    evals, evecs = np.linalg.eigh(np.cov((P - c).T))
    n = Vector(evecs[:, 0]).normalized()
    axis = Vector((sign, 0.0, 0.0))
    th_d, th_h, _ = bone_dir(f"{s}HandThumb1")
    _, _, th_t = bone_dir(f"{s}HandThumb3")
    thumb = th_t - th_h
    thumb_perp = (thumb - thumb.dot(axis) * axis).normalized()
    palm_est = (axis.cross(thumb_perp) if s == "Left" else thumb_perp.cross(axis)).normalized()
    if n.dot(palm_est) < 0:
        n = -n
    palm_down = n.dot(Vector((0.0, 0.0, -1.0)))
    RESULT[f"{s}_palm_normal_blender"] = [round(x, 4) for x in n]
    check(f"palm_down_{s}", palm_down > 0.9, f"palm normal (Blender) = {[round(x, 3) for x in n]}  dot(-Z) = {palm_down:.3f}  thumb dir = {[round(x, 3) for x in thumb.normalized()]}")

d, h, t = bone_dir("Head")
check("head_at_top", t.z > 0.85 * height, f"Head tail z={t.z:.3f} of height {height:.3f}")
for s in ("Left", "Right"):
    d, h, t = bone_dir(f"{s}Foot")
    check(f"{s}Foot_at_bottom", h.z < 0.1 * height, f"{s}Foot head z={h.z:.3f}")
    d, h, t = bone_dir(f"{s}Leg")
    check(f"{s}Leg_straight_down", d.z < -0.95, f"dir={[round(c, 3) for c in d]}")

# skin weights
unweighted = sum(1 for v in me.vertices if sum(g.weight for g in v.groups) <= 1e-6)
check("all_vertices_weighted", unweighted == 0, f"unweighted={unweighted}")
max_influences = max(len(v.groups) for v in me.vertices)
check("max_4_influences", max_influences <= 4, f"max influences per vertex = {max_influences}")

# armature modifier present on the import
check("armature_modifier", any(m.type == 'ARMATURE' and m.object == arm for m in mesh_obj.modifiers))

RESULT["pass"] = PASS
print("[verify] OVERALL:", "PASS" if PASS else "FAIL")
if json_out:
    with open(json_out, "w", encoding="utf-8") as f:
        json.dump(RESULT, f, indent=2, default=str)
    print("[verify] wrote", json_out)
