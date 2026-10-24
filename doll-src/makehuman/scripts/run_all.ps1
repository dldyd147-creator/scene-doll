# run_all.ps1 -- reproduce both Scene Doll MakeHuman mannequins end to end (Windows, Blender 4.3 headless).
#
#   powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1            # build + verify + previews
#   powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Install   # also (re)install MPFB from downloads/ first
#
# Steps:
#   0. (optional) install the MPFB extension zip from downloads/ into Blender  (00_install_mpfb.py)
#   1. build out/mh_male.glb   (build_doll.py --gender male   --height 1.75)
#   2. build out/mh_female.glb (build_doll.py --gender female --height 1.62)
#   3. verify both GLBs by re-import (verify_glb.py)  -> logs/verify_*.json
#   4. render preview PNGs (render_preview.py)        -> preview/*.png
param(
    [switch]$Install,
    [string]$Blender = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot          # ...\doll-src\makehuman
$Scripts = Join-Path $Root "scripts"
$Out = Join-Path $Root "out"
$Logs = Join-Path $Root "logs"
$Preview = Join-Path $Root "preview"
New-Item -ItemType Directory -Force $Out, $Logs, $Preview | Out-Null

function Run-Blender([string]$Script, [string[]]$ScriptArgs, [string]$LogFile) {
    Write-Host ">>> $Script $($ScriptArgs -join ' ')"
    & $Blender -b --python (Join-Path $Scripts $Script) -- @ScriptArgs 2>&1 | Tee-Object -FilePath $LogFile | Select-String -Pattern "\[(install|build|verify|preview)|Traceback|Error" | ForEach-Object { $_.Line }
    if ($LASTEXITCODE -ne 0) { throw "Blender exited with code $LASTEXITCODE while running $Script (see $LogFile)" }
}

if ($Install) {
    $zip = Get-ChildItem (Join-Path $Root "downloads") -Filter "add-on-mpfb-v*.zip" | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $zip) { throw "no add-on-mpfb-v*.zip in downloads/ -- download it from https://extensions.blender.org/add-ons/mpfb/ first" }
    Run-Blender "00_install_mpfb.py" @($zip.FullName) (Join-Path $Logs "00_install.log")
}

Run-Blender "build_doll.py" @("--gender", "male",   "--height", "1.75", "--out", (Join-Path $Out "mh_male.glb"),   "--log", (Join-Path $Logs "build_male.json"),   "--blend", (Join-Path $Logs "mh_male_debug.blend"))   (Join-Path $Logs "build_male.log")
Run-Blender "build_doll.py" @("--gender", "female", "--height", "1.62", "--out", (Join-Path $Out "mh_female.glb"), "--log", (Join-Path $Logs "build_female.json"), "--blend", (Join-Path $Logs "mh_female_debug.blend")) (Join-Path $Logs "build_female.log")
Run-Blender "verify_glb.py" @((Join-Path $Out "mh_male.glb"),   (Join-Path $Logs "verify_male.json"))   (Join-Path $Logs "verify_male.log")
Run-Blender "verify_glb.py" @((Join-Path $Out "mh_female.glb"), (Join-Path $Logs "verify_female.json")) (Join-Path $Logs "verify_female.log")
Run-Blender "render_preview.py" @((Join-Path $Out "mh_male.glb"),   (Join-Path $Preview "mh_male"))   (Join-Path $Logs "preview_male.log")
Run-Blender "render_preview.py" @((Join-Path $Out "mh_female.glb"), (Join-Path $Preview "mh_female")) (Join-Path $Logs "preview_female.log")

foreach ($g in "male", "female") {
    $v = Get-Content (Join-Path $Logs "verify_$g.json") -Raw | ConvertFrom-Json
    Write-Host ("{0}: verify {1} | height {2:N4} m | triangles {3} | bones {4}" -f $g, ($(if ($v.pass) { "PASS" } else { "FAIL" })), $v.height_m, $v.raw_gltf.triangles_total, $v.bones.Count)
}
