# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-02 ~16:43 (S35 — Trust IA + 无人值守 #106 合 main)
- **main tip**：`ed92a81` — PR **#106** squash：运行自主度/协议解锁 + ADR-021 无人值守桌面值守
- **能力**：设置「无人值守」武装后，`coordinateAllowed` App 上 `host_computer` 可跳过 **initial** L2（8h 进程 grant）；顶栏「值守中 · 桌面」；危险 re-L2 仍确认
- **流程**：M0–M3 对抗/双审门控；M2 曾因 sidepanel 初始同步测未更新被 REJECT 后修复
- **仓库**：本地仅 `main`；与 origin 一致
- **下次**：
  1. 真机微信清单 `docs/superpowers/plans/2026-08-02-unattended-desktop-manual-checklist.md`
  2. 需要分发则 `make package-macos` 重装 `/Applications`
  3. 可选：Developer ID / CU experimental smoke / 清理未跟踪 patch

### 2026-08-02 ~14:54 (S34 — Trust IA 设计与 P0+P1)
- Hybrid：协议解锁 ≠ 全开；运行自主度 dual-write 三 bool
- 后并入 #106；桌面免确认由 ADR-021 承接
<!-- handoff:end -->
