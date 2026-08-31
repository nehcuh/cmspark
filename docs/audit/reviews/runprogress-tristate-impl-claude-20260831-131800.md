Review complete. All four REJECT conditions verified against source and execution; findings below.

## Review: `fix/runprogress-adapter-tristate` — adapter RunProgress tri-state

**Verification basis**: fresh `tsc -p tsconfig.test.json` rebuild + `node --test .test-dist/tests/run-progress.test.js` → **29/29 pass** `[executed]`. Diff read in full; all call sites traced.

### REJECT conditions — all clear

1. **Null reseeds via helper?** No. `run-progress.ts:124` guards `thread.run_progress === null → undefined` with strict `=== null` *before* any seeding. Test locks it with handoff todos + matching `navigate` tool → `undefined`.
2. **Adapter inlines `seedRunProgress`/`applyToolResult`?** No. Grep of `adapter.ts` shows exactly two occurrences of either symbol's replacement — import (line 69) and one call (line 1344). The old inline seed/tick/shouldWrite block is gone. Source-lock test additionally asserts the success-send window `doesNotMatch` both old names.
3. **Toggle on null coerces to `{ items: [] }`?** No. `handlers/run-progress.ts:19-21` early-returns the unchanged thread before the `?? { items: [] }` coercion; no `threadManager.update` on that branch. TM `update()` (thread-manager.ts:820-825) passes `null` through as explicit clear, `get()` (768-770) only sanitizes non-null — no writer can resurrect it.
4. **Helper on failure/abort paths?** No. Single call site at `adapter.ts:1344` sits inside `if (toolResult.success)` (line 1340). Abort (`persistInterruptedRemainder`), parse-failure, and validation-failure windows contain no helper reference — confirmed by grep (2 total occurrences in file) and by test.

### Spec conformance

- Tri-state logic matches the design clause-for-clause, including the spec's warned trap: write-eligibility uses `=== undefined` (line 131), not `!= null`, so a seeded copy of a cleared thread can never be written back.
- All four spec-mandated tests present, plus a bonus unmatched-tool → no-write case.
- `{ items: [] }` caller-set reseed-on-match is preserved (old adapter behavior) and accurately documented in the helper's doc comment — I verified equivalence with the pre-diff logic by hand `[inspected]`.
- Repo-wide sweep: `seedRunProgress`/`applyToolResult` now only referenced in `run-progress.ts` itself and TM's two `=== undefined`-guarded seed sites. Every production writer honors the contract.

### Notes (non-blocking, no change requested)

- Toggle-null returning `{ type: "thread.updated", thread }` is a no-op success response — this is what the spec asked for ("return thread unchanged (no write)"), and the alternatives (new response type, error) would expand WS surface for nothing.
- Helper's `thread` param is a three-line structural type duplicating `seedRunProgress`'s shape — fine at this scale.

VERDICT: APPROVE
