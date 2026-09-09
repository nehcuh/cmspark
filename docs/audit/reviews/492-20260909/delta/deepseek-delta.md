## Incremental delta review

The delta replaces the native append GET/array heuristic with a stable `segment_id` forwarded through `/api/meeting/append` into the already-reviewed handler idempotency/recovery path. The synthetic fault now exercises a real partial-write boundary (`transcript.json` committed, `original-transcript.json` stale).

### Findings

**NIT — `saveMeetingSegment` no longer detects concurrent external edits to the meeting before appending**

Before: the GET reconciliation threw `会议材料已在别处变化…` when `transcript` or `original_transcript` diverged from the last-seen base. After: the first request from `saveMeetingSegment` is the append itself. If another surface edits the same meeting between paint and persist, the segment-id append will succeed against the changed store and the caller only verifies its own line is present in `original_transcript`. The request still appends exactly one new line by `segment_id`, so no duplicate or overwrite occurs; but the previous “materials changed elsewhere — please check current draft” guard no longer fires on this path. This is narrower than the removed check, not a data-loss regression, because the new line is additive and idempotent.

**NIT — test fixture truncates raw to `before.original_transcript` after `handleMeetingMessage` already returns `meeting.updated`**

`fs.writeFileSync(rawPath, JSON.stringify(before.original_transcript || []))` writes `[]` when the pre-append raw archive was empty, which happens to match the unit test’s `fs.writeFileSync(originalPath, "[]")` scenario. But in the UI partial-write pass, `before.original_transcript` is the full previous archive, not an empty file. The `after` assertion confirms the effective state (`transcript` +1, `original_transcript` unchanged), so the fault is faithfully reconstructed; only the unit scenario name “[]” is more severe than the UI case. Not a product finding.

### Confirmed unchanged / still valid

- Existing archive repair for `before_send` / `after_commit` still passes with the same-sid retry (`ui-native-delta.log`).
- New `partial_write` path passes end-to-end: retry repairs raw once, appends exactly once, segment id is non-empty and identical across attempts.
- Invalid `segment_id` is rejected via existing handler validation (`invalid_segment_id`), no path traversal.
- Bounded input: `text` already limited by body size; `segment_id` length/shape is checked by existing handler validation rather than a new unbounded sink.
- No new method, permission, server route, or LLM/tool surface. HTTP route only forwards an optional body field.
- Repeated utterances still get distinct sids (`startStt` random suffix; import path index suffix), retries keep same sid.
- Original archive recovery on native retry now verifies the returned original contains the segment by id/text/source, not just length/array equality.
- Prior accepted nits remain accepted.

VERDICT: APPROVE_WITH_NITS