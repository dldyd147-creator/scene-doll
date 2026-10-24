"""Smoke test: does the MPFB API work in background mode? Creates a human, adds the mixamo rig, prints stats."""
import bpy, sys, time
t0 = time.time()
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService
from bl_ext.user_default.mpfb.services.rigservice import RigService
from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

# empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)

macro = TargetService.get_default_macro_info_dict()
macro["gender"] = 1.0
print("[smoke] macro", macro)
human = HumanService.create_human(macro_detail_dict=macro)
print("[smoke] created", human.name, "verts", len(human.data.vertices), "polys", len(human.data.polygons), "in %.1fs" % (time.time() - t0))
print("[smoke] shape keys:", [k.name for k in human.data.shape_keys.key_blocks] if human.data.shape_keys else None)
print("[smoke] modifiers:", [(m.name, m.type, getattr(m, 'vertex_group', '')) for m in human.modifiers])
vg = [g.name for g in human.vertex_groups]
print("[smoke] vertex groups:", len(vg), vg[:20], "...")

def body_bbox(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    n = len(me.vertices)
    ev.to_mesh_clear()
    return n, (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

print("[smoke] evaluated body bbox (mask applied):", body_bbox(human))

rig = HumanService.add_builtin_rig(human, "mixamo")
print("[smoke] rig", rig.name, "bones", len(rig.data.bones), "in %.1fs" % (time.time() - t0))
for b in rig.data.bones:
    print("   ", b.name, "<-", b.parent.name if b.parent else None, "deform=", b.use_deform, "connect=", b.use_connect, "head=%s tail=%s" % (tuple(round(c, 4) for c in b.head_local), tuple(round(c, 4) for c in b.tail_local)))
print("[smoke] modifiers after rig:", [(m.name, m.type, getattr(m, 'vertex_group', ''), getattr(m, 'object', None)) for m in human.modifiers])
vg = [g.name for g in human.vertex_groups]
print("[smoke] vertex groups after rig:", len(vg))
print("[smoke] bone vertex groups present:", sum(1 for b in rig.data.bones if b.name in human.vertex_groups), "/", len(rig.data.bones))
print("[smoke] rig matrix_world:", rig.matrix_world, "human parent:", human.parent.name if human.parent else None, "human matrix_world translation:", human.matrix_world.translation)
print("[smoke] DONE in %.1fs" % (time.time() - t0))
