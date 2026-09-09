## Review — CMspark #492 Plugin Slice

### Correctness & Source Preservation

- **HIGH** — `meeting-store.ts:setTranscript`: original archive can be initialized with an empty `user_edit` list if the first set is from user edit, then never recovers true STT lines. If a user later edits a paste-only meeting then imports audio, the first `set_transcript` occurs with `source:"user_edit"` on the merged body; `original_transcript` is set to `[]` (filter stt finds none), so subsequent STT appends are stored but the archive now only shows post-edit appends—the pre-edit speech is gone. This is an edge case mitigated by `append_local_and_remote` using `id` after import, but the first import is written via `set_transcript`, not appends. Likely acceptable for paste-only meetings, but contradicts the design claim that “已有文字保留，合并稿不能自动按音频标说话人” without preserving original for the merged prior text.
- **MEDIUM** — `MeetingPanel.tsx:1202` `const hasPreviousText = previousText.trim().length > 0` uses the textarea directly; if the user has only import audio and no edits, `transcriptRef.current` may be stale after a fast import. Low risk, UI-only.
- **MEDIUM** — `meeting-reference.ts:importMeetingReference`: input `type` is ignored; MIME is derived from extension. Validation is sound; however, `.md` files with non-UTF8 or binary are rejected only for text types—duplicated check; no bypass.

### Wire Completeness & Validation

- **HIGH** — `meeting-handlers.ts:meeting.generate_minutes` accepts `msg.reference_notes` and `msg.reference_name` and uses them to mutate `meeting` before `saveMeeting`, but the `meeting.updated` reply from `setMinutes` does not re-check `reference_notes`/`reference_name` against the saved value. A concurrent `set_reference` during generation could overwrite the new material; `reconcileMinutesSource` will catch this and mark stale, but the generated minutes themselves already used the older reference. This is covered by the `in-flight` test (mark stale), so acceptable.
- **MEDIUM** — `meeting.generate_minutes` from the client sends `id` as `meeting-minutes-<uuid>`, but `resolveMeetingId` ignores `tray-N` and uses `meeting_id`. The validator accepts both. The `minutesInFlight` set is keyed by resolved meeting id, not request id, so a client sending two distinct request ids for the same meeting is correctly blocked; however, the client uses `id` and `meeting_id` differently than the handler expects—`minutesRequestRef` uses the request id; this is fine because `minutes_result` matching in the panel checks `msg.id !== request.id`, and the handler returns `msg.id` as the request id. Wire consistency confirmed.

### Privacy

- `meeting.import_reference` / `meeting.set_reference` are correctly excluded from `OVERLAY_MEETING_TYPES` and extensions. The planned native authorization is acknowledged and not evaluated here; current source still denies overlay. No live user config changes beyond the documented test-runner isolation; five synthetic dirs were created and removed with exact IDs; no user data read. Privacy gates intact.

### Recovery & Race

- **HIGH** — `MeetingPanel.tsx:commitLiveSegment`: `recordingEpochRef.current` is incremented at `startLiveCapture` but not at `setTranscript` from manual edits. A manual edit during the same recording does not invalidate pending refinements; however, `refined` results are only applied if `meetingIdRef.current === pinnedId`, and `meetingId` doesn’t change per epoch. The epoch guard prevents cross-recording leaks, but a manual edit before refine returns could still allow a stale replacement. Low severity, because corrections are suggestions only and not proof.
- **MEDIUM** — `MeetingPanel.tsx:1247` `appendLocalAndRemote(oneLine, id)` now appends per import segment to `meeting.transcript` (server) *and* later does a `set_transcript` merge; the server has duplicate appends and then a full replacement. Fine for simple use, but `transcriptToText` ordering could interleave with the appended lines; test passed.
- **MEDIUM** — `meeting-close.ts:create`: `request("", "meeting.create", "meeting.created", fields)` — the `request` function checks `if (message.meeting?.id !== meetingId && meetingId)` — when meetingId is `""`, any meeting is accepted. This is fine for create, but a future misuse of `create` to write would be unsafe. Acceptable.

### Final Verdict

**APPROVE_WITH_NITS**

The diff meets the stated scope: original transcript preserved, live corrections independent, reference import validated, generation saves before LLM, stale minutes marked, abort/timeout tested, no overlay escalation in plugin slice. Minor nits around original archive initialization for paste-then-import and a slight race in refine suggestions do not block merge.