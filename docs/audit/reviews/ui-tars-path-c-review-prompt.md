# Pi path review: UI-TARS absorption

## Role

You are an independent product/architecture reviewer (Pi). Review the **path selection**, not the full implementation.

## Read first

1. `docs/research/ui-tars-absorption-2026-08-08.md`
2. `docs/decisions/ui-tars-absorption-multipath-2026-08-08.md`
3. Skim `docs/adr/017-computer-use.md` and `companion/src/computer/locate-chain.ts` header for CMspark CU identity.

## Decide

Is **Path C (pattern absorption)** the correct 0.5.x choice vs A/B/D?

Check:

- Does Path B correctly get REJECT for identity/trust reasons?
- Is Path A correctly deferred (not mixed into this PR)?
- Path C scope: experimental raw/Thought caption + parse robustness + LLM playbook + docs — any **must-add** or **must-cut**?
- Security: any Path C item that could weaken dual-switch / G4 re-L2 / hard-deny?

## Output format

1. Short summary (≤10 lines)
2. Blocking issues if any (file:line or section id)
3. Non-blocking nits
4. Final line EXACTLY one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
