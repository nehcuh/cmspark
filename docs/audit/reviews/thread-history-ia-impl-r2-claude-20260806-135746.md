I have enough evidence to render a verdict. Let me write the final review.

## Summary

R2 confirmation review for Thread History IA impl. I verified B1–B3 fixes plus perf nits by reading the actual code in the repo (not just the patch), running thread tests, and confirming the patch file matches `git status`. All B1–B3 blocking issues from R1 are fixed in code. Perf nits all landed. 75 thread tests + 448 chrome-extension tests pass green.

## B1 verdict: FIXED

- `companion/src/message-router.ts:1139` — `const mode = rest.mode === "trash" ? "trash" : "hard"` defaults HARD unless explicit trash.
- `message-router.ts:1141-1148` — single delete rejects busy via `listLlmActiveThreadIds().includes(rest.thread_id)`.
- `message-router.ts:1162` — trash path broadcasts `thread.trashed`; `:1167` hard path returns `thread.deleted` with `mode: "hard"`.
- `chrome-extension/src/sidepanel/components/ThreadList.tsx:246/251/262/274/313` — delete handlers explicitly pass `mode: "trash"` (soft) or `mode: "hard"` (trash-view permanent delete).
- `chrome-extension/src/background/index.ts:741-758` — SW forwards `mode` for both single and batch.
- `companion/src/tray/companion-client.ts:399-410` — tray listens for `thread.trashed` and `thread.restored` (added to refresh triggers).
- `companion/tests/single/files.test.ts:210` — existing `thread.delete` test (no mode) still expects `thread.deleted`; passes (verified `[executed]`).

## B2 verdict: FIXED

- `message-router.ts:1359-1366` — `thread.list` response echoes `include_trashed`, `only_trashed`, `list_scope` (computed as `"trash" | "all" | "active"`).
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:838-911` — `case "thread.list"`: `list_scope === "trash"` → no `SET_THREADS` (just resets blank-thread ref); `list_scope === "all"` → `SET_THREADS` with no auto-create / no auto-select; default → existing behavior.
- `chrome-extension/src/sidepanel/store/agentStore.tsx:277-308` — `SET_THREADS` preserves `activeThreadId` when still present; falls back to current active only if every incoming row is trashed (defense for `only_trashed` mishap).
- `ThreadList.tsx:282/290` — trash view and post-restore refresh both use `include_trashed: true` (never `only_trashed`).

## B3 verdict: FIXED

- `chrome-extension/src/sidepanel/App.tsx:536-544` — `handleKeyDown` early-returns for `["ArrowDown","ArrowUp","Escape","Enter"]` when `(slashVisible || atVisible)`. `atVisible` now has full parity with `slashVisible`. `AtThreadPopover` listens at `document` level, so the un-prevented keydown reaches its handler.

## Perf nits verdict

| Nit | Status | Evidence |
|------|--------|----------|
| Double message-file read on list | LANDED | `thread-manager.ts:456-477` `listWithPreviews` calls `getMessages` once per thread, reuses for `first_user_preview` + `last_user_preview` + `isDigestStale(digest, msgs)`. Router has no second `getMessages` for list. |
| @ digest 8 concurrent LLM | LANDED | `digest.ts:201` `DIGEST_EXTRACT_CONCURRENCY = 2`; `:203` `digestInFlight` Map dedupes per `threadId`; `:207-224` slot acquire/release. `message-router.ts:608-621` calls `extractThreadDigestQueued` for `on_at_ref`. |
| purge N× saveIndex | LANDED | `thread-manager.ts:398-418` filters expired in one pass, single `this.index.threads = filter`, single `saveIndex()`, then `unlinkSync` loop. Test `thread-cleanup-context.test.ts` pins "batches multiple expired ids in one index rewrite" (`[executed]`). |

## New regressions / residual risks

- Trust release on trash is intentional per capability declaration ("Trust: trash + hard delete releaseTrust per id"); restored threads do not auto-reacquire pack trust. Documented behavior, not a regression.
- `cleanupEmpty()` does not filter `agent_role === "worker"`; only `suggest_cleanup` rules engine does. Pre-existing, not introduced by this diff.

## Blocking

None.

## Nits

1. `companion/src/server.ts:5348-5351` — `thread.delete` validator does not validate `mode` field. Safe today because `message-router.ts:1139` treats anything-not-`"trash"` as hard, but a server-side `mode ∈ {"trash","hard",undefined}` check would surface client bugs earlier and match the `thread.batch_delete` validator at line 5363.
2. `companion/tests/single/files.test.ts:210` — `thread.delete` test does not assert `response.mode === "hard"`, so a future regression to the default-mode branching could slip past. Recommend adding `assert.equal(deleteResponse.mode, "hard")` and a sibling test for `mode: "trash"` returning `type: "thread.trashed"`.
3. `companion/src/message-router.ts:1247-1267` — `thread.restore` broadcasts per-id `thread.updated`, not `thread.restored`. The extension listens for both (`useWebSocket.ts:705` triggers list refetch on `thread.restored`; `:684` does UPSERT on `thread.updated`), so behavior is correct, but the asymmetry between response type and broadcast type is worth a one-line comment to prevent future confusion.
4. No automated test for the `atVisible` Enter gating in `App.tsx handleKeyDown` (B3). The change is two characters, but a `sidepanel-state.test.ts` reducer-level pin on the gating condition would prevent regression.
5. `chrome-extension/src/sidepanel/components/AtThreadPopover.tsx:100` — `document.addEventListener("keydown", handleKeyDown)` without `{ capture: true }`. Currently works because App.tsx now does not `preventDefault()` on gated keys, but adding capture (or explaining why not) would make the popover robust to future changes in App's key handling.

VERDICT: APPROVE_WITH_NITS
