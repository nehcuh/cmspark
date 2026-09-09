## Corrected review

### Disposition of previous findings

**#8 single-row deletion — previous HIGH finding is REFUTED.**
`handleDeleteOne` sets `pendingDelete {ids:[threadId]}`; confirmation calls `executePendingDelete` → `runMutation(ids, "trash"/"hard", "row")` → `mutateThreads`. The mutator always sends `thread.batch_delete` with `thread_ids`, `require_connected:true`, a correlation id, and waits for a matching `thread.batch_deleted` before resolving. There is no path to the legacy background `thread.delete` here. The new actual-App test verifies exactly this for source `"row"`: one `thread.batch_delete` with `['t1']`, zero `thread.delete` messages, and row retention until the persisted reply arrives. **Finding withdrawn. No defect.**

**#3 absent `registerBeforeClose` — previous claim of inverted fallback is REFUTED.**
The exact button branch is:
```
if (props.registerBeforeClose) props.onClose()
else void requestCloseRef.current().then(allowed => { if (allowed) props.onClose() })
```
My prior description asserted the safer `requestCloseRef()` branch runs only when the prop is absent *and called it inverted*. The production Host always provides the guard, so outside the Host the component does not blindly call `onClose()`: it awaits its own persistence guard. The new standalone actual test mounts `MeetingPanel` with no `registerBeforeClose`, forces `deferEnd`, clicks the inner close button, and proves ordering: append → `meeting.get`/`get_result` → `meeting.end` → `meeting.ended` → exactly one `fixture.closed`. In-Host, `props.onClose()` delegates to the registered guard and is equally safe. **Finding withdrawn. The optional-prop design is correct, not inverted.**

**#2 settings failure — prior severity/moderate finding is DISMISSED as non-defect.**
The actual code first clears `SET_SETTINGS_OPEN`, invokes the guard, and only reopens settings on allowed close. A failed save leaves settings closed with an error and retains the meeting. The new test reproduces failure on the first Settings click, then a second Settings click after recovery succeeds (`meeting.get` count 2, release to settings). This is fail-closed‑and‑retryable: no navigation away on failed save, no lost transcript, no stuck Settings. The "flashed closed" description is the deliberate UX of clearing the request while the panel handles the close; retry remained visible and enabled in the actual test. **Not a defect.**

**#1 transcript sync — prior low/moderate speculation is DISMISSED.**
`confirmMeetingClose` compares `persisted.transcript` text from the actual server response against `liveTextRef` (all locally appended capture text). `appendLocalAndRemote` appends to `liveTextRef` before any send and only sends when `id` exists; the close path pins `closeMeetingIdRef` and reads actual server data. The asserted "server has extra lines so close passes" scenario has no demonstrated loss: local appended lines are exactly what is compared, and the new test asserts `window.persisted == ['最后一段合成转写']` after every close path. This was speculative future-change reasoning, not a concrete defect.

**#4 selection-boundary pruning — remains NITS, correctly not a rejection issue.**
Pruning selected ids when `selectableIds` shrinks is intentional; the test asserts shrink-to-0 and disabled delete. Retaining select mode with `已选 0` is cosmetic only.

**#5 timeout after server success — PASS/unchanged.**
Cautious `unknown_timeout` on a late reply is conservative and surfaced honestly; no row is removed without a correlated receipt.

**#6 close refs across attempts — none observed/unchanged.**
No deadlock or double-resolve path found; actual closing paths pass.

**#7 ComposeSectionId excludes `board` — previous nit is resolved.
`ComposeSectionId` is the compile-time union and `COMPOSE_SECTIONS` contains only the six IDs; `composeSectionsExcludeBoard()` enforces the guard, and the metadata test verifies no Autonomy entry. No undefined row exists from source data. Not a defect.

### Reproducible blockers

None. All claimed blockers are refuted by the cited source and the two passing actual-App suites.

### Final verdict

**APPROVE**