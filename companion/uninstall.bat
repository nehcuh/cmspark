@echo off
setlocal enabledelayedexpansion

chcp 65001 >nul 2>nul
if !errorlevel! neq 0 chcp 936 >nul 2>nul

title CMspark Uninstall

echo Uninstalling CMspark Browser Agent...

:: 1. Kill processes
echo   [1/3] Stopping processes...
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im cmspark-agent.exe >nul 2>nul
echo          Done

:: 2. Remove auto-start
echo   [2/3] Removing auto-start...
schtasks /delete /tn "CMsparkAgent" /f >nul 2>nul
set "shortcutPath=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CMspark.lnk"
if exist "!shortcutPath!" (
    del "!shortcutPath!" >nul 2>nul
    echo          Auto-start shortcut removed
) else (
    echo          Auto-start shortcut not found
)

:: 3. Prompt to remove Chrome extension
echo   [3/3] Remove Chrome extension
echo.
echo   Please manually remove in Chrome:
echo     chrome://extensions -> CMspark -> Remove
echo.
start chrome chrome://extensions 2>nul

:: 4. Clean user data
echo.
set /p DELDATA="Delete user data (history, skills)? (y/N): "
if /i "!DELDATA!"=="y" (
    rmdir /s /q "%USERPROFILE%\.cmspark-agent" >nul 2>nul
    echo   User data deleted
) else (
    echo   User data kept
)

:: 5. Clean log files
del "%~dp0cmspark-agent.log" >nul 2>nul
del "%~dp0cmspark-agent.lock" >nul 2>nul

echo.
echo Uninstall complete
echo.
pause
