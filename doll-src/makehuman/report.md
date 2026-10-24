# MakeHuman (MPFB2) rigged mannequin GLBs for Scene Doll — build report

Date: 2026-10-24 · Machine: Windows 11 Home 10.0.26200 · Blender 4.3.2 (headless) · MPFB 2.0.18

## 요약 (TL;DR)

- `out/mh_male.glb` (937,936 B) / `out/mh_female.glb` (937,888 B): MakeHuman 베이스 바디만 포함(헬퍼 지오메트리/눈/치아/머리카락 없음), 13,380 버텍스 · 13,378 쿼드 · 26,756 트라이앵글, 단일 무텍스처 머티리얼, 애니메이션 없음.
- 키: 남 1.7497 m, 여 1.6202 m (바운딩 박스, 발바닥 min y = 0.00000, x 중심 0, glTF Y-up, 정면 +Z).
- 스켈레톤: Mixamo 표준 65본, `mixamorig:` 접두사 없음, 요구된 부모 체인 그대로. 손가락 1~4 전부 포함. 그 외 본 없음.
- 바인드/레스트 포즈 = T-포즈 (LeftArm/RightArm 방향이 정확히 ±X, 0.00°; 손바닥 법선·(−Y_up) = 0.995/0.998).
- 재현: `powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1` (설치까지 포함하려면 `-Install`).
- 주의: MPFB mixamo 가중치 파일이 정규화되어 있지 않아 스크립트에서 정규화함; 끝 본 13개(HeadTop_End, Toe_End×2, 손가락 *4×10)는 MPFB 리그에 없어서 스크립트가 추가한 리프 본(가중치 없음).

Preview renders (Workbench, from the exported GLBs): `preview/mh_male_front.png`, `_side.png`, `_threequarter.png`, `_bones.png` (bones as cones through an X-ray body) and the same for `mh_female`.

---

## 1. Environment

| Item | Value |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| Blender | 4.3.2 (hash 32f5fdce0a0a, 2024-12-17), `C:\Program Files\Blender Foundation\Blender 4.3\blender.exe`, run with `-b --python` |
| Blender Python | bundled 3.11 (numpy available) |
| glTF exporter | Khronos glTF Blender I/O v4.3.47 (bundled `io_scene_gltf2`) |
| MPFB | 2.0.18 (manifest `version = "2.0.18"`, build info 20261010), extension module `bl_ext.user_default.mpfb` |

## 2. What was downloaded

Only one archive was downloaded, into its own empty folder `downloads/`:

| | |
|---|---|
| File | `downloads/add-on-mpfb-v2.0.18.zip` |
| Source URL | `https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip` |
| Listing | https://extensions.blender.org/add-ons/mpfb/ (official MPFB listing, maintainer `Joel-Palmius`; discovered via the extensions API `https://extensions.blender.org/api/v1/extensions/?blender_version=4.3.2&platform=windows-x64`) |
| Size | 45,956,992 bytes (matches `archive_size` in the API listing) |
| SHA-256 | `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad` — verified locally after download, identical to the `archive_hash` published by the extensions platform |
| Declared compatibility | `blender_version_min = "4.2.0"` |
| Declared license (manifest / platform) | `SPDX:GPL-3.0-or-later` |

Why the extensions-platform zip and not a GitHub release asset: the GitHub release page for the same version, https://github.com/makehumancommunity/mpfb2/releases/tag/v2.0.18 (published 2026-10-11), carries **no zip asset** — like every release since v2.0.14, its body only links to the release notes. The last GitHub asset was `mpfb-2.0.8.zip` (v2.0.8, 2025-01-28), whose release note states: "The preferred method of installation is via the extension platform: https://extensions.blender.org/add-ons/mpfb/". The official downloads page (https://static.makehumancommunity.org/mpfb/downloads.html) also lists the Blender Extensions Platform as the recommended download. The zip's contents match the `v2.0.18` tag of the repository (`src/mpfb/` → zip root: `blender_manifest.toml`, `__init__.py`, `data/`, `entities/`, `services/`, `ui/`; 2,422 entries).

Nothing was executed from `downloads/`; the zip was only passed to Blender's extension installer (`bpy.ops.extensions.package_install_files`). No MakeHuman asset packs were downloaded or needed: the base mesh (`data/3dobjs/base.obj`), all macro targets, the rig definitions (`data/rigs/standard/rig.mixamo.json`) and the weights (`weights.mixamo.json`) ship inside the MPFB zip. MPFB needs no internet access for this pipeline (its `network` permission is only for talking to a local MakeHuman instance). Note: the MakeHuman site lists a news item "Community services shut down" dated 2026-10-21; it did not affect this build because nothing is fetched from makehumancommunity.org at build time.

### Licenses

- **MPFB2 source code: GPL-3.0-or-later** (`LICENSE.md` §B and `LICENSE.CODE.md` at tag v2.0.18; the manifest/extension listing says `SPDX:GPL-3.0-or-later`).
- **Bundled assets (base mesh, proxies, targets, textures, rigs, poses, expressions, JSON mesh data): CC0 1.0 Universal** (`LICENSE.md` §C, `LICENSE.ASSETS.md`).
- **Output / exported models: free to use without restriction.** `LICENSE.md` §D ("Concerning the output from MPFB"): the MakeHuman team states that output such as "Exports to files (FBX, OBJ, DAE, MHX2...)", "Graphical data generated via scripting or plugins", renderings and saved model files contain no program logic, are a combination of CC0 assets and the user's input, and "there is no limitation on what you can do with this combined output … We regard these things as your data". The official MakeHuman FAQ "Can I sell models created with MakeHuman?" (https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html) answers "Yes" and states verbatim: "The exported models end up being licensed CC0 (Creative Commons Zero)." The MPFB FAQ "Can I sell models made with MPFB?" (https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html) answers "Yes" and notes that all core assets are CC0 (the only caveat is third-party assets under other licenses — none are used here).
- The two GLBs therefore contain only CC0 asset data + script-driven posing; they can be shipped with Scene Doll without attribution requirements. (Attribution to MakeHuman/MPFB is still a nice gesture.)

## 3. Installation (headless)

`scripts/00_install_mpfb.py` (`blender -b --python scripts/00_install_mpfb.py -- downloads/add-on-mpfb-v2.0.18.zip`):

```python
bpy.ops.extensions.package_install_files(filepath=zip_path, repo="user_default", enable_on_install=True, overwrite=True)
bpy.ops.wm.save_userpref()
```

Result: `{'FINISHED'}`, module `bl_ext.user_default.mpfb` enabled and saved in the user preferences. Side effects outside the work folder (unavoidable for an add-on install): the extension lives in `C:\Users\admin\AppData\Roaming\Blender Foundation\Blender\4.3\extensions\user_default\mpfb`; on first enable MPFB created its user dirs `…\4.3\extensions\.user\user_default\mpfb\{data,config,cache,logs}` and `…\4.3\mpfb\config\log_levels.json`. Nothing else was changed on the system. Log: `logs/00_install.log`.

Scripts import the services directly (`from bl_ext.user_default.mpfb.services.humanservice import HumanService`); `build_doll.py` also tries `bl_ext.blender_org.mpfb` and `mpfb` in case the add-on was installed from the online repository or as a legacy add-on.

## 4. Pipeline (`scripts/build_doll.py`)

All MPFB calls are the documented service API (looked up in the add-on source and `docs/services/*.md`):

1. `HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)` → object `Human`, 19,158 vertices / 18,486 polygons including helpers, with a `MASK` modifier "Hide helpers" on vertex group `body`. `scale=0.1` converts MakeHuman decimetres to metres.
2. Height tuning: `HumanObjectProperties.set_value("height", h)` + `TargetService.reapply_macro_details(human)` in a bisection loop until the evaluated body bounding-box height matches the target (±0.5 mm).
3. `HumanService.add_builtin_rig(human, "mixamo", import_weights=True)` → armature `Human.rig`, 52 deform bones named `mixamorig:*`, weights from `weights.mixamo.json`, Armature modifier on the mesh. The rig is fitted to the tuned mesh via MPFB's joint-cube/vertex strategies, so the rig must be added **before** helpers are deleted (joint cubes are helper geometry).
4. Weight normalisation: `bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM')` — the MPFB mixamo weight file is not normalised (per-vertex sums ranged 0.2 … 1.498; e.g. palm vertices only carry `LeftHand = 0.2`). Blender's armature modifier and the glTF exporter normalise internally anyway, but normalising explicitly makes the result deterministic.
5. T-pose (pose mode, computed from the actual rest-pose bone directions, not from a stored pose file — MPFB ships `t-pose.json` files for `default`, `game_engine`, `cmu_mb` and `mixamo_unity`, but not for `mixamo`):
   - for each side: shortest-arc rotate `Arm`, then `ForeArm`, then `Hand` so their world direction is exactly `+X` (left) / `−X` (right) → straight horizontal arm at shoulder height, straight elbow;
   - measure the palm plane from the *deformed* hand vertices (PCA of vertices whose dominant weight is `*Hand`), resolve the normal's sign with the anatomical rule "arm out to the side, palm down ⇔ thumb points forward", then twist the `ForeArm` about the arm axis so the palm normal points straight down. Required twist: male L 5.73° / R 6.13°, female L 3.40° / R 3.75°. Palm-down dot(−Z): before 0.45 → after 0.98 in the build measurement (0.995 / 0.998 when re-measured on the imported GLB).
   - legs/feet are left as MakeHuman's default (already straight, feet flat, pointing forward; see §8).
6. `RigService.apply_pose_as_rest_pose(rig)` — MPFB's own "apply as rest pose" workflow: bakes all shape keys into the mesh (`TargetService.bake_targets`), applies the Armature modifier, `bpy.ops.pose.armature_apply(selected=False)`, then re-creates the Armature modifier. After this the rest pose **is** the T-pose; a working Armature modifier remains on the mesh.
7. Helper deletion: `ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=False)` applies the `body` MASK modifier, i.e. the helper vertices are really deleted from the mesh (asserted: exactly 13,380 vertices remain, no MASK modifier left). Then every vertex group that is not a bone (`body`, `HelperGeometry`, `JointCubes`, `Left/Mid/Right`, all `helper-*` and `joint-*` groups — 152 groups) is removed.
8. Bone renaming: strip `mixamorig:` (Blender renames the matching vertex groups automatically; the script double-checks). Add the 13 Mixamo end bones that MPFB's rig lacks as connected leaf bones at the parent's tail: `HeadTop_End` (0.10 m, continuing the Head bone), `Left/RightToe_End` (0.02 m), `*Hand{Thumb,Index,Middle,Ring,Pinky}4` (0.015 m). All 65 bones are `use_deform=True`; the end bones have empty vertex groups (no weights), exactly like Mixamo's own end joints. The script asserts that the final bone set is exactly the required + optional Mixamo set (no extras).
9. `vertex_group_limit_total(limit=4)` + `vertex_group_normalize_all` (0 unweighted vertices).
10. Single plain material `DollSkin` (Principled BSDF, base colour (0.80, 0.68, 0.60), roughness 0.65, no textures); objects renamed `Body` / `Armature`; MPFB custom properties removed; mesh re-grounded (min z → 0, x centred — the required shift was < 1 mm).
11. Export:
    ```python
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
        export_skins=True, export_animations=False, export_yup=True, export_morph=False,
        export_materials='EXPORT', export_image_format='NONE', export_texcoords=True, export_normals=True,
        export_tangents=False, export_def_bones=False, export_rest_position_armature=True,
        export_extras=False, export_cameras=False, export_lights=False, export_all_influences=False)
    ```
    Only `Body` + `Armature` are selected.

Each build takes about 1–2 s. Per-build diagnostics (macro, height iterations, T-pose measurements, bone table with head/tail, mesh stats) are in `logs/build_male.json` / `logs/build_female.json`; a debug `.blend` of the final scene is saved as `logs/mh_male_debug.blend` / `logs/mh_female_debug.blend`.

## 5. Macro / target settings

| Macro (MakeHuman 0…1) | `mh_male` | `mh_female` | Meaning |
|---|---|---|---|
| gender | 1.0 | 0.0 | 1 = male, 0 = female |
| age | 0.5 | 0.5 | ≈ 25 years |
| muscle | 0.5 | 0.5 | average |
| weight | 0.5 | 0.5 | average |
| proportions | 0.5 | 0.5 | average |
| **height** | **0.5244140625** | **0.5302734375** | tuned by bisection (9 iterations each) |
| cupsize / firmness | 0.5 / 0.5 | 0.5 / 0.5 | average |
| race | asian 0.33 / caucasian 0.33 / african 0.33 | same | MPFB default neutral blend |

Height macro range measured on these bodies: male 0.0 → 1.3735 m, 1.0 → 2.4308 m; female 0.0 → 1.2352 m, 1.0 → 2.2923 m. Targets 1.75 m / 1.62 m → achieved 1.7497 m / 1.6202 m. (Any other value can be produced with `--height`; `--race asian|caucasian|african|neutral` is also available.)

Source rig: MPFB built-in **`mixamo`** (`data/rigs/standard/rig.mixamo.json` + `weights.mixamo.json`). It already uses Mixamo names with the `mixamorig:` prefix, so the mapping is simply "strip the prefix" (`mixamorig:Hips → Hips`, … 52 bones) plus the 13 added end bones. No bone merging was necessary (the source rig has no extra bones such as breast/eye/jaw bones). The `game_engine` (UE4 naming) and `default` rigs were not needed.

## 6. Final skeleton (identical in both GLBs — 65 bones, verified on re-import)

```
Hips
├─ Spine ─ Spine1 ─ Spine2
│   ├─ Neck ─ Head ─ HeadTop_End
│   ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand
│   │   ├─ LeftHandThumb1 ─ LeftHandThumb2 ─ LeftHandThumb3 ─ LeftHandThumb4
│   │   ├─ LeftHandIndex1 ─ LeftHandIndex2 ─ LeftHandIndex3 ─ LeftHandIndex4
│   │   ├─ LeftHandMiddle1 ─ LeftHandMiddle2 ─ LeftHandMiddle3 ─ LeftHandMiddle4
│   │   ├─ LeftHandRing1 ─ LeftHandRing2 ─ LeftHandRing3 ─ LeftHandRing4
│   │   └─ LeftHandPinky1 ─ LeftHandPinky2 ─ LeftHandPinky3 ─ LeftHandPinky4
│   └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand
│       ├─ RightHandThumb1 ─ … ─ RightHandThumb4
│       ├─ RightHandIndex1 ─ … ─ RightHandIndex4
│       ├─ RightHandMiddle1 ─ … ─ RightHandMiddle4
│       ├─ RightHandRing1 ─ … ─ RightHandRing4
│       └─ RightHandPinky1 ─ … ─ RightHandPinky4
├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase ─ LeftToe_End
└─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase ─ RightToe_End
```

Flat list as printed by `verify_glb.py` (`bone <- parent`), same order as in the files:

```
Hips <- None | LeftUpLeg <- Hips | LeftLeg <- LeftUpLeg | LeftFoot <- LeftLeg | LeftToeBase <- LeftFoot | LeftToe_End <- LeftToeBase
RightUpLeg <- Hips | RightLeg <- RightUpLeg | RightFoot <- RightLeg | RightToeBase <- RightFoot | RightToe_End <- RightToeBase
Spine <- Hips | Spine1 <- Spine | Spine2 <- Spine1
LeftShoulder <- Spine2 | LeftArm <- LeftShoulder | LeftForeArm <- LeftArm | LeftHand <- LeftForeArm
LeftHandIndex1 <- LeftHand | LeftHandIndex2 <- LeftHandIndex1 | LeftHandIndex3 <- LeftHandIndex2 | LeftHandIndex4 <- LeftHandIndex3
LeftHandMiddle1 <- LeftHand | LeftHandMiddle2 <- LeftHandMiddle1 | LeftHandMiddle3 <- LeftHandMiddle2 | LeftHandMiddle4 <- LeftHandMiddle3
LeftHandPinky1 <- LeftHand | LeftHandPinky2 <- LeftHandPinky1 | LeftHandPinky3 <- LeftHandPinky2 | LeftHandPinky4 <- LeftHandPinky3
LeftHandRing1 <- LeftHand | LeftHandRing2 <- LeftHandRing1 | LeftHandRing3 <- LeftHandRing2 | LeftHandRing4 <- LeftHandRing3
LeftHandThumb1 <- LeftHand | LeftHandThumb2 <- LeftHandThumb1 | LeftHandThumb3 <- LeftHandThumb2 | LeftHandThumb4 <- LeftHandThumb3
Neck <- Spine2 | Head <- Neck | HeadTop_End <- Head
RightShoulder <- Spine2 | RightArm <- RightShoulder | RightForeArm <- RightArm | RightHand <- RightForeArm
RightHandIndex1 <- RightHand | RightHandIndex2 <- RightHandIndex1 | RightHandIndex3 <- RightHandIndex2 | RightHandIndex4 <- RightHandIndex3
RightHandMiddle1 <- RightHand | RightHandMiddle2 <- RightHandMiddle1 | RightHandMiddle3 <- RightHandMiddle2 | RightHandMiddle4 <- RightHandMiddle3
RightHandPinky1 <- RightHand | RightHandPinky2 <- RightHandPinky1 | RightHandPinky3 <- RightHandPinky2 | RightHandPinky4 <- RightHandPinky3
RightHandRing1 <- RightHand | RightHandRing2 <- RightHandRing1 | RightHandRing3 <- RightHandRing2 | RightHandRing4 <- RightHandRing3
RightHandThumb1 <- RightHand | RightHandThumb2 <- RightHandThumb1 | RightHandThumb3 <- RightHandThumb2 | RightHandThumb4 <- RightHandThumb3
```

Mixamo bones missing: **none** of the standard 65 Mixamo bones (25 body/limb bones including `HeadTop_End` and the two `Toe_End` joints + 40 finger bones). 13 of them (`HeadTop_End`, `LeftToe_End`, `RightToe_End`, the ten `*4` fingertip bones) do not exist in MPFB's mixamo rig and were added by the script as leaf bones without skin weights. No other bones exist in the files (verified: no extras, no `mixamorig:` prefix, no control/non-deform bones).

Key joint positions in **glTF coordinates** (x right = character's left, y up, z forward; right side is mirrored in x):

| Joint | mh_male (x, y, z) | mh_female (x, y, z) |
|---|---|---|
| Hips | (−0.001, 0.981, 0.009) | (0.005, 0.880, 0.025) |
| Spine / Spine1 / Spine2 (y) | 1.068 / 1.170 / 1.293 | 1.003 / 1.107 / 1.227 |
| Neck / Head / HeadTop_End (y) | 1.501 / 1.543 / 1.752 | 1.372 / 1.432 / 1.621 |
| LeftShoulder | (0.065, 1.466, 0.012) | (0.062, 1.349, 0.018) |
| LeftArm / LeftForeArm / LeftHand (x; y) | 0.189 / 0.444 / 0.714; y = 1.397 | 0.157 / 0.395 / 0.610; y = 1.289 |
| LeftUpLeg / LeftLeg / LeftFoot | (0.110, 0.931, −0.007) / (0.154, 0.509, 0.027) / (0.201, 0.072, 0.014) | (0.096, 0.833, 0.017) / (0.137, 0.452, 0.048) / (0.167, 0.069, 0.029) |
| LeftToeBase / LeftToe_End | (0.198, 0.029, 0.159) / (0.201, 0.014, 0.213) | (0.166, 0.024, 0.155) / (0.170, 0.012, 0.202) |

(Full head/tail table for every bone: `logs/build_*.json → final_bones`, Blender Z-up coordinates.)

## 7. Mesh statistics

| | mh_male.glb | mh_female.glb |
|---|---|---|
| File size | 937,936 B | 937,888 B |
| Blender mesh before export | 13,380 vertices · 13,378 polygons (all quads, 0 tris, 0 n-gons) · 26,756 triangles | same |
| In the GLB | 1 mesh `Body`, 1 primitive (TRIANGLES), **26,756 triangles** (80,268 indices), 14,517 positions (vertices are split along UV seams by the exporter), attributes POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 / WEIGHTS_0, 0 morph targets | same counts |
| Nodes / skins / joints | 67 nodes (65 joints + `Body` + `Armature`), 1 skin with 65 joints | same |
| Materials / textures / images / animations / extensions | 1 (`DollSkin`) / 0 / 0 / 0 / none | same |
| Bounding box (glTF, metres) | x [−0.9152, 0.9152] · y [0.0000, 1.7497] · z [−0.1008, 0.2126] | x [−0.7774, 0.7774] · y [0.0000, 1.6202] · z [−0.0926, 0.2026] |
| Height | **1.7497 m** (target 1.75) | **1.6202 m** (target 1.62) |
| min y (feet on ground) | 0.00000 | 0.00000 |
| x centre | 0.0000 | 0.0000 |
| Max influences / unweighted vertices | 4 / 0 | 4 / 0 |

Triangle budget: 26,756 ≤ 30,000 (ideal) ≤ 50,000. Lower-poly option (not used): MPFB supports MakeHuman "topology proxies" (`Proxymeshes` asset type, e.g. the `male_generic` / `female_generic` low-poly proxies) via `HumanService.add_mhclo_asset(..., asset_type="Proxymeshes")`, but those proxies live in the separately downloaded `makehuman_system_assets` pack (not bundled with MPFB), so they were not used. If a lighter doll is ever needed, a Decimate modifier before export is the simplest path.

## 8. Verification (`scripts/verify_glb.py`, re-import with `bpy.ops.import_scene.gltf`)

Full logs: `logs/verify_male.log|json`, `logs/verify_female.log|json`. Both: **OVERALL: PASS** (all 41 checks). Key lines (Blender Z-up vectors; glTF forward +Z = Blender −Y):

| Check | mh_male | mh_female |
|---|---|---|
| required bones present / parent chain / no extras / no prefix / finger bones | PASS / PASS / PASS / PASS / PASS | same |
| skin joints == bones | 65 == 65 | 65 == 65 |
| height (bbox) | 1.7497 m | 1.6202 m |
| feet on ground | min y = 0.00000 | min y = 0.00000 |
| facing | LeftFoot dir (Blender) = (−0.019, −0.959, −0.284) → −Y = glTF **+Z**; nose at y = −0.169 vs head joint y = −0.018 (face points to −Y/+Z) | (−0.007, −0.941, −0.338); nose y = −0.154 vs head y = −0.025 |
| LeftArm / LeftForeArm / LeftHand direction | (1, 0, 0) / (1, 0, 0) / (1, 0, −0.0008) — 0.00° / 0.00° / 0.05° from +X | identical |
| RightArm / RightForeArm / RightHand direction | (−1, 0, 0) / (−1, 0, 0) / (−1, 0, −0.0009) — 0.00° / 0.00° / 0.05° from −X | identical |
| arm at shoulder height | LeftArm head z = tail z = 1.397 | 1.288 |
| palm normal (should be −Z) | L (−0.093, 0.035, −0.995) dot = 0.995 · R (0.050, 0.038, −0.998) dot = 0.998; thumbs point forward/down (−Y, −Z) | L dot = 0.995 · R dot = 0.998 |
| head at top / feet at bottom | Head tail z = 1.752; Foot heads z = 0.072 | 1.621; 0.069 |
| legs straight | LeftLeg dir (0.106, 0.029, −0.994) | (0.079, 0.049, −0.996) |
| all vertices weighted / ≤ 4 influences / armature modifier | PASS / PASS / PASS | same |

Bind pose = rest pose = T-pose: the GLB was exported with `export_rest_position_armature=True` after `pose.armature_apply`, so the skin's inverse bind matrices correspond to the T-pose that the mesh is modelled in; the re-import shows upper arms exactly horizontal along ±X, head on top, feet at the bottom.

Visual check: `preview/*.png` (rendered from the GLBs: front, side, three-quarter, and a bones view that draws every bone as a cone through an X-ray body) — straight arms at shoulder height, backs of the hands up, straight elbows, feet forward on the ground plane.

## 9. Problems, quirks and caveats

1. **No GitHub release zip for ≥ 2.0.14** — the official distribution is the Blender Extensions platform (see §2). The GitHub repo tag `v2.0.18` is the same code; the platform zip is what was installed.
2. **MPFB mixamo weights are not normalised** (sums 0.2 … 1.498). Harmless for Blender and glTF (both normalise), but the script normalises explicitly; keep this in mind if the weights are ever re-exported through another tool.
3. **13 end bones added by script** (`HeadTop_End`, `*Toe_End`, `*Hand*4`). They are positioned at the parent bone's tail (fingertips, toe tips, top of the skull as defined by MPFB's Head bone, ≈ 3 mm above the mesh). They have no weights (same as Mixamo).
4. **Palm orientation**: palm plane normals are within ~6° (import measurement) / ~11° (build measurement) of straight down; the remaining tilt is the natural arch/tilt of the MakeHuman hand relative to the hand bone (a component along the arm axis), not a twist, so it was intentionally not forced. Fingers keep MakeHuman's relaxed, slightly curled/splayed rest shape — the same as Mixamo's T-pose characters.
5. **Shoulders/clavicles and legs** were left in MakeHuman's default orientation (clavicle slopes slightly down toward the shoulder, legs slightly apart ≈ 6° from vertical, feet flat pointing forward). Only Arm/ForeArm/Hand were re-posed.
6. **Vertex count in GLB (14,517) ≠ Blender vertex count (13,380)** because glTF needs one UV per vertex and the exporter splits vertices on UV seams. The triangle count (26,756) is unaffected. The UV map (`TEXCOORD_0`) is kept in case textures are wanted later; no textures/images are embedded.
7. **Blender's glTF importer (4.2+) adds an `Icosphere` helper object** when re-importing with the default `bone_heuristic='BLENDER'` (bone custom shapes). It is not in the GLB (the file has exactly one mesh); the verifier imports with `bone_heuristic='TEMPERANCE'`.
8. **Hips origin**: `Hips` is at y ≈ 0.98 m (male) / 0.88 m (female), x ≈ 0, z ≈ 0.01–0.03 m; the armature node `Armature` sits at the world origin (identity transform), the mesh node `Body` is its child. Three.js: load with `GLTFLoader`, the `SkinnedMesh` is `Body`, bones are reachable by name via `object.getObjectByName('LeftArm')` etc.
9. **Bone local axes** are Blender's (bone Y along the bone, converted by the exporter), not Mixamo's FBX axes. Names, hierarchy and T-pose match Mixamo, so retargeting by rotation *difference* works; copying Mixamo local Euler values 1:1 would not.
10. Neutral race blend and average body (MPFB defaults) were used; the face shape is a generic average. Everything is adjustable via the macro dict in `build_doll.py`.
11. No `.blend` is needed to rebuild; `logs/*.blend` are only for inspection (2.6 MB each).
12. Blender's console prints warnings from MPFB about a missing asset library / "Start here" panel on first run — irrelevant for this pipeline (no asset packs required).

## 10. Files

```
doll-src/makehuman/
├─ downloads/add-on-mpfb-v2.0.18.zip          (untrusted archive, 45,956,992 B, sha256 c075b3e9…8dad)
├─ out/mh_male.glb, out/mh_female.glb          ← deliverables
├─ scripts/00_install_mpfb.py                  install + enable MPFB headless
├─ scripts/build_doll.py                       the whole pipeline (human → rig → T-pose → rest → helpers → rename → export)
├─ scripts/verify_glb.py                       re-import + checks (raw GLB JSON + Blender)
├─ scripts/render_preview.py                   preview PNGs (Workbench)
├─ scripts/run_all.ps1                         one-shot reproduction
├─ scripts/dev/smoke_test.py, debug_weights.py exploratory scripts used while developing (API smoke test, weight inspection)
├─ logs/  00_install.log, build_*.log|json, verify_*.log|json, preview_*.log, mh_*_debug.blend, smoke.log
├─ preview/ mh_{male,female}_{front,side,threequarter,bones}.png
└─ report.md
```

## 11. Commands to re-run

```powershell
# everything (assumes MPFB already installed in Blender 4.3; add -Install to install from downloads/ first)
powershell -ExecutionPolicy Bypass -File C:\dev\scene-doll\doll-src\makehuman\scripts\run_all.ps1
powershell -ExecutionPolicy Bypass -File C:\dev\scene-doll\doll-src\makehuman\scripts\run_all.ps1 -Install

# individual steps
$B = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"; $S = "C:\dev\scene-doll\doll-src\makehuman"
& $B -b --python "$S\scripts\00_install_mpfb.py" -- "$S\downloads\add-on-mpfb-v2.0.18.zip"
& $B -b --python "$S\scripts\build_doll.py" -- --gender male   --height 1.75 --out "$S\out\mh_male.glb"   --log "$S\logs\build_male.json"
& $B -b --python "$S\scripts\build_doll.py" -- --gender female --height 1.62 --out "$S\out\mh_female.glb" --log "$S\logs\build_female.json"
& $B -b --python "$S\scripts\verify_glb.py" -- "$S\out\mh_male.glb"   "$S\logs\verify_male.json"
& $B -b --python "$S\scripts\verify_glb.py" -- "$S\out\mh_female.glb" "$S\logs\verify_female.json"
& $B -b --python "$S\scripts\render_preview.py" -- "$S\out\mh_male.glb" "$S\preview\mh_male"
```

(Any `--height`, `--race asian|caucasian|african|neutral`, `--blend <debug.blend>` can be added to `build_doll.py`.)
