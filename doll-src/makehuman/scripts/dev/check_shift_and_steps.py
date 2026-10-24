"""Dev: in a final debug .blend, check connected-bone head/tail consistency, twist-vs-parent relative rotation, and
where the hard weight steps (> 0.5) are located."""
import bpy, math
from collections import defaultdict
arm = bpy.data.objects["Armature"]; body = bpy.data.objects["Body"]; me = body.data
print("== connected bones: |child.head - parent.tail| ==")
for b in arm.data.bones:
    if b.parent and b.use_connect:
        d = (b.head_local - b.parent.tail_local).length
        if d > 1e-5:
            print("   MISMATCH %-18s %.5f m" % (b.name, d))
print("== twist vs parent relative rotation (final state) ==")
for b in arm.data.bones:
    if b.name.endswith("Twist"):
        rel = b.parent.matrix_local.inverted() @ b.matrix_local
        q = rel.to_quaternion(); ang = math.degrees(2 * math.acos(min(1, abs(q.w))))
        pd = (b.parent.tail_local - b.parent.head_local).normalized(); bd = (b.tail_local - b.head_local).normalized()
        print("   %-18s rel_rot=%.4f deg  dir angle=%.4f deg  parent dir=%s" % (b.name, ang, math.degrees(pd.angle(bd)), [round(c, 4) for c in pd]))
gname = {g.index: g.name for g in body.vertex_groups}
print("== hard weight steps (> 0.5) ==")
for e in me.edges:
    a, b_ = e.vertices
    wa = {gname[g.group]: g.weight for g in me.vertices[a].groups}; wb = {gname[g.group]: g.weight for g in me.vertices[b_].groups}
    m, mb = 0.0, None
    for k in set(wa) | set(wb):
        d = abs(wa.get(k, 0) - wb.get(k, 0))
        if d > m: m, mb = d, k
    if m > 0.5:
        p = (me.vertices[a].co + me.vertices[b_].co) / 2
        print("   step %.3f %-18s at %s  A=%s B=%s" % (m, mb, [round(c, 3) for c in p], {k: round(v, 2) for k, v in wa.items()}, {k: round(v, 2) for k, v in wb.items()}))
