Verification complete. All claims in the spec check out against the live tree. Review follows.

---

# Review — adapter honors run_progress tri-state (plan only)

## 1. Bug is real and correctly described

[inspected] `companion/src/llm/adapter.ts:1344-1352` matches the spec's quote verbatim. Traced the `null` path:

- `th.run_progress && th.run_progress.items.length > 0` — `null` is falsy → `current = seedRunProgress(th)` reseeds from handoff
- `shouldWrite = next !== current || (!th.run_progress && ...)` — `!null === true`, so a write fires even **without** a matching tick (seeded length > 0), and certainly with one (`next !== current` after tick)

`threadManager.get()` keeps `null` sticky (thread-manager.ts:768,773 both use `!= null` / `=== undefined` correctly), so the adapter is the sole violator of the shipped contract. Confirmed.

## 2. REJECT-rule trace — does the design still reseed `null`?

No. The helper's branch ordering is the load-bearing detail:

```
1. run_progress === null → undefined   ← strict ===, fires BEFORE any seedRunProgress call
2. existing object with items → applyToolResult
3. undefined | empty → seed then tick
```

Because `seedRunProgress` is unreachable when `run_progress === null`, the `next !== current` path can never operate on a seeded copy of null. The spec explicitly names and rejects the naive fix (guard only the `!th.run_progress` clause, leave the seed fallback) — that awareness is exactly right; the partial fix would still reseed on tick. Branch 3's write condition uses `run_progress === undefined`, not falsy — strict. **Rule 1: pass.**

## 3. Calibration

[inspected via grep] Only three production writers of `run_progress`: the adapter tick, the toggle handler, and TM itself (tri-state-correct). No production writer of `null` — latent, T2 appropriate. Spec's non-goals explicitly exclude UI clear control and WS allowlist expansion — no scope inflation, no security inflation. Trust axis unchanged (helper reuses `applyToolResult` untouched; ticks stay exact `item.tool`). **Rule 2: compliant.**

## 4. Sufficiency — helper + toggle no-op + tests

- Helper test 1 (`null` + handoff + matching tool → `undefined`) forces the skip logic
- Test 4 (toggle on `null` stays `null`) locks the `?? { items: [] }` coercion fix (handler run-progress.ts:18 — real, confirmed)
- Adapter source-window lock forces the adapter to actually call the helper on the success path

**Rule 3: pass.**

## Nits (non-blocking)

1. **Adapter lock should assert absence, not just presence.** The grep lock should require the success window to contain `nextRunProgressAfterToolSuccess` AND no longer contain inline `seedRunProgress`/`applyToolResult` — otherwise the adapter could call the helper *and* keep a fallback seed path, and the lock would stay green. Also note test line 436's global `assert.match(src, /applyToolResult\(/)` will fail post-refactor; "replace the grep" implies updating it, but say so explicitly.
2. **Missing branch-2 unchanged test.** Test 3 covers existing-items + matching tool (ticked). Add: existing items, tool does *not* match → helper returns `undefined` (no write). That's the no-op half of branch 2.
3. **Branch 3 preserves a pre-existing divergence:** caller-set `{items: []}` gets reseeded by the tick (adapter behavior) while TM treats empty as sticky-caller-set. Spec inherits this silently; a one-line acknowledgment would prevent a future "consistency fix" from regressing either way. Latent, out of scope — fine to keep.
4. **Toggle no-op response shape unspecified.** "Return thread unchanged" should name the type (`thread.updated` with the unchanged thread) so test 4 asserts a stable contract rather than whatever the implementer picks.

None of these change the verdict: the design is correct at the branch level, the tests force the null skip end-to-end, and scope is calibrated.

VERDICT: APPROVE_WITH_NITS
