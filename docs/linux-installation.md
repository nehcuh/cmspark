# Linux 安装与桌面启动

GitHub: #833 / PR #834

提供 x86_64（DEB amd64 / RPM x86_64）和 ARM64（DEB arm64 / RPM aarch64）安装包。
从 `Build installers` 的对应 Linux artifact 下载，选择与机器架构一致的文件；
Chrome 扩展另在 `cmspark-chrome-extension` artifact 中提供。

## 安装和使用

Debian / Ubuntu：`sudo apt install ./cmspark_1.0.1-1_amd64.deb`。
Fedora / Red Hat 系：`sudo dnf install ./cmspark-1.0.1-1.x86_64.rpm`。
ARM64 分别选用文件名带 `arm64` 和 `aarch64` 的安装包。

安装后在桌面环境的应用菜单中搜索 **CMspark**，点击图标启动 Companion 和托盘。
桌面入口位于 `/usr/share/applications/cmspark.desktop`，图标使用标准 hicolor 路径。
不会向各用户的 Desktop 文件夹强行复制快捷方式；可用桌面环境的“添加到桌面/收藏”功能固定图标。
桌面会话须提供 systemd 用户服务及 GTK/AppIndicator 托盘支持；GNOME 需启用 AppIndicator 支持。
包管理器按包依赖安装托盘所需的 GTK、AppIndicator 和剪贴板工具。

将独立扩展 ZIP 解压到长期保留的目录，打开 `chrome://extensions`，开启开发者模式，
点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
从托盘菜单打开 Chrome、复制配对码，在扩展中完成配对并操作。
Linux 本次交付托盘和 Chrome 扩展，不包含 Windows/macOS 的独立原生工作台窗口。

如果托盘未出现，先查看 `journalctl --user -u cmspark-tray -u cmspark-companion`。
卸载使用 `sudo apt remove cmspark` 或 `sudo dnf remove cmspark`；用户数据保存在 `~/.cmspark-agent`。

## 构建和验证

`make package-linux-deb` / `make package-linux-rpm` 构建 x86_64；
`make package-linux-deb-arm64` / `make package-linux-rpm-arm64` 在原生 ARM64 Linux 构建。
ARM64 构建额外需要 Go、GCC、pkg-config 和 `libappindicator3-dev`。

x64 托盘保留 systray2 2.1.4 原包及其现有 SHA256 核验。
ARM64 使用同一协议的上游 [systray-portable](https://github.com/felixhao28/systray-portable/tree/6eddc917bf39fcc0d95b57a0741d0c065fbd1e23)
固定提交 `6eddc917bf39fcc0d95b57a0741d0c065fbd1e23` 原生编译，源码压缩包先核 SHA256，
Go 模块按上游 go.mod/go.sum 下载并验证。来源记录和许可证随包分发，不改 npm 原包的校验清单。
ZIP、DEB、RPM 均检查 Node 和托盘的 ELF 架构；CI 在各原生架构上运行托盘的菜单、更新和退出协议。
原生协议通过不等于所有发行版及桌面环境已完成真人点击认证。
