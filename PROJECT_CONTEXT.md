# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-08 (S56 — Windows 本机听写诊断 + 打包/下载 UX)
- **Branch**: `main`（本会话改动待 commit：voice 下载反馈、binary 搜索、build-windows-exe stage whisper）
- **诊断**：下载静默 ≠ 缺系统 whisper-cpp；`binary_missing` = 包内无 `bin/cmspark-whisper-win-x64.exe`；PATH `whisper-cli` 可 dev 回落；getUserMedia NotFound = 系统麦
- **打包**：`build-package.bat` → SEA **旁路** `bin\`；先放 `companion\dist\bin\cmspark-whisper-win-x64.exe` 再打包
- **Next**：用户准备 win-x64 whisper 二进制后重打包或 PATH 安装 whisper-cli；重载扩展 + 重启 Companion 验收下载 UI 与本机组件
- **Pitfalls**：三层（权重 / cmspark-whisper / 麦）；SEA 勿嵌原生 CLI

### 2026-08-08 (S55 — 听写 UX · Whisper M2 · 0.5.0 · DMG · #310)
- **Main tip**: `91c0b1c` — **#154** React #310；0.5.0 ship
- **Next**：真机 §4 听写/会议；host-integrity 打包脏改勿塞功能 PR
<!-- handoff:end -->
