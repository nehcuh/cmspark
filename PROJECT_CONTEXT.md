# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-28 (session-end S19+ — estop detached fix user-verified)
- **HEAD**：`7c7611b` on `origin/main`（synced after memory flush）
- **用户验收**：Windows `host_computer` estop preflight **成功**（fix `7c7611b` 已部署到 `dist-package-new` / `dist-package` SEA）
- **estop 两修**：
  1. `96548e1` — 死 PID `estop-ready.json` tombstone
  2. `7c7611b` — **禁止** `spawn({detached:true})` 起 `computer-estop.ps1`（会 exit 1、无 ready）
- **同会话已合（S19）**：HUD P3a Task 1–6 源码；BottomBar more；skills 守卫；enterprise A+B；Win package 路径
- **运行中**：`dist-package-new\cmspark-windows-x64\cmspark-agent.exe` + 旁置 `host-scripts-win/`
- **下次**：
  1. macOS：`build-tray.sh` → `SWIFT_TRAY_SHA256` → HUD Task 7 ship note + 实现双评
  2. 可选：无 debug.log 锁时全量 Windows package；P0-D hard-gates
- **勿做**：Task 7 前 dual-track 截图洪水；estop 再改回 detached:true；hash mismatch 自动 rebuild tray

### 2026-07-28 (earlier S19 — HUD + A+B + package)
- HUD 1–6、enterprise A+B、UI fixes、tombstone estop 已合 main；详见 session.md S19。
<!-- handoff:end -->
