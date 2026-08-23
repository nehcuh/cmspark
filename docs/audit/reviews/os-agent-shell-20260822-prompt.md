# External triple review — OS Agent Shell brief v2

You are an independent senior product+architecture reviewer for CMspark.

READ the files. Use tools. Do not rubber-stamp. Do not edit the repo.

## Capability declaration

```text
Surface:      L0 capture overlay (macOS, Chrome-absent same-thread chat); full L0/L1 = Side Panel; L2 = HUD/Cockpit
L2-classes:   none new
Compose:      Pack/Skill/MCP/Knowledge index only; no trust elevation from overlay
Autonomy:     single-thread; no auto-spawn
Trust:        same SHA256 tray binary; overlay is NOT a confirm writer; Chrome launch = real user-gesture UI RPC; BROWSER_* non-retryable
Channel:      community
```

## What to review

1. `docs/decisions/os-agent-shell-brief-2026-08-22.md` (**v2 post-adversary**)
2. `docs/audit/reviews/os-agent-shell-adversary-synthesis-20260822.md`
3. Cross-check claims against live code if the brief asserts facts:
   - `companion/src/ws/lifecycle.ts` (`pickAuthenticatedClientWs`, per-ws `createToolExecutor`)
   - `companion/src/ws/tool-forward.ts`
   - `companion/src/platform.ts` (`openSidePanel`)
   - HUD N1–N10: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
   - ADR-020, ADR-022 L8/L9

## Locked (do not re-litigate)

- Owner wants Chrome-optional same-thread L0 from OS (not a Raycast clone, not Electron).
- Four internal lanes independently REJECTED v1. v2 folded those BLOCKs.

## Your job

Confirm or reject the **fold**. Hunt leftover BLOCK-class holes:

1. Does v2 still call the overlay a product home in any remaining sentence?
2. Is S19 actually sufficient vs today's `createToolExecutor(originatingWs)`?
3. S21 hybrid (stdin window + tray WS chat + ACL) — does it recreate the WS superuser?
4. S6 vs N2 — any remaining overlay Allow?
5. P0 falsification — still theater?
6. S10 OPEN (IME×CU process) — is shipping P0 spike acceptable?
7. ADR-020 copy freeze until P0 pass — good or a docs split?
8. Any v1 sentence that survived unamended and still contradicts v2 laws?

Apply ADR-020 checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`.

Score three layers: outcome (can this be a spike without lying) / trajectory (fold vs ignore adversary) / component (which law/file).

## Output

- Findings BLOCK / MAJOR / NIT with path citations
- S1–S24: LOCK / AMEND / OPEN only where you disagree with v2
- Residual before spike plan
- Final line EXACTLY one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

REJECT if any BLOCK remains (unenforceable Trust, identity lie, or P0 not landable).
APPROVE_WITH_NITS = foldable nits only.

Do not award length. Do not APPROVE because the synthesis is long.
