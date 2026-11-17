@echo off
setlocal EnableDelayedExpansion

:: -------------------------------------------------------------
:: TraceMotion OBS Plugin - One-Click Elevated Installer
:: Automatically requests UAC elevation if not already running as Admin
:: -------------------------------------------------------------

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [TraceMotion] Requesting Administrator Privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

title TraceMotion OBS Plugin Installer
echo ==========================================================
echo  TraceMotion OBS Plugin - Elevated Installation
echo ==========================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SRC_DLL=%SCRIPT_DIR%obs-telemetry-recorder\build\tracemotion-obs.dll"
set "SRC_DATA=%SCRIPT_DIR%obs-telemetry-recorder\data"

if not exist "%SRC_DLL%" (
    echo [ERROR] Could not find built DLL at:
    echo   %SRC_DLL%
    echo Please run obs-telemetry-recorder\build.bat first!
    pause
    exit /b 1
)

:: 1. Install to Global ProgramData
if exist "C:\ProgramData\obs-studio" (
    echo [1/3] Installing to C:\ProgramData\obs-studio\plugins\tracemotion-obs...
    if not exist "C:\ProgramData\obs-studio\plugins\tracemotion-obs\bin\64bit" mkdir "C:\ProgramData\obs-studio\plugins\tracemotion-obs\bin\64bit" >nul 2>&1
    copy /Y "%SRC_DLL%" "C:\ProgramData\obs-studio\plugins\tracemotion-obs\tracemotion-obs.dll"
    copy /Y "%SRC_DLL%" "C:\ProgramData\obs-studio\plugins\tracemotion-obs\bin\64bit\tracemotion-obs.dll"
    xcopy /Y /S /I /Q "%SRC_DATA%\*" "C:\ProgramData\obs-studio\plugins\tracemotion-obs\data\" >nul 2>&1
)

:: 2. Install to Program Files
if exist "C:\Program Files\obs-studio\obs-plugins\64bit" (
    echo [2/3] Installing to C:\Program Files\obs-studio\obs-plugins\64bit...
    copy /Y "%SRC_DLL%" "C:\Program Files\obs-studio\obs-plugins\64bit\tracemotion-obs.dll"
    if not exist "C:\Program Files\obs-studio\data\obs-plugins\tracemotion-obs" mkdir "C:\Program Files\obs-studio\data\obs-plugins\tracemotion-obs" >nul 2>&1
    xcopy /Y /S /I /Q "%SRC_DATA%\*" "C:\Program Files\obs-studio\data\obs-plugins\tracemotion-obs\" >nul 2>&1
)

:: 3. Install to User AppData
if exist "%APPDATA%\obs-studio\plugins" (
    echo [3/3] Installing to %APPDATA%\obs-studio\plugins\tracemotion-obs...
    if not exist "%APPDATA%\obs-studio\plugins\tracemotion-obs\bin\64bit" mkdir "%APPDATA%\obs-studio\plugins\tracemotion-obs\bin\64bit" >nul 2>&1
    copy /Y "%SRC_DLL%" "%APPDATA%\obs-studio\plugins\tracemotion-obs\tracemotion-obs.dll" >nul 2>&1
    copy /Y "%SRC_DLL%" "%APPDATA%\obs-studio\plugins\tracemotion-obs\bin\64bit\tracemotion-obs.dll" >nul 2>&1
    xcopy /Y /S /I /Q "%SRC_DATA%\*" "%APPDATA%\obs-studio\plugins\tracemotion-obs\data\" >nul 2>&1
)

echo.
echo ==========================================================
echo  INSTALLATION SUCCESSFUL!
echo ==========================================================
echo TraceMotion plugin is now active in OBS Studio.
echo You can now launch OBS Studio.
echo.
pause
