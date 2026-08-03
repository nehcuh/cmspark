# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-03 (S39 — PR 收口 + Anthropic P1)
- **PR 收口**: #112 closed (already on main)；#111 cookie trust 文案 MERGED；#110 shell_exec card MERGED
- **Anthropic P1 PR #113 OPEN**: https://github.com/nehcuh/cmspark/pull/113 · `feat/llm-anthropic-p1-ui-probe` @ `bed0cf0`
  - Side Panel + settings-web：API 协议选择 + Coding Plan 网关兼容头 + 快速配置 chips
  - `probeLlmConnection`：openai chat/completions + anthropic /messages；L7 拒发；WS config.test + /api/test
  - skill-craft / skill-engine → createProvider / llmExtract
  - extra_headers 广播脱敏
- **测试**: companion 相关 69 pass；extension sidepanel-state 15 pass
- **下次**: 合 #113；真机 Coding Plan 中继 smoke（可选）；S36 residual unattended honesty

### 2026-08-03 ~17:44 (S38 — Anthropic LLM protocol P0)
- P0 on main `5d9986b`；ship note under docs/audit/reviews/
<!-- handoff:end -->
