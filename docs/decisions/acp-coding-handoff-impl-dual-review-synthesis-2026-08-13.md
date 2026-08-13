# Dual-review synthesis: 编程接力 implementation

**Date:** 2026-08-13  
**Branch:** `feat/coding-handoff` (worktree `.worktrees/feat-coding-handoff`)

| Reviewer | Round | Verdict | Artifact |
|----------|-------|---------|----------|
| Claude | R1 | **APPROVE_WITH_NITS** | `docs/audit/reviews/acp-coding-handoff-impl-claude-20260813-091007.md` |
| Pi | R1 | **REJECT** (B1 HITL bypass) | `…-pi-20260813-092100.md` |
| Implementer | Fix | B1 + nits folded | commits after Claude review |
| Pi | R2 | (pending / re-run) | `acp-coding-handoff-impl-r2-*` |

## Blocker fixed (Pi B1)

`acp_propose_session` / `acp_start_session` were in `L2_GATE_TOOLS` but **not** in `capabilityForceConfirm`, so `auto_approve_dangerous` / god-mode / three-flag cruise could auto-issue tokens without dialog.

**Fix:** `acpForceConfirm` always sets `forceConfirm=true` (never waived by full autonomy cruise). Plus non-empty `bindingPayloadFor`, sanitize always `review_readonly`.

## Nits folded

- L2 preview strings for ACP
- Prompt file in `os.tmpdir()`
- Cancel optimistically closes session
- Terminal CTA = copy-only label
- meta-slash brace nesting
- Token binding agent|goal|session

## Ship

| Phase | Status |
|-------|--------|
| A 任务包 | **Ship** on branch |
| B ACP default-off | **Ship** after B1 fix |
| C/D apply | **Not implemented** (NO-GO) |
