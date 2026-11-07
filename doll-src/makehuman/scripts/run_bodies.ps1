# run_bodies.ps1 -- 체형 돌(2026-11-08): 남자_모델핏 · 여자_근육핏. 기본 돌(run_v2.ps1)과 같은 뼈대(Mixamo 73본)·메시, 매크로와 MPFB 타깃만 다르다.
#   powershell -ExecutionPolicy Bypass -File scripts\run_bodies.ps1
# 새 체형을 더할 때: 아래에 줄 하나 추가(--age/--muscle/--weight/--proportions 0~1, --targets "이름=가중치,..." 는 mpfb/data/targets 의 파일 이름).
param([string]$Blender = "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$S = Join-Path $Root "scripts"; $Out = Join-Path $Root "out"; $Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force $Out, $Logs | Out-Null
function Build([string]$Name, [string[]]$Args) {
    & $Blender -b --python (Join-Path $S "build_doll_v2.py") -- @Args --out (Join-Path $Out "$Name.glb") --log (Join-Path $Logs "build2_$Name.json") 2>&1 | Tee-Object -FilePath (Join-Path $Logs "build2_$Name.log") | Select-String -Pattern "\[build|Traceback|Error" | ForEach-Object { $_.Line }
    if ($LASTEXITCODE -ne 0) { throw "Blender failed for $Name" }
}
# 남자_모델핏: 9등신에 가깝게 — 머리 작게, 다리·목 길게, 어깨 넓게, 마른 편
Build "mh2_male_model" @("--gender","male","--height","1.88","--proportions","1.0","--weight","0.3","--muscle","0.6","--targets","head-scale-vert-decr=0.6,head-scale-horiz-decr=0.4,head-scale-depth-decr=0.3,measure-upperleg-height-incr=0.7,measure-lowerleg-height-incr=0.7,measure-neck-height-incr=0.3,measure-shoulder-dist-incr=0.3")
# 여자_근육핏: 근육 매크로 최대 + 팔·다리·복근 타깃, 어깨 넓게
Build "mh2_female_muscle" @("--gender","female","--height","1.72","--proportions","0.8","--weight","0.45","--muscle","1.0","--targets","l-upperarm-muscle-incr=0.8,r-upperarm-muscle-incr=0.8,l-upperarm-shoulder-muscle-incr=0.8,r-upperarm-shoulder-muscle-incr=0.8,l-lowerarm-muscle-incr=0.6,r-lowerarm-muscle-incr=0.6,l-upperleg-muscle-incr=0.7,r-upperleg-muscle-incr=0.7,l-lowerleg-muscle-incr=0.7,r-lowerleg-muscle-incr=0.7,stomach-tone-incr=0.8,measure-shoulder-dist-incr=0.4")
