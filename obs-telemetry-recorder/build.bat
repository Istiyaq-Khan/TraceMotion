@echo off
setlocal enabledelayedexpansion

echo ==========================================================
echo  TraceMotion OBS Plugin - Automated Native Build
echo ==========================================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

rem 1. Locate Visual Studio vcvarsall.bat
set "VCVARS="
if exist "D:\apps\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat" (
    set "VCVARS=D:\apps\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
)

if "%VCVARS%"=="" (
    echo [ERROR] Could not find Visual Studio vcvarsall.bat.
    pause
    exit /b 1
)

echo [1/3] Initializing Visual Studio build environment...
call "%VCVARS%" x64 -vcvars_ver=14.44.35207 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    rem Fallback to default vcvarsall
    call "%VCVARS%" x64 >nul 2>&1
)

rem Prepend compiler and lib paths
if exist "D:\apps\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.44.35207\bin\HostX64\x64" (
    set "PATH=D:\apps\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.44.35207\bin\HostX64\x64;!PATH!"
    set "INCLUDE=D:\apps\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.44.35207\include;!INCLUDE!"
    set "LIB=D:\apps\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.44.35207\lib\x64;!LIB!"
)

rem 2. Ensure OBS import libraries exist
echo [2/3] Checking OBS import libraries...
if not exist "deps\obs\lib\obs.lib" (
    if not exist "deps\obs\lib" mkdir "deps\obs\lib"
    (
        echo LIBRARY obs.dll
        echo EXPORTS
        echo     blog
        echo     obs_get_video_info
        echo     obs_output_get_settings
        echo     obs_data_get_string
        echo     obs_data_release
        echo     obs_output_release
        echo     bfree
        echo     os_gettime_ns
    ) > "deps\obs\lib\obs.def"
    lib /nologo /def:deps\obs\lib\obs.def /machine:x64 /out:deps\obs\lib\obs.lib >nul
)

if not exist "deps\obs\lib\obs-frontend-api.lib" (
    (
        echo LIBRARY obs-frontend-api.dll
        echo EXPORTS
        echo     obs_frontend_add_event_callback
        echo     obs_frontend_remove_event_callback
        echo     obs_frontend_get_recording_output
        echo     obs_frontend_get_last_recording
    ) > "deps\obs\lib\obs-frontend-api.def"
    lib /nologo /def:deps\obs\lib\obs-frontend-api.def /machine:x64 /out:deps\obs\lib\obs-frontend-api.lib >nul
)

rem 3. Compile and Link tracemotion-obs.dll
echo [3/3] Compiling and linking tracemotion-obs.dll (C++20 Release)...
if not exist "build" mkdir "build"

cl.exe /nologo /LD /std:c++20 /O2 /EHsc /utf-8 /Iinclude /Ideps\obs\include ^
    src\main.cpp src\telemetry_worker.cpp ^
    /Febuild\tracemotion-obs.dll /Fobuild\ ^
    /link /nologo /LIBPATH:deps\obs\lib obs.lib obs-frontend-api.lib winmm.lib user32.lib gdi32.lib

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Compilation failed.
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================================
echo  BUILD SUCCEEDED!
echo  Binary: %SCRIPT_DIR%build\tracemotion-obs.dll
echo ==========================================================
echo.
echo To install into OBS Studio, run this in PowerShell:
echo   Copy-Item "%SCRIPT_DIR%build\tracemotion-obs.dll" "C:\Program Files\obs-studio\obs-plugins\64bit\"
echo.

endlocal
