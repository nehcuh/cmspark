# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-27 (session-end S17 — UI 三模 + Native HUD P3 grill + P3a spike plan Task 0)
- **UI**：Side Panel 三模 P0–P2 + R1–R4 + S1 已在 main（content-split / ContextStrip / tokens / meta slash）。
- **Native HUD 产品锁 N1–N10**（Claude+Pi grill）：`docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
  - 一 Swift binary=tray+HUD；`shell.standby`；N3 心跳 3s / ping 400ms；N5 wire 仍为 `unknown` + broadcast NEW；关窗≠停任务；macOS first。
- **P3a spike plan**（Task 0 双评过，nits 已折入）：`docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`
  - 范围：open/hydrate/一 confirm RT/abort/standby stub；**无** dual-track 截图。
  - Wire：`server.ts` 拥有 manager + `onTerminal`；spike fan-out 仅 HUD+tray。
- **HEAD**：`eb8a2cf` on `origin/main` — `docs(p3a): Native HUD spike plan + Task 0 dual-review gate`
- **下次他机**：
  1. `git pull origin main`
  2. 从 plan **Task 1** 起实现（protocol → router → onTerminal → Swift HUD → bridge → `CMSPARK_HUD_SPIKE=1`）
  3. Task 7 实现双评通过后再碰截图路径
- **勿做**：默认把用户 shell 切到 native；改 wire 为 `already_resolved`；hash mismatch 自动 rebuild tray

### 2026-07-26 (session-end S16 — computer-use 点击真生效 + Mail 最新信)
- 用户验收点击真生效；SkyLight+HID 双投递；Mail 按 date 取最新；session-trust 默认勾选。
- 下次可选：`make package-macos` 正式重打 DMG；收紧 click `verified` 假阳性。
<!-- handoff:end -->
