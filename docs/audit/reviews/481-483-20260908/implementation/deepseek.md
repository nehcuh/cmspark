# Independent T3 Review: Issues #481/#482/#483

**Scope:** terminal/diff targets, async callbacks, final text duplication/loss, permissions/payload ACL, session ownership, voice finalization.

---

## Findings

### 1. HIGH — Voice final duplication via partial polling after classic stop (`companion/src/summoner/voice-input.ts`, `poll()`)

**Trigger:** Local engine with non-`large-v3-turbo` model. User clicks mic to start, then clicks mic again to stop while `poll()`'s 1400ms timer(s) are still alive.

**Defect:** `stop()` sets `s.stopping = true`, which `poll()` checks on both the timer callback and after `await`-ing `s.queue`. However, `s.queue` chains all posted `/api/stt/chunk` and `/api/stt/partial` requests. Because `queueChunk()` appends to `s.queue` and `poll()` snapshots the queue at schedule time, the scheduled request can execute **after** the final `/api/stt/end` POST was appended by `stop()`. The server may respond to the partial request with an SSE `voice.stt.partial` or final `voice.stt.result`, which `applyEvent()` will consume before `stop()`'s end-promise resolves. If the server returns `voice.stt.result` as the partial response (some engines do final on partial), the final text gets committed twice when end later resolves.

**Concrete failure path:**
```
1. start → poll(t0) scheduled; queue = [start]
2. audio chunk → queue = [start, chunk]  
3. poll t0 fires → post partial → queue = [start, chunk, partial]
4. stop() → flush() → queue = [..., chunk, partial, end]
5. partial response returns "FINAL" via SSE → applyEvent() → finish() commits
6. end response returns "FINAL" → stop().then() → finish() commits duplicate
```

Also, `applyEvent()` for `voice.stt.result` is not handled as a termination condition — `s` is still live and `s.stopping` is true, so the SSE branch in summoner-web (meeting only) is excluded but the dictation handler returns `true` and does nothing. The HTTP `end` resolves separately and commits. This violates the design "partial recognition is distinct from final text" and "final text must not duplicate."

**File/fix:**
- In `SUMMONER_DICTATION_JS`, modify `poll()` to **capture the current session generation** and check it against `s.stopping` after queue flush, and cancel any scheduled partial when `stop()` is invoked.
- In `applyEvent()`, treat `voice.stt.result` received while `s.stopping || s.stopped` as **already finalized** and return `true` without committing.
- Ensure `stop()` completes the end-post before allowing `finish()` to be called from any source. A single `finalizeOnce` guard on the session object is the cleanest fix.

---

### 2. MEDIUM — HTTP dropped in `summoner-web.ts` voice start/end error path leaks sticky `overlaySttSessionId`

**Trigger:** `dispatchAllowed("voice.stt.end", ...)` returns an error (e.g., Companion momentarily unavailable). The HTTP response is sent to the browser as an error JSON, but the server never clears `overlaySttSessionId` if end never succeeded.

**Defect:** `SUMMONER_DICTATION_JS`'s `stop()` checks `checked(d)` on the end response, so it surfaces an error to the user; however, the server-side `overlaySttSessionId` remains set, which could gate a **future** meeting STT session (`voice.stt.result` handler uses `sttFeatsBySid[sid]` lookup, but the overlay session tracking may hold the stale sid). Depending on how `voice.stt.start` uses `overlaySttSessionId`, the stale lease can cause `session_busy` on the next invocation.

Looking at the diff, no changes were made to `overlaySttSessionId` cleanup on error. The server-level `voice.stt` error paths do send responses, but none clear the session tracking.

**File/fix:** In `summoner-web.ts`, the `voice.stt.end` / `voice.stt.abort` handler should clear `overlaySttSessionId` when the dispatch returns an error or times out. Also consider a TTL or generation check in the `voice.stt.result` SSE route.

---

### 3. MEDIUM — `codingMessageTargetsThread()` uses only `thread_id`, but `acp.session.followup` replies may carry `parent_session_id` only

**Trigger:** The extension uses `codingMessageTargetsThread(msg, activeThreadRef.current)` in `useWebSocket` for `acp.*` error and `acp.apply_diff.result` dispatch. The companion's `handleAcpWsMessage` wrapper ensures replies carry `thread_id: owner` when a session exists, but the `acp.ui_start.accepted` / `denied` reply path in the wrapper uses the `acp.ui_start` input's `thread_id` (line ~190 in `acp/handlers.ts`), which may be **empty** if the UI start was initiated from the legacy offer flow that omitted it.

**Concrete case:** Old extension build (or another client) sends `acp.ui_start` without `thread_id`, but with a goal. The companion sets `owner = msg.thread_id` (undefined) and reaches no fallback to `ctx.threadId`. The reply is then `{type:"acp.ui_start.accepted", ...}` without `thread_id`. New extension's `codingMessageTargetsThread(msg, activeThreadRef.current)` rejects the echo because `msg.thread_id` is missing. The user sees no accepted/denied status even though the L2 confirmation was shown and the backend started the session.

**File/fix:**
- In `handleAcpWsMessage` wrapper (`companion/src/acp/handlers.ts`, ~line 54), change the owner fallback for `acp.ui_start` to `msg.thread_id || ctx.threadId` (a *string* type check) before returning.
- Alternatively, in the wrapper, after the internal call, use `result.thread_id` if the result carries it, then `session?.thread_id`, then `ctx.threadId`. Do not rely solely on the input.

---

### 4. LOW — `agentStore.tsx` reducer allows a malicious or buggy event to change a session's owner if `thread_id` conflicts with the cached record (`codingSessionsById` overwritten without ownership keying)

**Trigger:** `ACP_SESSION_EVENT` with a known `session_id` but a different `thread_id` than the existing record. The reducer's guard is:
```
const owner = typeof e.thread_id === "string" && e.thread_id ? e.thread_id : previous?.threadId
if (!owner || (previous && previous.threadId !== owner)) return state
```
This is correct for existing records. But for a **brand new session_id**, if a malicious/buggy event sends `thread_id: "b"` while the active thread is `"a"`, the session will be inserted into `codingSessionsById` with `threadId: "b"` and `codingSessionIdByThread["b"] = sessionId`. The current active thread's selector (`selectCodingSession`) returns null, so the UI doesn't show it — ok. However, a **second** event with the same session_id but no thread_id will use `previous.threadId` and succeed even from the background, caching a stale session for thread B that may later be selected. No security/ACL issue here (it's a client-side store), but it can pollute the cache with unowned sessions that later get displayed when the user navigates to B, showing progress that the user's own actions never started.

**File/fix:** In the reducer, when `previous` is undefined, verify that the incoming `thread_id` is either the current `state.activeThreadId` at delivery time or match a known thread in `state.threads`. If neither, drop the event. This is more robust than accepting any first-seen owner.

---

### 5. INFO — `workspace.pick` result fixed, but `github.pick_result` and other asynchronous pickers may still leak cross-owner replies

The diff added `owner` echo to `workspace.pick` in `message-router.ts`. After a final review of the full context, other pick types (`github.pick`, `knowledge.import`, `terminal.cwd` etc.) are outside this diff's scope. However, the `CodingAgentPanel`'s `workspace.pick_result` listener now checks `owner === threadId`. If a background thread triggers `workspace.pick` while the user has the coding panel open on thread A, the result for B is now ignored. But the native pick dialog may still steal focus and block the user's foreground action. That is a UX gap, not a data corruption bug. Not a blocker for this batch; the design already states that native pickers are per-thread.

---

### 6. INFO — `useVoiceInput` change to `nearRt = o.realtimeStreaming === true` removes continuous-mode-only restriction

This broadens `streamPartial: true` to **classic** mode. The adapter now routes classic+streamPartial to `runStreamingContinuous`, which has a hard `break` when `mode === "classic"` after one window (added at line ~784). That's intentional for one-shot preview + final. Confirmed no regression for `continuous` without `streamPartial`. The adapter's `stop()` for `streamPartial` classic now uses the continuous stop path (release segment, re-arm pending with `stopGraceMs`), which is correct for the new semantics.

One nit: `runStreamingContinuous` sets `segmentCapMs = LOCAL_STT_MAX_RECORD_MS - 1_000` in `start()` when `streamPartial && mode === "classic"`. But `segmentCapMs` is also set in the body for continuous mode. No conflict.

---

### 7. INFO — `CodingAgentPanel` `sendUiStart` check for `threadId !== state.activeThreadId`

```
if (!mountedRef.current || threadId !== state.activeThreadId || !threadId || !agentId || !ws) {
```
Correct, but `state` is captured from `useAgentStore()` which returns a new object each render. `sendUiStart` is wrapped in `useCallback` with `state.activeThreadId` in deps. Confirmed. No stale closure issue.

---

### 8. INFO — Shared metadata validator `summonerThreadMetadata` is applied only on summonser surface

The HTTP path runs validator before `dispatchAllowed`. WS path runs `applySummonerPayloadPolicy` in `summoner-acl.ts`. Both enforce the same exact-set allowlist. Verified that mixed `{alias, config}` rejects before any dispatch. The validator does not strip unknown keys; it throws. Good.

---

### 9. INFO — `ThreadMetadataEditor` (extension) and summoner `metadataSave` comparison logic

Summoner compares normalized tags and folder after persist; extension's `thread-management.ts` uses `sanitize` + matching persisted response. Both correctly reject transport ACK mismatches. No final-text loss risk here.

---

## Regression Check (terminal/diff targets, async callbacks)

- Final diff duplication: covered by finding #1.
- Final text loss: classic stop now preserves full inference budget in both UI layers (extension + summoner), and the extension's `pendingWaitMs` no longer shortens classic post-stop. Good.
- Permissions/payload ACL: mixed-policy rejection functional; no workspace/trust config leakage. `workspace.pick` now echoes owner and `setWorkspaceRoot` is only invoked for matching thread.
- Session ownership: backend rejects explicit mismatch; legacy omission passes. UI gates on `codingSessionBelongsToThread`. Good.

---

## Verdict

**REJECT (blocking)**

The classic streaming preview final duplication (finding #1) is a direct violation of the design contract ("final text must not duplicate") and the user-visible result of the core #482 fix. The server and extension adapter fixes are correct, but the summoner's asynchronous partial polling races the final HTTP end. This must be resolved before merging. All other findings are MEDIUM or lower and can be addressed in the same PR or follow-up.

**Models:** Grok 4.6 + DeepSeek V4 Pro independent gates; both identify the partial/final race in `SUMMONER_DICTATION_JS` as blocking. Conclusion recorded.