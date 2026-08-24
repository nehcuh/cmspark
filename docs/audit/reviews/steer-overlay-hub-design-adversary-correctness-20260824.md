# Design adversary (CORRECTNESS / PROTOCOL) — steer/nextRun UI + overlay L0 hub

**Date**: 2026-08-24  
**Lane**: independent C-correctness / protocol. Hostile to SoT splits and race bugs. Did not author the spec.  
**Spec**: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`  
**Prompt**: `docs/audit/reviews/_prompts/steer-overlay-hub-design-adversary-20260824.md`  
**Worktree**: `/Users/huchen/Projects/cmspark` (design-only; **no production edits**)  
**Evidence**: `[inspected]` live code cited below. No tests executed this pass.

```text
Surface:      L0 (claimed)
L2-classes:   none — overlay not Allow/Deny
Compose:      pack.apply overlay allowTrust:false
Autonomy:     existing steer/nextRun
Trust:        monotonic — overlay MUST NOT write Trust B
Channel:      summoner ACL +pack.list +pack.apply; mcp.add denied
```

This lane attacks **busy SoT**, **overlay submit mapping (Node vs Swift)**, **enqueue while overlay vs panel**, **pack.apply mid-loop tools**, **generation CAS if UI never supersedes**. Trust-B / eligible-heuristic / 200pt chrome are other lanes except where they punch a protocol hole.

---

## Verdict in one line

The spec **names** `abortControllers` as the busy SoT, then **implements busy in three unsynchronized places**, tells the UI it is idle at `chat.done` **before** nextRun drain claims the next generation, and treats “never supersede” as a client promise while `chat.create` / `file.upload` / `chat.regenerate` / overlay `sendChatCreate` still **abort the live controller**. That is not a protocol. It is hope.

---

## Attack 1 — Three busy SoTs, spec claims one

**Claim to falsify**: “`summoner.submit` 在 companion 侧看该 thread 是否 LLM-busy（`abortControllers` / 与 panel 同一 SoT）.” (spec §2 PR1)

### What actually exists `[inspected]`

| SoT | Where | What it means |
|-----|--------|----------------|
| **A. `abortControllers`** | `companion/src/message-router.ts:115,125-127,349,551` | Process-local in-flight LLM AbortController. `chat.steer` / `enqueue:true` key off `.has()`. |
| **B. `run_status`** | `message-router.ts:1795-1802` | Snapshot of A on `thread.select`. **Omitted when `stampedSurface === "summoner"`** (“Summoner must not see run_status (ACL hydrate)”). |
| **C. `SET_THREAD_BUSY` / `deriveThreadBusy`** | `useWebSocket.ts:354,364,402,1183-1188`; `App.tsx:527-532,1771-1776`; `thread-busy.ts:14-16` | Event-driven UI map. OR of `streaming` / `isProcessing` / `runningToolCount` / `mapBusy`. `mapBusy` is set from `chat.user` / tokens / tools / **local `handleSend`**, cleared on `chat.done` / `chat.aborted` / **optimistic `handleStop`**. |

These are not the same bit.

**A vs B**: overlay hydrate is `thread.select` on the summoner socket → `run_status` **stripped**. Swift has **no** protocol field for LLM-busy. Spec still wants busy hint copy (`回车纠偏 · Shift+Enter 排队`) and Node-side mapping. There is no `summoner.busy` / `run_status` cmd in `companion/src/summoner/protocol.ts` (`SummonerSubmitEvt` is `{ thread_id, text }` only, `:83`).

**A vs C — `chat.done` seam (this is the kill shot)**:

```1096:1105:companion/src/llm/adapter.ts
        sendToExtension({
          type: "chat.done",
          thread_id: threadId,
          message_id: savedAssistant.id,
          ...
        })
        generateThreadTitle(...)
        return
```

Then, **after** `await chatCreate(...)` returns:

```518:538:companion/src/message-router.ts
      } finally {
        if (llmLoopGeneration.get(rest.thread_id) === myGeneration) {
          if (abortControllers.get(rest.thread_id) === controller) {
            abortControllers.delete(rest.thread_id)
          }
          releaseMultiAgentLlmLoop(rest.thread_id)
        }
      }
      if (llmLoopGeneration.get(rest.thread_id) === myGeneration) {
        const queued = takeNextRun(rest.thread_id)
        if (queued) {
          return handleMessage(
            { type: "chat.create", thread_id: rest.thread_id, message: queued },
            ...
          )
        }
      }
```

Panel on `chat.done` (`useWebSocket.ts:360-365`): **`SET_THREAD_BUSY` false immediately**. Overlay on `chat.done` → `summoner.done` (`mapChatMessageToSummonerCmd`). Composer is **idle in the UI** while:

1. `abortControllers` still holds until `finally`, then
2. nextRun drain **synchronously** installs a **new** controller via recursive `chat.create`.

User hits Enter on an “idle” composer → `chat.create` **without** `enqueue` → **supersede of the queued nextRun that just started**. Generation CAS then does exactly what it was built for: predecessor skips `takeNextRun`, successor aborts the drain. Queue is not lost; **the user’s “after this run” work is killed**. That is PR1’s headline failure mode.

`handleStop` is worse (`App.tsx:1412-1425`): it sets `SET_THREAD_BUSY` false **before** `chat.abort` is acked. Enter in that window is a create that can land **before** abort (supersede, then abort kills the new run) or **after** abort (new run; leftover nextRun waits for *that* run’s finally). Spec §5 “Stop 与今日 abort 相同” inherits this race.

**C is also not LLM-busy**: `deriveThreadBusy` is true for leftover `isProcessing`, tool cards, streaming buffer. Spec says “Busy + 有正文 → steer”. If they key off `threadBusy` (spec §2: “用 `threadBusy`（已有 `SET_THREAD_BUSY` ← `run_status`）”), a stuck tool card with **no** `abortControllers` yields `chat.steer` → `no_active_run`. If they key off A in Node and C in panel, overlay and panel **diverge on the same thread**.

### Required protocol (not a UI nit)

1. **One server bit** for “this thread may not `chat.create`”: `abortControllers.has(id) || peekNextRunCount(id) > 0` (or hold the controller until drain has claimed / queue empty). Call it `run_occupied`.
2. **`chat.done` must not imply idle** if nextRun will fire. Either delay `chat.done` until drain decision, or add `next_run_pending: true` / `run_status: "llm"` and keep C true until the successor’s `chat.user` or a real idle.
3. Overlay must receive that bit (`summoner.busy` / hydrate `run_status`). Stripping it on summoner `thread.select` (`:1798-1799`) is now a **bug**, not an ACL feature, if overlay is supposed to share SoT.
4. Stop: UI stays occupied until `chat.aborted`; or server rejects create until abort’s generation bump is visible.

Until then, “同一 SoT” is false.

---

## Attack 2 — Overlay mapping is specified in two places and implemented in neither

**Claim**: “submit 已有，busy 映射在 Node 不在 Swift”; also “忙 → steer 或 enqueue（**modifier**）”.

### Live path `[inspected]`

```
Swift submitComposer
  → stdin summoner.submit {thread_id, text}     // SummonerOverlay.swift:504; protocol.ts:83
  → handleSummonerSubmit                         // menu-bar-agent.ts:726-740
  → submitSummonerTalk
       claimLease (steal overlay holder)
       sendChatCreate({thread_id, message})      // companion-client.ts:286-290  ALWAYS chat.create
  → WS chat.create  (no enqueue, no steer)
  → message-router: if abortControllers.has → SUPERSEDE (existing.abort, :376-379)
```

`CompanionClient.sendChatCreate` cannot send `enqueue` or `chat.steer`. `submitSummonerTalk` deps only expose `sendChatCreate`. Overlay **today is the supersede client**. PR1’s entire point.

### Internal contradiction

- “映射在 Node 不在 Swift” ⇒ Swift keeps a single `summoner.submit`; Node picks steer vs enqueue vs create.
- “enqueue（modifier）” and “Shift+Enter 排队” ⇒ **someone** must send a bit. If Swift does not, Node cannot distinguish Enter vs Shift+Enter. If Swift does, mapping is **not** Node-only.

`SummonerSubmitEvt` has no `enqueue` / `mode` field. Spec §4 stdin 增量 lists `summoner.pack.apply` and “submit 已有” — **no modifier schema**.

If mapping is in `submitSummonerTalk` / tray (still “Node”):

- Tray checks `abortControllers` then `sendAppMessage`. That is **check-then-send across the WS event loop**. Router `chat.create` without `enqueue` still supersedes if the thread became busy; `chat.steer` returns `no_active_run` if it became idle. Fire-and-forget (`sendAppMessage`, no `id`) means `chat.steered` / `{type:"error", error:"queue_full"}` land on `onAppMessage` → `mapChatMessageToSummonerCmd`, which **only** maps `chat.token` / `chat.done` / `chat.error` / `tool.start` / `mcp.confirm.pending` (`client.ts:256-296`). `queue_full` / `empty_enqueue` / `empty_steer` / `no_active_run` / `chat.enqueued` / `chat.steered` are **dropped**. Spec §2 “`queue_full` / `OVERLAY_STANDBY` 用现有 error 字符串，UI 可读化” only works for `OVERLAY_STANDBY` because that one is `type: "chat.error"` (`composer-lease.ts:137-142`).

If mapping stays in tray, **lease steal** still happens first (`submitSummonerTalk:150-152`). Overlay submit while panel holds the lease **takes the composer**, then `chat.create` supersedes the panel run. Spec §5: “overlay 无 lease → `OVERLAY_STANDBY`；提示「侧栏占用了输入」”. Live code does the opposite: overlay submit **claims**. Tests pin this (`summoner-talk.test.ts:73-91` “claims overlay, sends chat”; `:124-137` only skips send when `claimLease === false`).

`handleSummonerContinue` (`menu-bar-agent.ts:721-724`) is a second always-`chat.create` path. Spec is silent. Busy Continue = supersede.

### Required protocol

Put the **atomic** decision in `handleMessage`, not tray:

```
summoner.submit { thread_id, text, enqueue?: boolean }
  → (optional tray claim already held; do NOT claim on submit)
  → WS: one of
       chat.steer
       chat.create { enqueue: true }
       chat.create
     decided inside the router on abortControllers + enqueue flag
```

Server rules (these must be **rejects**, not fallthrough):

| Incoming | Occupied (`abortControllers.has`) | Idle |
|----------|-----------------------------------|------|
| `chat.create` enqueue≠true | **`busy_must_steer_or_enqueue`** (do not supersede) | new run |
| `chat.create` enqueue=true | `enqueueNextRun` / `queue_full` | **`idle_enqueue`** (do not create) |
| `chat.steer` | `enqueueSteer` | `no_active_run` (already) |

Today `enqueue:true` when **idle** falls through to a real `chat.create` (`message-router.ts:349` then `:369+`). That is a silent supersede/new-run footgun for a stale Shift+Enter. Spec §5 only says “闲时隐藏排队”; that is UI, not a gate.

`chat.enqueued` must carry **depth** (`peekNextRunCount`). Live payload is `{ type, thread_id, queue: "next_run" }` with **no count** (`:362-366`). Spec “成功排队：可见条数（cap 8）” cannot be honest across panel + overlay without the server number. Local counting desyncs on the other surface.

Wire `mapChatMessageToSummonerCmd` (or send steer/enqueue as `sendRequest`) so Swift sees `queue_full` / `OVERLAY_STANDBY` / `chat.enqueued`. Spec names the strings; the overlay mapper does not.

Lease: **submit does not `claimLease`**. Open / thread-select / `summoner.ready` claim. Submit is `gateChatCreateOnLease` only. Overlay without holder → `OVERLAY_STANDBY`, matching the table.

---

## Attack 3 — Panel cannot steer until the spec admits the composer is **disabled**

**DoD**: “busy Enter = `chat.steer` not supersede”.

Live Side Panel (`App.tsx`):

```880:887:chrome-extension/src/sidepanel/App.tsx
  const canSend =
    composerMode !== "l2_task" &&
    composerMode !== "thread_busy" &&
    hasContent && ...
```

```1771:1776:chrome-extension/src/sidepanel/App.tsx
            disabled={
              needsThread ||
              needsConnection ||
              threadBusy ||
              voice.liveOverlay !== null ||
              !!overlayStandby
            }
```

`composerMode === "thread_busy"` when `deriveThreadBusy` (`:558`). Textarea **disabled**. Send **blocked**. Placeholder (`thread-busy.ts:56-57`): “本对话处理中 · 停止后再指挥”.

The problem statement “UI 仍把第二次发送当 supersede” is **false for Side Panel**. Panel already refuses busy send. The supersede clients are **overlay `sendChatCreate`**, `file.upload` (`message-router.ts:794-798`), `chat.regenerate` (`:1238-1244`), and races in Attack 1.

PR1 is therefore not “stop calling supersede from InputArea”. It is “**re-enable** the composer while occupied, and route”. Spec never says to flip `disabled` / `canSend` / `composerMode`. An implementer who only “禁止再走 supersede `chat.create`” ships a no-op panel.

Shift+Enter: idle `handleKeyDown` (`App.tsx:1151-1152`) is newline when shortcut is Enter (`shouldSend` requires `!e.shiftKey`). Spec: busy Shift+Enter = enqueue. Must branch on occupied. **Unspecified** when `sendShortcut` is `Cmd+Enter` / `Ctrl+Enter` (settings). Occupied Cmd+Enter vs Shift+Enter vs Enter is a protocol hole; default-Enter is not enough.

Attachments: attach button already disabled when `threadBusy` (`:1756`). Keep it that way. If busy send is enabled and `handleSend` still takes the `file.upload` branch (`:1270+`), **file.upload supersedes**. Spec must say: occupied + files = refuse, not upload.

`handleSend` already optimistic-`SET_THREAD_BUSY` true (`:1397-1398`) — good for double-Enter **after** first send. It does not help Attack 1’s `chat.done` / Stop seam.

---

## Attack 4 — Enqueue overlay vs panel is lease-exclusive **if and only if** submit stops stealing

`chat.steer` and `chat.create` (including enqueue) both `gateChatCreateOnLease` **before** queue mutation (`:318-321`, `:349`, `:555-558`). `[inspected]` test `chat.steer is lease-gated like chat.create` (`files.test.ts:399-415`): panel steer while overlay holds → `OVERLAY_STANDBY`.

**That gate is correct.** Overlay submit **bypasses** it by claiming first.

| Holder | Panel enqueue/steer | Overlay submit (live) | Overlay submit (spec table) |
|--------|---------------------|------------------------|------------------------------|
| overlay | `OVERLAY_STANDBY` | claim (no-op) + **create/supersede** | steer/enqueue |
| panel | enqueue/steer | **steal lease** + create/supersede | `OVERLAY_STANDBY` |
| none (default panel) | enqueue/steer | steal + create | create if overlay claimed on open |

`composer.lease` is the composer SoT (`composer-lease.ts:93-94`: “Overlay claim and chat.create share this map”). Busy SoT is `abortControllers`. Spec muddles them: “lease/conductor 失败原样返回” is **not** busy mapping. A thread can be LLM-busy with overlay holding lease (overlay started it) or panel holding lease (panel started it). Conductor (`l2-conductor.ts:19-31`) additionally denies **all** overlay chat.create/steer while **any** `host_computer` task is live (process-wide registry, not per-thread). Spec does not mention `L2_CONDUCTOR_ELSEWHERE`. Occupied overlay Enter during a CU task would become steer in Node mapping, then die on the conductor gate. Fine if Swift shows the error; mapper only understands `chat.error`. Conductor already returns `chat.error`. OK.

Enqueue while occupied does **not** start a run (`:349-366` returns `chat.enqueued`). Drain is only in the owning generation’s post-`finally` (`:530-538`). Abort keeps nextRun (`run-queues.ts:3`, `abortThreadChat` only `dropSteer`, `:157`). **This part of #218 is sound** and should stay.

What is **not** sound: drain uses `handleMessage({ type: "chat.create", ...})` with **no** enqueue flag. If the UI issues a create in the `chat.done` window (Attack 1), drain **is** the supersede victim. “CAS holds if UI never supersedes” is a tautology: CAS is the **cleanup** so a superseded predecessor does not steal the queue (`:527-529` comment). It does **not** prevent abort. Non-goal §1 “恢复忙时第二次发送 = supersede” is **not enforced on the server**.

### Required

Server: occupied `chat.create` without `enqueue` → **reject**, not `existing.abort()`. Then generation CAS is a backstop for `file.upload` / regenerate / bugs, not the busy-send policy.

If product still needs regenerate/upload to interrupt: those types stay supersede; **user composer create does not**. Spec must name the exception list.

---

## Attack 5 — `pack.apply` mid-loop is composition-on-disk, execution-live

**Claim**: “跑着套 Pack 允许 composition-only apply；不 abort 当前轮.”

Live apply (`message-router.ts:2723-2744`): **no busy gate**. `allowTrust: true` always (Trust lane). `applyPack` writes `tool_whitelist` / skills / `system_prompt_append` onto the thread immediately (`pack-engine.ts:1715-1725` `computeWhitelist` then patch).

In-flight `chatCreate`:

- **Offer** snapshot once, **before** the tool loop (`adapter.ts:611-619`): `tools.filter(t => threadManager.isToolAllowed(...))`.
- **Execute** re-reads `isToolAllowed` in `tool-pregate.ts:170` on every call.

Adapter comment `:613-614`: “Use the same isToolAllowed gate as execution … Prevents tool offered to model then blocked.”

Mid-run overlay/panel apply **breaks that invariant**. Meeting-style overlay-eligible pack with a **narrow** allow-list: model already offered `navigate` / `shell_exec` from the pre-pack full surface → next tool call → `tool_not_allowed`. Round continues (no abort, as specified) but the model is now in the recoverable-failure path. Inverse: apply cannot **add** tools to the current offer (stale `tools[]`), so “composition took effect” is a lie for the current generation.

System prompt / skill activation are also start-of-`chatCreate` (`adapter.ts:420-425`). Mid-run apply is **next generation / nextRun drain** for prompt+skills, **immediate** for the execution gate. Spec does not distinguish.

nextRun drain recursive `chat.create` **will** see the new whitelist. That is the right time.

### Required

Pick one, write it down, test it:

1. **Defer** `applyPack` thread mutation while `abortControllers.has` — return `pack_apply_busy` or queue the apply until drain idle; **or**
2. **Freeze** `isToolAllowed` for the live generation (snapshot at `chat.create` / `nextLlmGeneration`, pregate uses snapshot). Thread record may update so the **next** generation sees it.

“Composition-only, don’t abort” without (1) or (2) is a live “offered then blocked” bug the codebase already called P0-adjacent.

Router today hard-codes `allowTrust: true`. Spec’s `stampedSurface === "summoner"` force-false is necessary (Trust lane) but **not sufficient** for this race.

`pack.apply` validate copy still says “Side Panel only” (`validate.ts:817`). Spec §4 “UI gesture only” is a string change; summoner ACL must add `pack.list`/`pack.apply` (`summoner-acl.ts:11-31` currently has neither). Out of this lane except: overlay apply while occupied hits Attack 5 on day one of PR2.

---

## Attack 6 — Generation CAS does **not** implement “UI never supersedes”

`llmLoopGeneration` (`message-router.ts:116-120,178-…,519-538`) + `abortThreadChat` bump (`:151-156`) is a **correct** predecessor-cleanup CAS. Tests (`llm-supersede-generation.test.ts`) only pin abort releasing the multi-agent gate — not “busy create rejected”.

If UI never sends create while occupied, supersede from **composer** does not run. Spec §6 对抗: “二次发送不得 abort 当前轮”. That is a **client** test unless Attack 2’s server reject exists. Overlay, Continue, old extension, `file.upload`, regenerate, `chat.done` gap, Stop-then-Enter will all still abort.

`abortThreadChat` already drops steer, keeps nextRun. Spec §2 Stop “丢未消费 steer；nextRun 保留” matches live. **Do not** “fix” abort to drain nextRun; #218 was explicit.

Drain must remain generation-scoped (`:530`). Good. Occupied-until-drain (Attack 1) is what makes “UI never supersedes” **possible**.

---

## Nits (would not reject alone)

- **N1** `chat.steer` checks `abortControllers.has` **before** lease (`:551` then `:555`). Idle + overlay holder → `no_active_run` not `OVERLAY_STANDBY`. Harmless; document order.
- **N2** `steer_queue_full` exists (`:560-566`); spec §5 table omits it (only `queue_full` for nextRun). Overlay mapper drops it.
- **N3** Optimistic Swift `你: text` (`SummonerOverlay.swift:499`) then hydrate may inject the same line (`menu-bar-agent.ts:750-756`) **before** steer is persisted (`takeSteer` only at next LLM round, `adapter.ts:902-916`). Enqueue is **never** a `chat.user`; overlay will show a fake current-turn line for a queued message. Spec only says steer is echoed; enqueue transcript is unspecified.
- **N4** `handleSummonerContinue` / `#` search vs talk still always create. Occupied Continue needs the same matrix.
- **N5** Panel `thread.select` `run_status` is a snapshot; after hydrate, C is maintained by events. Switching threads mid-run relies on `SET_THREAD_BUSY` keyed by `threadId` (`:1160-1169`) — OK — unless `chat.done` of thread A clears busy after user switched to B (`doneThreadId` from msg, good) while drain of A starts. Not overlay-specific.

---

## What is already correct (do not “fix”)

- `enqueue:true` does not bump generation; `chat.steer` does not install a controller.
- Abort drops steer, preserves nextRun; nextRun does not auto-start on abort.
- Generation CAS prevents predecessor `finally` from deleting successor controller / draining successor’s queue.
- Lease gate on steer/create/enqueue is the right **surface** mutex; busy is a different mutex.
- `gateChatCreateOnConductor` on steer as well as create (`:557`).
- Empty steer/enqueue rejected (`empty_steer` / `empty_enqueue`).
- Overlay close must not `chat.abort` (existing tests). Keep it. Occupied overlay close **must not** be the thing that starts nextRun.

---

## Must-fix before this design can be implemented without reintroducing supersede

1. **Server occupied gate**: `chat.create` while `abortControllers.has` and `enqueue !== true` → error, **no** `existing.abort()`. Name the exception types (`file.upload` / `chat.regenerate`) or delete those supersedes too.
2. **Idle enqueue gate**: `enqueue:true` while not occupied → `idle_enqueue`, not a new run.
3. **Occupied includes nextRun drain**: do not publish idle (`chat.done` / `SET_THREAD_BUSY` false / `summoner.done`) until drain has claimed or queue is empty. Overlay hydrate must see the same bit (`run_status` on summoner, or `summoner.busy`).
4. **Atomic overlay mapping in the router**, with `summoner.submit.enqueue?: boolean` (or equivalent) on the Swift wire. Tray must **not** check-then-`sendChatCreate`. `sendChatCreate` as it exists is a spec violation.
5. **Submit does not `claimLease`**. No lease → `OVERLAY_STANDBY`. Open/select claims.
6. **Map overlay errors**: `queue_full` / `empty_*` / `chat.enqueued` (+ **count**) / `chat.steered` / `no_active_run` through `mapChatMessageToSummonerCmd` (or RPC).
7. **Panel composer**: spec must explicitly re-enable textarea/`canSend` while occupied, branch Enter/Shift+Enter, keep attach/file.upload disabled, and define Cmd/Ctrl+Enter.
8. **Stop**: busy chrome until `chat.aborted`, not optimistic clear in `handleStop`.
9. **`pack.apply` mid-run**: freeze execution whitelist for the live generation **or** refuse/defer apply while occupied.

#1–#5 are the SoT. Without them PR1’s 对抗 (“二次发送不得 abort 当前轮”) is untestable except as a Side Panel screenshot, and overlay remains a supersede client.

---

VERDICT: REJECT
