@echo off
chcp 65001 >nul
title CMspark Windows Build

echo ============================================
echo   CMspark Windows EXE Builder
echo ============================================
echo.

cd /d "%~dp0"

echo Delegating to PowerShell build script...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-exe.ps1" %*

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed. See output above for details.
    pause
    exit /b %errorlevel%
)
pause
