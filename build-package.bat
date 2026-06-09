@echo off
chcp 65001 >nul
title CMspark ���

echo ============================================
echo   CMspark Browser Agent -- �����ַ���
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] ��װ����...
cd companion
call npm install 2>nul
cd ..\chrome-extension
call npm install 2>nul
cd ..

echo [2/4] ���� Companion...
cd companion
call npm run build
echo   ^> esbuild ���...
call npx --yes esbuild dist/index.js --bundle --platform=node --target=node20 --outfile=dist/cmspark-agent.js >nul 2>&1
cd ..

echo [3/4] ���� Chrome ��չ...
cd chrome-extension
call npm run build >nul 2>&1
cd ..

echo [4/4] ����ַ��ļ�...
if exist dist-package rmdir /s /q dist-package
mkdir dist-package\cmspark

copy companion\dist\cmspark-agent.js dist-package\cmspark\ >nul
copy companion\node_modules\sql.js\dist\sql-wasm.wasm dist-package\cmspark\ >nul

:: ���Ʊ�Я�� Node.js ����ʱ�������û���װ Node.js��
for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
if exist "%NODE_EXE%" (
    copy "%NODE_EXE%" dist-package\cmspark\node.exe >nul
    echo   ^> �Ѹ��� Node.js ����ʱ
) else (
    echo   ^> [����] δ�ҵ� Node.js���ַ�������Ҫ�û����а�װ
)
xcopy /e /i /y companion\builtin-skills dist-package\cmspark\builtin-skills >nul
xcopy /e /i /y chrome-extension\build\chrome-mv3-prod dist-package\cmspark\chrome-extension >nul
copy companion\install.bat dist-package\cmspark\ >nul
copy companion\uninstall.bat dist-package\cmspark\ >nul
copy companion\launch.bat dist-package\cmspark\ >nul
copy companion\launch-hidden.vbs dist-package\cmspark\ >nul
copy companion\README.txt dist-package\cmspark\ >nul

echo   ^> ѹ��Ϊ zip...
cd dist-package
C:\Windows\System32\tar.exe -caf cmspark-v0.1.0.zip cmspark
cd ..

echo.
echo ============================================
echo   �����ɣ�
echo   �ļ�: dist-package\cmspark-v0.1.0.zip
echo ============================================
pause
