# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S57 — Windows Python discovery · #157+#156 合 main)
- **Main tip**: `2c84a5e` = `origin/main`（**#157** Python discovery cascade + **#156** MCP filesystem@home）
- **产品锁**: Scheme D `findPythonBase`（config→isolated→well-known→manager seed→PATH/py）；Store fail-closed；≥3.10；绝对 pin；`pythonInstallHint` winget；`basePythonAvailable` CTA
- **验证**: unit 45/45；本机 isolated+uv；SEA 重打包 + 侧栏可见 `computer.model.state` PASS
- **Stash**: `stash@{0}` wip-pre-main-sync — Whisper 打包/README/DLL stage 等（**未**合 PR）；需要时 `git stash show -p`
- **Next**: 可选 pop stash 做 Whisper 旁路打包 PR；开放 PR 当前无
- **Pitfalls**: base Python ≠ findUv；host pi CLI 偏题用协议 agent；跨功能用 worktree 干净分支

### 2026-08-08 (S56 — Windows 本机听写诊断 + 打包/下载 UX)
- **诊断**: 听写三层（权重 / cmspark-whisper / 麦）；`binary_missing` = 包内无 `bin/cmspark-whisper-win-x64.exe`
- **打包**: SEA **旁路** `bin\`；先放 whisper 再 `build-package.bat`
- **Next**: 与 S57 stash 中 Whisper stage 可合并跟进
<!-- handoff:end -->

