.PHONY: dev install test build clean load-extension

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

# 打包分发版本 (Windows 用户用)
# 用法: make package  (需要先安装 bun: npm i -g bun)
package: build
	@echo "Building distribution package..."
	@mkdir -p dist-package/cmspark
	@cp -r chrome-extension/build/chrome-mv3-prod dist-package/cmspark/chrome-extension 2>/dev/null || true
	@cp companion/install.bat dist-package/cmspark/ 2>/dev/null || true
	@cp companion/uninstall.bat dist-package/cmspark/ 2>/dev/null || true
	@cp companion/README.txt dist-package/cmspark/ 2>/dev/null || true
	@echo "Companion executable: 需要 Windows 环境编译"
	@echo "  方案1: bun build ./companion/dist/index.js --compile --outfile dist-package/cmspark/cmspark-agent.exe"
	@echo "  方案2: npx pkg companion/dist/index.js --targets node20-win-x64 --output dist-package/cmspark/cmspark-agent.exe"
	@echo "  方案3: ncc build companion/dist/index.js -o dist-package/cmspark/companion-bundle"
	@echo ""
	@echo "Manual steps:"
	@echo "  1. Build companion executable on Windows (see above)"
	@echo "  2. Copy cmspark-agent.exe to dist-package/cmspark/"
	@echo "  3. Zip dist-package/cmspark/ → cmspark-v0.1.0.zip"
