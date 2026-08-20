# 三路独立对抗合成 — Windows 官方 NSIS 安装器

**日期**: 2026-08-20  
**对象**: spec `docs/superpowers/specs/2026-08-20-windows-nsis-official-installer-design.md` + 现有打包/CI  
**方法**: 三路独立 explore agent，互不读对方结论  
**本会话不得自评放行修复**

## 参与路

| 路 | 范围 | 裁决 |
|----|------|------|
| **A Supply-chain / CI** | glob、REQUIRE、MSYS `/D`、Chocolatey TCB、zip-only 绿发布 | **REJECT** |
| **B Installer contract** | 卸载停不掉 tray、双自启、升级锁文件、SEA 混树 | **REJECT** |
| **C SoT / docs / tests** | 同名 Setup.exe 两载荷、Makefile vs CI、gates 会撒谎 | **REJECT** |

### 合成裁决

**实现前 REJECT 成立。** 原 spec 把「不改 nsi 产品行为」和「§4.7 SkipNsis 或删」写成可选项，会让官方 Release 继续 zip-only，或发出与 zip 不同载荷的同名 `CMspark-Setup-v*.exe`。吸收下列 P0/P1 后实现。

## 吸收（必须进实现）

| ID | Sev | 来源 | 实现锁 |
|----|-----|------|--------|
| A1/A2/C2 | P0 | 上传/flatten/`files` 只有 `cmspark-*.zip`；`*.exe` 不匹配 `CMspark-Setup-v*`；无 `fail_on_unmatched_files` | Windows **第二** artifact `cmspark-windows-x64-setup`，path **仅** `dist-package/CMspark-Setup-v*.exe` + `if-no-files-found: error`；flatten 显式该名；SHA256 含 exe；gh-release `fail_on_unmatched_files: true` |
| A3 | P1 | 单 `path:` zip+exe 时缺 exe 仍绿 | 禁止合并成一步 |
| A4 | P1 | Git Bash 把 `/DPRODUCT_VERSION=` 当路径 | wrapper：`MSYS_NO_PATHCONV=1` + `-DPRODUCT_VERSION=`（禁止 bash argv `/D`） |
| A5/F4/C1 | P0 | 同 staging 名 + 同 OutFile；SEA 树混入；VBS 优先 exe | 官方 wrapper **禁止** staging 含 `cmspark-agent.exe`；**删除** ps1 的 `makensis`（无 SkipNsis 或条款）；安装前 `Delete cmspark-agent.exe` |
| A6 | P1 | choco 后 PATH 无 makensis | CI 把 `C:\Program Files (x86)\NSIS` 写入 `GITHUB_PATH`；wrapper 探测该绝对路径 |
| F1 | P0 | `daemon stop` 只杀 PID 文件；tray 是另一 `node.exe`；wmic 死 | nsi 安装/卸载调用 `StopInstalledAgent`：daemon stop + `taskkill cmspark-agent.exe` + PowerShell 按 `ExecutablePath` 前缀杀 `$INSTDIR` 下进程 |
| F2 | P1 | HKCU Run **和** Startup 文件夹双开 | 只保留 HKCU Run；卸载仍删遗留 Startup lnk |
| F3 | P1 | 升级不先停进程；File /r 不删 SEA 残留 | 安装节先 Stop + Delete leftover exe |
| A5 File *.* | P1 | NSIS `*.*` 可能漏无扩展名文件 | `File /r "...\cmspark-windows-x64\"` |
| C3/C4/C5 | P1 | README zip 大小写；gates 要求 ps1 打 NSIS；bat/nsi 注释 | README 官方 zip=`cmspark-v*`；gates 改为 wrapper + `assert_file_lacks ps1 makensis`；改 nsi/bat 注释 |
| C6 | P1 | Makefile 切换后本机无 makensis 以为出了 Setup | wrapper 明确 warn skip；Makefile echo 两种产物 |

## 降级 / 不本轮

| ID | 处理 |
|----|------|
| A7 Chocolatey 无 hash pin | P2：钉 `nsis --version=3.12.0` + `docs/supply-chain.md` 写明 NSIS 在 Setup.exe TCB；不 vendor makensis |
| A8 SmartScreen「不变」 | 文案改为「Release 新增未签名 .exe，SmartScreen 会警告」（REL-1 仍不做） |
| F5 用户改到 Program Files | P2：保持 per-user 默认 + 目录页 |
| F6 zip 内 install-daemon.ps1 脚枪 | P2：zip 用户仍需要；不从 staging 删除 |
| F7 whisper 可选 | 与 zip 相同，非安装器独有 |
| C7 版本 fallback | 已有 gate；wrapper 强制 `-D` |
| C8 dry-run 才第一次 flatten | 接受：`workflow_dispatch` 会跑 package+upload，tag 才 gh-release |

## 机核

实现后：`bash scripts/tests/test-package-gates.sh`（含新静态/动态负例）。实现者不得自评放行；完成后 Claude + Kimi 双审。
