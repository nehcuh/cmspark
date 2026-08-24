# Pi re-review 鈥?post-#219 kimi nits (r2)

Reviewed all four r2 lane reports plus the live sources attached: `adapter.ts`, `tool-batch-heal.ts`, `message-router.ts`, `overlay-session.ts`, `menu-bar-agent.ts`, `tool-persistence-redact.ts`. Could not execute tests (no tools this session); fold 3 relies on lane A/D executed+inspected evidence with specific line citations.

## Fold spot-checks vs live code

### 1. Adapter leftover finally (A-High) 鈥?HOLDS
`adapter.ts` finally: `takeSteer(threadId)` 鈫?`.map(s => s.text).join("\n")` 鈫?`enqueueNextRun(threadId, text)`; on `false` 鈫?`logger.warn("llm.steer_leftover_dropped", ... reason: "next_run_queue_full")`. No `dropSteer` call 鈥?only a comment explaining why not. Import line 43 is `enqueueNextRun, takeSteer` only. Concurrent-steer survival logic is sound: `takeSteer` already removed the snapshot; later `enqueueSteer` entries are fresh queue items never touched.

### 2. Filler scope (A-High) 鈥?HOLDS
`replaceInterruptedFillerIfPresent`: with `assistantId`, `findIndex(m.id === assistantId)` 鈫?`from = asst+1`, `until` advances only while `role === "tool"`; missing assistant 鈫?`return false`. Both adapter call sites (success path and exception path) pass `savedAssistantId`, which is set at `addMessage` per round (`savedAssistant.id`). Contiguous-block matching verified.

### 3. Provider mock seam (A-BLOCK) 鈥?ACCEPTED (cannot execute)
Lane A/D both executed 13/13 plus private probes (`instanceof OpenAIProvider` true; `streamChat` prototype patch hit, dummy Completions missed). Production call site uses `provider.streamChat({...})` from `createProvider(config)`. No counter-evidence available; multi-lane `[executed]` corroboration is specific enough.

### 4. isDrainGateError (B-High) 鈥?HOLDS
`message-router.ts`: classifier type-wide (`error`|`chat.error`) 鈥?safe direction (push, never replace original ack).
- **create**: gate frame 鈫?`sendToExtension(drained)` + `return null` 鉁? non-gate truthy 鈫?return drained (happy path successor returns null) 鉁?- **upload**: gate 鈫?push + fall through to `return { type: "file.uploaded", ... }` 鉁? `else if (drainedAfterUpload) return` is latent-non-null only (Lane B O1, non-blocking)
- **regenerate**: gate 鈫?push + `return null` 鉁?- **abort**: all truthy drained pushed inside setImmediate; always returns `chat.aborted` 鉁?`drainNextRun` pre-checks lease+conductor BEFORE `takeNextRun`, so gate rejects keep the message queued 鉁? LLM-cap rejection after take is surfaced via pushed chat.error frame 鈥?bounded edge case, error visible, not a silent drop of the original ack.

### 5. Overlay reclaim gate (C-High) 鈥?HOLDS
`shouldReclaimLiveOverlayThread` requires `overlaySessionIsLive(liveSessionToken)` (i.e. `live && token === generation`). `beginOverlaySession()` bumps generation 鈫?old bound token dies 鈫?stale-claim reclaim no-ops even while `summonerThreadId` string lags. `reclaimLiveSummonerThread` reads the bound `summonerThreadSessionToken`. All production assigns route through `bindSummonerThread(id, token)` with the session token in hand (hydrate win, submit hydrate callback gated by `overlaySessionIsLive`, submit ok, new-thread claim); close 鈫?`invalidateOverlaySession()` + `clearSummonerThread()`. `setSummonerThreadId` binds with `currentOverlaySession()` 鈥?zero production callers (nit, Lane C).

### 6. Redact (D-High x3) 鈥?HOLDS
- `SENSITIVE_KEY_RE` = `/(secret|token|password|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)/i` 鈥?authorization/bearer/apikey covered (case-insensitive) and recurses nested `headers.Authorization` via `redactSensitiveKeysDeep`.
- `plainErrorResult` reconstructs `{success:false, error, error_code?}` on a fresh object 鈥?no stdout/stack/env extras; INTERRUPTED marker preserved (fillers are data-less `{success:false,error,error_code}` so they hit this branch, never the data-collapse branch).
- Codeish tools: `data` present 鈫?always `{redacted:true, len, sha256}`; no 鈮?00 plaintext path exists.

## Open nits (all non-blocking, all documented by lanes)
1. Leftover鈫抧extRun drops `clientMessageId` (`adapter.ts` finally maps text only; `run-queues` queue is `string[]`); mid-run steer path retains F1. Nit.
2. `passwd` / bare `value` keys persist on non-cookie tools 鈥?regex coverage hole, nit.
3. `setSummonerThreadId` export binds with current generation 鈥?zero production callers, latent only, nit.
4. No automated pin for post-`takeSteer` concurrent survival on queue-full (private probe only); `persistHealedToolRows` whole-tape id-skip residual 鈥?different bug class, not a regression of this fold.
5. M3 pack.apply router tests, N1/N9 鈥?explicitly out of slice per instructions.

## No new BLOCK/High found
I attempted to falsify the variants lanes did not explicitly enumerate: (a) `enqueueNextRun` throwing in the finally instead of returning false 鈥?same contract as the existing enqueue path, pre-existing; (b) recursive drain chain draining the full queue 鈥?terminates (each recursion consumes one, queue-count guard), generation-CAS per recursion holds; (c) abort-tick drain racing a fresh chat.create 鈥?slot pre-check makes it a no-op or surfaces an error, benign; (d) data+error_code error rows losing error_code in the collapse branch 鈥?INTERRUPTED fillers are data-less so the heal flow keys never hit it. None rise to BLOCK.

VERDICT: APPROVE_WITH_NITS
