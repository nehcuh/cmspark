.PHONY: dev install test build clean load-extension menu-bar install-macos uninstall-macos daemon-status install-linux uninstall-linux install-windows uninstall-windows

# 一键启动开发环境（两个进程并行）
dev: install
	@echo "Starting companion + extension dev servers..."
	@cd companion && npm run dev & \
	cd chrome-extension && npm run dev & \
	wait

# 安装所有依赖
install:
	cd companion && npm install
	cd chrome-extension && npm install

# 运行全部测试
test:
	npm --prefix companion test
	npm --prefix chrome-extension test

# 构建所有
build:
	cd companion && npm run build
	cd chrome-extension && npm run build

# 打开 Chrome 扩展管理页面（手动加载）
load-extension:
	@echo "1. Open chrome://extensions"
	@echo "2. Enable Developer Mode"
	@echo '3. Click "Load unpacked" → chrome-extension/build/chrome-mv3-prod/'
	@open "chrome://extensions" 2>/dev/null || echo "Please open chrome://extensions manually"

# 清理构建产物
clean:
	rm -rf companion/dist companion/.test-dist
	rm -rf chrome-extension/build chrome-extension/.test-dist

# 系统托盘代理（全平台）
tray:
	cd companion && npm run tray

# macOS 菜单栏代理（legacy readline）
menu-bar:
	cd companion && npm run menu-bar

# macOS 安装后台守护进程 + 系统托盘启动器
install-macos: build
	@echo "Installing CMspark macOS daemon..."
	@cd companion && ./scripts/install-daemon.sh

# macOS 卸载后台守护进程
uninstall-macos:
	@echo "Uninstalling CMspark macOS daemon..."
	@cd companion && ./scripts/uninstall-daemon.sh

# 查看守护进程状态
daemon-status:
	@cd companion && npm run daemon:status

# Linux 安装 systemd 用户服务 + 菜单栏启动器
install-linux: build
	@echo "Installing CMspark Linux daemon..."
	@cd companion && ./scripts/install-daemon.sh

# Linux 卸载 systemd 用户服务
uninstall-linux:
	@echo "Uninstalling CMspark Linux daemon..."
	@cd companion && ./scripts/uninstall-daemon.sh

# Windows 安装任务计划程序服务 + 开始菜单快捷方式
install-windows: build
	@echo "Installing CMspark Windows daemon..."
	@powershell -ExecutionPolicy Bypass -File scripts/install-daemon.ps1

# Windows 卸载任务计划程序服务
uninstall-windows:
	@echo "Uninstalling CMspark Windows daemon..."
	@powershell -ExecutionPolicy Bypass -File scripts/uninstall-daemon.ps1

# 打包分发版本 (Windows 用户用)
# 用法: make package  或双击 build-package.bat
package: build
	@echo "Building distribution package..."
	@mkdir -p dist-package/cmspark
	@cd companion && npx --yes esbuild dist/index.js --bundle --platform=node --target=node22 --outfile=dist/cmspark-agent.js
	@cp companion/dist/cmspark-agent.js dist-package/cmspark/
	@cp companion/node_modules/sql.js/dist/sql-wasm.wasm dist-package/cmspark/
	@cp -r companion/builtin-skills dist-package/cmspark/
	@cp -r chrome-extension/build/chrome-mv3-prod dist-package/cmspark/chrome-extension
	@cp companion/install.bat dist-package/cmspark/
	@cp companion/uninstall.bat dist-package/cmspark/
	@cp companion/launch.bat dist-package/cmspark/
	@cp companion/README.txt dist-package/cmspark/
	@echo "Compressing to zip..."
	@cd dist-package && C:/Windows/System32/tar.exe -caf cmspark-v0.1.0.zip cmspark
	@echo "Done: dist-package/cmspark-v0.1.0.zip"
