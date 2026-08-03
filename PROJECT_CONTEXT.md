# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-03 ~17:44 (S38 — Anthropic LLM protocol P0)
- **PR #112 OPEN**: https://github.com/nehcuh/cmspark/pull/112 · branch `feat/llm-anthropic-protocol-p0` @ `5d9986b`
- **Landed**: `LlmProvider` (openai + anthropic Messages fetch/SSE)；L7 first-party header deny；config `protocol` / `client_header_profile`；fixture tests；no UI
- **SoT**: `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md` · ship note under `docs/audit/reviews/llm-anthropic-protocol-p0-ship-note-2026-08-03.md`
- **本地 main**: 含同一 commit（ahead origin 1）；未 push main
- **下次**:
  1. 审/合 **PR #112**
  2. P1：Settings/Side Panel 协议 + Coding Plan 兼容头 UI；连接测试协议感知
  3. skill-craft 等旁路 `new OpenAI` → `createProvider`
  4. S36 residual：unattended dual-write 诚实性 / ensure_python_env 事务 / 真机微信清单（若仍开）

### 2026-08-03 ~11:12 (S36 — pull + 四路对抗 #105–#107)
- **Verdict**：**REQUEST_CHANGES** — `docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md`
- **P0 residual**: unattended dual-write 诚实性；`ensure_python_env` 先写 isolated；平台文案
<!-- handoff:end -->
