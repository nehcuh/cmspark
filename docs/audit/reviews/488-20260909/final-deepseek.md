## Re-adjudication of prior findings against current source

**All previously raised blockers are refuted or resolved by the current source and machine-executed test evidence.** Each is addressed below.

### Finding re-adjudication

**#1 transcript sync / old-suffix close bypass — REFUTED.**
`createMeetingPersistence.write` validates append receipts by exact last-line text: `meeting.transcript.at(-1)?.text !== String(fields.text || "").trim()` rejects suffix/equal receipts. `confirmMeetingClose` calls `persistence.waitForWrites(id)` (which fails on any unconfirmed failed write), then a correlated `meeting.get`/`meeting.get_result`, then `meeting.end`/`meeting.ended`. Unit tests explicitly prove: receive a stale `suffix` receipt with mismatched request id → one request stays pending; the old `appended`/`oldRead` receipts fail the new write; `waitForWrites` throws retaining panel; explicit `set_transcript` recovers. UI test asserts `persisted == ['最后一段合成转写']` after every path. No bypass.

**#2 settings failure — REFUTED.**
`ContextPanelHostProvider` clears `SET_SETTINGS_OPEN` before guard, reopens settings only on `allowed`. Actual test: failed readback retains `activePanel=="meeting"`, settings stays closed, retry succeeds with two `meeting.get`s. Fail-closed-and-retryable; no defect.

**#3 absent `registerBeforeClose` fallback — REFUTED.**
Inner button branch is exactly `if (props.registerBeforeClose) props.onClose() else void requestCloseRef.current().then(allowed => { if (allowed) props.onClose() })`. Standalone test with `deferEnd` proves append → readback → end ACK → exactly one `fixture.closed`. Not inverted.

**#4 selection boundary pruning — NITS only.**
Busy/filter shrink-to-0 and disabled delete are intentional; tests assert no cross-row deletion.

**#5 timeout after server success — PASS.**
Conservative `unknown_timeout` surfaced honestly; no row removed without correlated receipt.

**#6 close refs across attempts — none observed.**
`closePendingRef` serializes; no double-resolve in actual paths.

**#7 ComposeSectionId excludes board — RESOLVED.**
No Autonomy surface in drawer; metadata test verifies.

### New review of current diff

Reviewing the current receipt/UI diff reveals no remaining concrete defects:

**Close-gate / persistence.** `closePendingRef` is set before `requestCloseRef.current()` returns; repeated calls return the same pending promise. `persistenceRef` waits for all append/set writes with sequence tracking per `meeting_id`, validating receipt id and meeting owner. `confirmMeetingClose` requires correlated readback (`get_result`) then end (`ended`). `endMeetingRecording` returns a session even when already ended (`endedAgain`); `requestCloseRef` consumes each guarded attempt once via `needsClosePersistenceRef`. Same/old tail cannot consume a new write.

**Mount/unmount.** `useEffect(() => props.registerBeforeClose?.(() => requestCloseRef.current()), [props.registerBeforeClose])` returns the unregister function. The unmount cleanup fires `meeting.end` only when `stillLive && !finalizedRef` and does not dispatch further. `captureFinishedRef.current?.()` is resolved once. Component unmount abort via `importAbortRef` cancels pending decode before meeting creation; actual test verifies no `voice.stt.start` or `meeting.create` after closing while decoding.

**Settings reopen after actual unmount.** The settings effect observes `state.settingsOpen`, clears it before guard, reopens only after allowed close. This is the existing source and the test asserts `requests` unchanged after an unregistered guard is removed. No double-fire.

**Thread mutation.** `runMutation` in `ThreadList.tsx` uses `mutateThreads(ids, mode, controller.signal)` and only removes rows when the mutator returns a persisted `result.ok`; ACK alone doesn't remove rows. The actual-App suite verifies 60-item batching, busy/filter races, offline/partial failures, restore with `thread.list` refresh, and separate cleanup selection scope.

**Responsive.** `@media(max-width:520px){.cm-thread-row{flex-wrap:wrap}...}` plus hit-test assertions at 320/390/760/1440 confirm row actions remain reachable. No new stylesheet regressions.

**Scope.** No Surface/L2/Autonomy/Trust/Channel expansion. `resolveMeetingId` rejects `tray-\d+` ids; no endpoint permission change. Explicit Save Transcript uses existing `set_transcript`; no LLM in close path; the only LLM entry is `meeting.generate_minutes` when user explicitly saves and generates — the close path does not invoke it.

No remaining concrete issues found.

**Final VERDICT: APPROVE**