# S51 Correctness Lane

**Date**: 2026-08-07  
**Range**: `6d2cdcf..HEAD`  
**Themes**: Trust B lifecycle #126 · Thread History IA #127 · shell abort #128 · voice M1 #129 · analyze_image data: #130 · settings/timeline/context budget #131  
**Method**: live code + tests inspection (adversarial correctness). Evidence tags: `[inspected]` unless noted.

## Verdict: REQUEST_CHANGES

One user-facing correctness defect remains in the runtime context-budget path: mid-loop recompact **strips a pre_loop M2 rolling summary from the LLM request** even though thread-index meta was patched to keep it. That is wrong truncation semantics for the feature this batch shipped. Other theme surfaces (trash isolation, batch_delete, shell abort trees, @ Enter, analyze_image data:, Trust B restore, voice busy matrix) look solid at the ship bar.

## HOLDS

| Area | Status | Evidence |
|------|--------|----------|
| Trust B restore lifecycle (#126) | **HOLD** | `releaseTrustBeforeThreadGone` on single + batch delete; unapply/uninstall/switch restore cookies; boot journal reconcile. Residual dual-review nits cosmetic only. `[inspected]` `pack-engine.ts` + prior s46 APPROVE_WITH_NITS |
| Thread list `list_scope` trash isolation (#127) | **HOLD** | Companion echoes `list_scope`; extension ignores `trash` SET_THREADS; `all` updates rows without auto-create/select; `SET_THREADS` preserves active on only-trashed mishap. `[inspected]` `message-router.ts:1397-1406`, `useWebSocket.ts:892-918`, `agentStore.tsx:317-347` |
| `batch_delete` busy / trust / lock (#127) | **HOLD** | `withIndexLock`, max 50, busy → `thread_busy`, per-id `releaseTrustBeforeThreadGone`, trash/hard + broadcasts. Single `thread.delete` also busy-rejects + default hard. `[inspected]` `message-router.ts:1176-1284` |
| Soft-delete pollution gates (#127) | **HOLD** | `chat.create` rejects `thread_trashed`; `@` skips `trashed_at`; ThreadList active vs trash filter; cannot activate trash rows into main chat. `[inspected]` `message-router.ts:523-536`, `AtThreadPopover.tsx:39`, `ThreadList.tsx:106-110,258-261` |
| Digest queue (#127) | **HOLD** | `DIGEST_EXTRACT_CONCURRENCY=2` + in-flight de-dupe per threadId for `@` background fill. `[inspected]` `digest.ts:200-253`, `message-router.ts:647-661` |
| `@refs` Enter parity (#127) | **HOLD** | `handleKeyDown` gates Enter/arrows/Escape when `atVisible \|\| slashVisible`. `[inspected]` `App.tsx:588-596` |
| shell_exec on `chat.abort` (#128) | **HOLD** | WS path kills process tree via `abortShellRunsForThread` before router abort; signal plumbed into `shellExec`; POSIX detached group + win32 `taskkill /T /F`; flight released in `finally` after resolve → no permanent SHELL_BUSY. `[inspected]` `server.ts:6450-6461,3741-3786`, `shell.ts:43-58,96-120,360-546` |
| analyze_image `data:` (#130) | **HOLD** | Extension promotes data: → canvas; companion residual local decode (mime + 6 MiB), no phase2/L2/schemeOk expansion. Prior dual-review APPROVE. `[inspected]` `browser-bridge.ts:551-576`, `server.ts:2463-2515` |
| Voice M1 busy / stop (#129) | **HOLD** | Mic disabled when `threadBusy`; send blocked while `voice.listening`; Stop → `abortForChatStop` then `chat.abort`; chat_abort discards draft merge. R2 dual-review APPROVE_WITH_NITS. `[inspected]` `App.tsx:366-409,791-804`, `useVoiceInput.ts:186-193`, `session-reducer.ts:26-31,75-88` |
| Timeline fold / Settings IA shell (#131) | **HOLD** (no new correctness blockers found beyond budget bug below) | Yesterday default fold + expand LS live in ThreadList; compaction modes in config/Settings. |

## Findings

### HIGH

#### H1 — mid_loop recompact drops M2 rolling summary from the **request** (wrong truncation)
- **Where**: `companion/src/llm/adapter.ts` ~490–623 (`runContextBudgetPass`), especially after `messages = compact.messages` and the mid_loop meta keep-path; `companion/src/llm/context-budget.ts` `compactMessagesTurnSafe` strips prior omit/summary notices then re-inserts plain `[context_omitted]` when `opts.rollingSummary` is omitted; `shouldRunM2(..., "mid_loop")` always false (`context-budget-m2.ts:88-89`).
- **Repro path**:
  1. Set `llm.context_compaction=auto`, `context_compaction_m2=true`, use a small `context_window` (or a long thread that already triggers pre_loop compact).
  2. Send a turn that head-drops ≥3 messages / ≥500 tokens so pre_loop runs M2 → request carries `[context_summary]…Rolling summary…`.
  3. Force tool rounds that re-blow the budget (large tool results) so mid_loop recompacts again.
  4. Observe next LLM request: notice is plain `[context_omitted]` without the prior rolling summary. Thread meta /「查看摘要」may still show the old summary (meta was patched for the Pi nit).
- **User impact**: Model loses the only compressed memory of early decisions/todos right when the session is longest and tool-heaviest — exactly when M2 exists. UI dual-truth chip can claim “含滚动摘要” (meta `mode:m2`) while the model no longer receives it. Charter item: **context budget wrong truncation**.
- **Fix direction** (not implemented here): after resolving `keepSummary` on mid_loop, re-`attachRollingSummaryToMessages(messages, compact.droppedCount, keepSummary)` (or pass prior summary into `applyContextBudget`/`buildOmitNotice`). Also send event `mode: "m2"` when keepSummary is reused. Add an orchestration test for pre_loop M2 → mid_loop drop → request still contains `SUMMARY_PREFIX` + prior bullets.

### MED

#### M1 — mid_loop overwrites `dropped_count` / event `mode` with this-pass-only stats
- **Where**: `adapter.ts` meta write + `thread.context_compacted` payload use `compact.droppedCount` and local `mode:"m1"` even when `keepSummary` restores M2 text for UI.
- **Repro**: Same as H1; chip shows a small mid_loop drop count and may briefly treat mode as m1 on the live event (`useWebSocket.ts:727` trusts `msg.mode`).
- **User impact**: Understates how much was omitted; mode label can disagree with meta/rolling summary. Secondary to H1.

#### M2 — single `thread.delete` hard path still does not broadcast `thread.deleted`
- **Where**: `message-router.ts:1206-1207` returns to the requester only; no `session.broadcast`. Contrast: `batch_delete` hard broadcasts per id (`:1261`); trash path broadcasts `thread.trashed` (`:1201-1202`).
- **Repro**: Two Side Panels open → permanent-delete one thread from trash (single 🗑, not batch) in panel A → panel B list keeps a ghost row until next list refresh.
- **User impact**: Multi-panel desync (rare). Optimistic local REMOVE hides it for the actor. Residual History IA nit, still open, still user-impacting for multi-surface.

#### M3 — shell residual: win32 tree-kill best-effort; no full WS integration test
- **Where**: `shell.ts:99-111` `taskkill` fire-and-forget; suite skips hard grandchild proof on win32; no e2e `chat.abort`→registry test (unit registry/signal covered in `shell-abort-timeout.test.ts`).
- **User impact**: Theoretical orphan children on Windows if `taskkill` fails silently. Direction is safe (kill). Dual-review non-blocking; still residual.

### LOW

#### L1 — Voice mic: async `permissions.query` can double-`begin()` before phase flips
- **Where**: `useVoiceInput.ts:148-166` — phase checked only synchronously at toggle entry; granted path calls `begin()` without re-check.
- **User impact**: Double-start edge if user double-clicks during permission resolve; usually recovered by second toggle stop. Low.

#### L2 — History IA residual nits (non-user-blocking if H1 fixed)
- `thread.delete` server validator still omits `mode` enum pin (`server.ts` validators vs router default-hard).
- `AtThreadPopover` keydown without `{ capture: true }` (works today because App does not preventDefault on gated keys).
- No automated App-level test for `atVisible` Enter gate (reducer/list_scope tests exist for B2).

#### L3 — analyze_image / Trust B / shell test-shim nits closed or cosmetic
- analyze_image R3 nits (sanitizeImageDim DRY) cosmetic.
- Trust B empty `packId` branch / cast guards cosmetic.
- Extension `doesNotMatch` CI break from shell abort R1: **closed** via `assert.ok(!/超时/.test(meta))` in `shell-card-utils.test.ts:101-102`.

## Demoted / false positives

| Claim | Why demoted |
|-------|-------------|
| Soft-delete default on single `thread.delete` (History IA R1 B1) | **Fixed**: default hard unless `mode:"trash"`. |
| Trash list auto-creates / steals active (B2) | **Fixed**: `list_scope` + SET_THREADS guards. |
| `@` Enter double-send (B3) | **Fixed**: `atVisible` gate. |
| shell abort leaves grandchildren / SHELL_BUSY stuck | **Not reproduced in code**: tree kill + flight `finally` after resolve; unit tests cover signal/registry abort. |
| Voice error banner clobber / wrong-thread merge / auto-send | **Fixed** in M1 R2 (ENGINE_END preserves error phase; no auto-send; chat_abort discards). |
| analyze_image data: expands schemeOk / phase2 L2 | **False**: early local decode return. |
| Trust B sticky cruise after delete/uninstall | **Fixed** in s46 lifecycle + `releaseTrustBeforeThreadGone` on delete paths. |
| mid_loop **meta** wipe of rolling_summary (M2-meta Pi nit #1 as stated) | **Partially fixed**: meta keep path present; **request path still broken** → reclassified as **H1**, not demoted. |
| Digest 8-way concurrent LLM on `@` | **Fixed**: queue concurrency 2. |

## Residual dual-review nit ledger (this batch)

| PR / theme | Prior dual residual | Live status | User-impacting? |
|------------|---------------------|-------------|-----------------|
| #126 Trust B | cosmetic journal/cast | open, non-blocking | no |
| #127 History IA R2 | mode validator, broadcast asymmetry restore, capture keydown, atVisible test | M2 broadcast gap still yes; others nits | M2 multi-panel only |
| #128 shell abort | doesNotMatch CI, win32 kill, no e2e | CI fixed; win32 residual | low |
| #129 voice M1 R2 | dead ENGINE_END branch, timeout copy | open cosmetic | no |
| #130 analyze_image R3 | sanitizeImageDim DRY | open cosmetic | no |
| #131 context budget M2-meta | mid_loop wipe request+meta | meta fixed, **request not** | **yes → H1** |

## Recommendation

1. **Block ship-closeout of #131 / context budget** until H1 is fixed + regression test (pre_loop M2 → mid_loop recompact → request still has summary).
2. Optionally fold M1 (event mode + dropped_count) into the same patch.
3. Schedule M2 (single hard-delete broadcast) with other multi-panel sync polish — not a single-panel blocker.
4. Do not re-open Trust B / trash isolation / shell tree kill / voice M1 / analyze_image data: on correctness grounds without new repros.

**Acceptance for re-review**: H1 green test + manual repro no longer loses `[context_summary]` after a tool-round recompact; then this lane can move to **PASS_WITH_NITS** (M2/M3/L*).

VERDICT: REQUEST_CHANGES
