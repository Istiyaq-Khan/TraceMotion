@echo off
setlocal enabledelayedexpansion

:: Request Administrator privileges if not already elevated
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Requesting Administrator privileges to install into OBS Studio...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

set "SOURCE_DLL=%~dp0build\tracemotion-obs.dll"
set "DATA_DIR=%~dp0data"

if not exist "%SOURCE_DLL%" (
    echo [ERROR] Could not find compiled DLL at: %SOURCE_DLL%
    echo Please run build.bat first to compile it.
    pause
    exit /b 1
)

echo ==========================================================
echo  TraceMotion OBS Plugin - One-Click Installer (OBS 33+)
echo ==========================================================

:: Check if OBS is currently running
tasklist /FI "IMAGENAME eq obs64.exe" 2>NUL | find /I /N "obs64.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo.
    echo [WARNING] OBS Studio is currently running!
    echo Please close OBS Studio before continuing so the plugin files can be replaced.
    echo.
    pause
)

set "OBS_DIR=C:\Program Files\obs-studio"

echo [1/4] Installing to Modern OBS 33 ProgramData directory...
set "PD_PLUGIN=C:\ProgramData\obs-studio\plugins\tracemotion-obs"
if not exist "%PD_PLUGIN%" mkdir "%PD_PLUGIN%"
if not exist "%PD_PLUGIN%\bin\64bit" mkdir "%PD_PLUGIN%\bin\64bit"
if not exist "%PD_PLUGIN%\data\locale" mkdir "%PD_PLUGIN%\data\locale"

copy /y "%SOURCE_DLL%" "%PD_PLUGIN%\tracemotion-obs.dll" >nul
copy /y "%SOURCE_DLL%" "%PD_PLUGIN%\bin\64bit\tracemotion-obs.dll" >nul
if exist "%DATA_DIR%\manifest.json" copy /y "%DATA_DIR%\manifest.json" "%PD_PLUGIN%\data\manifest.json" >nul
if exist "%DATA_DIR%\locale\en-US.ini" copy /y "%DATA_DIR%\locale\en-US.ini" "%PD_PLUGIN%\data\locale\en-US.ini" >nul

echo [2/4] Installing to User AppData directory...
set "AD_PLUGIN=%APPDATA%\obs-studio\plugins\tracemotion-obs"
if not exist "%AD_PLUGIN%" mkdir "%AD_PLUGIN%"
if not exist "%AD_PLUGIN%\bin\64bit" mkdir "%AD_PLUGIN%\bin\64bit"
if not exist "%AD_PLUGIN%\data\locale" mkdir "%AD_PLUGIN%\data\locale"

copy /y "%SOURCE_DLL%" "%AD_PLUGIN%\tracemotion-obs.dll" >nul
copy /y "%SOURCE_DLL%" "%AD_PLUGIN%\bin\64bit\tracemotion-obs.dll" >nul
if exist "%DATA_DIR%\manifest.json" copy /y "%DATA_DIR%\manifest.json" "%AD_PLUGIN%\data\manifest.json" >nul
if exist "%DATA_DIR%\locale\en-US.ini" copy /y "%DATA_DIR%\locale\en-US.ini" "%AD_PLUGIN%\data\locale\en-US.ini" >nul

if exist "%OBS_DIR%" (
    echo [3/4] Installing to OBS Studio installation directory...
    set "PF_PLUGIN=%OBS_DIR%\plugins\tracemotion-obs"
    if not exist "!PF_PLUGIN!" mkdir "!PF_PLUGIN!"
    if not exist "!PF_PLUGIN!\data\locale" mkdir "!PF_PLUGIN!\data\locale"
    copy /y "%SOURCE_DLL%" "!PF_PLUGIN!\tracemotion-obs.dll" >nul
    if exist "%DATA_DIR%\manifest.json" copy /y "%DATA_DIR%\manifest.json" "!PF_PLUGIN!\data\manifest.json" >nul
    if exist "%DATA_DIR%\locale\en-US.ini" copy /y "%DATA_DIR%\locale\en-US.ini" "!PF_PLUGIN!\data\locale\en-US.ini" >nul

    echo [4/4] Installing legacy and core compatibility paths...
    if not exist "%OBS_DIR%\obs-plugins\64bit" mkdir "%OBS_DIR%\obs-plugins\64bit"
    if not exist "%OBS_DIR%\data\obs-plugins\tracemotion-obs\locale" mkdir "%OBS_DIR%\data\obs-plugins\tracemotion-obs\locale"
    if not exist "%OBS_DIR%\core\tracemotion-obs\data\locale" mkdir "%OBS_DIR%\core\tracemotion-obs\data\locale"

    copy /y "%SOURCE_DLL%" "%OBS_DIR%\obs-plugins\64bit\tracemotion-obs.dll" >nul
    copy /y "%SOURCE_DLL%" "%OBS_DIR%\core\tracemotion-obs\tracemotion-obs.dll" >nul
    if exist "%DATA_DIR%\manifest.json" copy /y "%DATA_DIR%\manifest.json" "%OBS_DIR%\data\obs-plugins\tracemotion-obs\manifest.json" >nul
    if exist "%DATA_DIR%\manifest.json" copy /y "%DATA_DIR%\manifest.json" "%OBS_DIR%\core\tracemotion-obs\data\manifest.json" >nul
    if exist "%DATA_DIR%\locale\en-US.ini" copy /y "%DATA_DIR%\locale\en-US.ini" "%OBS_DIR%\data\obs-plugins\tracemotion-obs\locale\en-US.ini" >nul
    if exist "%DATA_DIR%\locale\en-US.ini" copy /y "%DATA_DIR%\locale\en-US.ini" "%OBS_DIR%\core\tracemotion-obs\data\locale\en-US.ini" >nul
)

echo.
echo ==========================================================
echo  SUCCESSFULLY INSTALLED TRACEMOTION OBS PLUGIN!
echo ==========================================================
echo.
echo Verified Targets:
echo  1. %PD_PLUGIN%\tracemotion-obs.dll
echo  2. %AD_PLUGIN%\tracemotion-obs.dll
echo  3. %OBS_DIR%\plugins\tracemotion-obs\tracemotion-obs.dll
echo.
echo Next steps:
echo  1. Launch OBS Studio.
echo  2. Press "Start Recording", move your mouse, click a few times.
echo  3. Press "Stop Recording".
echo  4. Check your Videos folder - you will see your video and its companion:
echo     [video-file-name].cursor.json!
echo.
pause
