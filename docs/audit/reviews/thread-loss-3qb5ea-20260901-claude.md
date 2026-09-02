# Dual review — thread-loss diagnosis (3qb5ea / w2k8z9)

## Verification results (all at HEAD `3cd70cf8` + live data, read-only)

**1. `adapter.ts` truncatedToolBatch — CONFIRMED [inspected].** `adapter.ts:1047-1073`: on length-stop with tool calls, one auto-compaction retry, then `chat.error` with exact string `输出被截断（工具调用不完整），已停止。` (:1070) followed by `return` (:1072). `llm.usage` logging (:1076-1087) and `addMessage` (:1112) are both unreachable on this path. `isTruncatedToolBatch` = `isLengthStop && hasToolCalls` (`overflow.ts:15-19`), so pure-text length-stop falls through to `addMessage` + `chat.done` with `truncated:true` (`adapter.ts:1186`) — exactly as R1/R2 state.

**2. 8192 production cap — CONFIRMED [inspected + executed].** `anthropic-convert.ts:58-61`: `min(8192, max(256, floor(cw/8)))` — for any context window ≥ 64k the cap is 8192 regardless of config. Live config: `protocol: "anthropic"`, `base_url: https://open.bigmodel.cn/api/anthropic`, `model_name: glm-5.3`, `context_window: 1000000` → wired via `provider.ts:137` → `anthropic.ts:71` → `buildAnthropicRequestBody` (`anthropic-convert.ts:282`). This user's production cap is 8192.

**3. `SET_ACTIVE_THREAD` wipes messages — CONFIRMED [inspected].** `agentStore.tsx:798-825`: same-id early-return; cross-id sets `messages: []` at :809.

**4. Digest-only `update()` bumps `updated_at` — CONFIRMED [inspected].** `thread-manager.ts:878`: `Object.assign(thread, updates, { updated_at: monotonicTimestamp() })` unconditional. Digest caller at `message-router.ts:2037`, with `source: "manual"` hardcoded at :2031 (P2-2 accurate).

**5. Timeline sort key — CONFIRMED [inspected].** `thread-timeline.ts:168-172` sorts and day-groups by `updated_at || created_at`; existing test `tests/thread-timeline.test.ts:99` ("prefers updated_at over created_at") is real and must indeed be reversed under P0-2. Overlay sort at `companion/src/tray/companion-client.ts:239-243` has the same clock.

**6. `useWebSocket.ts` — CONFIRMED [inspected].** `chat.done` handler (:365-402) never reads `msg.truncated` (the file's only `truncated` match is an unrelated `maxFiles` note at :1714). `chat.error` (:470) and `chat.aborted` (:420) add rows with client-only ids (`…_error_${Date.now()}` / `…_abort_${Date.now()}`) that never reach disk.

**7. Live evidence — CONFIRMED [executed].**
- `3qb5ea.json`: 27 rows; tail is assistant 05:42:16.922 (2 tool_calls) + 2 tool rows + user「继续」05:47:43.717Z, **no assistant after**. The 05:35:14.301 row is `content_len: 0, reasoning_len: 23773` — R1's thinking-only cap-hit shape, addMessage'd with empty content. The 05:39:05.316 row (content 17310) matches the second cap hit.
- Index: `w2k8z9` `created_at=2026-08-31T05:38:39.796Z`, `updated_at=2026-09-01T06:25:20.409Z` **identical to** `digest.extracted_at` — smoking gun for R3. Digest tldr matches the 2 real 08-31 messages; `cruise-wl` alias ×55; `3qb5ea` has no digest.
- Log: `completion_tokens:8192` at 05:35:14.300 and 05:39:05.315; `llm.anthropic_request` at 05:42:17.555 / 05:44:50.378 / 05:47:43.772 / 05:50:44.195 with **zero** subsequent `llm.usage`; digest request at 06:25:13.170; **zero** `thread.create` events all day. `thread_digest {enabled: true, on_idle_hours: 24}` and last real message 08-31 14:11 local → digest 09-01 14:25 local = 24h14m — matches idle trigger.
- `handleSelect` (`ThreadList.tsx:706-724`) sends only `SET_ACTIVE_THREAD` + `thread.select` (no `chat.abort`); `thread.select` (`message-router.ts:2131-2151`) returns `thread.messages` from disk — the wipe→rehydrate-from-disk loop is closed end-to-end.
- P1-3 citation accurate: abort path (`adapter.ts:1754-1760`) persists only when `assistantContent.trim()` is non-empty, so reasoning-only partials are dropped.

## Judgment

The three root causes are real, independently verified in code and live data, and map 1:1 onto the three user-visible symptoms; no ruled-out item is causal (disk intact, no fork/new-thread, no click→create — all disproven by disk+index+log). The P0 set (message clock, timeline readers, persist truncated batch, no blank-on-switch) is necessary and sufficient for the incident symptoms, and §4's warning against blind `chat.abort` before P0-3/P1-3 is correct sequencing. The §5 unknowns are honestly bounded and don't undermine the chain — the request-without-usage signature is consistent with the code's skip-usage-on-truncate behavior, and the fix pins instrumentation (log usage/finish_reason before return) to disambiguate next time.

Nits:

1. **P0-1 names the wrong invariant boundary.** `addMessage` is a thin wrapper over `insertMessageAt` (`thread-manager.ts:1012-1013`). Implementing "仅 addMessage 推进" literally on the wrapper leaves other append/insert callers (compaction rewrites, imports) not advancing `last_message_at`. Pin the invariant ("message-row appends advance the clock; metadata writes never do"), not the function.
2. **P0-2 migration unspecified.** All 339 existing threads lack `last_message_at`; the `last_message_at || created_at` fallback will visibly reorder pre-migration threads by creation date even when their true last-message time is derivable from `threads/<id>.json`. State the one-time reorder consequence, or backfill lazily in `get()`.
3. **P0-3 must pair with the existing interrupted-tool machinery.** Persisting an assistant with incomplete `tool_calls` needs the "fill remaining tool_call ids as interrupted so the next turn pairs" treatment (`adapter.ts:1731-1739`, `persistInterruptedRemainder`), otherwise the next round risks unpaired tool_result / provider 400. The pin says what to persist but not this resume-pairing constraint.
4. Trivial citation drift, no impact: `w2k8z9` created_at actual `.796Z`; `addMessage` updated_at bump is at `thread-manager.ts:1066` not ~1064; `SET_ACTIVE_THREAD` body spans 798-825.
5. R1's "collapsed reasoning → blank bubble" rendering step is [assumed] (data shape verified, rendering not run); P1-2's UI test spec covers it regardless.

VERDICT: APPROVE_WITH_NITS
