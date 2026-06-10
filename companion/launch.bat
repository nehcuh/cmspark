@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [launch] Current dir: %CD%
echo [launch] Resolving launch method...

:: Priority 1: SEA standalone exe
if exist "cmspark-agent.exe" (
    echo [launch] Found cmspark-agent.exe (SEA mode)
    set "LAUNCH_EXE=cmspark-agent.exe"
    set "LAUNCH_ARGS=tray"
    goto :do_launch
)

:: Priority 2: bundled node.exe + cmspark-agent.js
set "NODE_CMD="
if exist "node.exe" (
    echo [launch] node.exe found
    set "NODE_CMD=node.exe"
) else (
    node --version >nul 2>nul
    if !errorlevel! equ 0 (
        echo [launch] system node found
        set "NODE_CMD=node"
    )
)

if "!NODE_CMD!"=="" (
    echo [ERROR] Neither cmspark-agent.exe nor Node.js found
    pause
    exit /b 1
)

set "LAUNCH_EXE=!NODE_CMD!"
set "LAUNCH_ARGS=cmspark-agent.js tray"

echo [launch] NODE_CMD=!NODE_CMD!

:do_launch
:: Check if already running
netstat -an 2>nul | find.exe "*********:23401" 2>nul | find.exe "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    echo [launch] Already running on port 23401
    goto :done
)

:: Launch via hidden VBS launcher (delegates to cmspark-agent.exe or node fallback)
if exist "%~dp0launch-hidden.vbs" (
    echo [launch] Launching via launch-hidden.vbs...
    wscript.exe "%~dp0launch-hidden.vbs"
) else (
    :: Fallback: launch directly without VBS (console window visible)
    echo [launch] VBS not found, fallback: !LAUNCH_EXE! !LAUNCH_ARGS!
    start /MIN cmd /c "!LAUNCH_EXE! !LAUNCH_ARGS!"
)
echo [launch] Launcher issued, waiting...

ping -n 5 127.0.0.1 >nul

:: Check if log was created
echo [launch] Checking for cmspark-agent.log...
if exist "cmspark-agent.log" (
    echo [launch] LOG FILE EXISTS
    type "cmspark-agent.log" 2>nul
) else (
    echo [launch] LOG FILE MISSING
)

:: Check port
netstat -an 2>nul | find.exe "127.0.0.1:23401" 2>nul | find.exe "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    echo [launch] Port 23401 is LISTENING
) else (
    echo [launch] Port 23401 NOT listening
)

:done
echo.
echo CMspark started (port 23401)
echo Open Chrome side panel: click CMspark icon on toolbar
exit /b 0
