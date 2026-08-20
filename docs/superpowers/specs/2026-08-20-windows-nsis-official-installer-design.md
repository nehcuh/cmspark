# Windows 官方 NSIS 安装器（Release 发 Setup.exe）

**日期**: 2026-08-20  
**状态**: **LOCKED**（三路对抗 A/B/C 均 REJECT → 吸收 P0/P1 后实现）  
**合成**: `docs/audit/reviews/windows-nsis-official-adversary-synthesis-20260820.md`  
**Blast tier**: **T2**（分发形态；不改运行时 Surface / L2 / Trust 门）  
**触发**: 用户要 Windows「类似 MSI 的安装包」；确认目标 **A**（普通用户双击安装，官方 Release 发安装器），方案 **1**（NSIS 包 `package.sh` staging，CI 失败即停）

**前序**:

- README「Windows 产物 Source of Truth」：GitHub Release 默认是 `scripts/package.sh windows-x64` 的 zip，**不是** SEA
- 已有 `scripts/installer.nsi`（per-user `%LOCALAPPDATA%\CMspark`），仅由本机 `build-windows-exe.ps1` 在找到 `makensis` 时可选生成，**不进 CI / Release**
- macOS 本地有 DMG（`create-dmg.sh`），GitHub Release 目前三平台都只发 zip

---

## 0. 能力声明（ADR-020）

```text
Surface:      n/a — 分发包装，不新增工具 / 确认门 / 一级 UI
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        单调 — 不新增 auto-approve、不改 confirm、不写 HKLM
Channel:      community
```

安装器只把**已经过 package.sh 门禁的同一份文件**拷到用户目录并写 HKCU 快捷方式 / 卸载项。不扩大 Companion 运行时权限。

---

## 1. 用户可观察 DoD

| # | 用户可观察 | 今日 | 本轮后 |
|---|------------|------|--------|
| D1 | GitHub Release 下载 Windows 安装器 | 只有 `cmspark-v*-windows-x64.zip` | 另有 `CMspark-Setup-v{version}.exe` |
| D2 | 双击安装器 | 无官方路径 | 向导：欢迎 → 目录（默认 `%LOCALAPPDATA%\CMspark`）→ 开始菜单 → 复制文件 → 完成页可「立即启动托盘」 |
| D3 | 开始菜单 / 桌面 / 开机自启 | zip 需手跑 `install-daemon.ps1` | 安装器写入 HKCU Run + 桌面/开始菜单/Startup 快捷方式（现有 nsi 行为，保持） |
| D4 | 「应用和功能」卸载 | 无 | `uninstall.exe` + HKCU Uninstall 键（现有 nsi） |
| D5 | zip 是否还在 | 官方唯一产物 | **仍发**；内容与安装器内文件相同（同一 staging） |
| D6 | 未装 NSIS 的 CI 是否默默只发 zip | 今日即如此 | **Windows Release job 失败**（`CMSPARK_REQUIRE_NSIS=1`） |
| D7 | SmartScreen | Release 无官方 `.exe` | **新增**未签名 `CMspark-Setup-v*.exe`，SmartScreen / Smart App Control **会警告**（REL-1 Authenticode 不在本轮）；Release notes 必须写明 |

**非目标（本轮硬否决）**:

- MSI / MSIX / WiX / Intune / `msiexec`
- Authenticode 签名
- 中文向导页
- 把官方 payload 改成 SEA `cmspark-agent.exe`
- 从 Release 去掉 zip
- 把 macOS DMG 塞进 GitHub Release（不对称范围）
- 改 Chrome 扩展加载方式（完成页仍指引 `chrome://extensions` 加载包内 `chrome-extension/`）

---

## 2. 载荷锁（SoT）

官方安装器 **只**包装 `scripts/package.sh windows-x64` 的 staging：

```text
dist-package/cmspark-windows-x64/
  node.exe                  # 经 nodejs.org SHASUMS 校验
  cmspark-agent.js          # esbuild bundle
  chrome-extension/
  launch-hidden.vbs         # 优先 SEA，否则 node.exe + js
  host-scripts-win/*.ps1
  qwen-vl-worker.py
  …
```

**禁止**用 `build-windows-exe.ps1` 的 SEA 树当官方 `CMspark-Setup-v*.exe` 的输入。理由：

1. README / CI 已钉 `package.sh` 为 Release SoT
2. `installer.nsi` 卸载已调用 `"$INSTDIR\node.exe" "$INSTDIR\cmspark-agent.js" daemon stop`
3. `launch-hidden.vbs` 在无 SEA 时走 node.exe + js（Priority 2）

`build-windows-exe.ps1` 可继续本地打 SEA zip / exe；**删除**其 `makensis` 调用（禁止 SkipNsis 或条款留下第二生产者）。官方 `CMspark-Setup-v*.exe` **只**由 `build-windows-installer.sh` 写出。

---

## 3. 生产者与失败语义

### 3.1 单生产者

新增 `scripts/build-windows-installer.sh`（macOS/Linux/Windows Git Bash 均可调用，只要有 `makensis`）：

1. 读 `companion/package.json` version
2. 断言 staging 存在且含 `node.exe`、`cmspark-agent.js`、`launch-hidden.vbs`、`chrome-extension/`；**若存在 `cmspark-agent.exe` 则失败**（禁止 SEA 混树；VBS Priority 1 会启动残留 SEA）
3. `MSYS_NO_PATHCONV=1 makensis -DPRODUCT_VERSION={version} scripts/installer.nsi`（**禁止** bash argv `/D…`，Git Bash 会当成路径）
4. 断言 `dist-package/CMspark-Setup-v{version}.exe` 存在且 size > 0
5. 探测 `makensis`：`PATH`、`CMSPARK_MAKENSIS`、`/c/Program Files (x86)/NSIS/makensis.exe`、`/usr/bin/makensis`

`scripts/package.sh` 在 windows-x64 **zip 成功之后**调用该脚本。

### 3.2 `CMSPARK_REQUIRE_NSIS`

| 环境 | `makensis` 缺失或 nsi 失败 |
|------|---------------------------|
| `CMSPARK_REQUIRE_NSIS=1`（CI Windows job） | **exit 1** — 不得只发 zip |
| 未设置（本机 `package.sh` / `make package-windows`） | 打印警告并跳过安装器，zip 仍可用 |

### 3.3 CI

`.github/workflows/release.yml` Windows 矩阵：

1. 在 `package.sh` **之前**安装钉死版本的 NSIS（Chocolatey `nsis`，版本写进 workflow，禁止浮动 latest）
2. Package step：`CMSPARK_REQUIRE_NSIS=1` 仅 windows-x64
3. 断言 `dist-package/CMspark-Setup-v*.exe` 存在且非空
4. `upload-artifact` **两步**（禁止合成一个 `path:`）：  
   - `name: cmspark-${{ matrix.platform }}` → 仅 `dist-package/cmspark-*.zip`  
   - Windows only：`name: cmspark-windows-x64-setup` → **仅** `dist-package/CMspark-Setup-v*.exe` + `if-no-files-found: error`
5. release job flatten：`cmspark-*.zip` **和** `CMspark-Setup-v*.exe`（禁止指望 `cmspark-*.exe`）；`sha256sum` 两者；`files` 列出 zip + `CMspark-Setup-v*.exe` + SHA256；**`fail_on_unmatched_files: true`**
6. Release body 增加 Windows Setup.exe 行；SmartScreen 写「新增未签名安装器会警告」，不要写「不变」

### 3.4 Makefile

`make package-windows` 改为 `bash scripts/package.sh windows-x64`（与 CI SoT 对齐）。  
SEA 仍：`powershell -File scripts/build-windows-exe.ps1`。  
修正现注释「package-windows = SEA + 可选 NSIS」。

### 3.5 `installer.nsi`（对抗吸收后的最小产品修）

- `File /r "..\dist-package\cmspark-windows-x64\"`（不要 `*.*`，避免漏无扩展名文件）
- `RequestExecutionLevel user`、`InstallDir $LOCALAPPDATA\CMspark`、HKCU 保持（无 UAC）
- 版本由 `-DPRODUCT_VERSION=` 注入；fallback 必须等于 `companion/package.json`
- **StopInstalledAgent**（安装节开头 + 卸载节）：`daemon stop` + `taskkill /F /IM cmspark-agent.exe` + PowerShell 按 `ExecutablePath` 前缀结束 `$INSTDIR` 下进程（tray 不是 daemon.pid；禁止再依赖 wmic）
- 安装在 File 之前 `Delete "$INSTDIR\cmspark-agent.exe"`
- **只保留 HKCU Run 自启**；删除创建 `$SMSTARTUP` 快捷方式（卸载仍删遗留 lnk）
- 完成页 `chrome://extensions` 打不开：预存在，本轮不修

---

## 4. 测试与机核

`scripts/tests/test-package-gates.sh` 增静态断言（不在 macOS CI 真跑 makensis）：

1. `package.sh` 调用 `build-windows-installer.sh`
2. wrapper 含 `CMSPARK_REQUIRE_NSIS` 且缺 makensis 时非零退出
3. wrapper 断言 `node.exe` + `cmspark-agent.js`（防止 SEA 树混入）
4. `release.yml` Windows 安装钉版本 NSIS；windows-x64 设 `CMSPARK_REQUIRE_NSIS=1`
5. `release.yml` 上传 `CMspark-Setup-v*.exe`；SHA256SUMS 包含 exe
6. `Makefile` `package-windows` 走 `package.sh`，不再默认 `build-windows-exe.ps1`
7. `build-windows-exe.ps1` **`assert_file_lacks` `makensis`**（删除生产者，不是 SkipNsis）
8. `ci.yml` `bash -n scripts/build-windows-installer.sh`

本机有 `makensis` 时可手动：`CMSPARK_REQUIRE_NSIS=1 bash scripts/package.sh windows-x64` 作金样。不把「生成真 exe」当 PR 机核（macOS runner 无 NSIS）。

---

## 5. 文档

- README 打包表：Windows 官方 = zip **+** Setup.exe；SEA 仍「否 — 本地/进阶」
- 明确 Setup.exe 与 zip **同一份文件**，只是向导外壳
- NSIS 从「可选本机依赖」改为「CI 必装；本机可选」
- `docs/supply-chain.md` 若提到发布物，补一行 Setup.exe 与 REL-1 未签名（不新开签名项目）

---

## 6. 错误处理

| 失败 | 行为 |
|------|------|
| staging 缺 `node.exe` / `cmspark-agent.js` / 扩展 | wrapper exit 1，不调用 makensis |
| `makensis` 不在 PATH 且 REQUIRE=1 | exit 1，提示安装钉版本 NSIS |
| `makensis` 不在 PATH 且 REQUIRE 未设 | warn + skip |
| makensis 非零 | 无论是否 REQUIRE，exit 1（已开始打安装器就不得假装成功） |
| OutFile 缺失或 0 字节 | exit 1 |

---

## 7. 实现文件清单

| 文件 | 动作 |
|------|------|
| `scripts/build-windows-installer.sh` | **新增** |
| `scripts/package.sh` | zip 后调 wrapper |
| `scripts/installer.nsi` | StopInstalledAgent、单自启、完整树拷贝、删残留 SEA |
| `scripts/build-windows-exe.ps1` | **删除** makensis 段 |
| `Makefile` | `package-windows` → package.sh |
| `.github/workflows/release.yml` | NSIS 钉版本 + REQUIRE + 上传 exe + SHA256 + notes |
| `scripts/tests/test-package-gates.sh` | 上节断言 |
| `README.md` | SoT 表 |
| `docs/supply-chain.md` | 一行发布物（若该文件已列 zip） |

---

## 8. 确认序（本任务）

用户指定，覆盖默认「对抗 → Pi」：

1. **三路独立对抗**（实现前打设计 + 现有打包脚本；实现后打 diff）
2. **机核** `test-package-gates.sh` + 相关静态检查
3. **Claude + Kimi 双路复审**（`VERDICT`）；实现者不得自评放行

Blast T2：不得 auto-merge；双审均为 APPROVE* 后才宣称可开 PR。
