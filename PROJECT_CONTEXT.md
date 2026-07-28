# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-28 (session-end S19 — full wrap)
- **HEAD**：`821acf4` on `origin/main`（clean）
- **用户验收**：Windows `host_computer` estop preflight **成功**
- **本会话交付摘要**：
  - Native HUD P3a Task 1–6 源码（Swift SHA256 rebuild / Task 7 双评仍 pending）
  - BottomBar「更多」fixed；skills 非数组守卫
  - Enterprise A+B（session trust + `auto_approve_enterprise_tools`）
  - Win estop：tombstone（`96548e1`）+ **no detached spawn**（`7c7611b`）+ SEA 热覆盖部署
- **运行中**：`dist-package-new\cmspark-windows-x64\cmspark-agent.exe` + `host-scripts-win/`
- **下次**：
  1. macOS `build-tray.sh` → `SWIFT_TRAY_SHA256` → HUD Task 7 ship note + 实现双评
  2. 可选：无 debug.log 锁时全量 Windows package；P0-D hard-gates
- **勿做**：Task 7 前 dual-track 截图；estop 改回 `detached:true`；hash mismatch 自动 rebuild tray

### 2026-07-27 (S18 — Native HUD P3a Task 1–6 source)
- Task 1–6 源码；Swift 未 rebuild SHA256；Task 7 未做。plan：`docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`
<!-- handoff:end -->
