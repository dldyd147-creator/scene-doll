# run_v2.ps1 -- reproduce both Scene Doll v2 MakeHuman mannequins (twist bones) end to end (Windows, Blender 4.3 headless).
#
#   powershell -ExecutionPolicy Bypass -File scripts\run_v2.ps1              # build + verify + deformation renders
#   powershell -ExecutionPolicy Bypass -File scripts\run_v2.ps1 -CompareV1   # also render the v1 GLBs with the same poses
#   powershell -ExecutionPolicy Bypass -File scripts\run_v2.ps1 -Install     # (re)install MPFB from downloads/ first
#
# Steps:
#   0. (optional) install the MPFB extension zip from downloads/ into Blender  (00_install_mpfb.py)
#   1. build out/mh2_male.glb   (build_doll_v2.py --gender male   --height 1.75)
#   2. build out/mh2_female.glb (build_doll_v2.py --gender female --height 1.62)
#   3. verify both GLBs by re-import (verify_glb_v2.py)          -> logs/verify2_*.json
#   4. deformation test renders (render_deform_v2.py)             -> preview_v2/mh2_*_<test>_<view>.png
#   5. (optional) the same renders for out/mh_*.glb (v1)          -> preview_v2/v1_compare/
param(
    [switch]$Install,
    [switch]$CompareV1,
    [string]$Blender = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot          # ...\doll-src\makehuman
$Scripts = Join-Path $Root "scripts"
$Out = Join-Path $Root "out"
$Logs = Join-Path $Root "logs"
$Preview = Join-Path $Root "preview_v2"
New-Item -ItemType Directory -Force $Out, $Logs, $Preview | Out-Null

function Run-Blender([string]$Script, [string[]]$ScriptArgs, [string]$LogFile) {
    Write-Host ">>> $Script $($ScriptArgs -join ' ')"
    & $Blender -b --python (Join-Path $Scripts $Script) -- @ScriptArgs 2>&1 | Tee-Object -FilePath $LogFile | Select-String -Pattern "\[(install|build|verify|deform)|Traceback|Error" | ForEach-Object { $_.Line }
    if ($LASTEXITCODE -ne 0) { throw "Blender exited with code $LASTEXITCODE while running $Script (see $LogFile)" }
}

if ($Install) {
    $zip = Get-ChildItem (Join-Path $Root "downloads") -Filter "add-on-mpfb-v*.zip" | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $zip) { throw "no add-on-mpfb-v*.zip in downloads/ -- download it from https://extensions.blender.org/add-ons/mpfb/ first" }
    Run-Blender "00_install_mpfb.py" @($zip.FullName) (Join-Path $Logs "00_install.log")
}

Run-Blender "build_doll_v2.py" @("--gender", "male",   "--height", "1.75", "--smooth-limbs", "2", "--out", (Join-Path $Out "mh2_male.glb"),   "--log", (Join-Path $Logs "build2_male.json"),   "--blend", (Join-Path $Logs "mh2_male_debug.blend"))   (Join-Path $Logs "build2_male.log")
Run-Blender "build_doll_v2.py" @("--gender", "female", "--height", "1.62", "--smooth-limbs", "2", "--out", (Join-Path $Out "mh2_female.glb"), "--log", (Join-Path $Logs "build2_female.json"), "--blend", (Join-Path $Logs "mh2_female_debug.blend")) (Join-Path $Logs "build2_female.log")
Run-Blender "verify_glb_v2.py" @((Join-Path $Out "mh2_male.glb"),   (Join-Path $Logs "verify2_male.json"))   (Join-Path $Logs "verify2_male.log")
Run-Blender "verify_glb_v2.py" @((Join-Path $Out "mh2_female.glb"), (Join-Path $Logs "verify2_female.json")) (Join-Path $Logs "verify2_female.log")
Run-Blender "render_deform_v2.py" @((Join-Path $Out "mh2_male.glb"),   $Preview, "mh2_male")   (Join-Path $Logs "deform2_male.log")
Run-Blender "render_deform_v2.py" @((Join-Path $Out "mh2_female.glb"), $Preview, "mh2_female") (Join-Path $Logs "deform2_female.log")

if ($CompareV1) {
    $Cmp = Join-Path $Preview "v1_compare"
    New-Item -ItemType Directory -Force $Cmp | Out-Null
    Run-Blender "render_deform_v2.py" @((Join-Path $Out "mh_male.glb"),   $Cmp, "mh_male")   (Join-Path $Logs "deform_v1_male.log")
    Run-Blender "render_deform_v2.py" @((Join-Path $Out "mh_female.glb"), $Cmp, "mh_female") (Join-Path $Logs "deform_v1_female.log")
}

foreach ($g in "male", "female") {
    $v = Get-Content (Join-Path $Logs "verify2_$g.json") -Raw | ConvertFrom-Json
    Write-Host ("{0}: verify {1} | height {2:N4} m | triangles {3} | bones {4}" -f $g, ($(if ($v.pass) { "PASS" } else { "FAIL" })), $v.height_m, $v.raw_gltf.triangles_total, $v.bones.Count)
}
