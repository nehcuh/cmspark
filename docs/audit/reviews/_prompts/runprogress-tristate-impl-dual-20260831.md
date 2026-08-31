# Dual re-review — run_progress adapter tri-state implementation

READ-ONLY. Independent senior reviewer. Do not edit.

Work in: `/Users/huchen/Projects/cmspark` branch `fix/runprogress-adapter-tristate`

## Capability

```text
Surface: L0 RunProgress | Blast: T2 latent
```

## Inputs

1. Spec: `docs/superpowers/specs/2026-08-31-runprogress-adapter-tristate.md`
2. Diff: `git diff` on this branch vs main — files `companion/src/threads/run-progress.ts`, `companion/src/llm/adapter.ts`, `companion/src/message-router/handlers/run-progress.ts`, `companion/tests/run-progress.test.ts`
3. Machine: `node --test .test-dist/tests/run-progress.test.js` 29/29 pass

## REJECT if

- `nextRunProgressAfterToolSuccess(null thread, matching tool)` would still return a seeded object
- adapter success window still inlines `seedRunProgress` / `applyToolResult`
- toggle on null writes `{ items: [] }`
- helper called on failure/abort paths

Final line exactly:

VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
