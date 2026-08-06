# Pi re-review — S51 P0 fix implementation

You previously REJECTED S51 findings (Trust trash cookie double-restore + mid_loop M2 request strip).

Inspect the **fix branch** code and confirm the two blockers are closed.

## Working directory
`C:\Users\HuChen\Projects\cmspark` branch `fix/s51-trust-trash-m2-midloop`

## Changes to verify

### C1 Trust cookie
- `companion/src/packs/pack-engine.ts` — `releaseTrustBeforeThreadGone` now clears cookie after restore (optional `threadManager.update`); new `clearTrustCookieWithoutRestore` for purge leftovers
- `companion/src/message-router.ts` — all release callers pass `threadManager`; trash list clears leftover cookies without re-restore before TTL purge; single hard-delete broadcasts
- Tests: `packs-engine.test.ts` S51 P0 trash→Settings→hard-delete; trash A then B then hard-delete A

### C2 mid_loop M2
- `companion/src/llm/adapter.ts` — mid_loop re-attaches `keepSummary` via `attachRollingSummaryToMessages` when mode stayed m1
- Test: `context-budget.test.ts` two-pass re-attach

### Nit
- `chrome-extension/src/tabs/voice-permission.tsx` — Windows/macOS/generic OS hint

## Method
1. Read the live functions (file:line). Do not rubber-stamp.
2. Confirm trash→settings flip→hard-delete cannot re-restore.
3. Confirm mid_loop request keeps `[context_summary]` when prior M2 summary exists.
4. Note residual non-blocking nits only.

## Output
List any remaining **blocking** issues with file:line, then end with exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
