# Independent re-review: CMspark #488 vs `947532a8`

Scope is the selected receipt/UI diff, the pinned companion meeting contract, and thread-mutation product logic that remains in scope. Machine PASS is not treated as correctness. Claims below are `[inspected]` against the supplied source and `[executed]` only where a named log line matches that path. No live mic, Companion user data, or Windows host is assumed.

Prior REJECT is re-adjudicated. The three meeting P1s and the 320px reachability P2 do not survive the current code.

---

## Prior P1s — closed

**1. `beforeClose` leak.**  
`useEffect(() => props.registerBeforeClose?.(() => requestCloseRef.current()), [props.registerBeforeClose])` **returns** the unregister. That is React cleanup, not a dropped result. `registerBeforeClose` only clears when the same function is still installed. After a real unmount the UI test opens Settings and asserts `meeting.get`/`meeting.end` counts are unchanged (`meeting-ui.log`: “guard effect unregisters on unmount”). The earlier reading that MeetingPanel “never uses” the return value was wrong.

**2. Stop then close / second `meeting.end`.**  
`endMeetingRecording` still returns a session when already ended; the handler still returns `meeting.ended`. `closeNeedsEndRef` remains true after 「结束录制」, so close sends a second correlated `meeting.end`. That is redundant, not a hang: the contract test records `ended` and `endedAgain`; the UI test stops, waits for `meeting.end`, then 「收起面板」 until `activePanel === null`.

**3. Import was fire-and-forget `set_transcript`.**  
Import now `persistence.write(..., "meeting.set_transcript", ...)`. Close is `waitForWrites` → correlated `meeting.get` → optional correlated `meeting.end`. Failed import write keeps the textarea; 「保存转写」 (`set_transcript` again, no `generate_minutes`) recovers (`meeting-ui.log`). Abort-during-decode still closes without `meeting.create` / STT because `needsClosePersistenceRef` is only set after a meeting id exists.

**Suffix / send-order.**  
`confirmMeetingClose` no longer `endsWith` a compact tail. Append confirmation requires `message.id === requestId`, `meeting.updated`, `meeting.id === meetingId`, and `transcript.at(-1).text ===` the appended text. Stale `appended` / `oldRead` fixtures use other ids and cannot settle the write (`meeting-close.test.ts`; UI `好` / `你好` loop). Get/end are separate correlated requests (`id` is `meeting-rpc-…`, `meeting_id` is owner). Companion `resolveMeetingId` prefers `meeting_id`; WS stamps `id: msg?.id`. Transport `{ok:true}` is not a write receipt.

---

## Close path (current)

`requestClose` drains in-flight explicit save, import abort, capture/final, refine, then `confirmMeetingClose`. While that promise is in flight, `finalizeCapture` skips the uncorrelated `meeting.end` (`if (id && !closePendingRef.current)`). Capture/import writes are owned by `createMeetingPersistence`. `onMsg` ignores `meeting-rpc-*` `updated`/`error` so a persistence failure is not treated as a PCM-finalization failure.

Covered navigation (`test-meeting-close-ui.py` + `meeting-ui.log`): host 「结束并收起」, inner 「结束录制并收起面板」, 技能, Escape, Settings, latest-target 知识, stray `meeting.created` other id, standalone without `registerBeforeClose`, Settings readback failure + retry, stop then close, import in-flight final, decode cancel, 20s stop failsafe retains panel, failed close retains panel. Optional-host fallback: final → persist → end ACK → exactly one `onClose`.

Settings-while-guarded: Host forces `settingsOpen` false, runs the guard, reopens only if that transition version still matches. Failure keeps the meeting and does not open Settings; the same button retries (`meeting-ui.log`).

---

## Thread mutations (unchanged product logic)

Still: visible search/tag/trash is the selection boundary; busy/filter only shrink; row and bulk delete use `thread.batch_delete` (no `thread.delete`); >50 is serial 50 then remainder; transport ACK does not drop rows; confirm re-checks busy; offline/partial keep failed ids; restore waits then `thread.list` `include_trashed: true`; empty cleanup probes `thread_ids: []` then server recheck; cleanup checkboxes are a separate set.

`@media (max-width: 520px) { .cm-thread-row { flex-wrap: wrap } }` plus Playwright hit-test + `click(trial=True)` on every real row action at 320/390/760/1440 (`mutations-ui-final.log`). Prior “clipped at 320px” P2 is closed by that evidence.

Unmount abort after `mutateThreads` can skip `REMOVE_THREADS`. That is fail-visible extra rows on a disposing tree, not ACK-as-success and not deletion of the wrong id. Closing the history popover is not shown in the excerpt to unmount `ThreadList`; visibility/`thread.list` refresh remains. Not re-raised as a blocker.

No new production meeting endpoint, permission, Surface/L2/Autonomy/Trust/Channel expansion. `capabilityLevel` on `ComposeDrawer` is unused and kept for caller compatibility; `surfaceChip` is gone.

---

## Nits (non-blocking)

1. **`set_transcript` / `meeting.get` do not re-check body text.** Append checks last-line equality; replace only requires a correlated `meeting.updated` with `meeting.id` and an array `transcript`. Under the pinned handler (`setTranscript` then echo `msg.id`) a correlated replace *is* the post-write snapshot. A confused server that echoed the request id on an empty/old body would be accepted. Defense-in-depth only; not the old suffix/`endsWith` hole.

2. **`fieldset disabled={closing} { display: "contents" }`.** Host 「收起」 is outside the fieldset and coalesces on `closePendingRef`. Inner controls rely on `disabled` propagating through `display: contents` (historically unreliable). Not exercised while an end is deferred. Hypothesis, not a demonstrated loss path.

3. **`requestPanelChange` coalesces on the first in-flight promise.** Latest `targetRef` applies only if that guard returns true; a failed close drops a queued 技能/知识 open and stays on meeting (fail-closed). Success path 「latest」 → knowledge is tested.

4. **`onSendToDraft` fills the composer before `closePanel()`.** If persist then fails, minutes can already be in the composer while the panel stays. Not data loss of the meeting write; awkward UX. Not in the close UI matrix.

5. **Whole-tree unmount** still fire-and-forgets `meeting.end` if capture was live and the guard never ran (tab kill). Destroyed UI; DoD does not require a durable unload receipt.

---

## Evidence vs inference

| Claim | Status |
|---|---|
| Guard unregister is effect cleanup; Settings after unmount does not replay get/end | `[inspected]` + `[executed]` meeting-ui.log |
| Companion `meeting.end` is idempotent; stop then close completes | `[inspected]` store/handler + `[executed]` contract + meeting-ui.log |
| Capture/import writes wait on `meeting-rpc-*` receipts; old tail / wrong id cannot pass | `[inspected]` meeting-close.ts + `[executed]` unit + UI |
| Failed write keeps textarea; explicit 「保存转写」 recovers; no LLM | `[executed]` meeting-ui.log |
| All listed close/navigation paths; standalone fallback; failsafe retains panel | `[executed]` meeting-ui.log |
| 320px row actions receive pointer | `[executed]` mutations-ui-final.log |
| `meeting-close.test.ts` specifically named in a log | `[assumed]` (included in 1327 passing extension tests; not uniquely labeled) |
| `display:contents` disables descendants in Chrome | `[assumed]` / hypothesis |
| Popover close does not abort an in-flight mutation | `[assumed]` from excerpts (no `abort()` call site supplied) |

`tsc --noEmit` + plasmo build green; 1327 extension tests pass; companion contract test pass. Fixture is production Host/Meeting/adapter with synthetic PCM and transport only.

---

VERDICT: APPROVE_WITH_NITS
