# MakeHuman (MPFB2) mannequins v2 — twist bones, cleaned weights, deformation tests

Date: 2026-10-25 · Windows 11 · Blender 4.3.2 (headless) · MPFB 2.0.18 (`bl_ext.user_default.mpfb`, already installed by v1 — not reinstalled)

## 요약 (TL;DR)

- 새 파일: `out/mh2_male.glb` (939,992 B) / `out/mh2_female.glb` (940,052 B). v1 파일(`out/mh_male.glb`, `out/mh_female.glb`)은 그대로 둠.
- 메시/규격은 v1과 동일: 13,380 버텍스 · 26,756 트라이앵글, 단일 머티리얼, 애니메이션 없음, 키 1.7497 / 1.6202 m, 발바닥 y=0, 정면 +Z, T-포즈 바인드(팔 정확히 ±X, 손바닥 아래).
- 스켈레톤 73본 = Mixamo 65본(접두사 없음, 끝 본 13개는 가중치 없음) + **트위스트 본 8개** `Left/Right{Arm,ForeArm,UpLeg,Leg}Twist` (부모 사지 본의 리프 자식, 축 위 35 % / 65 % 지점, 부모와 동일한 로컬 방향 → glTF 노드 회전 = 항등).
- MPFB에는 트위스트 가중치가 전혀 없어서(`game_engine` 리그도 2.0.18에서는 `*_twist_01` 본이 없음) 사지 가중치를 본 축 방향 smoothstep 그라디언트로 나누어 생성함(§3). ArmTwist/UpLegTwist = 관절 쪽(근위) 절반, ForeArmTwist/LegTwist = 손목/발목 쪽(원위) 절반.
- 가중치 정리: 가중치 섬(island) 32개 제거, 사지 그룹 2회 라플라시안 스무딩(팔꿈치/무릎 안쪽의 한 엣지 점프 18 → 5), 정규화, 최대 4 인플루언스, 0 가중치 버텍스 0개, 스무스 셰이딩/노멀 심 없음 — 재임포트 검증 76개 항목 모두 PASS.
- 변형 테스트 렌더 `preview_v2/` (v1 비교는 `preview_v2/v1_compare/`): 트위스트 본이 있는 쪽 전완은 70° 비틀림이 전완 전체에 분산되고, 없는 쪽은 손목에서 접힘(캔디랩)이 생김. 어깨 내림/팔꿈치/무릎/허리는 "minor pinching ~ fine" 수준 (§7). 심한 아티팩트 없음.
- 재현: `powershell -ExecutionPolicy Bypass -File scripts\run_v2.ps1` (`-CompareV1` 로 v1 비교 렌더 포함).

---

## 1. What changed vs v1

| | v1 (`build_doll.py`) | v2 (`build_doll_v2.py`) |
|---|---|---|
| Human / macros | gender 1.0/0.0, age 0.5, muscle 0.5, weight 0.5, proportions 0.5, height tuned (0.5244 / 0.5303) | **unchanged** (same macro values, same height result 1.7497 / 1.6202 m) |
| Source rig / weights | MPFB `mixamo` (52 bones), normalised | unchanged source; `game_engine` was inspected and rejected (no twist bones, see §2) |
| T-pose / rest pose / helper removal / export settings | analytic T-pose, `apply_pose_as_rest_pose`, helpers deleted, GLB Y-up | **unchanged** |
| Skeleton | 65 Mixamo bones | **73** = 65 + 8 twist bones (§4) |
| Weight cleanup | normalise, limit 4 | + remove weight islands (31 stray fragments in the source weights), drop weights < 1e-3, **2× Laplacian smoothing of the 8 limb groups**, re-check islands after every step |
| Twist weights | – | generated from the limb weights by an axis gradient (§3); limb-bone swing behaviour unchanged |
| Shading | faces were already smooth | explicitly `shade_smooth`, sharp edges cleared, no custom normals; verifier checks that co-located (UV-split) vertices have identical normals |
| Grounding | shifted every edit bone's head/tail individually — for connected bones Blender moves the shared joint twice, which tilted the near-vertical legs by ≈ 0.09° (sub-mm, invisible, but it broke the "twist bone parallel to parent" guarantee) | `Armature.transform()` — rigid shift, relative orientations exact (asserted) |
| Verification | 41 checks | 76 checks incl. twist geometry/parentage, raw skin data, islands, twist profiles, normal seams |
| Previews | static T-pose views | 6 deformation test poses, 21 renders per doll + v1 comparison |

Vertex positions, UVs and triangle count are identical to v1 (the mesh is the same MakeHuman body in the same T-pose).

## 2. Why the `game_engine` route was not possible

MPFB 2.0.18 ships rigs in `data/rigs/standard/`: `default` (163 bones), `game_engine` (52), `game_engine_with_breast`, `mixamo` (52), `mixamo_unity`, `cmu_mb`, `openpose`. The `game_engine` rig uses UE4 names (`upperarm_l`, `lowerarm_l`, `thigh_l`, `calf_l`, …) **but contains no `upperarm_twist_01` / `lowerarm_twist_01` / `thigh_twist_01` / `calf_twist_01` bones**; `grep -ri twist data/rigs` is empty, and its weight file has 53 groups (one empty `Root`) that are the same vertex sets as the mixamo weights (e.g. `upperarm_l` = `mixamorig:LeftArm`, 654 body vertices each). So there are no twist weights anywhere in MPFB to remap.

The `default` MakeHuman skeleton does split each limb into two segments (`upperarm01/02`, `lowerarm01/02`, `upperleg01/02`, `lowerleg01/02`). Its proximal/distal share was measured as a cross-check of the gradient chosen below (`scripts/dev/analyze_weights_v2.py`, `logs/analyze_v1_weights.log`): the proximal segment's share falls from ≈ 0.9 at the shoulder/hip to 0.5 at ≈ 25–35 % and ≈ 0 by 60–75 % of the limb; the distal forearm/calf segment rises from 0 at ≈ 20 % to ≈ 0.5–0.8 at the wrist/ankle. The analytic profile in §3 follows that shape.

## 3. Twist weights — actual layout produced

Generated in the final T-pose rest geometry, per limb bone *L* (Arm, ForeArm, UpLeg, Leg, each side) and its twist bone *T*:

```
t      = clamp( dot(p - head_L, axis_L) / length_L , 0, 1 )     # 0 = proximal joint, 1 = distal joint
s(t)   = 1 - smoothstep(0.0, 0.6, t)   for ArmTwist, UpLegTwist   (proximal: 1 at the joint, 0 from 60 %)
s(t)   =     smoothstep(0.2, 1.0, t)   for ForeArmTwist, LegTwist (distal: 0 until 20 %, 1 at the joint)
w_T    = w_L * s(t)        w_L' = w_L * (1 - s(t))                # per-vertex sum unchanged
smoothstep(a,b,x) = u²(3-2u), u = clamp((x-a)/(b-a), 0, 1)
```

Vertices with *t* < 0 (deltoid / armpit / buttock vertices that carry some Arm/UpLeg weight) get *s* = 1, i.e. their Arm/UpLeg weight is moved entirely to ArmTwist/UpLegTwist. Because a twist bone is a child of its limb bone with identity local rotation, every swing of the limb is inherited unchanged — the split only changes how much of the limb's *twist* a vertex receives (the app's −50 % / +50 % ratios).

Mean share of the limb weight that went to the twist bone, per 10 % bin of the limb axis (male; female within ±0.03):

| bin of t | <0 | 0–.1 | .1–.2 | .2–.3 | .3–.4 | .4–.5 | .5–.6 | .6–.7 | .7–.8 | .8–.9 | .9–1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ArmTwist (proximal) | 1.00 | 0.98 | 0.84 | 0.64 | 0.39 | 0.17 | 0.02 | 0 | 0 | 0 | 0 |
| UpLegTwist (proximal) | 1.00 | 0.97 | 0.84 | 0.63 | 0.39 | 0.18 | 0.03 | 0 | 0 | 0 | 0 |
| ForeArmTwist (distal) | 0 | 0 | 0 | 0.02 | 0.07 | 0.24 | 0.47 | 0.57 | 0.74 | 0.91 | 1.00 |
| LegTwist (distal) | 0 | 0 | 0 | 0.01 | 0.10 | 0.18 | 0.37 | 0.64 | 0.82 | 0.92 | 0.99 |

(The same profiles re-measured on the re-imported GLBs are in `logs/verify2_*.json → twist_profiles`.) Effective twist with the app's ratios: at the shoulder/hip the skin twists 50 % of the limb twist, reaching 100 % at ≈ 55 % of the upper arm/thigh; the forearm/calf follows the hand/foot twist with 0 % near the elbow/knee rising to 50 % at the wrist/ankle, then 100 % on the hand/foot. The remaining 50 % step at the wrist is visible in test 4 (§7); the app can raise the ForeArmTwist/LegTwist ratio towards 0.7–1.0 for a smoother ramp, or lower the ArmTwist ratio to −100 % for a shoulder that does not twist at all. Parameters live at the top of `build_doll_v2.py` (`PROXIMAL_RAMP`, `DISTAL_RAMP`, `TWIST_HEAD_FRACTION`, `TWIST_LENGTH_FRACTION`).

## 4. Twist bone geometry

Each twist bone: `use_connect=False`, `use_deform=True`, parent = limb bone, **head on the limb axis** at 35 % (Arm, UpLeg) / 65 % (ForeArm, Leg) of the limb length from the limb head, tail 20 % of the limb length further along the same axis, `roll` = parent roll. Verified in the exported files: node rotation absent (identity, 0.000°), translation = (0, d, 0) in the parent's bone space with |off-axis| < 1e-7 m, leaf (no children), parent as required.

| twist bone | parent (length m/f) | local translation d along parent Y (m/f) | length (m/f) | glTF joint position male (x, y, z) | female |
|---|---|---|---|---|---|
| LeftArmTwist | LeftArm (0.2555 / 0.2378) | 0.0894 / 0.0832 | 0.051 / 0.048 | (0.278, 1.397, 0.018) | (0.240, 1.288, 0.021) |
| LeftForeArmTwist | LeftForeArm (0.2695 / 0.2148) | 0.1751 / 0.1396 | 0.054 / 0.043 | (0.619, 1.397, 0.018) | (0.534, 1.288, 0.021) |
| LeftUpLegTwist | LeftUpLeg (0.4257 / 0.3836) | 0.1490 / 0.1343 | 0.085 / 0.077 | (0.125, 0.783, 0.005) | (0.110, 0.700, 0.028) |
| LeftLegTwist | LeftLeg (0.4390 / 0.3846) | 0.2853 / 0.2500 | 0.088 / 0.077 | (0.184, 0.225, 0.019) | (0.157, 0.204, 0.036) |
| Right* | mirrored | same | same | x mirrored (−0.276, −0.618, −0.124, −0.183) | (−0.239, −0.533, −0.109, −0.155) |

Driving them at runtime: set the twist node's local quaternion to a rotation about its local **Y** axis (Blender bone axis = glTF node Y, pointing along the limb); since the local rotation is identity, a rotation about the twist bone's Y is exactly a rotation about the parent limb's axis.

## 5. Final skeleton (73 bones, both files identical)

```
Hips
├─ Spine ─ Spine1 ─ Spine2
│   ├─ Neck ─ Head ─ HeadTop_End
│   ├─ LeftShoulder ─ LeftArm ─┬─ LeftForeArm ─┬─ LeftHand ─ (Thumb/Index/Middle/Ring/Pinky 1-4)
│   │                          │               └─ LeftForeArmTwist
│   │                          └─ LeftArmTwist
│   └─ RightShoulder ─ RightArm ─┬─ RightForeArm ─┬─ RightHand ─ (fingers 1-4)
│                                │                └─ RightForeArmTwist
│                                └─ RightArmTwist
├─ LeftUpLeg ─┬─ LeftLeg ─┬─ LeftFoot ─ LeftToeBase ─ LeftToe_End
│             │           └─ LeftLegTwist
│             └─ LeftUpLegTwist
└─ RightUpLeg ─┬─ RightLeg ─┬─ RightFoot ─ RightToeBase ─ RightToe_End
               │            └─ RightLegTwist
               └─ RightUpLegTwist
```

Flat list (`bone <- parent`, file order):

```
Hips <- None | LeftUpLeg <- Hips | LeftLeg <- LeftUpLeg | LeftFoot <- LeftLeg | LeftToeBase <- LeftFoot | LeftToe_End <- LeftToeBase
LeftLegTwist <- LeftLeg | LeftUpLegTwist <- LeftUpLeg
RightUpLeg <- Hips | RightLeg <- RightUpLeg | RightFoot <- RightLeg | RightToeBase <- RightFoot | RightToe_End <- RightToeBase
RightLegTwist <- RightLeg | RightUpLegTwist <- RightUpLeg
Spine <- Hips | Spine1 <- Spine | Spine2 <- Spine1
LeftShoulder <- Spine2 | LeftArm <- LeftShoulder | LeftForeArm <- LeftArm | LeftHand <- LeftForeArm
LeftHandIndex1..4 (chain from LeftHand) | LeftHandMiddle1..4 | LeftHandPinky1..4 | LeftHandRing1..4 | LeftHandThumb1..4
LeftForeArmTwist <- LeftForeArm | LeftArmTwist <- LeftArm
Neck <- Spine2 | Head <- Neck | HeadTop_End <- Head
RightShoulder <- Spine2 | RightArm <- RightShoulder | RightForeArm <- RightArm | RightHand <- RightForeArm
RightHandIndex1..4 | RightHandMiddle1..4 | RightHandPinky1..4 | RightHandRing1..4 | RightHandThumb1..4
RightForeArmTwist <- RightForeArm | RightArmTwist <- RightArm
```

Weightless leaves (as v1, as Mixamo): HeadTop_End, Left/RightToe_End, the ten `*Hand<Finger>4`. Every other bone has weights (60 weighted bones). Full head/tail table: `logs/build2_*.json → final_bones` (Blender Z-up).

## 6. Weight statistics (Blender mesh, 13,380 vertices; GLB has 14,517 positions because the exporter splits UV seams)

Cleanup applied to the normalised MPFB mixamo weights (identical for both dolls — the weights are topology-based):

- **Islands removed: 31 fragments** that were not connected to the bone's main region — e.g. Head: 3 fragments (max weight 0.08) at the neck, LeftLeg/RightLeg: 8 fragments each (max 0.046) on the toes plus one on the *other* knee, RightForeArm: 2, LeftHandMiddle1: a weight on the *right* hand, several single finger vertices. Removed weight is renormalised into the vertex's other bones (total 1.25 weight units). One more 4-vertex RightArm fragment appeared after the influence limit and was removed. Final: **every weighted bone is one connected region** (checked again on the re-imported GLBs with UV-split vertices merged).
- Weights < 1e-3 removed (126), 2 × Laplacian smoothing (factor 0.5) of Left/Right Arm, ForeArm, UpLeg, Leg: edges with a weight step > 0.5 on the quad mesh **18 → 5** (v1: 25); the 5 left are at the thumb base / index & ring webbing (hand groups were not smoothed on purpose). On the triangulated GLB: 22 / 40,134 edges > 0.5, 2.7 % > 0.3, max 0.83 (thumb base).
- Influences: after the twist split 101 vertices had 5 influences (armpit / groin: Spine1+Spine2+Shoulder+Arm+ArmTwist etc.); the smallest was dropped (max dropped weight 0.053 male / 0.057 female) and the vertex renormalised. Final histogram male {1: 5325, 2: 5430, 3: 2100, 4: 525}, female {1: 5373, 2: 5431, 3: 2035, 4: 541}; **max 4**.
- Sum of weights per vertex: min = max = mean = 1.000000 (Blender); in the GLB (float32 WEIGHTS_0) 0.9999999 … 1.0000001, **0 zero-weight vertices**. Single `JOINTS_0`/`WEIGHTS_0` set.

Per-bone vertex counts (vertices with weight > 0) and weight sums, male / female:

| bone | before twist split | **final count** | weight sum | bone | before | **final count** | weight sum |
|---|---|---|---|---|---|---|---|
| LeftArm | 730 / 730 | **331 / 343** | 167.7 / 188.8 | RightArm | 738 / 738 | **342 / 354** | 168.8 / 190.0 |
| LeftArmTwist | – | **554 / 543** | 132.6 / 111.4 | RightArmTwist | – | **552 / 541** | 133.9 / 112.8 |
| LeftForeArm | 467 / 467 | **369 / 369** | 135.7 / 138.8 | RightForeArm | 467 / 467 | **369 / 369** | 135.5 / 138.7 |
| LeftForeArmTwist | – | **274 / 265** | 128.8 / 125.7 | RightForeArmTwist | – | **274 / 265** | 132.3 / 129.1 |
| LeftHand | 395 / 395 | **395 / 395** | 181.8 / 181.8 | RightHand | 506 / 506 | **506 / 506** | 202.2 / 202.2 |
| LeftUpLeg | 720 / 720 | **476 / 461** | 228.2 / 243.3 | RightUpLeg | 720 / 720 | **472 / 459** | 230.2 / 245.3 |
| LeftUpLegTwist | – | **508 / 478** | 131.2 / 116.1 | RightUpLegTwist | – | **505 / 475** | 130.8 / 115.8 |
| LeftLeg | 500 / 500 | **402 / 404** | 144.3 / 149.7 | RightLeg | 492 / 492 | **401 / 404** | 142.2 / 147.6 |
| LeftLegTwist | – | **290 / 299** | 116.5 / 111.2 | RightLegTwist | – | **282 / 291** | 114.9 / 109.5 |
| LeftFoot | 1007 | **1007** | 580.4 | RightFoot | 775 | **775** | 465.6 |

(Male/female differ slightly because the twist split depends on vertex positions along the limb; the "before" counts include the smoothing ring. Spine2 1247, Hips 607, Head 4274, LeftShoulder 239 / RightShoulder 222 are unchanged by the split.) Counts on the split GLB mesh are 5–15 % higher (duplicated seam vertices): `logs/verify2_*.json → raw_joint_vertex_counts_split_mesh`.

Shading: 13,378/13,378 faces smooth, 0 sharp edges, no custom normals; in the GLB the 1,122 groups of co-located vertices (UV seams) have identical normals (max angle 0.0001°) — no normal seams.

## 7. Deformation tests (`scripts/render_deform_v2.py`, from the exported GLBs, Workbench, grey, 900×1000)

Files: `preview_v2/mh2_{male,female}_<n>_<test>_<view>.png`; the same poses on the v1 files in `preview_v2/v1_compare/mh_{male,female}_…` (v1 has no twist bone, so test 4 is "without" on both sides there). Rotations are world-space rotations of the pose bones about their heads (independent of local bone axes).

| # | pose | renders | assessment (both dolls, honest) |
|---|---|---|---|
| 1 | rest T-pose | `1_rest_front` | **fine** — identical to v1 |
| 2 | LeftArm/RightArm 85° down | `2_armsdown_front`, `_back`, `_shoulder_closeup`, `_shoulder_closeup_back` | **minor pinching.** Shoulders keep their volume, deltoid cap stays rounded, no armpit tearing. Visible: a slightly angular acromion corner on top of the shoulder, a concave fold at the front armpit, and a horizontal crease across the rear armpit where the arm meets the lat (`_shoulder_closeup_back`). Same as v1 — arm *swing* is unchanged by design (the T-pose bind + linear blend skinning limit; a clavicle rotation in the app helps). |
| 3 | elbows 110°, forearms forward | `3_elbow110_front`, `_top`, `_elbow_closeup` | **minor pinching.** Inner elbow crease pinches as expected with LBS; the small self-intersecting fold at the crease that v1 shows (`v1_compare/..._elbow_closeup`) is gone after the weight smoothing; outer elbow slightly pointed. |
| 4 | from 3: LeftHand 70° about the forearm axis + LeftForeArmTwist 35°; RightHand 70° alone | `4_twist_front`, `_top`, `_top_closeup`, `_forearms_closeup`, `_left_side` (with twist bone), `_right_side` (without) | **left (twist bone): fine / slight narrowing** — the twist is spread over the distal half of the forearm, the wrist contour stays round. **right (no twist bone): minor-to-moderate pinching** — the forearm stays untwisted and the full 70° happens in one ring at the wrist: a clear notch / candy-wrap (this is what v1 does on both sides, see `v1_compare/..._4_twist_left_side`). The remaining step on the left is the 35° the hand still does alone (50 % ratio). From the front the forearms point at the camera, so the side/top closeups are the informative views. |
| 5 | Hips −0.25 m, thighs 45° forward, knees 90°, feet flat | `5_sit_threequarter`, `_side`, `_hips_closeup`, `_knee_closeup` | **minor pinching.** Thighs/calves keep volume; the back of the knee creases sharply (volume loss, slightly softer than v1), kneecap a bit pointed, a visible fold at the front hip crease/groin; buttocks fine; no artifacts or tearing. |
| 6 | Spine/Spine1/Spine2 each 12° forward + 10° twist (36°/30° total) | `6_torso_threequarter`, `_back`, `_closeup` | **fine** — smooth bend, no candy-wrapping of the torso, back/lats deform cleanly. |

Overall: no severe artifact in any test. The twist bones measurably fix the forearm candy-wrap (and will do the same for the thigh/calf and the upper-arm/shoulder region once the app drives them); the shoulder, elbow, knee and hip creases are the usual linear-blend-skinning limits of a T-pose-bound single mesh and are unchanged or slightly improved vs v1.

## 8. Verification (`scripts/verify_glb_v2.py`, re-import with `bone_heuristic='TEMPERANCE'`)

`logs/verify2_male.{log,json}`, `logs/verify2_female.{log,json}`: **OVERALL PASS, 76/76 checks** each. Highlights: 1 mesh / 1 skin (73 joints) / 1 material `DollSkin` / 0 textures / 0 animations / 0 morph targets / 26,756 triangles; height 1.7497 / 1.6202 m, min y = 0.00000, x centred; feet → +Z (glTF), nose forward; LeftArm/ForeArm along +X and RightArm/ForeArm along −X at 0.00°, palms down (dot −Z 0.995 / 0.998); all 8 twist bones present with the right parent, leaf, 0.000° local rotation, fraction 0.350 / 0.650, 0.00 mm off-axis; end bones weightless; all vertices weighted, max 4 influences, sums 1; no weight islands; smooth faces, no normal seams; twist layout profiles as in §3.

## 9. Caveats

1. **No twist weights exist in MPFB** (2.0.18): the twist layout is synthetic (§3). The ramp parameters are explicit constants; re-running the build with other values is cheap (≈ 2 s per doll).
2. Twist bones affect only *twist*; the shoulder/armpit and hip creases when limbs swing (tests 2 and 5) are inherent to linear blend skinning with a T-pose bind pose and were left as they are (hand-painting corrective weights or adding helper bones was out of scope).
3. The app's 50 % ratios leave a 35° step at the wrist/ankle in test 4; a ratio of 0.7–1.0 on ForeArmTwist/LegTwist gives a smoother ramp with these weights.
4. **Blender's glTF importer draws each limb bone ending at its nearest child**, i.e. `LeftArm` appears 0.089 m long (tail at the ArmTwist joint) when the GLB is opened in Blender. Cosmetic: glTF stores joints only; skinning (inverse bind matrices) and the app are unaffected. The verifier and the render script therefore use joint positions / world-space rotations, never bone tails.
5. 101 vertices (armpit/groin) exceeded 4 influences after the split; the smallest weight (≤ 0.06) was dropped and renormalised.
6. 5 one-edge weight jumps remain in the hands (thumb base, finger webbing) — inherited from MPFB, left unsmoothed to keep the fingers crisp.
7. v1's grounding shifted connected joints twice (≈ 0.7 mm, legs tilted ≈ 0.09°). Invisible, but v2 uses a rigid `Armature.transform()` and asserts twist/parent parallelism and connected-joint continuity after grounding.
8. Smoothing is on by default (`--smooth-limbs 2`); `--smooth-limbs 0` reproduces the raw MPFB limb blends.

## 10. Files

```
doll-src/makehuman/
├─ out/mh2_male.glb, out/mh2_female.glb              ← v2 deliverables (v1 mh_male.glb / mh_female.glb untouched)
├─ scripts/build_doll_v2.py                          pipeline (v1 steps + twist bones, cleanup, smoothing, stats)
├─ scripts/verify_glb_v2.py                          re-import verification (76 checks) -> logs/verify2_*.json
├─ scripts/render_deform_v2.py                       deformation test poses + renders
├─ scripts/run_v2.ps1                                one-shot: build + verify + renders (+ -CompareV1, -Install)
├─ scripts/dev/analyze_weights_v2.py, check_shift_and_steps.py   dev analysis used for this report
├─ logs/build2_*.{log,json}, verify2_*.{log,json}, deform2_*.log, deform_v1_*.log, mh2_*_debug.blend, analyze_v1_weights.log
├─ preview_v2/mh2_{male,female}_*.png (21 each), preview_v2/v1_compare/mh_{male,female}_*.png
└─ report_v2.md
```

## 11. Re-run

```powershell
# everything (MPFB already installed; add -Install to install from downloads/ first)
powershell -ExecutionPolicy Bypass -File C:\dev\scene-doll\doll-src\makehuman\scripts\run_v2.ps1 -CompareV1

# individual steps
$B = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"; $S = "C:\dev\scene-doll\doll-src\makehuman"
& $B -b --python "$S\scripts\build_doll_v2.py" -- --gender male   --height 1.75 --smooth-limbs 2 --out "$S\out\mh2_male.glb"   --log "$S\logs\build2_male.json"
& $B -b --python "$S\scripts\build_doll_v2.py" -- --gender female --height 1.62 --smooth-limbs 2 --out "$S\out\mh2_female.glb" --log "$S\logs\build2_female.json"
& $B -b --python "$S\scripts\verify_glb_v2.py" -- "$S\out\mh2_male.glb" "$S\logs\verify2_male.json"
& $B -b --python "$S\scripts\render_deform_v2.py" -- "$S\out\mh2_male.glb" "$S\preview_v2" mh2_male
```

(`--race asian|caucasian|african|neutral`, `--blend <debug.blend>`, `--smooth-limbs N` are optional.)
