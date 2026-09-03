@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [launch] Current dir: %CD%
echo [launch] Resolving launch method...

:: Priority 1: bundled node.exe + cmspark-agent.js (official zip; wins over leftover SEA)
set "NODE_CMD="
if exist "node.exe" (
    if exist "cmspark-agent.js" (
        echo [launch] Found node.exe + cmspark-agent.js
        set "NODE_CMD=node.exe"
    )
)

:: Priority 2: system node + local cmspark-agent.js
if "!NODE_CMD!"=="" (
    if exist "cmspark-agent.js" (
        node --version >nul 2>nul
        if !errorlevel! equ 0 (
            echo [launch] system node + cmspark-agent.js
            set "NODE_CMD=node"
        )
    )
)

if not "!NODE_CMD!"=="" (
    set "LAUNCH_EXE=!NODE_CMD!"
    set "LAUNCH_ARGS=cmspark-agent.js tray"
    echo [launch] NODE_CMD=!NODE_CMD!
    goto :do_launch
)

:: Priority 3: SEA standalone exe last resort
if exist "cmspark-agent.exe" (
    echo [launch] Found cmspark-agent.exe (SEA last resort^)
    set "LAUNCH_EXE=cmspark-agent.exe"
    set "LAUNCH_ARGS=tray"
    goto :do_launch
)

if exist "cmspark-agent.js" (
    echo [ERROR] cmspark-agent.js found but no Node.js runtime available.
    echo   Restore the bundled node.exe ^(re-extract the zip / check antivirus quarantine^)
    echo   or install Node.js from https://nodejs.org/
) else (
    echo [ERROR] Neither cmspark-agent.js / Node.js nor cmspark-agent.exe found
)
pause
exit /b 1

:do_launch
:: Already listening on Companion port?
netstat -an 2>nul | find.exe "127.0.0.1:23401" 2>nul | find.exe "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    echo [launch] Already running on port 23401
    goto :success
)

:: Launch via hidden VBS launcher (delegates to node bundle or SEA fallback)
if exist "%~dp0launch-hidden.vbs" (
    echo [launch] Launching via launch-hidden.vbs...
    wscript.exe "%~dp0launch-hidden.vbs"
) else (
    echo [launch] VBS not found, fallback: !LAUNCH_EXE! !LAUNCH_ARGS!
    start /MIN cmd /c "!LAUNCH_EXE! !LAUNCH_ARGS!"
)
echo [launch] Launcher issued, waiting...

ping -n 6 127.0.0.1 >nul

:: Probe 127.0.0.1:23401 LISTENING (server binds loopback only)
netstat -an 2>nul | find.exe "127.0.0.1:23401" 2>nul | find.exe "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    goto :success
)

echo.
echo [ERROR] Companion did not start (port 23401 not listening).
echo   Crash / diagnostics (if any):
echo     %USERPROFILE%\.cmspark-agent\logs\crash.log
echo     %USERPROFILE%\.cmspark-agent\logs\vbs-launcher.log
echo     %USERPROFILE%\.cmspark-agent\logs\companion-*.log
echo   Try: node.exe cmspark-agent.js tray   (visible console)
echo   Or:  wscript launch-hidden.vbs
echo   Or reinstall / re-run after fixing binaries.
pause
exit /b 1

:success
echo.
echo CMspark started (port 23401)
echo Open Chrome side panel: click CMspark icon on toolbar
exit /b 0
