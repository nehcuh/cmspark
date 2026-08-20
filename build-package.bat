@echo off
chcp 65001 >nul
title CMspark Windows Build

echo ============================================
echo   CMspark Windows EXE Builder
echo ============================================
echo.
echo Local STT: if companion\dist\bin\cmspark-whisper-win-x64.exe is missing,
echo   the build will AUTO-DOWNLOAD a pinned whisper.cpp zip (HTTPS+sha256)
echo   unless CMSPARK_WHISPER_AUTO_FETCH=0. Sidecar + DLLs stage next to the SEA exe.
echo.

cd /d "%~dp0"

echo Delegating to PowerShell SEA build script...
echo Official Setup.exe is make package-windows / scripts\package.sh, not this path.
echo.
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-exe.ps1" %*

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed. See output above for details.
    pause
    exit /b %errorlevel%
)
pause
