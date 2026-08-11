# Dual external review — C10 Phase B (L2 admission extract)

## Scope
Branch `fix/c10-godfile-split-a` commit `b2e32b0` (on top of C10 Phase A + #162 multi-adv).

### Change
Extract L2 security admission from `createToolExecutor` → `companion/src/tool/l2-admission.ts`:
- `runL2ToolAdmission(ctx)`
- `L2_GATE_TOOLS`, `isFullAutonomyCruise`, platform gated helpers
- server.ts: 5004 → 3640 (−1364); L2 algebra body moved, not rewritten

**Not moved:** URL_GATE, cookie gate, multi-agent tab lease, MCP/extension dispatch.

## Verify (must inspect code)
1. forceConfirm / three-flag / unattended / G1 / enterpriseSkip algebra **unchanged** (diff body vs prior if possible).
2. security_token strip still happens before admission; issueTokenFor after approve.
3. winL2NonceChallenge + hostAppTier still reach executeCompanionTool.
4. No circular import server↔l2-admission (manager injected via ctx).
5. security-gates integration still green (63).
6. Pure helpers match three-flag definition.

REJECT only on security/behavior regression. Prefer APPROVE if pure move.

Final line one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
