"""
00_install_mpfb.py -- install the MPFB2 extension into Blender 4.2+ headlessly.

Usage:
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe" -b --python scripts/00_install_mpfb.py -- <path-to-add-on-mpfb-vX.Y.Z.zip>

The zip is the official MPFB release from the Blender Extensions platform
(https://extensions.blender.org/add-ons/mpfb/), which is the distribution channel
that the MPFB GitHub release notes point to (GitHub releases >= 2.0.14 carry no zip asset).

After this script runs, the add-on is available as module `bl_ext.user_default.mpfb`
and is enabled + saved in the user preferences, so later `blender -b --python ...`
runs can import it directly.
"""
import sys
import os
import bpy

argv = sys.argv
if "--" in argv:
    user_args = argv[argv.index("--") + 1:]
else:
    user_args = []

if not user_args:
    raise SystemExit("usage: ... -- <path-to-mpfb-zip>")

zip_path = os.path.abspath(user_args[0])
if not os.path.isfile(zip_path):
    raise SystemExit(f"zip not found: {zip_path}")

print("[install] Blender", bpy.app.version_string)
print("[install] zip:", zip_path, os.path.getsize(zip_path), "bytes")

MODULE = "bl_ext.user_default.mpfb"

# If an older copy is enabled already, disable it first so the reinstall is clean.
if MODULE in bpy.context.preferences.addons:
    print("[install] disabling previously enabled", MODULE)
    bpy.ops.preferences.addon_disable(module=MODULE)

# Install from the local file into the "user_default" local repository and enable.
res = bpy.ops.extensions.package_install_files(
    filepath=zip_path,
    repo="user_default",
    enable_on_install=True,
    overwrite=True,
)
print("[install] package_install_files ->", res)

if MODULE not in bpy.context.preferences.addons:
    print("[install] not enabled after install; enabling explicitly")
    bpy.ops.preferences.addon_enable(module=MODULE)

bpy.ops.wm.save_userpref()

ok = MODULE in bpy.context.preferences.addons
print("[install] enabled:", ok)

# Report where the extension lives and which version the manifest declares.
import importlib
mod = importlib.import_module(MODULE)
mod_dir = os.path.dirname(mod.__file__)
print("[install] module dir:", mod_dir)
manifest = os.path.join(mod_dir, "blender_manifest.toml")
if os.path.isfile(manifest):
    with open(manifest, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith(("id", "version", "name", "blender_version_min", "license")):
                print("[install] manifest:", line.rstrip())

if not ok:
    raise SystemExit("MPFB install failed")
print("[install] DONE")
