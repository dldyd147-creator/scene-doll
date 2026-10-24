"""Dev analysis for v2: inspect v1 weight quality on the final v1 scene (logs/mh_male_debug.blend, read-only).
Usage: blender -b <debug.blend> --python analyze_weights_v2.py
Prints: islands per bone, edge weight steps, limb weight profiles along the bone axis, shading flags,
and the MakeHuman default-rig 01/02 limb split as a proximal/distal cross-check."""
import bpy, json, os, sys
from collections import defaultdict, Counter
from mathutils import Vector

body = bpy.data.objects["Body"]
arm = bpy.data.objects["Armature"]
me = body.data
names = {g.index: g.name for g in body.vertex_groups}
W = defaultdict(dict)   # bone -> {vi: w}
for v in me.vertices:
    for g in v.groups:
        if g.weight > 1e-4:
            W[names[g.group]][v.index] = g.weight

# adjacency
adj = defaultdict(set)
for e in me.edges:
    a, b = e.vertices
    adj[a].add(b); adj[b].add(a)

def islands(vset):
    seen = set(); comps = []
    for s in vset:
        if s in seen: continue
        stack = [s]; comp = 0; seen.add(s)
        while stack:
            x = stack.pop(); comp += 1
            for y in adj[x]:
                if y in vset and y not in seen:
                    seen.add(y); stack.append(y)
        comps.append(comp)
    return sorted(comps, reverse=True)

print("== islands per bone (component sizes, largest first) ==")
for bone in sorted(W):
    comps = islands(set(W[bone]))
    flag = "  <-- MULTI" if len(comps) > 1 else ""
    print("  %-18s verts=%5d islands=%d %s%s" % (bone, len(W[bone]), len(comps), comps[:6], flag))

print("== edge weight steps (max over bones of |w_a - w_b| per edge) ==")
steps = []
for e in me.edges:
    a, b = e.vertices
    wa = {names[g.group]: g.weight for g in me.vertices[a].groups}
    wb = {names[g.group]: g.weight for g in me.vertices[b].groups}
    m = 0.0
    for k in set(wa) | set(wb):
        m = max(m, abs(wa.get(k, 0.0) - wb.get(k, 0.0)))
    steps.append(m)
hist = Counter(round(s, 1) for s in steps)
print("  hist:", sorted(hist.items()))
print("  edges with step > 0.5:", sum(1 for s in steps if s > 0.5), "/", len(steps))

def profile(bone, others, nb=10):
    b = arm.data.bones[bone]
    h = arm.matrix_world @ b.head_local; t = arm.matrix_world @ b.tail_local
    d = (t - h); L = d.length; d.normalize()
    bins = defaultdict(lambda: defaultdict(float)); cnt = Counter()
    for vi in W[bone]:
        p = body.matrix_world @ me.vertices[vi].co
        tt = (p - h).dot(d) / L
        k = min(nb - 1, max(-1, int(tt * nb))) if tt >= 0 else -1
        cnt[k] += 1
        for o in [bone] + others:
            bins[k][o] += W[o].get(vi, 0.0)
    print("== profile along %s (len %.3f m); bins of t=(proj/len), mean weights ==" % (bone, L))
    for k in sorted(cnt):
        print("   t[%5.2f..%5.2f) n=%4d  " % (k / nb, (k + 1) / nb, cnt[k]) + "  ".join("%s=%.3f" % (o, bins[k][o] / cnt[k]) for o in [bone] + others))

profile("LeftArm", ["LeftShoulder", "Spine2", "LeftForeArm"])
profile("LeftForeArm", ["LeftArm", "LeftHand"])
profile("LeftUpLeg", ["Hips", "LeftLeg"])
profile("LeftLeg", ["LeftUpLeg", "LeftFoot"])
profile("LeftHand", ["LeftForeArm"])

print("== shading ==")
print("  polys smooth:", sum(1 for p in me.polygons if p.use_smooth), "/", len(me.polygons))
print("  sharp edges:", sum(1 for e in me.edges if e.use_edge_sharp), " custom normals:", me.has_custom_normals,
      " attrs:", [a.name for a in me.attributes])
print("  modifiers:", [(m.name, m.type) for m in body.modifiers])

# default rig 01/02 split cross-check (weights.default.json indexes the base mesh; body verts are [0,13380))
mpfb = None
for cand in ("bl_ext.user_default.mpfb",):
    try:
        import importlib; mpfb = importlib.import_module(cand)
    except Exception as ex:
        print("  mpfb import failed", ex)
if mpfb:
    p = os.path.join(os.path.dirname(mpfb.__file__), "data", "rigs", "standard", "weights.default.json")
    dw = json.load(open(p, encoding="utf-8"))["weights"]
    def tobone(name): return {i: w for i, w in dw[name] if i < 13380}
    for mix, (b01, b02) in {"LeftArm": ("upperarm01.L", "upperarm02.L"), "LeftForeArm": ("lowerarm01.L", "lowerarm02.L"),
                            "LeftUpLeg": ("upperleg01.L", "upperleg02.L"), "LeftLeg": ("lowerleg01.L", "lowerleg02.L")}.items():
        w1, w2 = tobone(b01), tobone(b02)
        b = arm.data.bones[mix]
        h = arm.matrix_world @ b.head_local; t = arm.matrix_world @ b.tail_local
        d = (t - h); L = d.length; d.normalize()
        bins = defaultdict(list)
        union = set(w1) | set(w2)
        print("== default-rig split %s/%s vs %s: union=%d, mixamo %s verts=%d, overlap=%d ==" % (b01, b02, mix, len(union), mix, len(W[mix]), len(union & set(W[mix]))))
        for vi in union:
            a1, a2 = w1.get(vi, 0.0), w2.get(vi, 0.0)
            if a1 + a2 < 1e-6: continue
            p3 = body.matrix_world @ me.vertices[vi].co
            tt = (p3 - h).dot(d) / L
            k = min(9, max(-1, int(tt * 10))) if tt >= 0 else -1
            bins[k].append(a1 / (a1 + a2))
        for k in sorted(bins):
            vals = bins[k]
            print("   t[%5.2f..%5.2f) n=%4d  mean f01=%.3f  min=%.3f max=%.3f" % (k / 10, (k + 1) / 10, len(vals), sum(vals) / len(vals), min(vals), max(vals)))
print("ANALYSIS DONE")
