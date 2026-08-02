# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-02 ~14:54 (S34 — Trust IA / 运行自主度)
- **产品**：权限入口混乱 + God-mode 过卖 → Hybrid 锁定
  - **协议解锁** = `allow_all_schemes`（非全开）
  - **运行自主度** = 双写 `auto_approve_dangerous` / enterprise / protocol；后果矩阵 + 短语
  - **否决** God 静默跳过 shell/CU/spawn
- **流程**：四路对抗 → SoT/plan → Pi+Claude APPROVE_WITH_NITS → P0+P1 实现
- **代码**：`SettingsSlideout` · `autopilot-tier.ts` · StatusRail 巡航徽章；**未改** `server.ts` skip
- **文档**：spec/plan + audit reviews `trust-ia-autopilot-*`；confirm-center / mission-pack / ADR-010 脚注
- **经验**：`memory/project-knowledge.md` Architecture + Reusable Patterns
- **下次**：
  1. Side Panel 真机武装/解除 smoke
  2. 可选实现 dual-review + PR 合 main
  3. P2：会话作用域 / TTL / spawn 预算 / 桌面巡航（需新 ADR 门）

### 2026-08-02 ~14:22 (S33 — #105 merge + vision 405 + Qwen test guide)
- main tip `6f3a210` PR #105：host_cli + Qwen P0/env UX
- vision 405：智谱 base_url 须 `/api/paas/v4`；本地 Qwen ≠ analyze_image
- 下次：CU 白名单 App 测 experimental；智谱余额 / Developer ID
<!-- handoff:end -->
