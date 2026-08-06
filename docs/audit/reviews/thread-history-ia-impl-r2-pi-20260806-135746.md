All verification complete. Let me compile the final report.

## Summary

Reviewed the R2 patch (working tree matches `docs/audit/reviews/thread-history-ia-impl-r2-diff-20260806-135746.patch` at base `c970fcd`, verified via diff-header comparison). Ran both suites: extension 448/448 pass; companion thread tests 22/22 pass; full companion suite shows 15 failures all confirmed **pre-existing on base `c970fcd`** via clean worktree runs (computer-executor 13, uia-watch 2 — identical fail counts on base, unrelated computer-UI files untouched by this diff). No new regressions.

## B1 verdict (FIXED) + evidence

- `companion/src/message-router.ts:1136-1188` — `thread.delete` computes `const mode = rest.mode === "trash" ? "trash" : "hard"` → default **hard**; busy reject via `listLlmActiveThreadIds()` before any mutation; trust release runs for both modes; trash path broadcasts `thread.trashed`, hard returns `thread.deleted` + mode.
- `ThreadList.tsx:243-251` — single delete passes `mode:"trash"` in main list, `mode:"hard"` in trash view; both call sites explicit (grep confirms only these two `thread.delete` senders).
- `background/index.ts:741-746` — forwards mode.
- `companion-client.ts:397-407` — tray refresh triggers include `thread.trashed` and `thread.restored`.
- `tests/single/files.test.ts:210-222` — `thread.delete` with no mode still expects `thread.deleted` + gone; passes.

## B2 verdict (FIXED) + evidence

- `message-router.ts:1346-1358` — `thread.list` echoes `list_scope: onlyTrashed ? "trash" : includeTrashed ? "all" : "active"` + `trash_count`; single-pass `listWithPreviews`.
- `useWebSocket.ts:838-890` — `listScope === "trash"` → no SET_THREADS (ignored); `"all"` → SET_THREADS then early `break` before the auto-create-blank and auto-select-first blocks.
- `agentStore.tsx SET_THREADS` — keeps `activeThreadId` when present, and when all incoming rows are trashed; preserves pinned/skill/mcp metadata via `?? state.x` fallback instead of wiping.
- `ThreadList.tsx:282,290` — trash opens with `include_trashed: true` (not `only_trashed`).
- The R1 repro paths are closed: empty trash no longer auto-creates a thread; open/close trash no longer nulls the active chat (active preserved).

## B3 verdict (FIXED) + evidence

- `App.tsx:536-544` — `handleKeyDown` returns early for ArrowDown/Up/Escape/Enter when `(slashVisible || atVisible)` — same gate as `/`, so `handleSend` is not reached while the @ popover is open.
- `AtThreadPopover.tsx:87-99` — document-level keydown `preventDefault()`s Enter and runs `onSelect` against the current textarea state; no premature send, no stale-text re-insertion.

## Perf nits verdict — LANDED

- **Double read**: `listWithPreviews` single `getMessages()` per thread → first/last preview + stale flag; router `thread.list` does no second scan (`trash_count` via index-only `list()`). Test: "listWithPreviews single-pass marks digest stale without second API".
- **@ digest concurrency**: `digest.ts` `extractThreadDigestQueued` — per-threadId in-flight dedupe (`digestInFlight`) + global cap `DIGEST_EXTRACT_CONCURRENCY = 2`; router context_refs uses it.
- **Purge**: `purgeExpiredTrash` batch filter + one `saveIndex()` + unlink loop. Test: "purgeExpiredTrash batches multiple expired ids in one index rewrite".

## New regressions / residual risks

- No new regressions (all 15 full-suite failures pre-existing on base; extension 448/448).
- `chat.create` (`message-router.ts:496`) and `thread.select` (`:1496`) still lack a `trashed_at` guard — clicking a trash-view row opens a trashed thread in the main chat and lets you keep chatting into it (R1 minor, still open).
- `thread.restore` broadcasts `thread.updated` per id and `useWebSocket` fires a second `thread.list` on `thread.restored` — benign redundant refresh, no loop (responses don't retrigger).
- Background `thread.delete` defaults unspecified `mode` → `"trash"` while the router defaults → `"hard"` (asymmetric latent footgun; no current caller affected since both call sites pass mode).

## Blocking

None. B1–B3 all verified fixed in code and by tests.

## Nits

1. **No regression tests for the two R1 blockers**: no extension test for the B2 trash-view/list interaction or the B3 @-Enter conflict, and no companion router test for `list_scope` echo, `thread.restore`, or the single-delete trash path — exactly the coverage holes R1 called out. Fixes verified manually, but untested at the WS/reducer level.
2. Missing `trashed_at` guard on `chat.create` / `thread.select` (R1 minor, unchanged).
3. @ chip/text desync persists (R1 nit): removing a chip doesn't strip `@「title」` from text; deleting text leaves a stale `threadRefs` entry that re-attaches on next send.
4. Background vs router `thread.delete` mode default asymmetry (see above).

ADR-020: declaration present and accurate — L0 surface, digest/tags are index metadata (not Composition), no new L2 tools/confirm dialect, no `securityConfirmations.request` (originWs N/A), trust released per-id on trash **and** hard delete with no re-acquire on restore (safe direction), no new runtime.

VERDICT: APPROVE_WITH_NITS
