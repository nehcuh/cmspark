# Dual re-review — run_progress adapter tri-state spec (plan only)

READ-ONLY. Independent senior reviewer.

Work in: `/Users/huchen/Projects/cmspark` branch `fix/runprogress-adapter-tristate`

## Capability

```text
Surface: L0 RunProgress | Blast: T2 latent | Trust: exact item.tool ticks
```

## Inputs

1. Spec: `docs/superpowers/specs/2026-08-31-runprogress-adapter-tristate.md`
2. Live: `companion/src/llm/adapter.ts` ~1340-1360, `companion/src/threads/thread-manager.ts` tri-state comment, `companion/src/message-router/handlers/run-progress.ts`, `companion/src/threads/run-progress.ts`
3. Tests already locking TM sticky-null: `companion/tests/run-progress.test.ts`

## Rules

1. Plan review. REJECT if implementing as written would still reseed `null` on a successful tool tick (`next !== current` path).
2. Calibration: latent — no production writer of null. Do not inflate to BLOCK/security. Do not demand a UI clear button.
3. APPROVE* if helper + toggle no-op is enough and tests force the null skip.

Final line exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
