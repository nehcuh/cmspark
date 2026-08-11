I have completed the review. Here is my assessment.

---

# Wave A Implementation Review — thread-history-ia-wave-a-impl

## 1. Summary

Real diff matches the patch file (`git status` + `git diff --stat` confirm). All 606 chrome-extension tests pass (`npm --prefix chrome-extension test` → 0 fail). Wave A acceptance A-1..A-7 and pins S1–S5 are met with file:line evidence. No companion protocol change, no Graph/Knowledge dual-write, no Wave B/C scope creep. Capability declaration present and correct (L0 only, no Compose/L2). Safe to merge and proceed to Wave B.

## 2. Spot-check (file:line evidence)

| Item | Status | Evidence |
|------|--------|----------|
| **A-1** `⋯` menu 🏷 为未标注提取要点; ≤20; disabled at 0 | ✅ | ThreadList.tsx:999-1008 (disabled + title); thread-timeline.ts:349 (`EXTRACT_DIGEST_MAX=20`); thread-timeline.ts:414 (cap) |
| **A-2** Tags empty/high-untagged primary CTA; honest copy | ✅ | ThreadList.tsx:753-853; copy "为未标注提取要点（最多20）" matches menu |
| **A-3** digest.tldr one-line ellipsis on rows | ✅ | thread-timeline.ts:469-477 (`displayDigestTldr`); ThreadList.tsx:560-564 row + styles.tldr:1407-1416 (nowrap+ellipsis); `title` carries full tldr |
| **A-4** Menu via portal to `document.body`, z > panel/backdrop | ✅ | ThreadList.tsx:949-1020 (`createPortal(..., document.body)`); menuPortal zIndex:10060 > panel:51 > backdrop:50 (lines 1357, 1251, 1239); resize+scroll(capture) listeners at 144-149 |
| **A-5** Tag cloud max-height + 更多 collapse | ✅ | thread-timeline.ts:355 (`TAG_CLOUD_MAX_HEIGHT_PX=72`), 353 (`TAG_CLOUD_MAX_VISIBLE=16`); ThreadList.tsx:765-770 maxHeight/overflow; 更多+收起 at 804-822 |
| **A-6** Multi-select 提取要点 still works | ✅ | ThreadList.tsx:1095-1105 bottom bar preserved; now routed through `batchNeedsForceExtract` at handleExtractDigest:394-399 |
| **A-7** N/M progress from digest_updated; no fixed 60s | ✅ | ThreadList.tsx:152-185 (digest_updated effect), 187-224 (completed event); old `setTimeout(..., 60_000)` removed — comment at line 389; progress bar at 1025-1030 |
| **S1** empty-tags digests → force:true | ✅ | thread-timeline.ts:431 unconditionally sets force=true when ids non-empty (handles empty-tags); handleExtractUntagged:404 passes `true`; companion honors at message-router.ts:1311,1328 (`!force && thr.digest && !isDigestStale` skip bypassed) |
| **S2** default exclude `agent_role === "worker"` | ✅ | thread-timeline.ts:415,422; ThreadList.tsx:261 passes `excludeWorkers: true`; orchestrator + normal included (test line 226) |
| **S3** skip busy; 0 targets → no empty send | ✅ | thread-timeline.ts:423 (`isBusyId`); ThreadList.tsx:753,834 (CTA disabled); 999 (menu disabled); 403 + 365 early-returns |
| **S4** portal menu, not overflow hack | ✅ | createPortal to document.body — `position:fixed` (not absolute within panel); see A-4 |
| **S5** progress event-driven; batch-aware spinner clear | ✅ | Per-id clearing via `batch.remaining.delete(id)` (ThreadList.tsx:160,173,206); no fixed 60s; both digest_updated and extract_digest_completed drive |
| **Scope** no Wave B/C / protocol / Graph / Knowledge | ✅ | useWebSocket.ts:937-983 only dispatches UI-internal CustomEvents; no companion file touched; no Graph/Knowledge refs |

## 3. Capability checklist (ADR-020)

- Surface/Compose/Autonomy/Trust/Channel declaration present in prompt — L0 only, no Compose/L2, no Pack, trust unchanged. ✓
- Not a Skill/MCP/Pack dressed as agent. ✓
- No new primary UI chrome (existing ThreadList panel extended). ✓
- No new confirm family / trust regression. ✓
- No new runtime. ✓

## 4. Nits (non-blocking)

1. **N1 — Dead in-loop force tracking** (`thread-timeline.ts:417-431`): the loop sets `force=true` when any selected thread has empty-tags digest, but line 431 `if (ids.length > 0) force = true` overwrites it unconditionally. The first computation is dead. Functionally fine (force=true is always correct for untagged batch), but the loop line is misleading.
2. **N2 — Returned `force` field unused** (`thread-timeline.ts:390` vs `ThreadList.tsx:404`): `selectUntaggedForExtract` returns `{ ids, force }`, but `handleExtractUntagged` hard-codes `true` and ignores `sel.force`. The API surface is slightly inconsistent with usage.
3. **N3 — Uncancelable progress-clear setTimeout** (`ThreadList.tsx:183, 215`): both `window.setTimeout(() => setExtractProgress(null), 1600)` are fire-and-forget. If a new batch starts within 1.6s of a prior completion, the pending timer will clear the new batch's progress bar mid-flight. Spinner state still recovers via `extract_digest_completed`. Suggest tracking the timer id in a ref and clearing on new batch.
4. **N4 — `hasTags ||` short-circuit in progress effect** (`ThreadList.tsx:171-172`): for multi-select re-extract of *already-tagged* threads, the condition marks them done on the first unrelated `threads` change, not on actual digest update. Recovered by the `extract_digest_completed` channel for spinner clearing, but the N/M progress display can briefly read "完成" before LLM actually returns. Primary untagged-batch path is unaffected (no tags → hasTags=false → waits for real `mark !== start`).
5. **N5 — Disabled CTA in fully-empty library** (`ThreadList.tsx:759-761`): `(tagKeys.length === 0 && untagged.length === 0)` branch renders a permanently-disabled primary CTA alongside the empty-state hint. Mild UX redundancy; not incorrect.

## 5. Blocking / Rejection gates

- R1 (force on empty-tags): **clear** — force=true sent.
- R2 (workers default-in): **clear** — `excludeWorkers !== false` default.
- R3 (empty batch / CTA not disabled): **clear** — both CTA and menu disable at 0.
- R4 (menu clipped): **clear** — `createPortal` to `document.body`, zIndex 10060.
- R5 (companion protocol / Graph / Knowledge): **clear** — none touched.
- R6 (tests fail / pure-logic untested): **clear** — 606 pass; S1–S3 covered.

No blocking issues.

## 6. Proceed to Wave B?

**Yes.** Wave A is self-contained, no protocol change, no autonomy/trust surface added. All pins and acceptance items met. The nits above are typical UI-progress polish; none of them obstruct Wave B (which depends on A's stable entry points).

VERDICT: APPROVE_WITH_NITS
