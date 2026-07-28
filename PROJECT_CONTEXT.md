# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-28 ~17:06 (S20 — docs reorg Phase1–4 → PR #80)
- **HEAD**：`074f483` on `origin/main`（docs reorg merge）；本地另有 **未提交** site-knowledge hostname WIP
- **本会话交付**：
  - Fanout 体检 + `docs/docs-reorg-plan-2026-07-28.md`
  - Phase1–4：README 能力矩阵、`docs/README.md`、四用户指南、ADR-017/018、`docs/archive/2026-07/`
  - Dual-review p1/p2/p4 both approve；p3 Pi + adversarial 收口（Claude 429）
  - **PR #80 已合 main**
- **关键入口**：`docs/README.md` · `docs/audit/reviews/docs-reorg-phase1-4-final-report.md`
- **下次**：
  1. site-knowledge hostname 单独 PR（勿混 docs）
  2. HUD Task 7：macOS `build-tray.sh` → SHA256 → 实现双评
  3. 可选：Claude 额度后补 p3 内容审
- **勿做**：把 site-knowledge 代码塞进 docs commit；归档时动 decision 锁路径

### 2026-07-28 (S19 — HUD / enterprise / Win estop wrap)
- HEAD 曾为 `821acf4`；Win estop 用户验收；HUD Task 1–6 源码、Task 7 仍 pending
- 下次仍以 macOS tray rebuild + Task 7 双评为主路径（见 in-flight P3a）
<!-- handoff:end -->
