@echo off
chcp 65001 >nul
title CMspark Browser Agent 安装

echo ============================================
echo   CMspark Browser Agent -- 一键安装
echo ============================================
echo.

cd /d "%~dp0"

:: 0. 检查 Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 运行时
    echo.
    echo 请先安装 Node.js：
    echo   1. 访问 https://nodejs.org/
    echo   2. 下载并安装 LTS 版本 (v20+)
    echo   3. 重新运行 install.bat
    echo.
    start https://nodejs.org/
    pause
    exit /b 1
)

:: 1. 启动 Companion
echo [1/3] 启动 Companion 服务...
call "%~dp0launch.bat"
echo.

:: 2. 设置开机自启（无需管理员权限）
echo [2/3] 设置开机自启...
set "startupDir=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "shortcutPath=%startupDir%\CMspark.lnk"

if exist "%shortcutPath%" (
    echo        开机自启已存在
) else (
    echo        创建快捷方式到启动文件夹...
    echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\CreateShortcut.vbs"
    echo sLinkFile = "%shortcutPath%" >> "%TEMP%\CreateShortcut.vbs"
    echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\CreateShortcut.vbs"
    echo oLink.TargetPath = "%~dp0launch.bat" >> "%TEMP%\CreateShortcut.vbs"
    echo oLink.WorkingDirectory = "%~dp0." >> "%TEMP%\CreateShortcut.vbs"
    echo oLink.Save >> "%TEMP%\CreateShortcut.vbs"
    cscript //nologo "%TEMP%\CreateShortcut.vbs"
    del "%TEMP%\CreateShortcut.vbs" >nul 2>&1
    if exist "%shortcutPath%" (
        echo        开机自启已设置
    ) else (
        echo        [跳过] 无法创建快捷方式
    )
)
echo.

:: 3. 加载 Chrome 扩展
echo [3/3] 提示加载 Chrome 扩展
echo.
echo   请手动完成以下步骤：
echo   1. 打开 Chrome 浏览器
echo   2. 地址栏输入: chrome://extensions
echo   3. 打开右上角"开发者模式"
echo   4. 点击"加载已解压的扩展程序"
echo   5. 选择文件夹: %~dp0chrome-extension
echo.

start chrome chrome://extensions 2>nul

echo ============================================
echo   安装完成！
echo.
echo   CMspark 正在后台运行（端口 23401）
echo.
echo   如需卸载，运行: uninstall.bat
echo ============================================

pause
