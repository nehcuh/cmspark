# Dual external review R2: shell-abort-timeout — CI tsc fix

**Batch:** `shell-abort-timeout-r2`  
**Stage:** Confirmation after R1 REJECT  
**Date:** 2026-08-06  

## Prior verdicts (R1)

| Reviewer | Verdict | Blocking |
|----------|---------|----------|
| Claude | **REJECT** | `assert.doesNotMatch` breaks `chrome-extension` `tsc -p tsconfig.test.json` → `npm test` |
| Pi | **REJECT** | Same |

Artifacts:
- `docs/audit/reviews/shell-abort-timeout-claude-20260806-192609.md`
- `docs/audit/reviews/shell-abort-timeout-pi-20260806-192609.md`
- `docs/audit/reviews/shell-abort-timeout-verdict-20260806-192609.json`

## Capability declaration (unchanged)

```text
Surface:      L2 (enterprise shell_exec lifecycle only)
L2-classes:   shell
Compose:      none
Autonomy:     single
Trust:        L2 security_token unchanged; abort is safe direction
Channel:      enterprise
```

## Your job — verify R1 blocking fix only (+ scan for new regressions)

### B1 — extension test tsc gate (both Claude + Pi)

**Claimed fix:**
- Replaced `assert.doesNotMatch(...)` with `assert.ok(!/超时/.test(meta), ...)`
- File: `chrome-extension/tests/shell-card-utils.test.ts`
- Does **not** require extending `node-shims.d.ts` (shim still lacks `doesNotMatch`)

**Verify by execution:**
```bash
cd chrome-extension && npx tsc -p tsconfig.test.json --noEmit
# must exit 0
cd chrome-extension && npm test -- --test-name-pattern shell-card
# or: npx tsx --test tests/shell-card-utils.test.ts
```

Confirm the aborted meta still asserts:
- `card.aborted === true`
- meta matches `/已停止/`
- meta does **not** contain `超时`

### Scope discipline

- Do **not** re-litigate R1 nits (win32 taskkill await, registry microtask gap, missing WS integration test) unless they become blocking under new evidence.
- REJECT only if B1 is unfixed **or** a new CI/security regression was introduced by the one-line fix.

## Required verdict shape

End with exactly one of:
VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  
