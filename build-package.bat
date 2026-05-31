@echo off
chcp 65001 >nul
title CMspark 打包

echo ============================================
echo   CMspark Browser Agent -- 构建分发包
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] 安装依赖...
cd companion
call npm install 2>nul
cd ..\chrome-extension
call npm install 2>nul
cd ..

echo [2/4] 构建 Companion...
cd companion
call npm run build
echo   ^> esbuild 打包...
call npx --yes esbuild dist/index.js --bundle --platform=node --target=node22 --outfile=dist/cmspark-agent.js >nul 2>&1
cd ..

echo [3/4] 构建 Chrome 扩展...
cd chrome-extension
call npm run build >nul 2>&1
cd ..

echo [4/4] 打包分发文件...
if exist dist-package rmdir /s /q dist-package
mkdir dist-package\cmspark

copy companion\dist\cmspark-agent.js dist-package\cmspark\ >nul
copy companion\node_modules\sql.js\dist\sql-wasm.wasm dist-package\cmspark\ >nul
xcopy /e /i /y companion\builtin-skills dist-package\cmspark\builtin-skills >nul
xcopy /e /i /y chrome-extension\build\chrome-mv3-prod dist-package\cmspark\chrome-extension >nul
copy companion\install.bat dist-package\cmspark\ >nul
copy companion\uninstall.bat dist-package\cmspark\ >nul
copy companion\launch.bat dist-package\cmspark\ >nul
copy companion\README.txt dist-package\cmspark\ >nul

echo   ^> 压缩为 zip...
cd dist-package
C:\Windows\System32\tar.exe -caf cmspark-v0.1.0.zip cmspark
cd ..

echo.
echo ============================================
echo   打包完成！
echo   文件: dist-package\cmspark-v0.1.0.zip
echo ============================================
pause
