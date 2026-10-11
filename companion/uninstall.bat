@echo off
setlocal DisableDelayedExpansion

chcp 65001 >nul 2>nul
if errorlevel 1 chcp 936 >nul 2>nul

title CMspark Uninstall

echo Uninstalling CMspark Browser Agent...

:: 1. Kill processes
echo   [1/3] Stopping processes...
set "CMSPARK_INSTALL_STOP_ROOT=%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$r = [IO.Path]::GetFullPath($env:CMSPARK_INSTALL_STOP_ROOT).TrimEnd('\') + '\'; Get-CimInstance Win32_Process | ForEach-Object { if (($_.Name -eq 'node.exe' -or $_.Name -eq 'cmspark-agent.exe') -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"
set "CMSPARK_INSTALL_STOP_ROOT="
echo          Done

:: 2. Remove auto-start
echo   [2/3] Removing auto-start...
schtasks /delete /tn "CMsparkAgent" /f >nul 2>nul
set "shortcutPath=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CMspark.lnk"
if exist "%shortcutPath%" (
    del "%shortcutPath%" >nul 2>nul
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
if /i "%DELDATA%"=="y" (
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
