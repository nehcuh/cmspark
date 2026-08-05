# S45 P0 follow-up — internal adversarial

## pass: true

## blocking: []

## summary

Live sources on branch intent `fix/s45-p0-multi-lane-followup` were inspected for the three claimed follow-ups. **All three claims are present and correctly wired**; no HIGH incomplete fix or new regression found. Residual risks are MEDIUM/LOW and do not fail the gate.

### Claim 1 — P0 upload thread isolation — **holds**

| Location | What was verified |
|---|---|
| `useWebSocket.ts` ~1176–1205 `file.upload_error` | Always `SET_THREAD_BUSY(uploadErrTid, false)` **before** `shouldApplyStreamEvent`; panel chrome (`isProcessing`, streaming clear, `ADD_MESSAGE`) only after gate. |
| `useWebSocket.ts` ~1210–1224 `file.uploaded` | Always clear mapBusy for `upTid`; `SET_PROCESSING` / status only when gate passes (and only if no live stream buffers). |
| `App.tsx` ~224–226, ~559–624 | `activeThreadIdRef` kept current; SW-fail callback always clears mapBusy for `uploadThreadId`, then gates chrome with `shouldApplyStreamEvent(uploadThreadId, activeThreadIdRef.current)`. |
| `agentStore.tsx` ~296–306 | `SET_ACTIVE_THREAD` resets global `isProcessing` / streaming / status — so gating chrome on inactive upload does **not** leave the newly active thread stuck on global processing (mapBusy on the upload tid is the durable busy signal). |

Helpers/tests: `shouldApplyStreamEvent` + upload-style foreign-thread case in `chrome-extension/tests/stream-thread-gate.test.ts`.

**Not a wrong claim**: mapBusy-always / chrome-gated split matches the stated design.

### Claim 2 — P0 fleet stop scope — **holds**

| Location | What was verified |
|---|---|
| `thread-busy.ts` ~171–206 `buildFleetStopAllMessage` | `scope.kind === "run"` → `orchestrator_run_id: scope.runId` + run-scoped confirm/title; `parent` / `none` → process-wide payload with honest “进程内全部” copy. |
| `FleetStrip.tsx` ~71, ~101–112, ~160–161 | Uses `buildFleetStopAllMessage`; sends `orchestrator_run_id` when present; disabled title when empty: **「当前作用域无 worker 可停」** (no residual-cleanup claim). |
| `FleetWorkerList.tsx` ~71–83, ~212–216 | Same payload + confirm; empty title **「当前会话无子任务可停」**. |
| `message-router.ts` ~1809–1820 | Companion already filters: `runId` → `listWorkers(..., runId)`; else all workers. |

Unit coverage: `chrome-extension/tests/thread-busy.test.ts` (`buildFleetStopAllMessage` run vs parent/none).

### Claim 3 — P1 plasmo / safe basename / stamped upload errors — **holds**

| Location | What was verified |
|---|---|
| `chrome-extension/plasmo.config.ts` L7 | `version: "0.4.0"`. |
| `file-parser.ts` ~65–69, ~256–288 | `safeUploadBasename` (basename, strip NUL, reject empty/`.`/`..`); temp write uses join + `path.relative` containment reject before `writeFileSync`. |
| `server.ts` ~5997–6028 | Oversized WS: peek `type`+`thread_id` from first 400B; `file.upload` + tid → stamped `file.upload_error` (else bare `error`). |
| `server.ts` ~6077–6094 | Invalid `file.upload` with non-empty string `thread_id` → stamped `file.upload_error`; else bare `error`. |
| `message-router.ts` file.upload path | Parse/size/type failures already return `{ type: "file.upload_error", thread_id, ... }`. |

Unit coverage: `companion/tests/file-parser-safe-name.test.ts`.

### Claim line accuracy notes (non-blocking)

- Claim wording “App.tsx SW-fail callback” is accurate for `InputArea` inside `App.tsx` (not a top-level App export).
- “P1” labels in comments on `file.uploaded` vs “P0” on `file.upload_error` are cosmetic; both implement the same isolation pattern.
- No fabricated file:line locations found relative to current live sources.

## residual_risks

1. **MEDIUM — SW send-fail dual path**  
   `background/index.ts` ~582–586 on `!sent` broadcasts bare `{ type: "error", error: "Companion 未连接…" }` **without** `thread_id`, while `App.tsx` also handles `!response?.ok` with the correct gate. Generic `error` handling in `useWebSocket.ts` ~1254–1274 always clears **active** mapBusy + chrome and may double-message or pollute the active transcript after a mid-upload thread switch. mapBusy for the upload tid is still cleared by App callback; residual is chrome pollution / double error, not sticky busy on the upload thread.

2. **MEDIUM — Unstamped `file.upload_error` fallback**  
   `uploadErrTid = msg.thread_id \|\| activeThreadRef` means a missing stamp falls back to active and `shouldApplyStreamEvent("", …)` is legacy-apply (`true`). Oversized/invalid paths that fail the stamp conditions (no peekable tid; validation fail without string tid) still emit bare `error`. Primary happy paths stamp correctly.

3. **MEDIUM — Lost error transcript when user switches mid-upload**  
   Gate correctly suppresses `ADD_MESSAGE` for foreign threads. Errors are not buffered per-thread; switching back reloads companion messages, which may never contain the failed upload. Result: silent absence of failure text (busy state is cleared). Acceptable for isolation P0; UX follow-up if product wants guaranteed error visibility.

4. **MEDIUM — Parent/none fleet.stop_all remains process-wide**  
   Documented in `buildFleetStopAllMessage` and honest confirm copy; companion has no parent filter yet. Intentional residual until parent-scoped stop lands — not an incomplete claim-2 implementation.

5. **LOW — Oversized peek window**  
   First-400-byte regex assumes `type`/`thread_id` near the JSON head. Current SW payload order (`type`, `thread_id`, then `files`) satisfies this; a reordered client would fall back to bare `error`.

6. **LOW — FleetStrip expanded lock list still process-wide**  
   `FleetWorkerList` scopes locks; expanded `FleetStrip` still maps `fleet.locks` unscoped. Unrelated to stop payload claim; possible UX inconsistency.

7. **LOW — No companion integration test** for oversized/invalid → stamped `file.upload_error` (unit coverage exists for basename + panel helpers only).

**Verdict**: pass=true. Ship-worthy for the three claimed fixes; residuals above are acceptable under MEDIUM-OK policy.
