# Lane A — PRODUCT
HEAD: 022b2f60
VERDICT: REJECT

## Scope actually read

Claims (treated as claims, not truth): CHANGELOG Unreleased #502/#504–#511/#513; `docs/superpowers/specs/2026-09-18-agent-operate-surface-design.md`; `docs/superpowers/specs/2026-09-19-fleet-trigger-surface.md`; A/B/C/E/G1-DONE; `gh issue view` #502/#513/#514 and `gh pr view` #512.

Shipped UI / control flow [inspected]: `ChatView.tsx`, `tool-history-view.ts`, `LoopStatusRow.tsx`, `FleetStrip.tsx`, `FleetWorkerList.tsx`, `FocusBand.tsx`, `focus-band-priority.ts`, `CodingAgentPanel.tsx`, `CodingSessionChip.tsx`, `coding-handoff/copy.ts`, `coding-handoff/embed-entry.ts`, `SettingsSlideout.tsx`, `CodingHandoffSettingsSection.tsx`, `useWebSocket.ts`, `agentStore.tsx`, `redacted-stub-utils.ts`, `MinimalConfirm.tsx`, `cockpit/CockpitApp.tsx`. Companion contracts that drive that copy [inspected]: `tool-persistence-redact.ts` (`archiveToolPayload`), `loop-kernel.ts`, `loop-status.ts`, `llm/adapter.ts` (fleet hint + round_limit exit + summoner filter), `companion-dispatch.ts` (fleet_suggest_propose + spawn_worker goal/kick), `l2-admission.ts` (spawn preview), `security-policy.ts` (spawn token bind), `server.ts` (kickWorkerChat + summoner strip), `orchestrator/fleet.ts` (Glance push), `config.ts` SCOPE comment.

Not executed: no browser e2e, no live companion round. Findings below are path-traced from HEAD source.

## Findings
### P-A-1 — BLOCK
- File: chrome-extension/src/sidepanel/components/ChatView.tsx:1724-1734; companion/src/security/tool-persistence-redact.ts:280-283, 307-326
- Evidence: [inspected]
- Claim that is false:
  Spec §3: archive stubs must be labelled **「正文未保存」**; the default is a product choice, not a security fold. CHANGELOG / settings: default archive keeps **tool name + ok/fail + fingerprint**. The persist helper even admits it reused the SEC-C envelope so the panel keeps saying **「出于安全未持久化」** and “needs no new UI dialect.”
- Actual behavior:
  Default `persist_full_tool_history === false` runs `archiveToolPayload` → `collapseResult` (`{success, redacted:true, len, sha256}`). `extractRedactedStub` matches that shape. After reload, **every** ordinary `navigate` / `click` / `get_page_text` card in the expanded audit chip renders:

  `出于安全未持久化：原始长度 N 字符 · sha256 …。实时轮次中内容对模型与界面可见…重新加载后不再保留。`

  That string is the old SEC-C dialect. Sensitive classes still fold either way; the new default stubs **non-sensitive** bodies too.
- Failure mode for the user:
  Reload a normal browser task → expand「展开审计」→ every step looks like a security redaction. They go to **安全与信任**, not **对话归档**. Settings copy (“只留工具名、成败、内容指纹”) and the transcript contradict each other. Spec’s required honest annotation never shipped.
- Why this is a distinct product lie (not a duplicate of another finding in this file):
  This is the **in-transcript** cause-of-omission, after reload. P-A-2 is the settings toggle not taking effect. Different surface, different lie.
- Suggested fix:
  Split dialects. Default archive: `正文未保存（设置 → 对话归档可打开完整操作史；已省略的不会恢复）`. Keep `出于安全未持久化` only for cookie / shell / host / osascript / MCP secret folds. Do not reuse SEC-C copy for the product default.

### P-A-2 — MAJOR
- File: chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:3447-3468 vs 3262-3270 and 4187-4217
- Evidence: [inspected]
- Claim that is false:
  The control’s own label is a **live status**: `已开启` / `默认关闭`. Help text describes companion persist behaviour. Same file’s coding-handoff / embedded-terminal toggles `config.set` on click.
- Actual behavior:
  Archive toggle only `dispatch(SET_CONFIG)`. Companion still reads disk `getConfig().persist_full_tool_history` until footer **「保存并关闭」**. Local store can say `已开启` while every new tool row is still stubbed. Closing the slideout without save leaves the lying label for the session (hydrate may later snap it back).
- Failure mode for the user:
  They turn the switch on, keep chatting, reload, still see stubs (and P-A-1’s security copy). They conclude the feature is broken. Digest fields in the same section explicitly say「点『保存』写入 Companion」; this toggle does not.
- Why this is a distinct product lie (not a duplicate of another finding in this file):
  Persist **when** vs persist **why**. P-A-1 is wrong copy on already-written stubs. This is the switch claiming a mode the companion has not entered.
- Suggested fix:
  Send `{ type:"config.set", config:{ persist_full_tool_history } }` on click (same pattern as `embedded_terminal.enabled`), or stop saying `已开启` until `config.updated` hydrates, and mirror the digest help:「点保存后才对之后的工具行生效」.

### P-A-3 — MAJOR
- File: chrome-extension/src/sidepanel/components/ChatView.tsx:558-590; LoopStatusRow.tsx:26-39, 332-373; companion/src/loop/loop-kernel.ts:360-378
- Evidence: [inspected]
- Claim that is false:
  #505 / PR #512: unarmed 100-cap is a **non-tombstone continue hint**, armed threads use the loop status row, **无双提示**. Spec NEVER: no unarmed auto-continue / no silent autonomy. G1: unarmed → 建议卡; #505 added the hint because suggest is checklist-scoped.
- Actual behavior:
  Unarmed `round_limit` still emits `task_loop.suggest` when `untickedEvidence(run_progress).length > 0` (the normal page-operate path: page tools require propose). Independently, `shouldShowRoundLimitHint` is only `!loopView && terminal==="round_limit"` — it does **not** look at `loopSuggest`. ChatView renders **both**:

  1. `RoundLimitHint`: `这一段跑满了 100 步工具调用，任务尚未收尾。回复“继续”可接着执行。` (one more `chat.create`, no arm)
  2. `LoopSuggestCard`: `要继续做完吗？` / CTA `继续做完` / hint `点按即激活续跑` → `task_loop.arm`

  #505’s “no double prompt” only vs `LoopStatusRow`, not vs the arm card.
- Failure mode for the user:
  Two “continue” CTAs stacked. Typing 继续 ≠ clicking 继续做完. The latter injects 20-run loop autonomy. Easy to arm a loop while following the new #505 sentence.
- Why this is a distinct product lie (not a duplicate of another finding in this file):
  Autonomy double-prompt on the 100-cap, not archive copy and not fleet dispatch.
- Suggested fix:
  If `loopSuggest` is showing for this thread, do not render `RoundLimitHint`. Or drop the arm card on `round_limit` and keep a single CTA whose copy matches the action (reply 继续 vs explicit arm).

### P-A-4 — MAJOR
- File: companion/src/tool/l2-admission.ts:329-330; companion/src/security-policy.ts:95-101; chrome-extension/src/cockpit/CockpitApp.tsx:608-610
- Evidence: [inspected]
- Claim that is false:
  #514 / catalog / dispatch: `spawn_worker` **requires `goal`**, persists it as the worker brief, and **kicks immediately**. Confirm / 急停 never buried. Expert-team L2 **does** show `goal=`.
- Actual behavior:
  Spawn L2 preview is still `Spawn worker role=… alias=… pack=… allow=… deny=… intent=…` — **no goal**. Token bind is the same fields, **no goal**. Cockpit renders `full_preview || code_preview` (that string). Side-panel `MinimalConfirm` is tool-name + “详细预览在确认台”. The load-bearing task the worker will run is not on the HITL card this branch made required.
- Failure mode for the user:
  They approve “检索 worker” and never see “爬这 8 个招聘站并返回表格”. Confirm no longer matches the work. (Token not binding `goal` is also a swap window — other lanes; product fact is the preview.)
- Why this is a distinct product lie (not a duplicate of another finding in this file):
  Confirm-center contract for spawn, not transcript archive and not the 100-cap continue pair.
- Suggested fix:
  Put truncated `goal` (and `role_prompt` if any) in the L2 preview; bind `goal` on the token like `spawn_expert_team` already binds slices.

### P-A-5 — NIT
- File: CHANGELOG.md:8; SettingsSlideout.tsx:3467-3468 vs companion/src/config.ts:357-360
- Evidence: [inspected]
- Claim that is false:
  Spec §3: if you don’t say so, 「默认不保存」 is fake — `history.db` / `logs` are out of scope. B-DONE residual 3: must be in 对外说明.
- Actual behavior:
  User-facing CHANGELOG / settings never mention 操作历史 / logs. Config SCOPE comment is developer-only. The 操作历史 **panel** only lists tool name + ✓/✗ + time (`ContextPanelHost.tsx:411-434`), so the visible table is not a full replay — the overclaim is disk-privacy, not a second transcript.
- Failure mode for the user:
  Anyone who believed “we stopped saving operations” still has 30-day `history.db` summaries and logs.
- Why this is a distinct product lie (not a duplicate of another finding in this file):
  Sink-scope disclosure, not the SEC-C dialect (P-A-1) and not the toggle (P-A-2).
- Suggested fix:
  One clause on the settings help:「只作用于对话 JSON；操作历史面板与日志不在此开关内。」

## Overturned / not-a-bug

- **「不嵌 Alacritty、不自动开 PTY」** — ACP start records `embed_intent` only (`embed-entry.ts:139-148`; panel button is click + L2). Settings still list Alacritty as **Mode C outer app**, which is the pre-existing jump, not an MV3 embed. `#506` `embed_running` banner/Stop copy is honest. [inspected]
- **「不激活续跑」on fleet accept** — `buildFleetAcceptMessage` is `chat.send` (+ steer if busy); tests lock `task_loop.arm` off the card. Hint says 分派指令 + 确认中心. #513 issue **body** still says arm; the issue **comment** declares the v2 revision. CHANGELOG matches HEAD. [inspected]
- **Summoner exclusion** — `fleetDispatchHint` empty on `surface==="summoner"`; catalog tools stripped; `fleet_suggest_propose` fail-closed on summoner/null handshake. Overlay has no `FleetSuggestCard`. [inspected]
- **Glance invisible / Inspect steals transcript** — `broadcastFleetSnapshotIfWorkers` on spawn + run-end; FocusBand 10‑min `fresh` gate; `inspectWorker` does not `SET_ACTIVE_THREAD`. Glance suffix `who:tool` is one meta line as spec E (not the wireframe’s 3-line %). [inspected]
- **Busy fleet-card copy「当前回合结束后送达」** — accept uses `chat.steer`; `takeSteer` is the next tool-loop round, leftover steers become `nextRun`. Not “lost” and not “after the whole 100-step run.” [inspected]
- **CHANGELOG「100 步改为换段续跑」read alone** — Unreleased #505 bullet scopes unarmed to a continue hint. Combined changelog is honest; the double-prompt is P-A-3, not this sentence.
- **FleetStrip `fleetStripShouldShow` omits `fresh`** — `FleetStrip` is only mounted from FocusBand after `hasFleetActivity` already applied the gate. Dead inner check, not a second squat.

## Residual (pre-existing, not this diff)

- **#502 D Goal Driver** (issue “停在目标完成 / 无进展 / 预算 / 安全”) is still T3. This branch ships G1 `round_limit` only. CHANGELOG does not claim the full goal card. Do not treat missing Goal UI as a new lie.
- **C-DONE leftover** “intent stuck on embed_intent after spawn” is addressed by #506 `embed_running` on this HEAD; not residual anymore.
- **Main-thread L2 frames without `thread_id`** — PR #512 residual; #507 gates with current view + `itemIsLast`. Pre-existing wire shape.
- **`history.db` / logs** still exist (P-A-5 is only the missing user-facing SCOPE sentence).
- **Pager「展开审计」shows the current round**, not all N steps at once — matches #514 comment; not a spec NEVER.

VERDICT: REJECT
