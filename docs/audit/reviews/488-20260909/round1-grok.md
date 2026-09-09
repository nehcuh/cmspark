# Independent review: CMspark #488 vs `947532a8`

Capability claim holds: existing `thread.batch_delete` + `only_empty` / empty-target probe; no new agent/tool privilege; confirmations stay user-gated; no offline destructive queue. Machine PASS is not treated as correctness.

## What actually landed

Selection is now the current search/tag/trash view and no longer expands an empty selection. Mutations wait on correlated companion payloads, not transport ACKs, in serial 50s. Empty cleanup probes `thread_ids: []` then hard-deletes with a server `getMessages()` recheck. Meeting close *intends* to drain capture → readback → `meeting.end`. Those contracts are the right ones. Several of them are not actually closed.

---

## P1 — leaked `beforeClose` guard (control-flow / component contract)

`registerBeforeClose` returns an unregister function:

```179:182:chrome-extension/src/sidepanel/components/ContextPanelHost.tsx
  const registerBeforeClose = useCallback((guard: () => Promise<boolean>) => {
    beforeCloseRef.current = guard
    return () => { if (beforeCloseRef.current === guard) beforeCloseRef.current = null }
  }, [])
```

MeetingPanel never uses it:

```javascript
useEffect(() => props.registerBeforeClose?.(() => requestCloseRef.current()), [props.registerBeforeClose])
```

After a successful close, Host unmounts `MeetingPanel` and **leaves `beforeCloseRef` set for the rest of the session**.

Repro:
1. Open 会议, start or don’t start capture, 结束并收起 until `activePanel === null`.
2. Open 设置.

Host still sees a guard:

```javascript
if (!beforeCloseRef.current) { closePanel(); return }
dispatch({ type: "SET_SETTINGS_OPEN", open: false })
const pending = requestPanelChange(null)
```

Settings is forced shut, the **unmounted** panel’s `requestClose` runs (`setClosing(true)` on a dead instance), then settings may reopen. Every later panel change also goes through that stale async guard. If `needsClosePersistenceRef` is still true (see P1 below), settings/skills/knowledge are blocked on `meeting.get` / `meeting.end` for a meeting that is already gone.

UI tests never open settings after the meeting panel has unmounted. They only toggle settings *while* meeting is still mounted.

---

## P1 — stop-then-close waits for a second `meeting.end`

`startLiveCapture` sets `needsClosePersistenceRef = true` and `closeNeedsEndRef = true`. Those flags are cleared **only** after `confirmMeetingClose` succeeds.

Normal 「结束录制」 / 「结束并生成纪要」 calls `finalizeCapture` with `closePendingRef == null`, which **already sends `meeting.end`**. Closing afterwards still does:

```javascript
await confirmMeetingClose({
  id,
  expectedText: liveTextRef.current.join("\n"),
  endRecording: closeNeedsEndRef.current, // still true
  ...
})
```

Repro (not in `test-meeting-close-ui.py`):
1. 开始录制 → inject a final STT chunk so capture is live.
2. Click 「结束录制」 (not 收起). Wait until phase is idle / `meeting.end` has been sent.
3. Click 「结束并收起」 or switch to 技能.

Client sends `meeting.end` again and blocks up to 10s on `meeting.ended`. If companion treats the session as already ended (error, no second `ended`, or `meeting.ended` for a different id), close fails, panel is retained, retry hits the same flags. Navigation is stuck without a reload.

The synthetic close tests only close **while recording**. They never stop, then navigate.

Same hole: `onSendToDraft` → `closePanel()` after a finished recording.

---

## P1 — import close confirms a fire-and-forget `set_transcript`

Audio import appends locally with `appendLocalAndRemote(oneLine, null)` (no `meeting.append_transcript`), then:

```javascript
sendViaRuntime({ type: "meeting.set_transcript", v: 1, id, text: body, ... })
// ...
resolveImport(importSucceeded) // does not wait for persist
```

`requestClose` then `meeting.get` + `endsWith(liveText)`. On a real companion that is not the fixture’s synchronous `set_transcript`, first close fails “尚未确认保存” (acceptable) **or** succeeds on a stale snapshot that does not include the last imported segment (not acceptable). Abort-during-decode also `return`s from `try` with `importSucceeded` still `true`; that path is accidentally rescued only because `needsClosePersistenceRef` is still false.

Fixture applies `set_transcript` inline. That is not a persistence proof.

---

## P2 — last STT vs `meeting.get` is send-order, not durability

Live close orders `append_transcript` then `get` then `end` on the **outbound** queue. `confirmMeetingClose` accepts any `meeting.get_result` with the same id; it does not wait for the append’s `meeting.updated`. Compact `endsWith` can also pass if the expected tail is a suffix of an older line (`"好"` vs `"你好"`).

Timeout failsafe: `finalizeCapture` early-returns when `finalizedRef` is already true and will **not** resolve a newly installed `captureFinishedRef`. The 20s stopping timer usually shares the first finalize; a second close overlapping that window can hang until the import/capture timeout, then retain. Retry can then `meeting.end` without the late STT (textarea still has it locally).

---

## P2 — narrow list: capabilities are wider, not quieter

Row actions 相关 / AI 标签 / 知识 / 分类 / 导出 / 删除 are now nowrap text (`iconBtn.whiteSpace: "nowrap"`). Global `.cm-history-panel button { min-height: 32px }` applies to those too. `threadItem` is a non-wrapping flex row.

Playwright only asserts the **dialog** `scrollWidth <= clientWidth` and a list `height >= 100`. It never clicks a row action at 320×480. Clipped 删除/知识 on Mac side panel width is the likely outcome; that violates “all old capabilities remain reachable” without removing them.

Whole-panel scroll + `min-height: 120px` on the list is the right layout fix; sticky selection bar is fine. Header 全选 vs 整理建议 全选建议 is correctly split.

---

## P2 — mutation abort vs durable result

`runMutation` does `if (controller.signal.aborted) return` **after** `mutateThreads` resolves, skipping `REMOVE_THREADS` and the notice. Sidepanel unmount aborts. Server may already have deleted; UI keeps rows and says nothing. Unknown path is honest only when the notice actually renders.

`executePendingDelete` rechecks `message_count === 0` for empty cleanup. That is the UI preview, not `getMessages()`. Server recheck is the real gate; this is fail-closed if `message_count` is missing, fail-open if the list count is stale-zero and the server check were ever skipped. Companion path does not skip it.

---

## NIT

- `ComposeDrawer` still accepts `capabilityLevel` and keeps unused `surfaceChip` styles; copy itself is the requested global vs 本对话 split.
- Empty-probe `unknown_disconnected` is labeled `not_sent`, not `not_sent_unsupported` — fine.
- `requestPanelChange` coalesces on the first in-flight promise; latest `targetRef` is applied only if that first guard returns true. Failed close drops a queued 技能/知识 open.
- `CompanionMark` swap is in-scope branding; tests were rewritten to match, so they no longer protect the old #323 calf contrast story.

---

## What is actually solid (short)

`parseResult` refuses ACK-only, wrong mode, duplicate/unrequested/omitted ids, and count/`deleted_ids` mismatch. Background refuses delete/restore unless `wsClient` is connected and returns `ok: sent` with the same `id`. Companion probe cannot carry targets; `only_empty` requires `mode=hard` and rechecks trash/busy/messages. ThreadList no longer expands empty selection; busy/filter only shrinks; cleanup selection is a separate set. Those match DoD and the recorded payload fixture.

They do **not** cover: meeting unmount guard lifetime, stop-then-navigate, import persist-before-get, or row-level reachability at 320px. `PASS meeting-close-ui` / `PASS thread-mutations-ui` therefore do not prove the claimed close/navigation or Mac quiet-UI contracts.

---

VERDICT: REJECT
