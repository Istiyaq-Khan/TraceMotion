# =====================================================================
# TraceMotion - Local Release Packaging Script
# Generates the exact clean release ZIPs for GitHub Releases
# =====================================================================

param (
    [string]$Version = "v1.0.0"
)

$ErrorActionPreference = "Stop"
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $rootDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Packaging TraceMotion Release: $Version" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Run validation tests first
Write-Host "`n[1/3] Running automated validation tests..." -ForegroundColor Yellow
& node "$rootDir/scripts/test_es3_panel.js"
if ($LASTEXITCODE -ne 0) {
    Write-Error "test_es3_panel.js failed! Aborting release packaging."
}
& node "$rootDir/scripts/test_build_rig.js"
if ($LASTEXITCODE -ne 0) {
    Write-Error "test_build_rig.js failed! Aborting release packaging."
}
Write-Host "All tests passed cleanly!" -ForegroundColor Green

# 2. Prepare dist directory
$distDir = Join-Path $rootDir "dist"
if (Test-Path $distDir) {
    Remove-Item -Path $distDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distDir | Out-Null

# 3. Package After Effects ScriptUI Panel ZIP
Write-Host "`n[2/3] Packaging After Effects ScriptUI Panel..." -ForegroundColor Yellow
$aeStaging = Join-Path $distDir "TraceMotion-AfterEffects-Panel"
New-Item -ItemType Directory -Path $aeStaging | Out-Null
Copy-Item "$rootDir/after-effects-importer/TraceMotionImporter.jsx" -Destination $aeStaging
Copy-Item -Path "$rootDir/after-effects-importer/assets" -Destination $aeStaging -Recurse

$aeInstallTxt = @"
TraceMotion Studio - After Effects Panel Installation
=====================================================

1. Copy 'TraceMotionImporter.jsx' AND the 'assets' folder into your After Effects ScriptUI Panels directory:
   - Windows: C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\
   - macOS:   /Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/

2. In After Effects, navigate to:
   - Edit > Preferences > Scripting & Expressions
   - Ensure 'Allow Scripts to Write Files and Access Network' is CHECKED.

3. Restart After Effects.
4. Launch TraceMotion from the menu: Window > TraceMotionImporter.jsx
"@
Set-Content -Path (Join-Path $aeStaging "HOW_TO_INSTALL_AE.txt") -Value $aeInstallTxt

$aeZip = Join-Path $distDir "TraceMotion-AfterEffects-Panel-$Version.zip"
Compress-Archive -Path "$aeStaging/*" -DestinationPath $aeZip -Force
$aeSizeMB = [math]::Round((Get-Item $aeZip).Length / 1MB, 2)
Write-Host "  -> Created: $aeZip ($aeSizeMB MB)" -ForegroundColor Green

# 4. Package OBS Studio Plugin ZIP
Write-Host "`n[3/3] Packaging OBS Studio Plugin..." -ForegroundColor Yellow
$obsStaging = Join-Path $distDir "TraceMotion-OBS-Plugin"
New-Item -ItemType Directory -Path $obsStaging | Out-Null

$dllSrc = "$rootDir/obs-telemetry-recorder/build/tracemotion-obs.dll"
if (Test-Path $dllSrc) {
    Copy-Item $dllSrc -Destination $obsStaging
} else {
    Write-Warning "Could not find $dllSrc - skipping DLL copy"
}
Copy-Item -Path "$rootDir/obs-telemetry-recorder/data" -Destination $obsStaging -Recurse
Copy-Item "$rootDir/install_obs_plugin.bat" -Destination $obsStaging
Copy-Item "$rootDir/HOW_TO_INSTALL.txt" -Destination $obsStaging

$obsZip = Join-Path $distDir "TraceMotion-OBS-Plugin-Windows-x64-$Version.zip"
Compress-Archive -Path "$obsStaging/*" -DestinationPath $obsZip -Force
$obsSizeKB = [math]::Round((Get-Item $obsZip).Length / 1KB, 2)
Write-Host "  -> Created: $obsZip ($obsSizeKB KB)" -ForegroundColor Green

# Cleanup staging folders
Remove-Item -Path $aeStaging -Recurse -Force
Remove-Item -Path $obsStaging -Recurse -Force

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " Release packaging complete! Files ready in dist/:" -ForegroundColor Green
Get-ChildItem -Path $distDir -File | ForEach-Object {
    Write-Host "   - $($_.Name) ($([math]::Round($_.Length / 1MB, 2)) MB)" -ForegroundColor Cyan
}
Write-Host "==========================================================" -ForegroundColor Green
