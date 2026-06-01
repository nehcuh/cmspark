@echo off
setlocal enabledelayedexpansion

set "LOG=%~dp0install.log"
> "%LOG%" echo [CMspark Install Log]

cd /d "%~dp0"

echo ============================================
echo   CMspark Browser Agent -- Install
echo ============================================
echo.
echo [Diag] Current dir: %~dp0
echo [Diag] Files in this dir:
dir /b "%~dp0"
echo.

:: 0. Check runtime
echo [0/3] Checking runtime...
set "HAS_NODE=0"
set "NODE_CMD="

if exist "%~dp0node.exe" (
    echo        [OK] Built-in Node.js found (node.exe)
    set "HAS_NODE=1"
    set "NODE_CMD=%~dp0node.exe"
    goto :node_ok
)

node --version >nul 2>nul
if !errorlevel! equ 0 (
    echo        [OK] System Node.js detected
    set "HAS_NODE=1"
    set "NODE_CMD=node"
    goto :node_ok
)

echo.
echo [ERROR] Node.js runtime not found!
echo.
echo Possible causes:
echo   1. Incomplete extraction -- node.exe (~85MB) missing
echo   2. Blocked by antivirus -- check Windows Defender quarantine
echo   3. File corrupted -- re-download the package
echo.
echo Solutions:
echo   A. Check if node.exe exists in this folder
echo   B. If antivirus blocked it, choose "Allow/Restore"
echo   C. Or install Node.js first: https://nodejs.org/
echo.
start https://nodejs.org/
pause
exit /b 1

:node_ok
echo.

:: 1. Start Companion
echo [1/3] Starting Companion...
call "%~dp0launch.bat"
if !errorlevel! neq 0 (
    echo [WARN] Companion may have failed to start, check logs in %%USERPROFILE%%\.cmspark-agent\logs\
)
echo.

:: 2. Set auto-start
echo [2/3] Setting auto-start...
echo        [Skip] Auto-start setup skipped for compatibility
echo        To auto-start CMspark on boot, manually copy launch.bat to:
echo        %%USERPROFILE%%\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
echo.

:skip_autostart
echo.

:: 3. Load Chrome extension
echo [3/3] Loading Chrome extension
echo.
echo   Please complete the following steps:
echo   1. Open Chrome browser
echo   2. Type in address bar: chrome://extensions
echo   3. Enable "Developer mode" at top-right
echo   4. Click "Load unpacked"
echo   5. Select folder: %~dp0chrome-extension
echo.
start chrome chrome://extensions 2>nul

echo ============================================
echo   Installation complete!
echo   CMspark is running in background (port 23401)
echo   To uninstall, run: uninstall.bat
echo ============================================
pause
