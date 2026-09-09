# Incremental review: native `segment_id` recovery

Scope is the supplied delta vs base `b349f447` and the prior Grok NIT only. T3 and previously accepted cosmetics are not reopened. Claims below are from the packet ([inspected] source; [supplied evidence] logs). I did not run tests.

## Prior NIT — closed

Native append no longer depends on GET + array equality.

- Workflow posts `{id, text, segment_id: s.sid}` and accepts the receipt only if `original_transcript` contains that `segment_id` + text + `source==="stt"`.
- HTTP `/api/meeting/append` still dispatches existing `meeting.append_transcript`; it only optionally forwards `segment_id`. `source` stays server-stamped `"stt"`. No new route, verb, allowlist entry, or LLM path.
- Retry is the same `s.sid`. Lost ACK and pre-send failure both POST again; stored length stays one (handler idempotency, not the old `alreadySaved` heuristic).
- Split-archive fault is the real write order: `transcript.json` committed, `original-transcript.json` restored to the pre-append production array. Unit test truncates that file to `[]` and replays the same sid; UI injects `partial_write` once, then retry. Both require repaired original == last editable line.
- Traversal `segment_id: "../../bad"` still dies as `invalid_segment_id` (existing handler bound).
- New live/import windows keep distinct `s.sid` values (`ov-` / `ov-import-` + index). Same pending segment retries one id.

That is the extension’s stable-id repair surface, on the native HTTP client.

## T3

Unchanged: cookie/Origin on the existing POST; `import_reference` / `set_reference` only extra verbs; overlay still denies `import_text` / `auto_diarize` / `set_transcript`; minutes still need `privacy_ack_v1`; AI-draft copy and #494 PCM gap untouched. Adapter builds `{v,id,text,source}` plus optional `segment_id` only — no `path`/`tool` smuggling.

## Findings

None actionable in this delta. Dropping the GET “材料已在别处变化” guard is the intended replacement, not a hole: concurrent different sids append; same sid replays. HTTP `segment_id` is forwarded un-coerced (unlike `id`/`text`); the handler already rejects bad values, as the invalid-id case shows. Not scoring.

## Evidence (supplied)

- `tsc` build green.
- Companion: 5078 tests, 0 fail (log still does not isolate the #492 TAP names).
- Native UI: `before_send`, `after_commit`, and `partial_write` each PASS retry → end → generate; no duplicate/lost materials. Prior 7 native PASSes still present.

VERDICT: APPROVE
