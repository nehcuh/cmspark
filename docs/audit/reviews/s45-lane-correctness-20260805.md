# Lane: Correctness — S45 main pull multi-adversarial

**Date:** 2026-08-05  
**Range:** `4a2d02f..474df7e`  
**Tip SHA:** `474df7eebe20fd830b6fb5d066d4673b7e1f87e2` (`main`)  
**Diff artifact:** `docs/audit/reviews/s45-main-pull-diff-20260805.patch`  
**Evidence mode:** patch + live tip sources `[inspected]`. Targeted suites (process-path / security-gates / computer-executor / orchestrator-tab-lease / thread-busy) **not re-executed** in this reviewer runtime (no shell). Assertions and polarity inferred from source + patch only.

---

## Verdict: REQUEST_CHANGES

Core product claims for **M3' floors**, **run-scoped intents**, **active-thread fleet scoping (#124)**, **PATH/osascript harden**, and **same-thread upload stuck-busy** are present and internally consistent.  
One **HIGH** residual violates the existing P0-B thread-isolation pattern on the new `file.upload_error` path (and the panel SW-failure callback): mid-switch / late error can **pollute the active transcript** and **false-clear global `isProcessing`**. That is the same class of busy/state-machine bug S44 claimed to close — fix before treating the upload busy state machine as complete.

Everything else is MEDIUM under-report / residual UX isolation or LOW/NIT test-coverage debt.

---

## Claim matrix

| Theme | Claim | Status | Evidence |
|-------|--------|--------|----------|
| #122 M3' floors | god-mode / domain / auto_approve alone still forceConfirm critical evaluate; three-flag cruise waives | **FIXED** | `server.ts` ~1467–1486: `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`; browser-script `skipConfirmation` waiver removed |
| #122 re-L2 cruise | danger / experimental still prompt under cruise | **FIXED** | `executor.ts` ~643–667: cruise short-circuit only when `!forceInteractive && !reL2ShouldPrompt` |
| #122 open_intents_by_run | run-scoped intents; no global fallback when run known | **FIXED** | `fleet.ts` ~112–143; `thread-busy.ts` `resolveOpenIntentsForRun` / `resolveOpenIntentsForScope` |
| #123 PATH harden | drop file-in-PATH; restore system bins; absolute osascript | **FIXED** | `process-path.ts`; callers in index/server/shell/cli/mcp/platform/folder-picker/menu-bar |
| #124 RunBusy / fleet | active-thread scope only; normal chat ignores foreign residual workers | **FIXED** | `buildScopedRunBusyInput` wired in App / ChatView / RunBusyChip / FleetStrip / FleetWorkerList / FocusBand |
| S44 upload busy | clear stuck on `file.upload_error` / `error` / SW send fail | **PARTIAL** | same-thread paths clear; cross-thread / unstamped `error` incomplete (F1–F3) |
| S44 reasoning | stream `chat.reasoning`; persist on `chat.done` | **FIXED** | adapter + useWebSocket + ChatView + agentStore |
| 0.4.0 packaging | qwen-vl-worker gate; drop ORT/tinyclick hard gates | **PRESENT** | package.sh / release.yml / test-package-gates.sh |

---

## Findings (F1…)

### F1 — HIGH — `file.upload_error` ignores thread gate (transcript pollution + false-ready)

**Where:** `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` ~1176–1201

**Issue:** Unlike `chat.done` / `chat.error` / `file.upload_status`, `file.upload_error` always:

1. clears global `isProcessing` / streaming / reasoning / status  
2. `ADD_MESSAGE` into **active** `state.messages` (reducer does not filter by `thread_id`)

even when `msg.thread_id !== activeThreadRef.current`.

**Contrast (correct pattern on same file):**

```314:320:chrome-extension/src/sidepanel/hooks/useWebSocket.ts
        case "chat.done": {
          const doneThreadId =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current
          if (doneThreadId) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: doneThreadId, busy: false })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
```

**Failure mode:**

1. Start upload on thread A (optimistic `SET_THREAD_BUSY` A + `isProcessing`).  
2. Switch to thread B (`SET_ACTIVE_THREAD` wipes messages, sets `isProcessing: false`, **keeps** `threadBusyById[A]`).  
3. Start chat on B (or wait while B is busy).  
4. A’s parse fails → `file.upload_error` for A:  
   - A’s mapBusy cleared (good)  
   - B’s composer unlocked via `isProcessing: false` (false-negative busy if B was processing)  
   - A’s error bubble appears in **B’s** transcript (P0-B isolation break)

**Same class on panel SW fail path:** `App.tsx` ~599–614 always `ADD_MESSAGE` + clear `isProcessing` without checking active thread still equals `uploadThreadId`.

**Fix direction (minimal):**

```ts
// mapBusy always by uploadTid
if (uploadErrTid) dispatch({ type: "SET_THREAD_BUSY", threadId: uploadErrTid, busy: false })
if (!shouldApplyStreamEvent(uploadErrTid, activeThreadRef.current)) break
// then clear panel streaming/isProcessing + ADD_MESSAGE
```

Mirror for panel callback: only mutate global processing / messages if `state.activeThreadId === uploadThreadId`.

---

### F2 — MEDIUM — unstamped WS `error` clears **active** busy, not upload thread

**Where:** `useWebSocket.ts` ~1247–1257; companion `server.ts` ~5997–5999 (`Message too large`), ~6049–6050 (`Invalid message`)

**Issue:** Oversized / invalid upload fails with `{ type: "error", error: "..." }` **without** `thread_id`. Handler:

```ts
const errTid = activeThreadRef.current || ""
dispatch({ type: "SET_THREAD_BUSY", threadId: errTid, busy: false })
// + always clear isProcessing
```

If user switched after send: **upload thread stays mapBusy forever** (no chat.done/error for that id); active thread may be falsely cleared.

**Mitigation already present:** companion parse path now returns stamped `file.upload_error`; phase try/catch wraps unexpected throws. Residual is the pre-router size/validation gate only.

**Fix direction:** stamp `thread_id` on size/validation rejects when parseable from payload prefix, **or** on panel side track in-flight upload thread ids and clear those on generic error.

---

### F3 — MEDIUM — `file.uploaded` can false-clear active processing after switch

**Where:** `useWebSocket.ts` ~1206–1217

```ts
if (upTid) dispatch SET_THREAD_BUSY upTid false
dispatch SET_PROCESSING_STATUS null
if (!streamingRef.current && !reasoningRef.current)
  dispatch SET_PROCESSING false  // not gated by active === upTid
```

`streamingRef` is active-panel only (cleared on thread switch). So A finishes upload/chat → `file.uploaded` while B is in “thinking” with no tokens yet (`isProcessing` true, empty stream) → B unlocks incorrectly.

**Note:** mapBusy clear for `upTid` is correct. Gate `isProcessing` clear with `shouldApplyStreamEvent`.

Also: companion always returns `file.uploaded` **after** `chatCreate` even when chat threw (`message-router.ts` ~831–850) — success ack after `chat.error`/`chat.aborted`. Double clear is mostly harmless; type name is misleading (NIT).

---

### F4 — MEDIUM — parent-scope open intents hard-zero (under-busy)

**Where:** `thread-busy.ts` ~198–209

```ts
export function resolveOpenIntentsForScope(...) {
  if (scope.kind === "none") return 0
  if (scope.kind === "run") return openIntentsByRun?.[scope.runId] ?? 0
  // parent without run stamp
  return 0
}
```

**Effect:** multi-agent host/worker without `orchestrator_run_id` never gets intent-only RunBusy, even if process-wide `open_intent_count > 0` belongs to that host. Intentional conservative under-report (avoids sticky foreign intents) but **false-negative** RunBusy / composer-run_busy for unstamped boards.

**Acceptable** if product accepts under-busy ≫ sticky busy; document as known residual of #122/#124. Not a regression vs foreign-sticky class.

Hosts **with** `orchestrator_run_id` correctly use `open_intents_by_run` (`fleet.ts` ~123–129 only buckets when `rid && n > 0`).

---

### F5 — LOW — scoped strip/list vs process-wide `fleet.stop_all`

**Where:** `FleetWorkerList.tsx` ~78, ~204–206; `FleetStrip.tsx` ~107

UI lists/counts are scoped (`buildScopedRunBusyInput` / `workersInFleetScope`), but **全停** still sends process-wide `fleet.stop_all`. Title warns when `scope.kind === "none"`. Correctness risk: operator believes “stop these” stops only visible workers — residual workers of other sessions die too.

Product/ops footgun, not a busy false-positive. Track as UX/correctness follow-up (scoped stop API) or keep global with stronger confirm.

---

### F6 — LOW — RunBusyChip / InputArea ignore `streamingReasoning` in `streaming` flag

**Where:** `RunBusyChip.tsx` ~26–27; `App.tsx` ~301–314 vs `ChatView.tsx` ~ streamingReasoning in `deriveThreadBusy`

ChatView: `streaming: !!(streamingContent || streamingReasoning)`.  
Composer/chip: `streamingContent` only.

**Mitigation:** `chat.reasoning` also sets `isProcessing: true` (`useWebSocket.ts` ~278), so composer still locks via `isProcessing`. Label/chip edge only if that invariant is later relaxed. Align flags for defense-in-depth.

---

### F7 — NIT — `resolveOpenIntentsForRun(null)` still process-wide

Deprecated helper keeps `if (!runId) return openIntentCount ?? 0`. Live consumers use `buildScopedRunBusyInput` → `resolveOpenIntentsForScope`. Dead-ish footgun if a future caller reuses the deprecated API for “null runId = global”. Prefer throw or always-0 when no runId to match scope.none policy.

---

### F8 — NIT — process-path Windows coverage thin

`process-path.test.ts` covers file-in-PATH unix harden, empty-ish segments, absolute osascript (darwin-only integration), MCP/shell child env. **Missing:** explicit `platform: "win32"` + `;` delimiter + System32 candidates with injected `isDirectory`; empty PATH on win32; `Path` vs `PATH` dual-key behavior under non-Windows CI.

Logic in `essentialPathCandidates` / `hardenPath` looks sound for win32 (`process-path.ts` ~76–85, 110–132); residual is test gap, not inverted policy.

---

### F9 — NIT — packaging / version bumps

0.4.0 + qwen-vl-worker hard gate + drop ORT/tinyclick stage are consistent across `package.sh`, `release.yml`, `test-package-gates.sh`. No correctness defect for runtime busy/PATH; gate-only windows path now requires qwen worker source/dist. Fail-closed packaging is correct for the new product claim.

---

### F10 — NIT — tool.start clears live reasoning bubble (active only)

`useWebSocket.ts` ~434–440 clears streaming/reasoning when tools start after gate. Correct for multi-round tool loops; intermediate reasoning only survives if companion saved it on the tool-bearing assistant message (`adapter.ts` persists `reasoning_content` on that turn). Inspected; no bug if product expects reasoning on the pre-tool assistant only.

---

## Positives

1. **M3' algebra restored cleanly** — single waive path `userFullAutonomy` three-flag; audit reason only `full_autonomy_cruise`. Inverted tests in `security-gates.test.ts` match code polarity (god-mode alone / domain / auto_approve alone → forceConfirm; full cruise → waive + audit). `[inspected]`

2. **re-L2 ordering** — cruise no longer sits above PROMPT_ALWAYS; danger/experimental stay interactive; empty/unknown tags fail-closed via `reL2ShouldPrompt`. Cruise danger test added in `computer-executor.test.ts`. `[inspected]`

3. **#124 fleet isolation is thorough** — pure `resolveFleetScope` / `workersInFleetScope` / `buildScopedRunBusyInput` shared by composer, chip, chat footer, FocusBand, FleetStrip, and drill-down list. Regression fixture `v5gkth` / foreign `7eyxoz` in `thread-busy.test.ts` encodes the production sticky-busy bug. `[inspected]`

4. **open_intents_by_run** companion emission + WS validation (object, non-array, number values only) + no global fallback when run id known. `[inspected]`

5. **PATH harden design is right-shaped** — drop non-dirs first, keep user order, append essentials, absolute `OSASCRIPT_BIN` for macOS spawns (server osascript_eval, folder-picker, Chrome opener, tray notify). Early `applyHardenedProcessPath` on index + server start. `[inspected]`

6. **Same-thread upload stuck path is fixed** — optimistic busy + SW send fail clear + companion `file.upload_error` + outer try/catch + `file.upload_status` progress + diagnostics without base64 body. Historical “parse fails → forever 思考中” is addressed for the common path. `[inspected]`

7. **Reasoning stream** — adapter emits cumulative `chat.reasoning`; done carries `reasoning_content`; UI collapsible live/final; thread switch clears `reasoningRef`. `[inspected]`

---

## Test evidence

| Suite | Claim coverage | This lane |
|-------|----------------|-----------|
| `chrome-extension/tests/thread-busy.test.ts` | open intents no-fallback; fleet scope none/run; foreign residual; same-run RunBusy | **[inspected]** source; not executed |
| `companion/tests/orchestrator-tab-lease.test.ts` | `open_intents_by_run` aggregation | **[inspected]** |
| `companion/tests/process-path.test.ts` | file-in-PATH, essentials, applyHardened, shell/MCP PATH | **[inspected]** |
| `companion/tests/integration/security-gates.test.ts` | M3' inverted + full-auto positive | **[inspected]** |
| `companion/tests/computer-executor.test.ts` | cruise × danger_detected still prompts | **[inspected]** |
| Upload / thread-switch integration | F1–F3 races | **Missing** — no test for switch mid-upload |

---

## Recommendation summary

| Priority | Action |
|----------|--------|
| **P0 (blocks “upload busy complete”)** | Gate `file.upload_error` UI mutations with `shouldApplyStreamEvent`; always clear **stamped** mapBusy; same for `App.tsx` SW fail callback (F1). |
| **P1** | Gate `file.uploaded` / generic `error` `isProcessing` clear; prefer stamped thread_id on size/invalid rejects (F2–F3). |
| **P2** | Decide parent-scope intent attribution or document under-busy (F4); consider scoped stop confirm (F5). |
| **P3** | Align streamingReasoning in chip/composer; win32 harden unit cases; deprecate-or-zero `resolveOpenIntentsForRun` null fallback (F6–F8). |

**Ship posture for claimed themes:**

- **M3' + re-L2 + PATH + #124 RunBusy/fleet scope + 0.4.0 packaging:** logic looks **correct to merge/stay on main**.  
- **S44 upload busy state machine:** **not fully closed** until F1 (and ideally F2–F3) land as a small follow-up.

---

*Lane: Correctness only. Security residual elevation of three-flag cruise is product-explicit, not a correctness inversion. Architecture / product lanes may weigh F4–F5 differently.*
