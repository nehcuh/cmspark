I'll read the remaining production callers and reducer paths the packet only excerpts, then judge closed/compacted feedback, typed dispatch, cache, TTL, and preview isolation against the frozen source.# Independent Grok 4.6 finalR3 combined review — coding UI #484/#522 + preview #532

**Verdict: APPROVE_WITH_NITS**  
**Severity: no confirmed P0 / P1 / P2**  
**#522: remains PARTIAL** (do not write `Closes #522`)  
**#484 / #532: closable only after remaining named-review + exact-head CI gates**  
R2 Grok `APPROVE_WITH_NITS` is not evidence for this freeze. Office R2 P2s are checked against this source, not against R2 approval.

Machine PASS (host 5939/5887 + 52 skips, extension 1546, ARM targeted, both builds 0) is inventory, not correctness proof.

---

## 1. R2 Office P2s — closed and compacted refusals

**Refuted as remaining in this freeze. Both are actually closed in source.**

### Closed followup / prompt / apply

R2 failed because untyped ACP errors were treated as Stop (`ACP_CONTROL_ERROR`), and the closed-row fence dropped them.

Producer now stamps the dispatched operation:

```69:89:companion/src/acp/handlers.ts
      request_type: type,
      session_id: sid, ...(session ? { thread_id: session.thread_id } : {}),
    }
  }
  // ...
    ...(result.type === "error" ? { family: "acp", request_type: type } : {}),
```

Feature-disabled followup (`handlers.ts:282`) has no local `request_type`; the outer wrapper still stamps it. Closed prompt uses `promptSession` → `propose` disabled copy, then the same wrapper (`request_type: "acp.session.prompt"`). Closed apply uses `session is not propose_diff` (`handlers.ts:392`) with `request_type: "acp.apply_diff"`.

Frontend dispatch is exact-string only, no `String` / `toString` coercion:

```10:21:chrome-extension/src/sidepanel/utils/coding-control-message.ts
  if (message.type === "error" && message.family === "acp" && message.request_type === "acp.session.cancel") return {
    type: "ACP_CONTROL_ERROR", ...
  }
  if (message.type === "error" && message.family === "acp" &&
      typeof message.request_type === "string" &&
      ["acp.session.followup", "acp.session.prompt", "acp.apply_diff"].includes(message.request_type)) return {
    type: "ACP_OPERATION_ERROR", ...
  }
  return null
```

`ACP_CONTROL_ERROR` still rejects closed / compacted / cancel-confirmed rows (`agentStore.tsx:1991-1992`). `ACP_OPERATION_ERROR` does not. It requires a known row, stored owner, current thread, and current selection (`1998-2005`), then stores a ≤1000-character notice without mutating records or selection.

Chip keeps the notice and blocks 12s auto-dismiss (`CodingSessionChip.tsx:23-31, 93`). Panel renders the same notice (`CodingAgentPanel.tsx:1090`).

**Reproduction (closed):** owner-stamped cancel ack → state `closed` + `cancelConfirmed` → chip 追问 → WS `{type:"error", family:"acp", request_type:"acp.session.followup", ...}`. Notice is visible; Stop pending/error is unchanged; row stays closed.

Missing / unknown / non-string `request_type` still return `null` and keep `processingStatus` (`useWebSocket.ts:2418-2428`).

### Compacted followup

`ACP_OPERATION_ERROR` does not require a rich row. Compacted identity is enough if it is still the selected owner session.

**Reproduction:** terminal row compacted while another thread is active → return to owner → 追问 → same producer followup refusal. `codingSessionsById` / `codingSessionIdByThread` stay referentially equal; `cacheCompacted` stays true; `handback` is not restored; chip/panel alert uses the real `error` string.

---

## 2. Typed cancel vs operation, owner / selection / stale Stop

| Gate | Source | Result |
|---|---|---|
| Cancel only → Stop | `coding-control-message.ts:10` `=== "acp.session.cancel"` | Pass |
| Followup/prompt/apply → notice | `:14-18` exact list | Pass |
| Non-Stop cannot clear `stopPending` | `ACP_OPERATION_ERROR` only writes `codingOperationError` | Pass |
| Stop refusal can clear pending | `ACP_CONTROL_ERROR` sets `stopPending: false` (`1995`) | Pass |
| Late Stop error after closed | `1992` rejects `state === "closed"` / compacted / `cancelConfirmed` | Pass |
| Wrong-owner ack/error | reducer `row.threadId !== action.threadId` | Pass |
| Runtime `{ok:true}` is not Stop | `codingControlAction({ok:true})` is null; `useCodingStop.ts:28-31` | Pass |
| Stale callback after replacement | `ACP_CONTROL_ERROR` is row-fenced; new session is a different id | Pass |
| Notice follows current selection | `selectCodingOperationError` `110-117`; cleared on thread switch (`applyActiveThreadSwitch:1039`), new session id (`1976-1978`), dismiss (`2019-2020`) | Pass |
| Retry clears notice | `ACP_OPERATION_REQUEST` → `null` (`2004-2005`) | Pass |

`useWebSocket.ts` merge keeps both deltas: `confirmationPreviewFromMessage` (`:4`, `:928`) and `codingControlAction` (`:7`, cancel.ack `:1675-1677`, ACP errors `:2418-2419`). Confirmation request case does not go through ACP error routing.

---

## 3. Closed latch and compacted `cancelled` marker

```1935:1936:chrome-extension/src/sidepanel/store/agentStore.tsx
      if (previous?.cacheCompacted) return state
      if ((previous?.cancelConfirmed || previous?.state === "closed") && e.state && e.state !== "closed") return state
```

Plain `state:"closed"` is terminal without ack. Same-id late `running` cannot revive it. Compacted rows ignore all later events.

Cancel sets `session.error = session.error || "cancelled"` and emits closed progress (`manager.ts:1116-1129`). Reducer:

```1965:1965:chrome-extension/src/sidepanel/store/agentStore.tsx
        cancelled: ((e.state ?? previous?.state) === "closed" && e.error === "cancelled") || previous?.cancelled,
```

Compact keeps the marker without rich error text:

```17:17:chrome-extension/src/sidepanel/utils/coding-session-cache.ts
    cancelled: row.cancelled || row.error === "cancelled",
```

UI copy: `cancelConfirmed || cancelled` → `已停止`; offered/confirmed → `待启动` / “尚未开始运行”; `running` only when `state === "running"` (`CodingAgentPanel.tsx:1122,1131`; chip `:83-84`).

---

## 4. Cache 16 / 256KiB and producer projection

`pruneCodingSessionCache` (`coding-session-cache.ts:22-39`):

- Eligible: uncompacted `closed`/`handback`, no pending diff, not current selection (unless dismissed).
- Protected: current selected, nonterminal (including `offered` / `confirmed` / `unknown-future`), `hasPendingDiff`.
- Both count ≤16 and UTF-8 JSON bytes ≤256KiB; oversized eligible rows compact below the count cap; oldest first, session-id tie-break.
- Markers remain; tiny-marker count is unbounded (stated #484 limit).

Producer (`ui-progress.ts:7-53`, `manager.ts:205-229`, `lifecycle.ts:660-667`):

- 128KiB UTF-8 live projection before listeners/broadcast.
- Text caps; diffs metadata only, ≤64 descriptors, keep one `applyable`.
- `output_truncated` on partial display.
- Identity/command not rewritten; oversize metadata returns `null` and is withheld.
- Canonical `ThreadManager` save happens before `codingHandbackView`.

---

## 5. Original 60s command TTL; #522 stays PARTIAL

```383:384:companion/src/acp/win-spawn.ts
export const MODE_C_TEMPFILE_TTL_MS = 60_000
export function scheduleUnlink(paths: string[], delayMs = MODE_C_TEMPFILE_TTL_MS): void {
```

`commandDeadline = Date.now() + MODE_C_TEMPFILE_TTL_MS` at opener request (`manager.ts:288,324-336`). That is at or before unlink scheduling after settle. File lifetime is not extended.

`retainTerminalCommandLine` drops empty/oversize whole commands (`progress-caps.ts:26-28`, 32KiB UTF-8). Copy is local clipboard only (`CodingAgentPanel.tsx:1166-1184`).

Default-off / missing / oversize / expired still have no usable CLI entry: `open_local_terminal_snapshot !== true` → `skipped` with no command (`manager.ts:256-258`). UI then shows “本次启动命令不可用 / 已过期；请自行切换到已有外部终端.” That is instruction, not entry. **#522 remains PARTIAL.**

---

## 6. Preview #532 — human-confirmation only, 45s / 5s, nonce/ACL, late raw

| Invariant | Evidence | Result |
|---|---|---|
| Reasons only on confirm UI | admission `1562` → manager `338-339` → WS whitelist `confirmation-preview.ts:17` → `ConfirmationPreview` | Pass |
| Not in tool / LLM | integration test asserts reason absent from tool result; helper nullable API unchanged | Pass |
| Fixed vocab, hostile dropped | `normalizePreviewUnavailableReason` on both sides; unknown/raw omitted | Pass |
| Preview 5s | admission `timeoutMs: 5000`; helper default 5000 | Pass |
| Confirm 45s | `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = 45000`; frames `timeout_ms: 45000` | Pass |
| Nonce / origin / deny | nonce still string-filtered (`useWebSocket.ts:925`); `respondFrom` origin_mismatch then deny; no token | Pass |
| Settled reason once | race winner only (`l2-preview-image.ts:159-165`); late pipeline does not call `onUnavailable` again | Pass |
| Late raw cleanup | `finally` after awaits; timeout path still deletes raw; prompt stays `timeout` + no image | Pass |
| New id vs image error | `failedImageId === request.confirmation_id` (`CockpitApp.tsx:479,583-585`) | Pass |
| Success / unattempted / old protocol | no reason, no “降级确认” | Pass |
| Merge | shared WS keeps preview spread and ACP handlers; no whole-file overwrite | Pass |

`MinimalConfirm` still has no screenshot (by design). Heavy preview remains Cockpit.

---

## 7. Nits (non-blocking)

**NIT-1 — uncompacted cancelled rows still paint raw `session.error`.**  
`CodingSessionChip.tsx:91`, `CodingAgentPanel.tsx:1162` render `session.error` in addition to `已停止`. After Stop, companion error is the sentinel `"cancelled"`, so the chip/panel show a red English `cancelled` line next to 已停止 until compaction drops `error`.

Reproduction: running CLI session → matching cancel ack or closed `error:"cancelled"` before cache retirement → inspect chip/panel. Compacted no-ack path already hides rich error and keeps the marker.

**NIT-2 — followup / prompt / apply runtime `lastError` still swallowed.**  
`CodingSessionChip.tsx:59-61,70-72`, `CodingAgentPanel.tsx:731-733,760-762`. Spec calls this preexisting and out of incremental scope. `ACP_OPERATION_REQUEST` still clears the companion notice on retry, so a disconnected retry can hide the last visible refusal with no new alert. Not a reopen of Office P2 (that was WS `request_type` + closed/compacted reducer drop).

---

## 8. Closure / gates / limitations

- **#522:** Stop feedback + valid-command copy: implemented. Default-off / missing / oversize / expired entry: **not** implemented. No `Closes #522`.
- **#484:** inactive rich cache + producer projection: implemented in this freeze. Closure still needs exact CI + remaining named judges.
- **#532:** operator diagnostic only. Closure still needs those parent gates. #530 5s misconception is not a timeout change here.
- DOM/App checks are isolated synthetic transport/clipboard, not native ScreenCaptureKit / Windows capture / T4 / live terminal.
- Exact new-head / main CI is still pending in the machine card.
- Non-Stop runtime callback swallow, unbounded tiny markers, and generic `thread.messages` pagination are outside this freeze.

---

**APPROVE_WITH_NITS.** No confirmed correctness/security counterexample that reopens the R2 closed/compacted P2s, typed dispatch, owner/selection fences, closed latch, cancelled marker, 16/256KiB + 128KiB projection, 60s TTL, or preview isolation. Do not close #522. Do not treat test counts or the R2 Grok note as approval.
