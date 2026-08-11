Patch verified non-stale (working-tree diff byte-identical to patch file). `npm --prefix chrome-extension test` → **606 pass / 0 fail**.

# Re-review (r2) — Thread History IA Wave A

## 1. A-5 / R7 spot-check (Pi blocking, geometry)

**Pi r1 blocking cleared.** Real code (`ThreadList.tsx:782-840`, `1399-1407`, `1531-1537`):

- `TAG_CLOUD_MAX_HEIGHT_PX` deleted (`thread-timeline.ts` only emits `TAG_CLOUD_MAX_VISIBLE=16`); grep on `ThreadList.tsx` shows **no `maxHeight`/`overflow:hidden`** on `tagCloud`, `tagCloudSection`, or `tagCloudFoldRow`. The only remaining `maxHeight` near this area is on `.panel` (line 1263, pre-existing) and `.list` `overflowY:auto` (line 1444) — the intended scroll mechanism.
- **`更多 · N`** renders in a **sibling** `tagCloudFoldRow` (`ThreadList.tsx:817-828`) under `tagCloudSection`, *not* inside the pills flex row. Same for **`收起`** (`:829-839`).
- Geometry: with pills ≈20px tall and the section unbounded, 16 folded pills + `#未标注` + `更多` render fully; the outer `.list` (`overflowY:auto`, `flex:1`) scrolls. In the **8..16-tag** range, `hiddenCount=0` so no `更多` button is shown, but with no height-clip every pill is visible — no silent loss. **R7 = clear.**

Spec A-5 wording ("`max-height` + 折叠「更多`") is now satisfied via a different mechanism (count-fold + scrollable list). The acceptance criterion ("多 tag 时列表仍可滚") is preserved. The literal `max-height` was the broken means, not the end.

## 2. r1 nit spot-check (claim verification)

| Item | Verified at | Status |
|---|---|---|
| Progress clear timer cancelled on new batch + shared ref | `ThreadList.tsx:103, 153-162, 377-380` | ✅ Claude N3 |
| Mark-done uses fingerprint delta, not hasTags short-circuit | `ThreadList.tsx:176-188` (comment + `(t.digest?.extracted_at \|\| t.digest?.tags)` + `mark !== start`) | ✅ Claude N4 |
| `handleExtractUntagged` uses `untaggedExtract.force` | `ThreadList.tsx:419` | ✅ Claude N2 |
| Trash view → empty selection | `ThreadList.tsx:268-269` | ✅ Pi N4 |
| Primary CTA only when `untaggedExtract.ids.length > 0` | `ThreadList.tsx:842` (gates the whole row) | ✅ Claude N5 |
| `selectUntaggedForExtract` simplified (no in-loop dead force tracking) | `thread-timeline.ts:411-429` returns `{ ids, force: ids.length > 0 }` | ✅ Claude N1 |

## 3. Capability checklist (ADR-020)

- Declaration present and accurate: Surface L0 only, no L2/Compose/Autonomy surface, Trust/Channel unchanged. ✓
- Not a Skill/MCP/Pack dressed as agent. ✓
- No new tools / gates / primary UI chrome / confirms. ✓
- No `originWs` surface touched, no god-mode, monotonic trust. ✓

## 4. Residual nits (non-blocking)

1. **Shared `extractBatchRef` still overlapping-batch unsafe** (`ThreadList.tsx:97-101`). Starting a second batch mid-flight overwrites `remaining`/`startMark`; the first batch's `extract_digest_completed` then mutates the new batch. Timer cancellation (r2) mitigates the progress-bar wipe symptom but not the state-corruption root. Bounded by user-gated triggers (≥2 explicit clicks) — non-blocking.
2. **`cmspark:digest_updated` window event is dead code** (`useWebSocket.ts:697-712`). Dispatched, never listened (progress flows through store `threads` effect at `ThreadList.tsx:165-197`). Drop the dispatch or wire it.
3. **Portal menu has no bottom-viewport clamp** (`ThreadList.tsx:967-973`). `⋯` lives in the panel header so real-world risk is low, but a fixed-position menu near viewport bottom can still overflow.
4. **Spec wording drift** (`docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md:165`): A-5 still says "`max-height` + 折叠". Update to "count-fold + scrollable list" to match the implementation.

## 5. Rejection gates

| # | Gate | Result |
|---|---|---|
| R1 | force on empty-tags | clear (`thread-timeline.ts:428`) |
| R2 | workers default-excluded | clear (`thread-timeline.ts:416`) |
| R3 | empty batch disables CTA + menu | clear (`ThreadList.tsx:768, 842, 1016`) |
| R4 | menu not clipped | clear (portal `zIndex:10060`, fixed, body) |
| R5 | no protocol/Graph/Knowledge | clear |
| R6 | tests + pure-logic coverage | clear (606 pass; S1–S3 covered) |
| **R7** | A-5 still clips 更多 / silently hides tags | **clear** (no height-clip; fold outside pills) |

## 6. Proceed to Wave B?

**Yes.** A-5 blocking is resolved with sound geometry; r1 nits that materially affected progress correctness are fixed; residual items are typical UI polish and don't obstruct Wave B's stable entry points.

Nits (non-blocking):
- N1: `extractBatchRef` is a single shared ref; overlapping batches can still corrupt `remaining` state (`ThreadList.tsx:97-101`). Mitigated by r2 timer cancel, not fixed at root.
- N2: `cmspark:digest_updated` window event dispatched but never listened to (`useWebSocket.ts:697-712`) — dead code.
- N3: Portal menu lacks bottom-viewport clamp (`ThreadList.tsx:967-973`).
- N4: Spec A-5 wording still says "max-height + 折叠「更多」"; doc should be updated to "count-fold + scrollable list" to match r2.

VERDICT: APPROVE_WITH_NITS
