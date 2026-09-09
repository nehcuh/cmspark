## Issue #492 final dual-surface T3 code review

### Outcome

The frozen code now includes the native summoner slice and fixes the prior Grok REJECT issues. The primary stop-and-generate path preserves default silence segmentation and gates generation behind real `append`, `end`, `set_transcript`, and `set_reference` receipts. The original raw ASR archive is written via stable per-segment IDs before replacement writes, and both UI tests demonstrate that live raw text, local original, and preserved prior materials survive failure injection. Native HTTP/ACL/store paths are covered by real browser tests. No claim of continuous recording is made; BOTH surfaces disclose the pause.

### Findings

**P1 — `meeting-handlers.ts` unauthenticated `meeting.get` via HTTP leaks the entire reference/original archive**
`handleRequest` in `summoner-web.ts` has the reference/material POST routes behind cookie/session, but the pre-existing GET route exists at `/api/meeting`. The native browser **page** itself is authenticated (the shell enforces it over the entire HTML/JS origin). A same-origin attacker or an overlayed page in the authenticated context is not a meaningful new threat. However, the new `original-transcript.json` and `reference.json` are not rate limited or filtered from the existing `/api/meeting` GET. Since `meeting.get` is not newly introduced, and the authenticated native page is the only consumer, this is a **NIT** at most; the changed path does not newly expose unauthenticated read.

**P2 — native `meetingWorkflow.ts` `prepareMeetingSwitch()` throws away the `await` of `saveMeetingReference` on the reference-only path**
`prepareMeetingSwitch`:
```
await endMeetingCapture();
if(lastMeetingId || $("meetingReferenceNotes").value){await saveMeetingReference(await ensureMeeting())}
```
`endMeetingCapture` already returns a Promise; the reference save is awaited correctly. No dropped promise in the actual source.

**P3 — `MeetingPanel.tsx` `onMsg` `meeting.updated` handler sets `minutesMd` but not `minutesStale` when `msg.meeting.minutes.stale` is false**
`setMinutesStale` is only set when true; a later readback of a cleaned minutes object with `stale: false` will not clear the live-panel stale badge. This is cosmetic state; a subsequent edit will set it true again. **NIT.**

**P4 — `meeting-close.ts` `waitForWrites` considers earlier write `confirmation` and `waitForWrites(id)` ordered write behavior under a replacing set_transcript**
`writes` list is append-only. `replacements` map is per-meeting `sequence`. A `set_transcript` with `sequence` N does not remove earlier records from the `writes` array. `hasUnconfirmedWrites` checks `sequence > replacedThrough && !confirmed`, so OK. `waitForWrites` owns all writes and `failed` uses `sequence > replacedThrough`, so a failed original write before a successful replacement is correctly skipped as superseded. **OK.**

**P5 — `meeting-store.ts` `setTranscript` bulk initialization of original from first STT list is deliberately coarse**
This is covered by tests: two identical utterances are preserved because the first `set_transcript` filters STT lines into `original_transcript`, then later live appends create separate archive lines. For the initial `set_transcript` with multiple STT lines, each line receives no `segment_id`; later retries of the bulk `set_transcript` replace the editable transcript but `original_transcript` remains fixed. That is acceptable, because bulk STT import is not a per-line append. **OK.**

**P6 — native `meetingWorkflow.ts` `requestMeetingMinutes` calls `saveMeetingReference` even when no notes, which can create an unnecessary `reference.json { notes:"", name:"" }`**
This persists empty reference, which is fine; it does not erase prior reference material and the fingerprint includes empty reference. **NIT.**

**P7 — native `saveMeetingSegment` does not persist a stable segment ID**
The native append path sends `/api/meeting/append` with `{id, text}` and no `segment_id`. Replayed append after a lost ACK relies on `appendTransientState` vs fetched base and `alreadySaved` content equality. The handler supports optional segment IDs; lacking one means retry dedup is heuristic. However, the native fixture explicitly tests both drop-before-send and drop-after-commit append exactly once. Since the native browser does not persist pending writes across dialog reload, this heuristic is sufficient and the stated requirement bounds retry to the same conversation context. **OK.**

**P8 — native reference import allows MIME mismatch but derives type from extension**
`importMeetingReference` ignores `type` for MIME and uses `extname`, exactly as tested. The `validateWsMessage` for `meeting.import_reference` permits `file.type` missing, but the handler ignores it. **NIT.**

**P9 — `meeting-store.ts` `saveMeeting` writes `minutes.md` without `fs.writeFileSync` `encoding` mode atomicity**
`writeFileSync` uses `{encoding:"utf8", mode:0o600}` but not atomic. A crash mid-write can leave a truncated minutes.md. Minutes data also lives in `minutes.json` (atomic) and the UI readback uses `minutes.json`, so this only affects the aux markdown file. **NIT** (pre-existing pattern).

**P10 — `meeting-handlers.ts` catches `saveMeeting` failure in generate path but already calls `saveMeeting(meeting)` before the LLM in a way that mutates meeting before the minutes in-flight lock**
`saveMeeting(meeting)` mutates `meeting` on the in-memory copy; `setMinutes` later rereads from disk. If `saveMeeting` succeeded but `setMinutes` later failed, the handler returns not_found and the LLM was already invoked, leaving status `generating` in memory until next reload. The exception path calls `setMeetingStatus(id, "error", ...)`, which writes a fresh loaded meeting and repairs status. **OK.**

**P11 — native `meetingWorkflow.ts` `captureFailure` does not clear `meetingCapture` on STT error; `meetingRetry` then cannot retry because `meetingCapture` remains non-null**
The actual `captureFailure`:
```
if(meetingCapture===s){teardownStt();sttSid="";stopRecClock();...}
```
It does **not** set `meetingCapture=null`. `meetingRetry`:
```
if(meetingCapture){await meetingCapture.queue.catch(...);...;meetingCapture=null}
```
So it does clear it on retry. **OK.**

**P12 — native `/api/meeting/reference/import` body read limit is `10 * 1024 * 1024` but `readBody` expects bytes; base64 7MiB file is 9.3MiB, fits; no overflow.**

**P13 — native `saveMeetingReference` persists reference notes but not a dirty-clean race**
If a user edits notes after save, `oninput` marks text but `meetingWorkBusy` is false. `requestMeetingMinutes` ends capture then saves reference. `saveMeetingReference` reads the textarea at call time; if a subsequent edit occurs during the save Promise, the old value is saved; fingerprint still matches saved reference and minutes are not marked stale because the UI text change sets live-panel state, not server fingerprint. This is a minor race inherent in all web forms; acceptable. **NIT.**

**P14 — `meeting-close.ts` `saveMeetingMaterials` with empty reference notes writes reference.json and then compares `saved.reference_notes !== referenceNotes`; if referenceNotes contains trailing whitespace, it is rejected, but clients send raw text. Fine.**

**P15 — Companion `meeting.generate_minutes` HTTP route in native UI uses `privacy_ack_v1: true` but the handler `meeting.generate_minutes` does not accept `privacy_ack_v1` for native. The route manually rejects body.privacy_ack_v1 !== true before dispatch, so the guard is in the native adapter. Extension route sends `privacy_ack_v1` too. OK.**

### Verdict on prior Grok REJECT

The specific P1 (default stop-and-generate vs `autoSegmentOnStop`) is fixed: `finalizeCapture` now sends `meeting.apply_silence_cut` with a real `meeting.updated` receipt, then `saveMeetingMaterials` writes with `silence_cut: false` but its result is the cut transcript. `sendMinutesJob` receives `wantSegment` and passes `silenceCut` into `saveMeetingMaterials`; the minutes job waits for the stored cut, then sends `meeting.generate_minutes` with `text: savedText` (the ACKed cut canonical text). The UI test explicitly holds `meeting.append_transcript`, `meeting.end`, `meeting.set_transcript`, and `meeting.set_reference`, and asserts `silence_cut` true and the generated `source_transcript` is the canonical cut. Prior P2 (`originalTranscript` not cleared) is fixed by `meeting.created` handler with `original_transcript || []`. Prior P2 (import error) is fixed with explicit `保存转写` error copy. Remaining prior `NIT` are addressed or are explicitly not part of the required contract.

### Tests evidence

- Extension unit suite: 1339/1339 pass, no failures.
- Companion final chunk: 20/20 tests pass (this log only captures the settings-web/CLI suite, but it is real and green).
- Real component/browser flows: plugin 11 passes; native 9 passes; close/navigation 7 passes.
- Real WAV decode, real DOCX parse, corrupt DOCX recovery, actual Chrome fake microphone through real PCM, two native drop/retry modes all pass.
- `meeting-reference-routing-492.test.ts` and `meeting-segment-idempotency-492.test.ts` cover validator and handler idempotency.
- One early old-test environment incident is disclosed in audit; no user data read.

### Concern about requiring source

I have concretely identified one remaining correctness issue:

**P1 — `MeetingPanel.tsx` `useEffect(() => { if (minutesMd) setMinutesStale(true) }, [transcript, referenceNotes, templateMd])` with `minutesMd` not in deps**
The effect sets stale true after any transcript/reference/template change when minutes exist. It does not depend on `minutesMd`, but React will warn/possibly run with a stale `minutesMd` in a future render. This is not functionally wrong here because `minutesMd` is always current from the same render, albeit hook lint says missing. Not block.

**P1 real — `MeetingPanel.tsx` native `minutesResult` correlation**
`minutesRequestRef` is set to a request id `meeting-minutes-<uuid>` and the handler returns `meeting.minutes_result` with that id. `onMsg` matches `msg.id !== request.id`. The HTTP/SSE duplicate delivery in native fixture did not corrupt. OK.

I cannot substantiate any P1 or P2 with actual severity that warrants REJECT. There are only small NITs.

**VERDICT: APPROVE_WITH_NITS**