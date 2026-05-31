@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 检查 Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 运行时
    echo 请先安装 Node.js：https://nodejs.org/
    pause
    exit /b 1
)

:: 检查端口 23401 是否已被占用（说明服务在运行）
netstat -an | find "127.0.0.1:23401" | find "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo CMspark 已在运行中（端口 23401）
    goto :done
)

:: 启动服务
if exist "%~dp0cmspark-agent.exe" (
    echo 启动 CMspark (standalone)...
    start /B "" "%~dp0cmspark-agent.exe" >nul 2>&1
) else if exist "%~dp0cmspark-agent.js" (
    echo 启动 CMspark (Node.js bundle)...
    start /B "" node "%~dp0cmspark-agent.js" start >> "%~dp0cmspark-agent.log" 2>&1
    timeout /t 2 >nul
    if exist "%~dp0cmspark-agent.log" (
        find /i "Companion started" "%~dp0cmspark-agent.log" >nul 2>&1
        if %errorlevel% equ 0 (
            echo 启动成功
        ) else (
            find /i "error" "%~dp0cmspark-agent.log" >nul 2>&1
            if %errorlevel% equ 0 (
                echo [错误] 启动失败，详情见 cmspark-agent.log
            ) else (
                echo [提示] 服务启动中，日志写入 cmspark-agent.log
            )
        )
    )
) else if exist "%~dp0companion-bundle\index.js" (
    echo 启动 CMspark (Node.js)...
    start /B "" node "%~dp0companion-bundle\index.js" start
) else (
    echo 错误: 未找到 CMspark 可执行文件
    pause
    exit /b 1
)

:done
echo.
echo CMspark 已启动 (端口 23401)
echo 打开 Chrome 侧边栏: 点击工具栏 CMspark 图标
timeout /t 2 >nul
exit /b 0
