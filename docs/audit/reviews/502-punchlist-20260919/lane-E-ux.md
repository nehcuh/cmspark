# Lane E — UX
HEAD: 022b2f60
VERDICT: REJECT

## Findings
### P-E-1 — BLOCK
- File: chrome-extension/src/sidepanel/components/ChatView.tsx:484-492, 1152-1153, 1211-1266; chrome-extension/src/sidepanel/components/tool-history-view.ts:384-415; chrome-extension/src/sidepanel/hooks/useWebSocket.ts:713-761
- Evidence: [inspected] `#514` consolidates a run into one tools block, then lifts the last assistant narration to sit *after* that block (`trailing` in `consolidateRunToolTurns`). ChatView still gates live/L2 on **last transcript item**, not last tools block:

```484:492:chrome-extension/src/sidepanel/components/ChatView.tsx
          const itemIsLast = i === transcriptItems.length - 1
          if (item.kind === "tools") {
            return (
              <ToolHistoryBlock
                key={`tools-${item.msgs[0]!.id}`}
                msgs={item.msgs}
                rounds={item.rounds}
                threadBusy={Boolean(itemIsLast && threadBusy)}
                pendingConfirmToolNames={itemIsLast ? pendingConfirmToolNames : EMPTY_CONFIRM_NAMES}
```

  Inside the block, even a `viewToolHistory` `kind:"live"` (running or pending-confirm id) is discarded unless that prop is true:

```1152:1153:chrome-extension/src/sidepanel/components/ChatView.tsx
  const lastView = viewToolHistory(lastTools, { threadBusy, pendingConfirmIds })
  const live = threadBusy === true && lastView.kind === "live"
```

  The live path that creates this shape is not hypothetical. `tool.start` commits any in-flight `streamingContent` / `streamingReasoning` as an assistant row *with function-shaped `tool_calls`* before appending the running tool row (`useWebSocket.ts` 713–761, comment: keep mid-turn text). `consolidateRunToolTurns` only absorbs **empty** tool-call drivers (`content.trim().length === 0`); any non-empty mid-text becomes the trailing “answer”. Tests lock the wrong predicate (`message-quiet-pr6.test.ts` `#508` asserts `itemIsLast && threadBusy`). Pure `viewToolHistory` still keeps L2 current (`tool-history-view.test.ts` “L2 pending is current”) — the fold happens at the ChatView wiring, after consolidation.
- What the user sees vs what they should: Wireframe 01 / spec §2.2: live turn = `已完成 N 步 · 展开` chip + **expanded** current `ToolCallCard` (running / 确认中). After a model says “好的，我来打开页面” and the first tool starts, the user instead gets the **done** chip (`N 步浏览器操作 · 0 失败 · 展开审计`, default collapsed) plus that sentence rendered as if it were the answer. The running card is behind the chip; L2 on that same step is also behind the chip (FocusBand `MinimalConfirm` can still show, but spec §2.3 / punch list: L2 must stay expanded in-stream, never buried in the chip). DeepSeek-style empty-content rounds escape this (empty drivers are skipped, tools block stays last) — GPT/Claude/Qwen content-before-tools, and CMspark’s own mid-turn commit, do not.
- Distinct because: Single root — `itemIsLast` after `#514` trailing-answer placement. Not a separate “L2 confirm buried” item.
- Suggested fix: Treat the **last `kind:"tools"` item of the current run** (after the latest user row) as the live frontier: pass `threadBusy` / `pendingConfirmToolNames` there even when a trailing assistant row follows. Keep historical runs (earlier user messages) collapsed. Render `kind:"live"` whenever `lastView.kind === "live"`; do not AND a false `threadBusy` prop that was forced off by `itemIsLast`.

### P-E-2 — MAJOR
- File: chrome-extension/src/sidepanel/components/ChatView.tsx:1724-1734; companion/src/security/tool-persistence-redact.ts:272-283; chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:3446-3469; companion/src/config.ts:350-360; companion/src/history/store.ts:102-107,456-475
- Evidence: [inspected] Default archive (`persist_full_tool_history: false`) collapses **non-sensitive** bodies to the same `{redacted, len, sha256}` envelope as SEC-C. Companion comment is explicit: reuse so the panel can keep saying 「出于安全未持久化」. Expanded audit therefore attributes a product-default omission to security. Spec §3.3 requires the honest mark 「正文未保存」. Settings help (`保存完整操作史`) is closer (“只留工具名、成败、内容指纹…已经省略的正文不会因打开而恢复”) but never says the key only covers `threads/*.json`. `history.db` still stores read-tier `result_summary` (≤500 chars after gates, 30-day) and logs are untouched — config.ts documents that scope; the toggle copy does not. Spec §3.2: if that isn’t written for the user, 「默认不保存」 is a false promise.
- What the user sees vs what they should: 展开审计 on a reloaded navigate/get_page_text step reads as a security fold they cannot undo, not “正文未保存；开设置只影响以后的 threads JSON；操作历史/日志另算”. Cookie/shell still correctly stay redacted either way — that part is honest; the default archive path is not.
- Distinct because: Copy/scope lie on slice B, not the live-fold predicate in P-E-1.
- Suggested fix: Split stub dialect — archive → 「正文未保存」 (+ optional “设置 → 对话归档可保存以后的步骤”); security-class → keep 「出于安全未持久化」. Settings help: one sentence that the switch is threads JSON only, does not empty `history.db` / `logs/`, and cannot revive already-stubbed rows.

### P-E-3 — NIT
- File: chrome-extension/src/sidepanel/components/LoopStatusRow.tsx:27-28; companion/src/loop/loop-status.ts:161-169
- Evidence: [inspected] Unarmed hint: `这一段跑满了 100 步工具调用，任务尚未收尾。回复“继续”可接着执行。` Armed status detail: `上一段用满了 100 步…`. Tombstone `达到最大工具调用轮次 (100)，已暂停。` is gone (locked in `round-limit-unarmed-hint.test.ts`). Wireframe slice 4 / spec §5.3: 100 is a hidden circuit breaker and “不进文案”. Punch list only requires a visible continue hint, not silent, not tombstone — that bar is met.
- What the user sees vs what they should: Continue hint is visible and non-red. They still see the magic number the wireframe kept off the operate surface.
- Distinct because: Copy density vs locked wireframe; not a missing hint.
- Suggested fix: Drop the numeral (`这一段跑完了，任务尚未收尾。回复「继续」可接着执行。` / `上一段用满了本段步数…`).

### P-E-4 — NIT
- File: chrome-extension/src/sidepanel/components/LoopStatusRow.tsx:456-461,245-247
- Evidence: [inspected] `cardFoot` is `display:flex; justifyContent:space-between` with **no** `flexWrap`. Hint (`点按即发送分派指令 · 每个 worker 仍需在确认中心批准` or the busy variant) plus 「不用，单线程继续」 plus 「派 worker 并行做」 share one 320px row. Subtask rows correctly wrap (`fleetCardItem`). Footer does not.
- What the user sees vs what they should: Spec card is readable on 320px including the L2 reminder. Footer may clip the hint or shove a button off the card. [assumed] actual overflow — no browser e2e.
- Distinct because: Layout of an otherwise-correct suggest card (title, wrap, no arm, 10 min silence, coexistence all hold).
- Suggested fix: `flexWrap: "wrap"` on `cardFoot`; stack hint full-width, buttons on the next row.

## Overturned
None (solo lane; no other-lane reports read).

## Residual (no browser e2e)
- FocusBand single-slot: `coding_session` / `confirm` outrank `fleet`, so Glance `角色:工具名` disappears while 编程接力 or MinimalConfirm owns the band. Inspect portal still does not steal the transcript (`SET_INSPECT_TAIL` before the active-thread gate; `inspectWorker` does not `SET_ACTIVE_THREAD`; portal close clears inspect). Pre-existing slot machine, not a new confirm UI.
- FleetStrip `styles.meta` is nowrap+ellipsis by contract; glance is on that same line. Clipping of `who:tool` vs `intent`/`worstLabel` not measured in a 320px chrome.
- Chip is a real `button` with `aria-expanded` (live + done). Native Enter/Space. Pager `‹ ›` are extra buttons; chip label also embeds `‹ n/m ›` — redundant but discoverable.
- Overlay/summoner: no overlay files in `93923c1d..HEAD`; `tool-history` locked sidepanel-only; `fleet_suggest_propose` SUMMONER_ACL fail-closed. No new overlay confirm chrome.
- Embed PTY: darwin ∧ `embedded_terminal.enabled` ∧ `embed_intent` gate; `embed_intent` / `embed_running` banners and Stop labels are honest; open errors `role="alert"`. Not visually clicked.
- Unarmed `round_limit` vs armed loop row: mutually exclusive ternary; unarmed copy is a continue hint. Armed live frame uses `这一段跑完了 N/M，接着下一段`. Panel-reopen `backfillLoopView(active)` still says 「续跑推进中」 without `lastTerminal` — only if `loop_state.status==="active"`.
- Fleet suggest: title `此任务适合多路并行`; subtasks wrap; accept = `chat.send` (steer while busy) + dismiss, **not** `task_loop.arm`; silence `FLEET_SUGGEST_SILENCE_MS = 10min`; independent block after `LoopSuggestCard`.

VERDICT: REJECT
