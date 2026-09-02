# Dual Review — thread-loss-3qb5ea synthesis (20260901)

  I read the synthesis in full, then independently inspected every cited code path at HEAD `3cd70cf8` and the live json/log under `~/.cmspark-agent/`. Findings below; the causal chain holds.

  ## Verified as cited

  **R1 — output cap 8192 + thinking burns completion budget.** `anthropic-convert.ts:58-61` is exactly `Math.min(8192, Math.max(256, Math.floor(cw/8)))`; `anthropic.ts:73,113` feed it `config.context_window`. Live config: `protocol: "anthropic"`, `base_url: open.bigmodel.cn/api/anthropic`, `model_name: glm-5.3`, `context_window: 1000000` → production cap is **8192**, regardless of the 1M window. Live log confirms `completion_tokens: 8192` at 05:35:14.300 and 05:39:05.315, and `3qb5ea.json` msg[19] is `content_len: 0 / reasoning_len: 23773` — the empty bubble is real on disk.

  **R2 — truncated tool batch returns before persistence.** `adapter.ts:1051-1072`: exact error string `输出被截断（工具调用不完整），已停止。`, then `return` at line 1072 — strictly before `llm.usage` (1076) and `addMessage` (1089+). Live: `llm.usage` at 05:42:16.921 (round 1, with the two tool rows persisted), then `llm.anthropic_request` at 05:42:17.555 / 05:44:50.378 / 05:47:43.772 / 05:50:44.195 with **zero** subsequent `llm.usage` and no error event rows; thread file ends at user「继续」05:47:43.717Z. `SET_ACTIVE_THREAD` (`agentStore.tsx:798-809`) wipes `messages: []` on cross-id switch; `handleSelect` (`ThreadList.tsx` ~706-723) sends only `thread.select`, no `chat.abort`. `chat.error`/`chat.aborted` rows use client-side `_${Date.now()}` ids and never touch disk. The "switch away → messages gone" mechanism is fully corroborated.

  **R3 — digest update masquerades as recency.** `thread-manager.ts:878` `Object.assign(thread, updates, { updated_at: monotonicTimestamp() })` is unconditional; `message-router.ts:2037` (and lazy fill at :672) call `update({ digest })`. Live index for `w2k8z9`: `created_at: 2026-08-31T05:38:39.796Z`, `updated_at: 2026-09-01T06:25:20.409Z` — **millisecond-identical to `digest.extracted_at`**. Sort/group key is `updated_at || created_at` in both `thread-timeline.ts:168-182` and tray `companion-client.ts:238-242`. `source: "manual"` is hardcoded at `message-router.ts:2031`. Zero `thread.create` events in the 09-01 log — w2k8z9 is a real 08-31 thread (2 msgs, 券商AI工作台 risk analysis), correctly not a fork/duplicate.

  **UI truncated blind spot.** `useWebSocket.ts` `chat.done` (365-401) never reads `msg.truncated` (the only `truncated` in the file is knowledge-import, line 1714), while the adapter does set it on length-stop (`adapter.ts:1186`).

  **Ruled-out items checked out:** disk history intact (27 messages, no trimming), no fork, no remount causality needed for the incident.

  ## Nits (non-blocking)

  1. **P1-3 citation is misleading.** `drainThreadOnSupersede` (`message-router.ts:234`) only rejects pending security confirmations — it flushes nothing. The actual persistence gap is the adapter abort catch (~`adapter.ts:1748-1760`): `persistInterruptedRemainder(savedAssistantId, ...)` plus a text-only fallback that requires non-empty `assistantContent`, so reasoning-only partial output is dropped. The behavioral pin is right; the pointer will send the implementer to the wrong file first.
  2. **Unlisted `05:44:50.378` request.** The synthesis flags `05:50:44` hang-vs-H2 as unknown but doesn't mention the second `llm.anthropic_request` at 05:44:50 — consistent with the auto-mode `lengthRecoveryUsed` retry (config has `context_compaction: "auto"`), yet no budget/compact log line accompanies it. P0-3's "log usage/finish_reason before return" resolves this by construction, but the timeline table should acknowledge it.
  3. **P0-1 completeness:** `addMessage` also bumps `updated_at` (`thread-manager.ts:1066`); when `last_message_at` is introduced, the implementer must consciously leave that bump in place (harmless once the timeline moves off `updated_at`) — worth one sentence in the pin so it isn't "helpfully" removed.
  4. **Line-number drift:** `ThreadList.tsx:721-722` → block starts ~706; `adapter.ts:1754-1760` → ~1748. Cosmetic only.
  5. Test fixture `adapter-steer-overflow.test.ts` exists as cited; `tests/thread-timeline.test.ts:99` ("prefers updated_at over created_at") does need the reversal P0-2 calls out.

  No cited root cause is false, no P0 pin is wrong or dangerous, and no ruled-out item is actually causal. The three-bug-stacked diagnosis is the minimal explanation consistent with all live evidence.

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_e8421790-b57d-448d-b896-5bec1d3ecb53
