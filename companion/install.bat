@echo off
chcp 65001 >nul
title CMspark Browser Agent 安装

echo ============================================
echo   CMspark Browser Agent — 一键安装
echo ============================================
echo.

cd /d "%~dp0"

:: 1. 启动 Companion
echo [1/3] 启动 Companion 服务...
call "%~dp0launch.bat"
echo.

:: 2. 注册开机自启
echo [2/3] 设置开机自启...
schtasks /create /tn "CMsparkAgent" /tr "\"%~dp0launch.bat\"" /sc onlogon /f /rl highest 2>nul
if %errorlevel% equ 0 (
    echo        开机自启已设置
) else (
    echo        [跳过] 需要管理员权限
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
