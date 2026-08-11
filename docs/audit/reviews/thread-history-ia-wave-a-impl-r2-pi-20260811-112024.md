All checks complete. Here is my independent re-review.

---

# Independent Re-review (r2) — Thread History IA Wave A

**Batch:** `thread-history-ia-wave-a-impl-r2` · **Base:** bf25c0b

**Staleness check:** Patch body byte-identical to live `git diff` (only wrapper diffstat differs). ✅

**Machine check:** `npm --prefix chrome-extension test` → **606 pass / 0 fail**. ✅

## R7 (A-5 blocking from Pi r1) — VERIFIED FIXED, with geometry reasoning

1. **Height-clip removed:** `TAG_CLOUD_MAX_HEIGHT_PX` has zero references left in the codebase (rg confirms only `TAG_CLOUD_MAX_VISIBLE` survives). `styles.tagCloud` (`ThreadList.tsx:1531-1537`) is now plain `flexWrap` — **no `maxHeight`, no `overflow:hidden`**.
2. **Fold controls outside the pills row:** 「更多 · N」 (`:817-823`) and 「收起」 (`:829-833`) render in `styles.tagCloudFoldRow`, a **sibling div** of the pills container inside `tagCloudSection` (`:782-841`) — they are structurally outside the flex-wrap container, and that container has no clip to begin with. They cannot be clipped.
3. **No silent tag loss:** cloud grows naturally (panel list scrolls); fold is purely count-driven (`collapseTagKeys`, >16 tags). 8..16 tags → no fold needed, nothing truncated. >16 → 「更多」 always visible beneath the cloud; expanded → 「收起」. Count-fold and render conditions are mutually consistent (expanded ⇔ hiddenCount 0).

R7 **passes** — the dead-end and the no-affordance regression are both gone.

## r1 nits addressed (verified in code)

| r1 nit | Status |
|---|---|
| Timer wipe of new batch | ✅ `beginExtractBatch` (`:378-380`) and `scheduleProgressClear` (`:133-137`) both clear the pending timer before arming |
| mark-done on composite mark, not hasTags | ✅ `ThreadList.tsx:175-190` compares `extracted_at\|fingerprint\|tags` against `startMark` snapshot |
| `handleExtractUntagged` uses force | ✅ `beginExtractBatch(untaggedExtract.ids, untaggedExtract.force)` (`:405`) |
| Trash → no untagged extract | ✅ `untaggedExtract` memo returns `{ids:[], force:false}` when `trashView` (`:265-266`); menu item disabled |
| CTA only when `ids.length > 0` | ✅ render guard `showPrimaryCta && untaggedExtract.ids.length > 0` (`:843`) |
| force = ids non-empty | ✅ `selectUntaggedForExtract` → `force: ids.length > 0` |

## Residual nits (non-blocking)

1. **Dead `cmspark:digest_updated` event** (`useWebSocket.ts:940-949`): still dispatched, **zero listeners** (rg across `src/`). Progress actually flows via `UPSERT_THREAD → threads` store effect; the window event + its "A-7: UI batch progress listens for digest_updated" comment are misleading dead code.
2. **No batch serialization guard** (r1 nit 3, unaddressed): a second `beginExtractBatch` overwrites the shared `extractBatchRef`; a late `extract_digest_completed` from batch A then mutates batch B's `remaining` (shared ids cleared early → progress/spinner inaccuracy). UI-only, bounded, non-blocking.
3. **Portal menu has no bottom-viewport clamp** (r1 nit 6, unaddressed): `menuPos.top = r.bottom + 4` can overflow the viewport near the bottom.
4. `showPrimaryCta` (`:773-777`) contains dead clauses (`untagged.length > 0 && !extractDisabled`, `highUntagged`) — unreachable given the render guard requires `ids.length > 0`; memo is misleading, no behavior impact.
5. `memory/session.md` S64 "(dual reviewers APPROVED)" wording still reads as implementation-approved (cosmetic).

## ADR-020 capability checklist

Declaration present and accurate: Surface L0 chat UX / thread navigation metadata; L2-classes none; Compose none; Autonomy n/a; Trust/Channel unchanged.

1. **Axes fit** ✅ UI-only diff (`ThreadList.tsx`, `useWebSocket.ts` events, `thread-timeline.ts` utils, tests). No L2/compose/autonomy surface.
2. **No "中层 Agent"** ✅ zero occurrences.
3. **Pack-first** ✅ new entry points into the *existing* `thread.extract_digest` scenario (force:true is pre-existing protocol); not a new capability → no Pack required.
4. **Confirm dialects / Trust monotonicity** ✅ no confirmations touched; force:true bounded ≤20, explicit click, skips busy+worker; no god-mode/auto_approve interaction.
5. **originWs** ✅ no `securityConfirmations.request` touched.
6. **P1 watchlist** ✅ no config.set / allow_all_schemes / evaluate / shell surface.
7. **Privacy** ✅ tldr is locally-stored digest content (same exposure as pre-existing previews); batch sends only thread_ids.

## Tests

New tests meaningfully cover the pure logic: `selectUntaggedForExtract` (busy/worker skip, cap 20, force, empty batch, `excludeWorkers:false`), `batchNeedsForceExtract`, `collapseTagKeys` fold math, `displayDigestTldr` ellipsis, `isUntaggedForExtract`/`shouldForceDigestExtract`. The A-5 fix itself is JSX/CSS structure — not unit-testable here, but geometry reasoning above confirms correctness.

## Verdict

Blocking gate R7 fixed; R1–R6 carry no regressions; machine green; only residual non-blocking nits remain.

**Proceed to Wave B?** yes

VERDICT: APPROVE_WITH_NITS
