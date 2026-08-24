# PR #218 remainder+nits — independent adversary

**Date**: 2026-08-24  
**Reviewer**: independent adversary (not implementer)  
**Branch**: `feat/agent-loop-durability-p0`  
**Prompt**: `docs/audit/reviews/pr218-remainder-nits-adversary-prompt-20260824.md`  
**Diff**: `docs/audit/reviews/pr218-remainder-nits-diff-20260824.patch` (cross-checked against live files)  
**Blast**: T2 (chat.steer / enqueue nextRun / overflow retry / cap-trim). Not T3: no confirm/originWs/shell/god-mode/outbound live-bridge change.

CMspark is a browser agent. Missing pi AgentHarness lanes / op-log / Continue UI / pending_confirms / CDP replay are **out of scope** and not grounds for REJECT.

## Capability declaration (ADR-020)

```text
Surface:      L0 (chat.steer / chat.create enqueue) — same tool-loop, no new CDP/Host
L2-classes:   (none)
Compose:      none (process-local maps, not Pack/MCP/Skill)
Autonomy:     single (nextRun is sequential drain, not multi-worker)
Trust:        unchanged — pending_tools DTO names/ids only; never args/originWs/nonce
Channel:      community (WS companion; summoner ACL now includes chat.steer)
```

Axes fit: Surface L0 entry + Autonomy single-loop queue. Not a second runtime. Trust not relaxed. Summoner `chat.steer` is Channel ACL, not a confirm-dialect.

## Method

- Live production call sites read (not patch-only): `adapter.ts`, `message-router.ts`, `run-queues.ts`, `overflow.ts`, `thread-manager.ts`, `tool-forward.ts`, `validate.ts`, `summoner-acl.ts`, `tool-batch-heal.ts`, plus `composer-lease.ts` / `l2-conductor.ts` / Anthropic convert / providers' `finish_reason`.
- Prior r1 REJECT (B1 heal-after-user, B2 select-heal, B3 shrink-omit) and remainder prior REJECT (takeNextRun CAS, truncated-tool execute, overflow fake user row, silent queue_full) checked at **call sites**.
- Machine: this sandbox has no shell. `[inspected]` `.test-dist/tests/overflow.test.js` and `run-queues.test.js` exist and match current sources. `npx tsc --noEmit` / `node --test` **not executed here**. Do not treat green helper tests as sufficient; verdict is from production paths.

Evidence tags: `[inspected]` unless noted.

---

## Prior REJECT that must stay gone

| # | Claim | Live call site | Status |
|---|--------|----------------|--------|
| 1 | `takeNextRun` only if `llmLoopGeneration.get(thread) === myGeneration` | `message-router.ts:526-537` — drain is **after** `finally`, gated on the same CAS as controller/gate release. Supersede path (`:370-378`) bumps generation **before** aborting the predecessor, so predecessor cannot steal the queue and `chat.create` the successor. | **GONE** |
| 2 | Truncated tool batch (`finish_reason` length + tool_calls): compact+retry once, then `chat.error` **return** — must not save/execute | `adapter.ts:977-991` runs **before** `addMessage` / `assistantMsg` execute loop (`:1008+`, `:1115+`). First hit: `lengthRecoveryUsed=true`, `round--`, `runContextBudgetPass("pre_loop")`, `continue`. Second: `chat.error` + `return`. | **GONE** |
| 3 | Context overflow after retry: `chat.error` + **return**, must not inject `Error occurred:` user row | `adapter.ts:1612-1625` returns inside the overflow branch. Fake user row at `:1683-1687` is only reachable after the overflow `if` (auth/structural/recoverable). | **GONE** |
| 4 | Empty enqueue rejected; nextRun capped (`MAX_NEXT_RUN=8`) with `queue_full` (not silent `chat.enqueued`) | `message-router.ts:348-365` + `run-queues.ts:27-36`. Empty → `empty_enqueue`. `enqueueNextRun` false → `queue_full` + `max`. Success → `chat.enqueued`. | **GONE** |

r1 B1/B2 still hold on this remainder:

- **B1 splice-after-assistant**: `chatCreate` heals at `adapter.ts:337` **before** the user row (`:339+`). `persistInterruptedRemainder` (`:859-868`) is now a thin wrapper over `persistHealedToolRows` + `onPersisted` (`tool-batch-heal.ts:144-188`), which inserts at `toolBlockInsertIndex` and re-reads after each insert (cap-trim). `select` does not write.
- **B2 select does not heal**: `message-router.ts:1774-1802` — `getMessages` only. Comment at `:1780` is honest. `persistHealedToolRows` production call sites are **only** `adapter.ts:337` and `adapter.ts:860`. Test `thread.select does not persist INTERRUPTED heal rows` still encodes this.

---

## External DoD (observable) — production, not helpers

| DoD | Verdict | Evidence |
|-----|---------|----------|
| Overflow: compact+retry-once then stop with `chat.error` | **HOLD** | `adapter.ts:873-875` flags; `:1612-1625` one compact+retry then return. `overflow.ts:3-7` classifiers include claimed strings (`input is too long`, `request_too_large`, `token count exceeds`). |
| Length-stop incomplete tools: no execute | **HOLD** | `adapter.ts:977-991` before save/execute. `isLengthStop` maps OpenAI `length` and Anthropic `max_tokens` (`overflow.ts:10-13`; providers yield `finish_reason` from `choice.finish_reason` / `delta.stop_reason`). |
| Steer dies on abort (`dropSteer`); nextRun survives abort | **HOLD** | `abortThreadChat` (`message-router.ts:156-160`) always `dropSteer`. `run-queues.ts` maps are separate; `dropSteer` does not touch `nextRunByThread`. |
| nextRun drain generation-CAS | **HOLD** | `message-router.ts:529-537`. Abort bumps generation (`:153`) so the aborted generation skips drain (queue remains until a later **owning** run finishes). |
| `queue_full` / `empty_enqueue` / `empty_steer` | **HOLD** | enqueue `:348-365`; steer trim+empty `:546-548`; `enqueueSteer` ignores whitespace (`run-queues.ts:9-11`). |
| `pending_tools` names/ids only | **HOLD** | `tool-forward.ts:84-98` constructs `{tool_call_id, tool_name, status}` only. Static import `message-router.ts:41` (no `require("./ws/tool-forward")`). Summoner omits (`:1792-1794`). |
| select does not heal (B2) | **HOLD** | see above |
| INTERRUPTED splice after assistant (B1) | **HOLD** | see above |

---

## Layer 1 — Outcome

Remainder+nits claimed behavior is true at production call sites:

- Steer inject is inside the tool loop **before** `streamChat` (`adapter.ts:902-911`): `takeSteer` → persist user row + push onto in-memory `messages`. Round-boundary only (not mid-tool). Abort cannot interleave the sync take/persist (single-threaded). Unconsumed steers are what `dropSteer` kills.
- Truncated batch / overflow **do not** fall through to execute or to the fake `Error occurred:` row.
- `round--` on both recovery paths so the retry does not burn a tool-round (`adapter.ts:982`, `:1616`) against `MAX_TOOL_CALL_ROUNDS=100`. Flags prevent infinite continue.
- `runContextBudgetPass` is a closure over `let messages` (`adapter.ts:540`, `:664`) — auto compaction actually replaces the in-memory tape before retry. `compaction: "off"|"prompt"` makes compact a no-op; retry-once still stops. Honest, not a silent loop.
- nextRun drain is recursive `handleMessage({type:"chat.create", thread_id, message: queued})` — goes through lease/conductor/generation claim again. Enqueue-while-busy (`:348`) returns **before** `nextLlmGeneration`, so it does not steal a slot.

No Continue UI. No persist `running=true` on the tape (grep of router/adapter/threads/ws: none).

---

## Layer 2 — Trajectory

Scope matches remainder+nits. New files are `run-queues.ts` + `overflow.ts` + tests. No new confirm family, no Pack trust, no originWs bind change, no shell/CU. Summoner allow of `chat.steer` is the claimed Channel expansion (overlay already had `chat.create` / `chat.abort`).

Not a new runtime. Process-local maps lost on process death — documented in `run-queues.ts` header and ADR-020 Compose "none".

---

## Layer 3 — Component findings

### BLOCKs

None. Prior remainder REJECTs are gone at the call sites that used to be wrong. I will not invent a BLOCK to look strict.

### NITS (real, non-blocking)

**N1 — Leftover steer leaks into the next `chatCreate` if the current run ends text-only**  
`adapter.ts:1051-1097` (`assistantMsg.length === 0` → `chat.done` + `return`) never `dropSteer`. `dropSteer` is abort-only (`message-router.ts:156-160`). A `chat.steer` accepted during the final stream sits in `steerByThread` until the **next** run’s `takeSteer` (`adapter.ts:902-911`), which persists it as an extra user row **after** that next user message. Abort-dies is true; completion-dies is not. Not DoD-breaking.

**N2 — `chat.steer` is not lease- or L2-conductor-gated**  
`chat.create` runs `gateChatCreateOnLease` + `gateChatCreateOnConductor` (`message-router.ts:317-320`). `chat.steer` (`:542-554`) only checks `abortControllers.has`. Overlay/panel can inject user text into the other surface’s in-flight loop. Summoner ACL **intentionally** allows `chat.steer` (`summoner-acl.ts:15`). No Side Panel `chat.steer` sender exists today (`chrome-extension` grep empty). Dual-draft hole is real but unused by current UI. Not T3.

**N3 — Steer persist is disk+LLM only; no live `chat.user` (or equivalent) to the panel**  
`adapter.ts:904-910` `addMessage` + `messages.push`. No `sendToExtension`. Live transcript does not show the steer until `thread.select`/reload. Observable via GET; not a pairing/heal bug.

**N4 — `enqueueSteer` is uncapped; `nextRun` is not**  
`MAX_NEXT_RUN=8` (`run-queues.ts:27-36`). Steer queue is unbounded; `takeSteer` joins with `\n` into one user row. A flood during a long tool round can bloat the next prompt. Process-local, not disk-cap. Abuse is a large user string, not trust elevation.

**N5 — `trimMessagesTurnSafe` can keep `[]` if one tool-block spans the cap window**  
`thread-manager.ts:228-248`: if `messages[start].role==="tool"` and walking back finds an assistant whose contiguous tools run to EOF, `start = k === length` → `slice` empty. `insertMessageAt` (`:990-994`) would then persist an empty tape and delete sidecars for the prefix. Requires ~1000 parallel tool rows after one assistant (`MAX_MESSAGES_PER_THREAD=1000`). Not a realistic CMspark batch; still a sharp edge of the turn-safe skip. Orphan-at-cut (`:241-245`) and “don’t start on tool” (`:234-240`) match the claimed nit and tests.

**N6 — Overflow/length adapter-loop untested; CAS drain untested**  
`overflow.test.ts` only hits classifiers. `run-queues.test.ts` hits maps + `dropSteer` analog, not `message-router.ts:529` generation CAS. `files.test.ts` hits `empty_enqueue` / `queue_full` / `empty_steer` / `no_active_run` via `__testSetLlmActiveForTests`. A future edit could re-introduce REJECT #1/#2/#3 without a red test. Production paths are correct **today** by inspection — that is a test gap, not a live defect.

**N7 — WS validate vs router empty-steer strings diverge**  
`validate.ts:48-50` rejects whitespace with `"chat.steer requires message string"` before the handler. `empty_steer` (`message-router.ts:547-548`) is only reachable via `handleMessage` bypassing validate (the unit test). Production WS clients never see `empty_steer` for whitespace.

**N8 — `isLengthStop` is `finish_reason`-only; classifier miss still uses the fake user row**  
If a proxy omits the terminal SSE chunk, `finishReason` stays unset (`openai.ts:103-108`, `anthropic.ts:302-303,440`), `truncatedToolBatch` is false, and incomplete tools can be saved/executed. JSON.parse failure (`adapter.ts:1126-1152`) is a partial safety net, not a batch abort. Overflow strings like “exceeds the model's context window” do **not** match `exceeds? the context` (`overflow.ts:5`) and would fall through to `:1683-1687` `Error occurred:`. Claimed provider strings **are** matched. Residual miss is not the r1 overflow-after-retry return hole.

**N9 — Length retry compact may not enlarge output budget**  
`finish_reason=length` is often an **output** cap. Retry still runs input `runContextBudgetPass("pre_loop")`. If compact cannot help, second length-stop `chat.error`s. Meets “retry-once then stop”; do not expect the retry to succeed.

### Trajectory / scope (not nits against this PR)

- No panel Continue button / nextRun UI — out of scope per prompt.
- `pending_tools` is in-flight `pendingToolCalls` only, not confirm queue — do not REJECT.
- nextRun after overflow/`truncatedToolBatch` `return` (non-throw) **will** drain if generation still owns (`message-router.ts:529`). That is “run after this generation finishes,” including error finish. Sequential, cap 8.

---

## Nits claimed folded this pass — check

| Claimed nit | Live | Folded? |
|-------------|------|---------|
| steer trim / `empty_steer`; enqueueSteer ignores whitespace | `run-queues.ts:9-11`, `message-router.ts:546-548` | yes |
| summoner ACL allows `chat.steer` | `summoner-acl.ts:15`, `summoner-acl.test.ts` | yes |
| `listPendingToolsForThread` DTO no originWs/tabId; static import | `tool-forward.ts:84-98`, `message-router.ts:41` | yes |
| overflow classifiers extra strings | `overflow.ts:5` | yes |
| `trimMessagesTurnSafe` skips orphan tool rows at the cut | `thread-manager.ts:241-245` | yes |
| overflow/length retry `round--` | `adapter.ts:982`, `:1616` | yes |
| `persistInterruptedRemainder` DRY via `persistHealedToolRows` + `onPersisted` | `adapter.ts:859-868`, `tool-batch-heal.ts:149-179` | yes |

r2 leftover `require("./adapter")` cycle in heal is **gone** (`createToolResultMessage` lives in `tool-batch-heal.ts`). Shrink-only `dropped_count:0` meta is outside this remainder slice.

---

## Tests vs call sites

Helper tests are aligned with helpers. They do **not** replace call-site reads:

- `truncatedToolBatch` / overflow `return` — **no** adapter-loop test. Call site holds.
- Generation CAS drain — **no** router test. Call site holds.
- `listPendingToolsForThread` extra-key test — holds for the DTO constructor.
- `thread.select` no-heal — holds.

`.test-dist` artifacts for `overflow.test.js` / `run-queues.test.js` match current `companion/tests/*.ts`. `[not executed]` `tsc` / `node --test` in this sandbox.

---

## Summary

Remainder+nits deliver the claimed T2 loop durability at the production sites that previously REJECT’d: CAS drain, truncated-batch no-execute, overflow stop without fake user row, explicit `queue_full`/`empty_enqueue`/`empty_steer`, summoner steer ACL, names/ids-only pending DTO, turn-safe cap-trim, heal DRY.

Residual issues are product/test gaps (stale steer after `chat.done`, steer vs lease, no live echo, uncapped steer, empty-tape trim edge, missing loop tests). None reintroduce prior BLOCKs or move Trust/Channel into T3.

VERDICT: APPROVE_WITH_NITS
