@echo off
chcp 65001 >nul
cd /d "%~dp0"

tasklist /fi "imagename eq cmspark-agent.exe" | find /i "cmspark-agent.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo CMspark 已在运行中
    goto :open_chrome
)

if exist "%~dp0cmspark-agent.exe" (
    echo 启动 CMspark (standalone)...
    start /B "" "%~dp0cmspark-agent.exe"
) else if exist "%~dp0companion-bundle\index.js" (
    echo 启动 CMspark (Node.js)...
    start /B "" node "%~dp0companion-bundle\index.js" start
) else (
    echo 错误: 未找到 CMspark 可执行文件
    pause
    exit /b 1
)

:open_chrome
echo CMspark 已启动 (端口 23401)
echo.
echo 打开 Chrome 侧边栏: 点击工具栏 CMspark 图标
timeout /t 2 >nul
exit /b 0
