I've inspected the actual files, run the 6 tests (all pass), and verified every floor. Verdict below.

## Review — meeting-minutes-mtg01 (T2)

### Floors verified [executed/inspected]

1. **Pack has no `voice*`/`autoStart` keys** ✓ `companion/src/packs/builtin/meeting-minutes/pack.yaml:1-59` — only `skills / mcp_servers / tools / system_prompt_append / thread_defaults / workspace / ui / tags`. Pack explicitly states "不会自动开麦" in `description` and `system_prompt_append`.

2. **Minutes job forbids invention; distinct from `asr_refiner`** ✓ `companion/src/meeting/minutes-prompt.ts:6-27` ships `Job id: meeting_minutes` + `Do NOT invent attendees, decisions, action owners, dates, or quotes` + `Do NOT invent speaker labels`. Distinct from `companion/src/voice/asr-refiner.ts:10` ("ASR post-editor"). Asserted by `meeting-minutes.test.ts:14-18`.

3. **No auto-send to chat** ✓ `MeetingPanel.tsx:283-295` calls `props.onSendToDraft`. `ContextPanelHost.tsx:268-272` dispatches `cmspark:fill-composer`. Consumer at `App.tsx:321-331` does `setText(detail.text)` + focus + `setSelectionRange` — **no submit, no enter**.

4. **Origin fence denies tray** ✓ `companion/src/voice/stt-handlers.ts:45-48` regex `/^chrome-extension:\/\/[A-Za-z0-9_-]+$/i` rejects `cmspark-tray://local` and missing origin. `meeting-handlers.ts:69-76` calls it before any branch. Test `handler origin denied` passes [executed].

5. **Path containment for meeting ids** ✓ `meeting-store.ts:68-70` `isSafeMeetingId` regex `/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/`, plus `resolveContained` (83-89) does a second `path.resolve` containment check. Generated ids are `mtg_<16 hex>` (20 chars) — match the regex. No traversal surface in `set_transcript`/`append_transcript`/`set_status` because they all funnel through `loadMeeting → resolveContained`.

6. **WS validators** ✓ `server.ts:5849-5878` adds `v:1` + arity checks; `set_transcript` text capped at 80_000.

### ADR-020 checklist

- **Axes fit**: ✓ Pack + L0 workbench. Handler is plain WS-message dispatcher — not a "中层 Agent" runtime.
- **Pack-first**: ✓ New scenario ships as a builtin Pack; no separate agent runtime.
- **Trust monotonicity**: ✓ Pack declares `min_capability: L0`, `tools.mode: unchanged`, no auto-approve shortcut.
- **originWs**: Handler reads `ctx.origin` from `session?.origin` in `message-router.ts:1931`. No new `securityConfirmations.request` introduced, so no new originWs binding obligation. (Tray IS denied by the chrome-extension regex — even tighter than required.)
- **No new runtime / no new confirm family**: ✓.
- **Capability declaration present** in the prompt: ✓.

### Tests [executed]
`node --test tests/meeting-minutes.test.ts` → 6/6 pass; tsc clean per implementer claim.

### Non-blocking nits

- **N1 (UI busy-state race)** — `MeetingPanel.tsx:175-184` `generate()` fires `meeting.set_transcript` immediately followed by `meeting.generate_minutes`. The `meeting.updated` reply from `set_transcript` flips `setBusy(false)` (line 220) while `generate_minutes` is still in flight, briefly un-disabling the generate button. Cosmetic; user clicking again would just queue another generate. Suggest gating `setBusy(false)` in `meeting.updated` on `status !== "generating"`, or skip the local `set_transcript` round-trip when the user is just generating.
- **N2 (length asymmetry)** — `server.ts` validator caps `meeting.set_transcript.text` at 80_000 but `meeting.append_transcript.text` has no cap. Local single-user so low blast radius, but tighten for symmetry.
- **N3 (status enum check)** — `server.ts` validator for `meeting.set_status` only checks `id`; the enum check lives in the handler. Defense-in-depth: mirror the enum in the validator.
- **N4 (dead code in batch)** — `meeting-store.ts:249-263` `deleteMeetingAudio` is exported but not called anywhere in Mtg0/Mtg1. Either mark "reserved for Mtg2" or drop.
- **N5 (transcript rewrites)** — `setMeetingStatus` and `setMinutes` both rewrite the entire `transcript.jsonl` via `saveMeeting`. Wasteful for large transcripts on status-only updates. Future: split meta-only writes.

None of these block merge — they're polish items.

VERDICT: APPROVE_WITH_NITS
