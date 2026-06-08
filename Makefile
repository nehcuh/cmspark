.PHONY: dev install test build clean load-extension \
       build-tray tray tray-status tray-rebuild menu-bar \
       install-macos install-macos-daemon install-macos-menubar \
       uninstall-macos daemon-status \
       install-linux uninstall-linux \
       install-windows uninstall-windows \
       package package-macos package-windows package-linux

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

# ── Swift 托盘 ──

# 编译 Swift 托盘（macOS Apple Silicon）
build-tray:
	@echo "Building Swift tray for macOS ARM64..."
	@cd companion && ./src/tray/build-tray.sh

# ── 系统托盘 ──

# 启动系统托盘（跨平台，推荐方式）
tray:
	@cd companion && npm run tray

# 查看托盘后端信息
tray-status:
	@cd companion && npm run tray:status

# 重新编译 Swift 托盘（macOS）
tray-rebuild:
	@cd companion && npm run tray:rebuild

# 已弃用，请使用 tray
menu-bar:
	@echo "[WARN] 'make menu-bar' 已弃用，请使用 'make tray'"
	@cd companion && npm run tray

# ── macOS ──

# macOS 一键安装（构建 + Swift 托盘 + 守护进程 + 菜单栏）
install-macos: build build-tray
	@echo "Installing CMspark macOS daemon..."
	@cd companion && ./scripts/install-daemon.sh daemon-only
	@cd companion && ./scripts/install-daemon.sh menubar-only
	@echo "CMspark macOS 安装完成"

# macOS 安装后台守护进程
install-macos-daemon:
	@echo "Installing CMspark macOS daemon..."
	@cd companion && ./scripts/install-daemon.sh daemon-only

# macOS 安装菜单栏启动器
install-macos-menubar:
	@echo "Installing CMspark macOS menubar..."
	@cd companion && ./scripts/install-daemon.sh menubar-only

uninstall-macos:
	@echo "Uninstalling CMspark macOS..."
	@cd companion && ./scripts/uninstall-daemon.sh

# 查看守护进程状态
daemon-status:
	@cd companion && npm run daemon:status

# ── Linux ──

install-linux: build
	@echo "Installing CMspark Linux daemon..."
	@cd companion && ./scripts/install-daemon.sh

uninstall-linux:
	@echo "Uninstalling CMspark Linux daemon..."
	@cd companion && ./scripts/uninstall-daemon.sh

# ── Windows ──

install-windows: build
	@echo "Installing CMspark Windows daemon..."
	@powershell -ExecutionPolicy Bypass -File scripts/install-daemon.ps1

uninstall-windows:
	@echo "Uninstalling CMspark Windows daemon..."
	@powershell -ExecutionPolicy Bypass -File scripts/uninstall-daemon.ps1

# ── 打包 ──

# 打包当前平台
package: build
	@bash scripts/package.sh

# 打包 macOS ARM64（含 Swift 托盘 + DMG 安装包）
package-macos: build build-tray
	@bash scripts/package.sh macos-arm64
	@echo "Building macOS DMG installer..."
	@bash scripts/create-dmg.sh
	@echo "Done: dist-package/CMspark-v*-macOS.dmg"

# 打包 Windows x64（产出 NSIS 安装包）
package-windows: build
	@bash scripts/package.sh windows-x64
	@echo "Building NSIS installer..."
	@makensis scripts/installer.nsi
	@echo "Done: dist-package/CMspark-Setup-v*.exe"

# 打包 Linux x64
package-linux: build
	@bash scripts/package.sh linux-x64
