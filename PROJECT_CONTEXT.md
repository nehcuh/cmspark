# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-31 (S25 — UIUX breath 合 main + 场景 UX PR #93)
- **main tip（已合）**：`6a6ed73` UIUX v2 Quiet Agent Shell + Gemini breath G1–G4（#92 squash）
- **本会话交付**：
  - 产品：任务包→**场景**；对抗设计 + Claude/Pi dual-review SoT `docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md`
  - **PR #93** `feat/scene-ux-p0`（未合）：unapply、confirm-on-apply、状态条、recoverable whitelist、`user_gesture`、清除工作区、NetSec **迁设置**、Skills 安装指引、设置「三道门」
  - 本地：`make package-macos` → `dist-package/CMspark-v0.3.0-macOS.dmg`；已删 `/Applications/CMspark.app`（用户可重装）
- **用户验收路径**：重载扩展+Companion → 线程 r21pj2 点「退出场景」→ Skills 导入 ZIP 装技能
- **下次**：
  1. **Merge #93**（CI 绿）
  2. 可选：对话错误条一键 unapply；NetSec 企业文案再收紧
  3. 勿把 god-mode 当成场景白名单绕过
- **分支**：`feat/scene-ux-p0` tip `516d97b`（NetSec 迁设置）

### 2026-07-31 (S24 — VibeSOP Sprint1 dogfood 落地)
- vibesop reinstall + claude-code/grok-build hooks；`vibe instinct` pending/dismiss 路径 dogfood
- 下次：观察 accept/dismiss 密度；勿用 probe 污染 production 路由
<!-- handoff:end -->
