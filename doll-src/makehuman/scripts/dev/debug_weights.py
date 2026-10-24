"""Debug: inspect mixamo weight distribution on the hand after add_builtin_rig."""
import bpy
from collections import Counter
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
macro = TargetService.get_default_macro_info_dict()
macro["gender"] = 1.0
human = HumanService.create_human(macro_detail_dict=macro)
rig = HumanService.add_builtin_rig(human, "mixamo")
names = {g.index: g.name for g in human.vertex_groups}
hand = human.vertex_groups["mixamorig:LeftHand"].index
cnt = 0
maxw = 0.0
hist = Counter()
groups_per_vertex = Counter()
for v in human.data.vertices:
    if v.index >= 13380:
        break
    groups_per_vertex[len([g for g in v.groups if names[g.group].startswith("mixamorig:")])] += 1
    for g in v.groups:
        if g.group == hand:
            cnt += 1
            maxw = max(maxw, g.weight)
            hist[round(g.weight, 1)] += 1
print("[dbg] LeftHand verts:", cnt, "max weight:", maxw, "hist:", sorted(hist.items()))
print("[dbg] bone-groups per body vertex:", sorted(groups_per_vertex.items()))
# sample a vertex with a LeftHand weight
for v in human.data.vertices:
    if any(g.group == hand for g in v.groups):
        print("[dbg] sample vertex", v.index, [(names[g.group], round(g.weight, 3)) for g in v.groups])
        break
# weight sums
sums = Counter()
for v in human.data.vertices:
    if v.index >= 13380:
        break
    s = sum(g.weight for g in v.groups if names[g.group].startswith("mixamorig:"))
    sums[round(s, 1)] += 1
print("[dbg] bone weight sums per body vertex:", sorted(sums.items()))
