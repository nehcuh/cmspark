## Review: C10 Phase G (extension tool-forward extraction)

**Inspected artifacts**
- Commit `39a83da` diff (server.ts −201 / ws/tool-forward.ts +356 / ws-tool-forward.test.ts +139 / companion-dispatch.ts comment-only)
- Source: `companion/src/ws/tool-forward.ts:1-356`, `companion/src/server.ts:78-99, 281-322, 558-576, 607-617, 968-980, 1278-1342, 1388, 2026-2029`
- Phase-G implementer doc (`c10-godfile-split-phase-g-tool-forward-20260811.md`)
- Re-derived git diff against `git show 39a83da` — patch file is not stale

**Verified**

1. **Code-motion is algebra-preserving**
   - `tabUrlCache.set(...)` → `getTabUrlCache().set(...)` (same `const` Map at server.ts:313, captured by closure at 1338).
   - `refreshTabUrlCache` and `getThreadManager` injected via `bindToolForwardRuntime`; bound eagerly at server.ts:1388 (after `tabUrlCache` decl at 313), and re-bound from `initServices` (561) + `seedThreadManagerForTests` (576).
   - Lazy `require("./orchestrator/tab-lease")` / `require("./orchestrator")` correctly rewritten to `../orchestrator/…` for the new file's location.
   - `logToolFinish` passed per-call; `startedAt` / `actingThreadId` / `finalParams` are all in scope at the new terminal (server.ts:970).

2. **SEC-E (origin mismatch)** — preserved. `pendingToolCalls` entries set `originWs: ws` in both `dispatchToExtension` (tool-forward.ts:183) and `forwardToolToExtension` (tool-forward.ts:330). `handleToolResult` ignores a non-matching peer silently (tool-forward.ts:126-132). `pending-tool-origin-ws.test.ts` 2/2 pass.

3. **Per-tool timeout** — `resolveToolDispatchTimeoutMs` invoked in `forwardToolToExtension` (tool-forward.ts:315); `dispatchToExtension` correctly retains fixed `TOOL_EXECUTION_TIMEOUT_MS` (image-fetch is never `browser_download`).

4. **Post-effects** — `list_tabs` (refresh + lease enrichment), `navigate`/`set_tab_url` (cache set), `create_tab` (cache set + multi-agent auto-hold), `close_tab` (lease release) all preserved verbatim.

5. **image-fetch** — `runImageFetchAdmission` still receives `dispatchToExtension` injected from server.ts:839.

6. **External consumers** — `message-router.ts` and others `await import("./server")` for `rejectPendingForThread`/`hasPendingForTab`/`rejectPendingForTab`; server.ts re-exports (78-99) keep the surface stable.

**Executed tests** (all green)
- `npx tsc --noEmit` — exit 0
- `ws-tool-forward.test.ts` — 7/7
- `pending-tool-origin-ws.test.ts` — 2/2
- `image-fetch-admission.test.ts` — 8/8
- `orchestrator-tool-pregate.test.ts` — 8/8
- `integration/security-gates.test.ts` — 63/63 (matches implementer claim)
- `integration/ws-roundtrip.test.ts` — 5/5 (end-to-end tool.execute ↔ tool.result)

**ADR-020 capability checklist** — Diff is pure code-motion refactor (no new tools / gates / primary UI / originWs regression). Surface/Compose/Autonomy/Trust/Channel declaration not required for pure-refactor diffs per checklist §"Required from implementer".

**Non-blocking nits**

1. `tool-forward.ts:325` stores `reject` in the pending entry but never invokes it (only `finishAndResolve → resolve` is called, even on timeout / send-failure / not-connected). This mirrors the pre-existing behavior in server.ts and is therefore not a regression; could be cleaned up later by dropping `reject` from `PendingToolCall` or replacing with a no-op.
2. server.ts:78-99 has the import + re-export lists duplicating the same 8 symbols. Cosmetic — same shape as prior C10-E/F extractions, consistent with house style.
3. FREEZE header in `tool-forward.ts` could mention that `applyConnectionCloseGracePeriod` still lives in server.ts (1278) and depends on the `pendingToolCalls` re-export; this is documented in the phase-G review doc but not in the source comment.

No incomplete fixes, no security regressions, no missing tests, no wrong file:line references, no over-claiming. The implementer's `2635 → 2434 (−201)` LOC delta matches exactly.

VERDICT: APPROVE_WITH_NITS
