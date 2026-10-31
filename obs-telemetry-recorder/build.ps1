# TraceMotion OBS Plugin - Automated Build Helper Script
param(
    [string]$ObsDir = "C:\Program Files\obs-studio",
    [string]$Generator = "Visual Studio 17 2022",
    [string]$Config = "Release"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $ScriptDir "build"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " TraceMotion OBS Plugin - Automated Build" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Clean stale cache if previous configuration failed
if (Test-Path $BuildDir) {
    Write-Host "[1/3] Cleaning previous/corrupted build cache..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $BuildDir
}
New-Item -ItemType Directory -Path $BuildDir | Out-Null
Set-Location $BuildDir

# 2. Run CMake Configure with explicit Visual Studio Generator
Write-Host "[2/3] Configuring CMake with generator: $Generator..." -ForegroundColor Green
try {
    cmake .. -G "$Generator" -A x64 -DOBS_DIR="$ObsDir"
} catch {
    Write-Host ""
    Write-Host "CMake Configuration Failed!" -ForegroundColor Red
    Write-Host "If you do not have Visual Studio 2022 installed, try:" -ForegroundColor Yellow
    Write-Host "  .\build.ps1 -Generator 'Visual Studio 16 2019'" -ForegroundColor White
    exit 1
}

# 3. Build Plugin
Write-Host "[3/3] Compiling TraceMotion DLL ($Config)..." -ForegroundColor Green
cmake --build . --config $Config

$DllPath = Join-Path $BuildDir "$Config\tracemotion-obs.dll"
if (Test-Path $DllPath) {
    Write-Host ""
    Write-Host "BUILD SUCCEEDED!" -ForegroundColor Green
    Write-Host "Output binary: $DllPath" -ForegroundColor White
    Write-Host ""
    Write-Host "To install into OBS Studio, run:" -ForegroundColor Cyan
    Write-Host "  Copy-Item '$DllPath' 'C:\Program Files\obs-studio\obs-plugins\64bit\'" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "Build finished. Check $BuildDir for build outputs." -ForegroundColor Yellow
}
