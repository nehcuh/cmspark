# Dual external review — multi-adv deep Wave 0–2

## Context
Independent multi-adversarial review (`multi-adversarial-project-deep-20260810.md`) found REQUEST_CHANGES on tip `5c64604`. This branch implements Wave 0 (honesty), Wave 1 (security residuals), Wave 2 (structure pragmatism).

**Branch:** `fix/multi-adv-deep-wave012`  
**Base:** `origin/main` @ `5c64604`  
**Commits:** f8ce33a (W0), dbd3999 (W1), 4ea1758 (W2)  
**Impl summary:** `docs/audit/reviews/multi-adv-deep-impl-summary-20260810.md`

## Must verify each finding (code, not rubber-stamp)

| ID | Expected fix |
|----|----------------|
| C1 | Pre-arm cruise snapshot; disarm + TTL always restore dual-write flags |
| C2 | Estop while armed → 「任务已停 · 值守仍开 · 点解除」 |
| C3 | Cockpit empty desk permanent 值守 banner |
| C4 | Matrix: navigate may skip; evaluate still confirms under default 值守 |
| C5 | Pack Trust cruise write requires confirmation_phrase server-side |
| C6 | Worker HARD_DENY in isToolAllowed; thread.update cannot elevate |
| C7 | normalizeShellCwd before issueToken and execute; preview shows cwd |
| C8 | normalizeNetsecPorts before bind and execute |
| C9 | ws-router-validator-lockstep test router ⊆ validators |
| C10 | FREEZE comments only — full god split DEFERRED is OK if documented |
| C11 | surface-by-tool drives mode-controller |
| C12 | No force_confirm \|\| Array.isArray false-green |
| C13–C15 | SUPERSEDED banners; mcp require_grant true; CU AppsPanel path |
| C16 | Residual honesty in ADR-021 |

## Review rules
1. Read real files under this repo worktree. Use tools.
2. Look for incomplete fixes, security regressions, missing tests, wrong algebra.
3. Apply ADR-020 checklist when relevant.
4. REJECT if any of C1,C5,C6,C7,C8 incomplete or bypassable.
5. APPROVE_WITH_NITS for non-blocking nits only.
6. Final line MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

## Capability declaration (implementer)
- Surface: L2 honesty + shell/netsec bind + worker isolation (no new L2 tools)
- Composition: Pack Trust phrase gate only
- Autonomy: unattended dual-write lifecycle only
- Trust: restore cruise on disarm/TTL; pack phrase step-up
- Channel: Side Panel + Companion only
