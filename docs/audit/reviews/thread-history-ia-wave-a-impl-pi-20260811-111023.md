All checks complete. Here is my independent implementation review.

---

# Implementation Review — Thread History IA Wave A

**Batch:** `thread-history-ia-wave-a-impl` · **Patch:** `docs/audit/reviews/thread-history-ia-wave-a-impl-diff-20260811-111023.patch`

**Staleness check:** patch diff body is byte-identical to current `git diff` working tree (only the wrapper diffstat differs). ✅ Not stale.

**Machine check:** `npm --prefix chrome-extension test` → **606 pass / 0 fail**. `tsc --noEmit -p tsconfig.json` → exit 0. ✅

---

## 1. Summary

Wave A is well-scoped and mostly solid: all five pins (S1–S5) are implemented correctly, tests are meaningful for the pure logic, the ADR-020 declaration is accurate, and there is zero scope creep (no companion change, no Graph/Knowledge dual-write, no Wave B/C). However, **acceptance A-5 is functionally broken** — the tag-cloud fold's expand control is unreachable exactly when needed, and tags become permanently hidden in the common case. That fails a mandatory acceptance item and regresses pre-Wave-A reachability, so I cannot approve the merge as-is.

## 2. Spot-check A-1..A-7 + S1–S5

| ID | Status | Evidence |
|----|--------|----------|
| **A-1** | ✅ | `⋯` item "🏷 为未标注提取要点" `ThreadList.tsx:993-1012`; disabled when `untaggedExtract.ids.length === 0`; ≤20 via `EXTRACT_DIGEST_MAX` `thread-timeline.ts:347`, `beginExtractBatch` cap `ThreadList.tsx:363-364` |
| **A-2** | ✅ | Primary CTA `ThreadList.tsx:825-858`; `showPrimaryCta` (empty / high-untagged) `:755-761`; honest copy "为未标注提取要点（最多20）", no "自动" wording (F2); disabled + explanatory title at 0 targets |
| **A-3** | ✅ | tldr row `ThreadList.tsx:560-563`; `displayDigestTldr` `thread-timeline.ts:473-483` (whitespace-collapse, 120-char + …); `styles.tldr` nowrap/ellipsis `ThreadList.tsx:1407-1418`; full text in `title` attr |
| **A-4** | ✅ | `createPortal(…, document.body)` `ThreadList.tsx:949-1011`; `menuPortal` fixed, `zIndex: 10060` > panel(51)/backdrop(50) `:1351-1366`; reposition on resize/scroll `:128-147`. Menu present in panel header → both time & tags views |
| **A-5** | ❌ **BLOCKING** | See below — `ThreadList.tsx:765-823` |
| **A-6** | ✅ | Multi-select 提取要点 preserved `ThreadList.tsx:1106-1113` → `handleExtractDigest` `:396-399` |
| **A-7** | ✅ | Progress bar N/M `ThreadList.tsx:1025-1029`; advanced by digest change on store `threads` `:128-153`; cleared by `cmspark:extract_digest_completed` ok+failed `:207-222`; fixed 60s full-clear removed from diff (was `ThreadList.tsx` old `setTimeout(60_000)`) |
| **S1** | ✅ | Untagged batch forces `force=true` whenever non-empty `thread-timeline.ts:451-454`; companion honors force (`message-router.ts:1311-1324` — without force a fresh empty-tags digest would be skipped via `isDigestStale`) |
| **S2** | ✅ | `excludeWorkers !== false` default `thread-timeline.ts:418-419,440-441`; `agent_role === "worker"` matches companion's lowercase values (`companion-dispatch.ts:339`, `fleet.ts:116`); orchestrator/normal included |
| **S3** | ✅ | Busy skip `isBusyId` `thread-timeline.ts:428-434` (handles both `Set` and `Record<string,boolean>`; store type is `Record`, `agentStore.tsx:154`); 0 targets → CTA disabled + menu item disabled + `handleExtractUntagged` early-return `ThreadList.tsx:402-405`; no empty send |
| **S4** | ✅ | Portal to `document.body` (not merely overflow hack) |
| **S5** | ✅ | Event-driven progress; no fixed 60s clear anywhere in diff |
| **Scope** | ✅ | Only `ThreadList.tsx`, `useWebSocket.ts`, `thread-timeline.ts`, `thread-timeline.test.ts`, `memory/session.md`. No companion/Graph/Knowledge/B-C |

**ADR-020 checklist:** Declaration present and accurate (Surface L0 UI-only; L2 none; Compose none; Autonomy n/a; Trust/Channel unchanged). Diff is UI + tests only — no new tools/gates/confirmations; Pack-first N/A (existing digest scenario, new entry point, not a new capability); no "中层 Agent" language; no `originWs` surface touched. ✅

**Security/privacy:** tldr in rows is locally-stored digest content — same exposure surface as pre-existing `first_user_preview`; no network/exfiltration (D3 respected). Untagged batch is explicit-click, ≤20, skips busy+worker — no accidental full-library extract (D4). ✅

## 3. Blocking issue

**A-5 fold is a dead-end: `maxHeight: 72` + `overflow: hidden` clips the "更多" expand button itself, and tags become unreachable.**

- `ThreadList.tsx:768-769` sets `maxHeight: TAG_CLOUD_MAX_HEIGHT_PX` (=72, `thread-timeline.ts:349`) with `overflow: "hidden"` on the flex-wrap cloud.
- The only expand affordance, "更多 · N" (`ThreadList.tsx:804-813`), renders **only when `hiddenCount > 0`** (i.e. `tagKeys.length > 16`, `thread-timeline.ts:461-470`) and is the **last flex item inside the same clipped container**.
- Geometry: pills are ~19-20px tall (11px font + 2px padding + 1px border, `ThreadList.tsx:1512-1521`); content height available = 72 − 16 (padding) = 56px → ~2 rows fit. At 300px panel width, realistic tags give 3-5 pills/row → 16 folded pills span 3-5 rows.

Consequences:
1. **`>16` tags:** "更多" (and usually the "#未标注 N" pill, `ThreadList.tsx:791-802`) lands on rows 3-5 → clipped by `overflow:hidden` → the only path to expand is invisible. Dead-end; tags beyond ~2 rows permanently hidden.
2. **`8..16` tags:** `hiddenCount = 0` → no "更多" button exists at all, yet the 72px clip still truncates rows 3+ → silent loss of tags with **no affordance**, a regression vs pre-Wave A where the cloud grew and the panel list scrolled to reveal everything.

This fails acceptance A-5 ("Tag cloud max-height + 更多 collapse") and the U2/GAP-14 discoverability goal that motivated Wave A. The two fold mechanisms (count-fold at 16 vs height-fold at 72px) are incoherent — one of them must drive the other (e.g., place 更多/收起 outside the clipped region, or derive maxHeight from the folded pill count, or drop the height clip and rely on the count fold alone).

## 4. Nits (non-blocking, after the above is fixed)

1. `cmspark:digest_updated` window event (`useWebSocket.ts:941-950`) is dispatched but **never listened to** — progress works via store `UPSERT_THREAD → threads` effect (`ThreadList.tsx:128-153`). Dead code / redundant mechanism.
2. 1.6s delayed `setExtractProgress(null)` after completion (`ThreadList.tsx:137-139, 216-217`) can wipe a *new* batch's progress bar if started within 1.6s of the previous finishing (spinners stay correct; only the N/M bar vanishes early).
3. Single shared `extractBatchRef` — starting a second batch mid-flight overwrites the first; the first batch's `completed` event then mutates the new batch's `remaining` (overlapping ids cleared prematurely). No batch serialization guard.
4. In trash view, `untaggedExtract` is computed from `filtered` (which includes trashed threads), so the `⋯` menu item stays enabled for trashed threads — harmless LLM cost on trashed threads; consider disabling in trash view.
5. Multi-select batch-wide `force:true` (when any selected thread has empty-tags digest) re-extracts co-selected fresh tagged threads — bounded by 20/request, protocol-level limitation, acceptable.
6. Portal menu has no bottom-viewport clamp; with `⋯` near the screen bottom the fixed menu can extend past the viewport.
7. `memory/session.md` S64 "dual reviewers APPROVED" reads as if implementation was already approved; it refers to design-stage approval. Cosmetic.

## 5. Proceed to Wave B?

**No** — fix the A-5 fold dead-end first (small, contained change), then re-review. Wave B should not build on a tags view whose primary navigation affordances are clipped.

---

VERDICT: REJECT
