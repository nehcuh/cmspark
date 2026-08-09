# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S57 — Windows Python discovery · #157+#156 合 main · memory 已推远程)
- **Main tip**: `c11a7e9` = `origin/main`（功能合入 tip `2c84a5e` + session-end memory）
- **远程已含**: session.md S57 END · project-knowledge pitfalls · instincts · PROJECT_CONTEXT · `memory/overview.md` 现状快照
- **产品锁**: Scheme D `findPythonBase`；Store fail-closed；≥3.10；绝对 pin；winget hint；`basePythonAvailable`
- **验证**: unit 45/45；本机 isolated+uv；SEA + 侧栏 `computer.model.state` PASS
- **Merged**: **#157** Python discovery · **#156** MCP filesystem@home
- **Stash (local only)**: `stash@{0}` Whisper 打包/README/DLL stage 等 WIP — **未**推远程
- **Next**: 可选 pop stash → Whisper 旁路打包 PR；开放 PR 无
- **Pitfalls**: base Python ≠ findUv；pi CLI 偏题用协议 agent；worktree 干净开 PR


### 2026-08-08 (S56 — Windows 本机听写诊断 + 打包/下载 UX)
- **诊断**: 听写三层（权重 / cmspark-whisper / 麦）；`binary_missing` = 包内无 `bin/cmspark-whisper-win-x64.exe`
- **打包**: SEA **旁路** `bin\`；先放 whisper 再 `build-package.bat`
- **Next**: 与 S57 stash 中 Whisper stage 可合并跟进
<!-- handoff:end -->

