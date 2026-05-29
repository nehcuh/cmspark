@echo off
chcp 65001 >nul
title CMspark 卸载

echo 正在卸载 CMspark Browser Agent...

:: 1. 杀掉 Companion 进程
taskkill /f /im cmspark-agent.exe 2>nul

:: 2. 删除开机自启任务
schtasks /delete /tn "CMsparkAgent" /f 2>nul

:: 3. 提示删除扩展
echo.
echo 请手动在 Chrome 中卸载扩展：
echo   chrome://extensions → CMspark → 移除
echo.

start chrome chrome://extensions 2>nul

:: 4. 清理数据目录（可选）
choice /c yn /m "是否删除用户数据（历史记录、技能等）"
if %errorlevel% equ 2 goto :skip
rmdir /s /q "%USERPROFILE%\.cmspark-agent" 2>nul
echo 用户数据已删除
:skip

echo 卸载完成
pause
