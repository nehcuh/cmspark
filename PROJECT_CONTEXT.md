# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-28 (session-end S19 — HUD 1–6 + enterprise A+B + Win package + estop)
- **HEAD**：`96548e1` on `origin/main`（synced）
- **已合本会话主线**：
  - Native HUD P3a Task 1–6 源码（protocol / router / onTerminal / Node bridge / Swift HudController / `CMSPARK_HUD_SPIKE=1`）
  - BottomBar「更多」fixed 菜单；skills 非数组守卫；enterprise A+B 全栈；Windows estop 死 PID tombstone 恢复
- **Enterprise A+B**（netsec/shell L2 体验）：
  - A = thread + family session trust（idle 30m / hard 8h，交互 grant）
  - B = `security.auto_approve_enterprise_tools`（phrase gate；pack-forbidden）
  - G1：`mustInteract = (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`
  - 文档：`docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`
- **Windows**：扩展须从最新 `dist-package`（或 `dist-package-new`）加载；companion 需重启以吃 `96548e1` estop fix
- **下次**：
  1. 重启 companion + 加载新扩展 → 验 A+B UI / SafetyStrip revoke
  2. macOS：`bash companion/src/tray/build-tray.sh` → 更新 `SWIFT_TRAY_SHA256` → HUD 真机 dual-process checklist → **Task 7** ship note + 实现双评
  3. 可选：P0-D package/release hard-gates
- **勿做**：Task 7 双评前 dual-track 截图洪水；hash mismatch 自动 rebuild tray；把 B 与 `auto_approve_dangerous` 混成一个开关

### 2026-07-27 (session-end S18 — Native HUD P3a Task 1–6 source)
- Task 1–6 源码完成；Swift 未 rebuild SHA256；Task 7 未做。
- 权威：N1–N10 lock + plan `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`
<!-- handoff:end -->
