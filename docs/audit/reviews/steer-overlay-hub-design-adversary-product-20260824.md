# Adversary review (Product / UX) — steer/nextRun UI + overlay L0 hub

**Batch**: `steer-overlay-hub-design-20260824`  
**Role**: independent Product / UX skeptic (did **not** author the spec)  
**Lane**: PRODUCT — hostile to habit-breaking send semantics and dishonest overlay chrome  
**Spec**: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`  
**Prompt**: `docs/audit/reviews/_prompts/steer-overlay-hub-design-adversary-20260824.md`  
**Repo**: `/Users/huchen/Projects/cmspark`  
**Date**: 2026-08-24  
**Design-only**: no production edits. Live code `[inspected]`, not a running overlay/panel session.

**Routing override.** Task is a named PRODUCT/UX design adversary with a fixed write path. `vibe route` is not the work.

```text
Surface:      L0 (composer send semantics + overlay chrome)
L2-classes:   none — overlay still not an Allow/Deny surface
Compose:      pack.apply from overlay with allowTrust:false only
Autonomy:     single-thread steer / nextRun (already in companion)
Trust:        monotonic — overlay MUST NOT write Trust B
Channel:      summoner ACL expand pack.list + pack.apply; mcp.add stays denied
```

Do **not** treat “busy Enter = 纠偏” as proven just because companion already has `chat.steer`. The incident to prevent is: **the user hits the send chord and the product does something other than send**. Overlay chrome that says “管理 MCP / 会议不必开 Chrome” while the surface is read-only chips + a composition-only pack apply is the second incident.

---

## What the live product actually does `[inspected]`

### Side Panel composer (`InputArea` in `chrome-extension/src/sidepanel/App.tsx`)

Busy is **not** “second send = supersede” on this surface. Busy is **lock the field**.

| Control | Live behavior |
|---------|----------------|
| Textarea | `disabled` when `threadBusy` / overlay standby (`App.tsx` ~1771–1777) |
| Placeholder | `本对话处理中 · 停止后再指挥` (`thread-busy.ts` `composerBusyPlaceholder` `thread_busy`) |
| `canSend` | false when `composerMode === "thread_busy"` (`App.tsx` ~880–887) |
| Primary chrome | Send **replaced by Stop** (`showStop = threadBusy \|\| isStreaming`, ~562, ~1793–1807) |
| Enter | Only fires `handleSend` when `shouldSend && canSend`. Busy ⇒ Enter is a no-op (field disabled) |
| Shift+Enter | **Not bound.** Default `sendShortcut === "Enter"`: only unmodified Enter is preventDefault'd. Shift+Enter falls through to the textarea = **newline** |
| `sendShortcut` | Settings: Enter / Cmd+Enter / Ctrl+Enter (`SettingsSlideout.tsx` ~1132–1142). Spec ignores this |
| Idle send | `chrome.runtime.sendMessage({ type: "chat.send" })` → SW always `chat.create` (`background/index.ts` ~510–548). Companion supersede is `chat.create` while `abortControllers` has the thread |

Panel thesis at file head: *“type or tap a sentence → work still fits 320px.”*

### Overlay (`companion/src/tray/SummonerOverlay.swift`)

This **is** the supersede surface today.

| Control | Live behavior |
|---------|----------------|
| Window | Content **420×~180**, `minSize` 420×140, capture column width locked to **396pt** (`relayout` ~862, `makeWindow` ~867–875) |
| Composer | 40pt capsule. `#` prefix = title search, not send (`isSearchQuery`, `insertNewline` selects a hit) |
| Enter | `insertNewline` → `submitComposer()` **always**, including Shift+Enter (no `modifierFlags`) |
| Submit payload | `{ type: "summoner.submit", thread_id, text }` — **no shift / enqueue bit** (`protocol.ts` `SummonerSubmitEvt`; Swift ~495–504) |
| Node | `sendChatCreate` → fire-and-forget **`chat.create`** (`companion-client.ts` ~286–290). Busy thread ⇒ companion supersede (`message-router.ts` ~369–379) |
| Hint | `回车发送到当前线程，输入 # 搜标题` |
| MCP | Copy *「MCP 未连接 · 去侧栏配置后这里可直接调用」* then **`isHidden = true` always** (`applyMcp` ~286–292) |
| Mic | Tooltip `听写暂未开放`. Not a meeting workbench |
| Windows/Linux | `systray2-bridge.ts` `openSummoner` / `sendSummoner` **no-op** (~176–178) |

### Busy SoT is not one SoT

- Panel: `deriveThreadBusy({ streaming, isProcessing, runningToolCount, mapBusy })` where `mapBusy` is `SET_THREAD_BUSY` from `run_status` **and** optimistic send/upload (`useWebSocket.ts` `chat.token` / `chat.user` / `chat.done` / `file.upload_*`; `InputArea` send ~1396–1398, Stop ~1423–1424).
- Overlay PR1 mapping (spec): companion `abortControllers`.
- Lease: `OVERLAY_STANDBY` — *「这边暂时打不了字，正在召唤器里说」* (`agentStore.tsx` ~10–14). Orthogonal to LLM-busy.

These three already disagree on Stop-then-type, upload-busy, and dual-open. Spec’s “与 panel 同一 SoT” is false of the code it cites.

### Meeting pack vs “不必开 Chrome”

`companion/src/packs/builtin/meeting-minutes/pack.yaml`: **no `trust:` block**, `tools.mode: unchanged` / `allow: []`, id `meeting-minutes`, `min_capability: L0`. Heuristic in spec §3 → **overlay-eligible: yes**.

Side Panel apply is **not** composition-only: `PacksPanel.tsx` ~407–423 flashes *「已应用会议场景，正在打开会议工作台…」* and `openPanelForce("meeting")`. Overlay apply cannot open that workbench. Overlay cannot record (mic closed). Windows has no overlay.

---

## Hunt scorecard (this lane)

| Hunt | Result | Why |
|------|--------|-----|
| Busy Enter = steer vs user expecting send/supersede | **FAIL (block)** | Panel users cannot send while busy today; overlay users **do** send (supersede). Spec hijacks Enter to a third meaning (in-flight 纠偏) without unlocking the field or keeping Stop as the primary busy chrome. Consumer send chord becomes agent jargon. |
| Shift+Enter vs newline | **FAIL (block)** | Default shortcut: Shift+Enter **is newline**. Spec: busy Shift+Enter = enqueue. Same chord, state-dependent. Overlay submit has no modifier. `sendShortcut` Cmd/Ctrl+Enter unspecified. |
| Overlay 200pt rail vs 420 capture | **FAIL (block)** | 200pt on a 420 min-width capture window is either a 220pt capture stub or a 620pt mini-app. Spec specifies neither. Dual thread pickers (`#` in field + rail list). 320px panel cannot host Stop + 纠偏 + 排队. |
| Windows users get panel-only | **FAIL (honesty)** | Spec non-goal is technically true. Problem statement still sells *「会议纪要不必开 Chrome」*. Windows tray overlay is a no-op; PR2 is macOS-only. Buried, not labeled as a product split. |
| MCP “management” read-only honesty | **FAIL (copy)** | Goal sentence: 悬浮窗能**管** MCP. ACL + UI: `mcp.list` chips, no add/remove. Live leftover copy *「这里可直接调用」* is a lie even if the row stays hidden. |
| Meeting pack actually eligible? | **ELIGIBLE, journey false** | Pack matches §3. User journey (record / workbench / no Chrome) does **not**. |
| Steer as `chat.user` pairing | **FAIL (nit→block if shipped as-is)** | Companion injects steer as a normal user turn (`adapter.ts` ~902–916). Overlay plaintext `你:` cannot tell 纠偏 from 发送. Spec says “不必再插假气泡” — that **is** the pairing bug. |
| Busy SoT (`SET_THREAD_BUSY` vs abortControllers vs lease) | **FAIL (chrome lie)** | 纠偏/排队 will light when companion is idle (`no_active_run`) and stay dark when overlay still holds the lease. |

---

## 1. Findings — blocking

### B1 — Busy Enter = 纠偏 is a send-chord hijack, not a send-semantics fix

**Claim to falsify**: “忙时说话是纠偏而不是杀掉当前轮” is what the human *intends* when they press the send key.

**What the user actually has today** `[inspected]`

- **Side Panel**: there is no second send. The field is disabled. Muscle memory is **Stop → type → Enter = new `chat.create`**. Spec grill #6 even keeps that for idle-after-Stop. Unlocking the field (which the spec **never states**) and making the same Enter mean `chat.steer` trains two opposite verbs on one key.
- **Overlay**: Enter *is* send, and send *is* supersede (`summoner.submit` → `chat.create`). Power users who mash Return to “start over” will instead inject a user turn into the *current* tool loop. The correction they wanted (abandon this, do that) is now the opposite of Stop.

Steer is a real verb. It is **not** send. ChatGPT/Claude panel: block or stop. Queue products: typed text is the *next message*. Agent IDEs: steer is a labeled interrupt. This spec takes the agent-IDE verb and puts it on the unlabeled consumer Return.

Worse: a full new request typed while the model is talking (*「算了改写 Python」*) becomes in-flight steer. Companion joins all pending steers with `\n` into **one** `chat.user` (`adapter.ts` ~902–910). That is not “my next message”; it is “whisper to the current run.” Users who wanted a new turn will watch the old run keep going, then see their words appear as if they had sent.

**Spec gap that makes this unshippable even if you like steer:**

1. Textarea stays `disabled={threadBusy}` unless PR1 deletes that gate. Spec never says unlock.
2. `canSend` is false on `thread_busy`. Enter never reaches a new `handleSteer`.
3. Busy primary button is **Stop**, not Send. “主按钮忙时改称「纠偏」” collides with Stop. Three actions (Stop / 纠偏 / 排队) are required; the spec draws two names and pretends Stop still exists in a table.
4. 320px capsule (`App.tsx` thesis) cannot take Stop + 纠偏 + 排队 + mic without eating the sentence field.
5. `l2_task` (CU running) is a different composer mode. Spec is silent. Steering “点允许” from a newly-enabled panel field while Cockpit owns L2 is how overlay chrome becomes a second conductor.
6. `chat.regenerate` from ChatView editor still uses the same Enter shortcut (`ChatView.tsx` ~655–668) and still supersedes (`message-router.ts` regenerate path). Spec does not touch it. “禁止再走 supersede” is false for edit-resend and Cockpit `chat.send`.

**Required remap (non-negotiable for this lane):**

- **Enter / configured send shortcut** always means “this text is a user message.” Idle → `chat.create`. Busy → **`enqueue: true`** (nextRun), never silent steer.
- **Steer is opt-in chrome**: a labeled `纠偏` (or “插入当前轮”) **button**, not Return. Empty field: no send, no steer.
- **Stop stays Stop**, visible while busy. Copy: 停止将丢弃未送达的纠偏；已排队的下一轮保留 (matches companion abort vs nextRun CAS).
- After Stop, Enter is `chat.create` (already spec). Do not also bind that to 纠偏.
- `sendShortcut` Cmd+Enter / Ctrl+Enter: the *send* chord follows settings; unmodified Enter remains newline. Spec must say this.

That is a grill #2 reversal, not a copy nit. Default busy Enter = steer **is** the habit-break.

### B2 — Shift+Enter cannot be 排队 on a surface where Shift+Enter is newline

**Claim to falsify**: “排队 = 按钮 + Shift+Enter” does not steal newline.

Live `handleKeyDown` (`App.tsx` ~1148–1165):

- `Enter` shortcut: send only if `Enter && !shift && !meta && !ctrl`.
- Shift+Enter is **intentionally** the multiline chord. Users writing 纠偏/下一轮 in a 2-row textarea will hit it.

Spec §5: idle Shift+Enter = 换行; busy Shift+Enter = enqueue. **Same physical chord, busy-bit dependent.** Classic footgun:

1. User starts a multiline prompt while the run is still `threadBusy` (or optimistic `SET_THREAD_BUSY` after send).
2. Shift+Enter “new line.”
3. Composer submits a half-sentence onto nextRun, field clears, cap-8 ticks.
4. They think they are still drafting.

Overlay is worse: `insertNewline` does not read Shift. Spec says “busy 映射在 Node 不在 Swift” but `SummonerSubmitEvt` has **no modifier**. Node cannot distinguish steer vs enqueue vs create from the live protocol. “实现时可合并” is not a protocol.

**Required:**

- Shift+Enter **never** enqueues on Side Panel. Newline stays newline for `sendShortcut=Enter`.
- Overlay idle: Shift+Enter may ignore (single line) **only if** Swift checks `modifierFlags` and does not submit. Today it submits.
- Queue is the **排队** button + optional an explicit chord that is **not** newline (e.g. Alt+Enter), documented next to `sendShortcut`.
- If they insist on a modifier, extend `summoner.submit` with `enqueue?: boolean` (or `intent: "steer"|"enqueue"|"create"`). Do not invent it in Node.

### B3 — 200pt left rail is a hub smuggled into a 420pt capture window

**Claim to falsify**: overlay can “管对话 / MCP / L0 场景” without stopping being a capture overlay.

Live capture geometry `[inspected]`: 420 wide, 396 content, 40pt field, `#` search dropdown in the **same** field, foot row two equal buttons (`发送` / `已连接，继续对话`). Prior PRODUCT lane already called this L0 capture, not main UI (`os-agent-shell-nits-20260823-product-ux.md`).

200pt rail:

| Choice | Result |
|--------|--------|
| Keep 420, steal 200 | Capture column **~196pt**. Hint `回车纠偏 · Shift+Enter 排队`, `#` hits, 纠偏+排队+发送 cannot fit. Capture job dies. |
| Grow to ~620 | No longer summoner. Mini Side Panel that **still** cannot render markdown, cannot Allow/Deny, cannot add MCP, cannot open meeting workbench. Dishonest “工作台”. |
| Unspecified (spec as written) | Implementer will pick the steal. Users get a crowded 420. |

Additional crowding, not in the spec:

- **Two thread pickers**: rail `thread.list` + `#` title search in the composer. Spec: “保留 `#` 只搜标题” **and** a permanent thread list. `#` hits stack already adds 8+36×n height (`relayout` ~858). Rail + hits + log(220) is a tower, not a summon.
- Header already has **新对话**. Rail `thread.create` + lease.claim is a second new-chat.
- Foot row is 396×36 fill-equal **two** buttons. Busy adds 纠偏/排队; Stop is unnamed in chrome. Overlay has no Stop control today (close ≠ abort, comment line 10). Spec PR1 Stop on overlay is a **new** button in a row that is already full.
- MCP chips + pack rows in 200pt: long names wrap into a third scrollbar. Ineligible gray *「去侧栏确认」* needs a line of type per pack.

**Required:**

- Spec the window: min width, whether the rail is collapsible, and a **capture-first** default (rail closed or overlay stays 420 with rail as a separate popover).
- Pick **one** thread switcher. Either rail list *or* `#`. Not both as primary.
- Overlay Stop / 纠偏 / 排队 layout drawing at 396pt **and** at 196pt. If it does not fit 396, it is not L0 capture.
- Do not call it a 工作台 in user-facing copy if Trust, MCP mutate, and meeting workbench remain Side Panel.

### B4 — Overlay copy overclaims: MCP “管理”, Windows Chrome, meeting without Chrome

**Goal sentence (spec §0):** 悬浮窗能管**对话 / 已连接 MCP / L0 场景**.

**ACL (spec §4):** no `mcp.add` / `mcp.remove` / `pack.install` / `config.*`. PR2 is chips.

That is **status**, not 管. Shipping a rail section titled MCP next to clickable 场景 apply teaches: chips are actions. Dead chips in a “hub” are dishonest overlay chrome.

Live string still in source (`SummonerOverlay.swift` ~1134, `applyMcp` ~288): *「去侧栏配置后这里可直接调用」*. Overlay chat.create may *see* MCP tools; the user cannot connect, toggle, or pick servers here. “可直接调用” is how a later patch adds `mcp.add` “because the chrome promised it.”

**Windows:** `systray2` overlay is a documented no-op. Spec §1 non-goal is honest **if** problem/goal stop selling overlay outcomes as product-wide. They do not. *「会议纪要不必开 Chrome」* is a table row in §0. False for:

- Every Windows/Linux user (panel-only; meeting workbench is Chrome).
- macOS overlay: mic `听写暂未开放`; apply meeting pack does **not** open `PacksPanel`’s meeting host; recording still needs Side Panel `meeting_privacy_ack_v1` (pack.yaml hard rule 4).

**Meeting pack eligible?** **Yes** under §3 (no `trust:`, not appsec/netsec/shell prefix, no `tool_whitelist` of L1 tools — the pack uses `tools.allow: []` / `mode: unchanged`). **No** as the user story. Overlay apply = skills + `system_prompt_append`. Side Panel apply = that **plus** 打开会议工作台. Spec must not equate them.

Heuristic hole (product-visible): `coding-handoff` has no `trust:` and id is not appsec/netsec/shell, but `tools.allow` includes `list_tabs` / `get_page_text` / `screenshot`. Spec checks `tool_whitelist` **if present** — this pack’s field is `tools.allow`. If the pure function is literal, coding-handoff becomes overlay-eligible L1 composition. Users tap 编程接力 on a capture window that cannot screenshot. Gray it via `min_capability > L0` **and** `tools.allow`, not only `tool_whitelist` / id prefix.

**Required copy / IA:**

- Rail: **已连接 MCP** (not 管理). Chips not clickable. Empty: **去侧栏添加**. Delete *「这里可直接调用」*.
- Goal: drop “管 MCP”. Say 查看已连接名字.
- Problem row *「会议纪要不必开 Chrome」*: rewrite to **macOS 悬浮窗可套用会议场景并粘贴转写；录音 / 工作台仍在侧栏。Windows 仅侧栏。**
- Overlay eligible meeting row: **套用场景（整理转写）**. Not **开始会议**.
- `pack.apply` validate/router strings still say *Side Panel only* (`validate.ts` ~817, `message-router.ts` ~2728). Spec §4 already wants “UI gesture only” — keep Trust-only-on-panel in the same sentence so overlay apply does not read as Trust apply.

### B5 — Busy chrome will lie because SoT is not shared

Spec: panel uses `SET_THREAD_BUSY` ← `run_status`; overlay uses `abortControllers`; “同一 SoT.”

`SET_THREAD_BUSY` is **not** `run_status` alone `[inspected]`:

- Optimistic true on `handleSend` / file upload **before** companion has a controller.
- Optimistic false on `handleStop` **before** abort finishes.
- `chat.user` echo sets busy true — **including steer echoes**. Steer then looks like a new send and re-locks chrome if they forget to keep the field open.
- Upload parse failure clears mapBusy; tools-still-running can still `deriveThreadBusy` via `runningToolCount`.
- Lease standby disables send even when LLM is idle.

User-visible lies:

1. Panel shows 纠偏, companion returns `no_active_run` (optimistic leftover).
2. Overlay Enter still `chat.create` supersede because Swift has no busy bit and Node’s controller was already dropped.
3. Stop then immediate Enter: panel thinks idle (`SET_THREAD_BUSY false`); companion still has controller → unexpected steer (if they ship B1) or unexpected enqueue.
4. Overlay standby: spec maps it to a hint *「侧栏占用了输入」* — good — but PR2 rail still offers pack.apply / new thread while the composer is dead. Hub chrome on a standby capture is a trap.

**Required:** one **user-visible** busy enum: `idle | running | overlay_standby | panel_standby`, same labels on both surfaces. Do not drive 纠偏/排队 from panel-only `threadBusyById` if overlay submit is gated on `abortControllers`. Until that exists, **do not rebind Enter.**

---

## 2. Findings — nits (do not save the spec)

### N1 — Queue count without a queue

Spec: 成功排队可见条数 (cap 8); `queue_full` 稍后再排. `chat.enqueued` today returns `{ queue: "next_run" }` with **no count** (`message-router.ts` ~362–366). No dequeue, no peek list, no “这条将在本轮结束后发送.” Cap 8 with only a number is a voicemail with no playback. Minimum: show the queued text chips + dismiss (or say v1 is count-only and **cannot** cancel).

`steer_queue_full` exists (`MAX_STEER` 8) and is **not** in the spec error table. UI will dump a raw string.

### N2 — Steer as unlabeled `你:`

Spec: companion already echoes `chat.user`; UI must not fake a bubble. Overlay log is `你: ${text}` on **local** submit (`submitComposer` ~499) **and** will get another `chat.user` for the same steer when the loop consumes it (timing: not at submit, at next tool-step). Pairing: two `你:` lines, or one local + one delayed, for a single 纠偏. Panel: steer looks like the user sent a new turn; export/Obsidian/edit-regenerate treat it as a normal user message.

Need a **纠偏** chip / prefix, not a second fake bubble. `role: user` without a `kind: steer` is how pairing stays confusing.

### N3 — Pack apply mid-run

Spec allows composition-only apply while running, no abort. User taps 会议记录 during a coding turn: system prompt appends, tools stay `unchanged` (meeting pack does not strip browser tools). The current run does not know it was restaffed. Flash: **已套用，下一轮起按会议场景** — or block apply while busy. Silent mid-run rewrite is dishonest.

### N4 — Voice / files / `@` refs

Busy dictation remains `!threadBusy` (`App.tsx` ~591–595). Spec re-enables typing but not voice. File upload while busy still blocked (`ingestBlocked` includes `threadBusy`). `@` thread refs and slash skills go through `handleSend` only. Steer/enqueue of attachments is unspecified. Do not let a busy 纠偏 button accept chips it will drop.

### N5 — IME

Overlay already refuses submit while `hasMarkedText`. Panel Enter does not. Any new busy binding must keep IME Return from 纠偏/排队. Spec silent.

### N6 — Overlay `#` empty needle

Prior overlay review: empty `#` is defined as one hit (newest thread) and hydrates. Rail thread list + that `#` behavior will auto-jump the capture thread. Spec “保留 `#` 只搜标题” must keep “empty `#` is not a select.”

---

## 3. Axes (ADR-020)

| Axis | Spec claim | This lane |
|------|------------|-----------|
| Surface | L0, overlay not Allow/Deny | Hold. Do not add confirm chrome to the rail. |
| Compose | overlay `allowTrust: false` | Hold if router **forces** it. Eligible heuristic must use `tools.allow` + `min_capability`, not a missing `tool_whitelist` field. Meeting pack is L0 compose; meeting **workbench** is not. |
| Autonomy | existing steer/nextRun | Hold the primitives; **do not** put steer on unlabeled Enter. |
| Trust | monotonic | Overlay must not look like it can 确认 Trust. “去侧栏确认” is the right disabled state **if** it is not a fake button. |
| Channel | summoner +pack.list +pack.apply | Honest only if MCP section is read-only in **title**, not just ACL. |

Pack-first: overlay one-tap L0 apply is the right shape **for meeting-minutes composition**. It is the wrong shape as a substitute for the meeting workbench.

---

## 4. Resubmit bar (PRODUCT)

Do not re-ask for APPROVE until the spec text itself:

1. **Reverses grill #2:** busy send-chord = **enqueue** (or keep field locked). Steer is a named button. Shift+Enter stays newline when `sendShortcut=Enter`. Document Cmd/Ctrl+Enter.
2. **Unlocks the field explicitly** if busy typing is in scope; draws Stop + 纠偏 + 排队 at **320px** and **396pt** (or drops buttons until they fit).
3. **Specifies overlay width** and a single thread switcher; 200pt rail must not shrink capture below a usable field. Capture-first default.
4. **Rewrites §0 goal/problem** so MCP is 只读已连接, Windows is panel-only, meeting-without-Chrome is macOS paste+pack, not 工作台.
5. **Labels steer** in the transcript; does not pretend `chat.user` echo is pairing-complete.
6. **Names one busy SoT** the user can see; Stop→Enter race described.
7. **Extends `summoner.submit`** if overlay has more than one submit intent. “Node will know” is not a design.

N1–N6 can ship as follow-through **after** B1–B5.

---

## Verdict rationale

The companion primitives (steer / nextRun / allowTrust skip) are fine. The **UI plan attaches the wrong verb to Return**, steals Shift+Enter from newline, and dresses a 420pt capture overlay as an MCP/pack 工作台 it cannot be — especially on Windows and for 会议纪要.

That is habit-breaking send semantics plus dishonest overlay chrome. Both are this lane’s kill criteria.

VERDICT: REJECT
