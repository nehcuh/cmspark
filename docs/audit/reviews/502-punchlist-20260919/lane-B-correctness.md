# Lane B — CORRECTNESS
HEAD: 022b2f60
VERDICT: APPROVE_WITH_NITS

## Scope actually read

Production first, tests second. Traced:

- `companion/src/threads/thread-manager.ts` — liveMirrors, addMessage isAppend-before-trim, latest_tool stamp
- `companion/src/llm/adapter.ts` — rebuildMessagesFromHistory(+live), persistAssistantDraft, rememberToolResult, round_limit chat.done, content-risk quarantine
- `companion/src/llm/tool-batch-heal.ts` — createToolResultMessage → archiveToolPayload, persistHealedToolRows, replaceInterruptedFillerIfPresent
- `companion/src/security/tool-persistence-redact.ts` — archiveToolPayload / stubFailureResult (#511)
- `companion/src/loop/loop-kernel.ts`, `loop-state.ts`, `loop-status.ts`
- `companion/src/orchestrator/fleet.ts`, `fleet-suggest.ts`, `expert-team.ts` (persistWorkerBrief / invokeKick)
- `companion/src/tool/companion-dispatch.ts` — spawn_worker (goal/brief/kick/BOARD_MISSING), fleet_suggest_propose
- `companion/src/message-router.ts` — broadcastLoopStatus then drainNextRun, run-end fleet push
- `companion/src/server.ts` — kickWorkerChat skipUserMessage:true + scheduleWhenLlmSlotAvailable
- `companion/src/acp/manager.ts`, `open-local-terminal.ts`, `pty/handler.ts`, `pty/session.ts` (#506)
- `companion/src/tool/l2-admission.ts`, `security-confirmation.ts` (workerId stamp)
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`, `store/agentStore.tsx`, `components/tool-history-view.ts`, `ChatView.tsx`, `LoopStatusRow.tsx`

[executed] `npx tsx --test tests/live-rebuild-continuity.test.ts` (4/4), `tests/fleet-suggest-dispatch.test.ts` (16/16), `tests/loop-kernel.test.ts` (31/31). [executed] chrome-extension `tests/tool-history-view.test.ts` + `tests/round-limit-unarmed-hint.test.ts` (39/39).

## Findings

### P-B-1 — MAJOR
- File: `companion/src/llm/adapter.ts:435-444` (rebuild prefers live), `companion/src/llm/adapter.ts:2328-2349` (quarantine), `companion/src/llm/adapter.ts:283-330` (`quarantinePersistedToolRow` disk-only), `companion/src/llm/adapter.ts:1251-1256` / `1925` (remember raw result, never rewritten)
- Evidence: [inspected] `#430` comment at adapter.ts:2342-2343 says disk quarantine exists so `rebuildMessagesFromHistory` will not re-send the banned body. [inspected] `#504` rebuild is `JSON.stringify(liveTool?.result ?? tc.result ?? {})` — live wins. [inspected] `quarantinePersistedToolRow` calls `updateMessage` only; `rememberLiveToolResult` is never pointed at the placeholder. [executed] live-rebuild tests prove the live substitution path; they never run the content-risk branch.
- Concrete failing scenario (input → observed vs expected):
  1. Default archive tier. `get_page_text` returns a large body that the provider 400s as content-risk.
  2. This run: in-memory row + disk row quarantined to `CONTENT_RISK_QUARANTINE_PLACEHOLDER`; live mirror still holds `{ success:true, data:{ text: <full body> } }`. Recovery retry succeeds.
  3. Same-process continue (user “继续” or armed `round_limit` drain → new `chatCreate`).
  4. Observed: rebuild substitutes the live full body (then truncates to 8000). First LLM call of the new run 400s again; recovery spends another round. Expected after the `#430` comment: next run rebuilds the placeholder from disk and does not re-offer the banned payload.
- Why production (not just a test) breaks: every same-process continue after a content-risk recovery re-injects the payload `#430` already decided was unsafe. Not fatal (per-`chatCreate` recovery still fires once), but the disk heal `#430` added is a no-op for the `#504` continue path the punch list claims to own. Restart (no mirror) is fine.
- Distinct from other findings in this file because: this is live-mirror *over-retention* after a later disk mutation, not a missing remember on first persist.
- Suggested fix: `quarantinePersistedToolRow` (and any other post-persist rewrite of a tool body) must `rememberLiveToolResult(threadId, toolCallId, { result: { quarantined:true, reason:"content_risk" }, tool_name })` so rebuild stays honest; or rebuild must not prefer live when disk `result.quarantined === true`.

### P-B-2 — NIT
- File: `companion/src/loop/loop-status.ts:156-170`, `companion/src/message-router.ts:1424-1436`
- Evidence: [inspected] armed `round_limit` broadcasts `task_loop.status` with lastTerminal then immediately `drainNextRun` → new `chat.create`. [inspected] `broadcastLoopStatus` is not called at run start (only run-end + arm/stop). [executed] loop-kernel enqueues the continuation (G1 tests green).
- Concrete failing scenario: armed thread, unticked items, 100 tool rounds → `chat.done.terminal="round_limit"` → status “这一段跑完了 n/m，接着下一段” → drain starts segment 2 (minutes). Observed: that copy sticks until segment 2 *ends*. Expected per the loop-status comment (“nothing is running at this instant”): `推进中` once the continuation is in flight.
- Why production (not just a test) breaks: not a silent cut (enqueue still happens; unarmed `#505` hint is a different gate). The between-segment copy lies for the whole next run. Loop-kernel tests cannot see it — they never broadcast.
- Distinct from other findings in this file because: UI status-frame lifetime, not tool-body rebuild.
- Suggested fix: broadcast `task_loop.status` without `lastTerminal` at drain/start (or clear lastTerminal when `abortControllers` gains the thread).

### P-B-3 — NIT
- File: `chrome-extension/src/sidepanel/components/ChatView.tsx:563`, `LoopStatusRow.tsx:280-294`
- Evidence: [inspected] `#507` tool-history correlation is thread-scoped (`pendingConfirmToolNamesForThread` + last-round ids). [inspected] `LoopStatusRow` still gets `pendingSecurityConfirmations.length` (global). [inspected] companion stamps `worker_id: actingThreadId` for main and worker (`l2-admission.ts:1321-1335`), so tool-history cross-thread flips are actually gated in production.
- Concrete failing scenario: viewing armed parent; worker has a pending L2. Observed: parent loop row elevates to “等待确认”. Expected under “L2 pending scoped to current thread”: parent stays `推进中`; only the worker/Confirm Center waits.
- Why production (not just a test) breaks: status lie only; Confirm Center queue is still global by design. `#507` tests never mount `LoopStatusRow` with a mixed queue.
- Distinct from other findings in this file because: confirm *count* on the loop row, not name→id folding.
- Suggested fix: pass `pendingConfirmToolNames.size` (or confirms whose owner === `activeThreadId`) into `LoopStatusRow`.

## Overturned / not-a-bug

- **#504 live rebuild / disk stubs / restart.** [executed] same-process run 2 sees `FULL-FIDELITY-BODY`; disk stays `{redacted:true}`; fresh `ThreadManager` (restart analog) replays the stub. Production `chatCreate` always passes `getLiveMirror`. Assistant args remembered under the persisted assistant id. `isAppend` captured before 1000-cap trim so `latest_tool` does not freeze.
- **#511 failure archive vs INTERRUPTED.** [inspected] `stubFailureResult` keeps `success` / bounded `error` / `error_code` / machine `data.{error_code,suggested_action,tab_url}` + fingerprint. Heal fillers go through `createToolResultMessage` → archive; `replaceInterruptedFillerIfPresent` still keys on top-level `error_code === INTERRUPTED`. Cookie/exec/read branches hit `plainErrorResult` before the stub. Exception path does **not** `rememberLiveToolResult`; disk still keeps the diagnostic — not a #504 body miss.
- **#505 unarmed honesty.** [inspected] sole `runStats.terminal = "round_limit"` is the while-exhaustion `chat.done` (no `finish_reason`). [inspected] `SET_RUN_TERMINAL` is applied even for background threads; cleared on new busy / user message. [executed] `shouldShowRoundLimitHint` is unarmed-only; armed backfill is a loop view.
- **#507 global-by-name.** [inspected] production L2 frames carry `worker_id = actingThreadId` (main thread included), so `confirmationOwnerThreadId` scopes. Last-round-only `pendingConfirmIdsFromTools` stops same-name historical cards. Untagged-match tests are legacy; not the live stamp.
- **#506 embed_intent → embed_running.** [inspected] `emitAgentSpawned` only for explicit `file`; `noteEmbedAgentSpawned` flips `embed_intent` and `pushTimeline` emits `local_terminal`. Spawn fail re-records on `terminal_busy` / `spawn_failed`; `INVALID_PTY_OPTS` stays consumed. Non-darwin `terminal.open` returns before `takeEmbedIntent`.
- **#513 advisory-only.** [executed] propose broadcasts one `fleet.suggest`, mutates no thread, no spawn/arm. Summoner `== null` / `"summoner"` → `SUMMONER_ACL`. Workers `WORKER_DENIED`. Dismiss silences 10 min; throttle 60s does not extend on suppress. UI accept is `chat.send` + dismiss, not `task_loop.arm`.
- **#514 BOARD_MISSING / goal+brief+kick / snapshot.** [executed] invented `intent_id` on a host with `mission_board == null` returns success + `skipped:true`; worker remains. No goal → `INVALID_ARGS`. Brief is first user row + `system_prompt_append`; `kickWorkerChat` invoked. [inspected] production kick is fire-and-forget `scheduleWhenLlmSlotAvailable` + `skipUserMessage:true` (no deadlock, no duplicate user row). `broadcastFleetSnapshotIfWorkers` after spawn, expert-team spawn, worker-kick settle, and parent run-end.

## Residual

- `tests/fleet-suggest-dispatch.test.ts` `#514` kick assertion uses a no-op `kickWorkerChat`; it cannot catch a production `skipUserMessage:false` duplicate-brief. Wiring was verified in `server.ts:765-782`, not by that test.
- `tests/round-limit-exit.test.ts` is source-regex; production `chat.done` shape was read in `adapter.ts:2417-2427`.
- Live-mirror eviction (1200 tools / 800 assistant rows / 64 threads) degrades to disk stubs; same documented restart tradeoff, not a punch-list miss.
- `fleetSuggestGate` stamps the 60s throttle *before* the `NO_CHANNEL` check — only tests/non-server; production executor always passes `broadcast`.

VERDICT: APPROVE_WITH_NITS
