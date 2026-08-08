All checks complete. Here's my full review.

## Verification performed

**Patch freshness**: Confirmed `docs/audit/reviews/meeting-minutes-mtg01-diff-20260808-082003.patch` matches `git diff 8470054..dcee9a6` exactly (only the status-line preamble differs). Live branch `feat/meeting-minutes-mtg01` at `dcee9a6`.

**Machine checks run**: companion `tsc --noEmit` clean; `meeting-minutes.test.ts` 6/6 pass; chrome-extension `context-panel-host.test.ts` 4/4 pass.

## Floor-by-floor results

1. **Pack has no voice\*/autoStart keys** — ✓ `pack.yaml` keys are clean (skill + `system_prompt_append` only). Defense in depth: `VOICE_FORBIDDEN_KEY_RE` in `companion/src/packs/types.ts:270` (covers `voice|sttEngine|…|audio_retain|autoStart`) is enforced by `validator.ts:75` and stripped on install/apply (`pack-engine.ts:1153`). Mic can't ride on this pack even if someone adds the keys later.

2. **Minutes job forbids invention; distinct from asr_refiner** — ✓ `MEETING_MINUTES_SYSTEM_PROMPT` (`minutes-prompt.ts:8`) is job `meeting_minutes`, "Do NOT invent attendees, decisions, action owners, dates, quotes", "Do NOT call tools"; `ASR_REFINER_SYSTEM_PROMPT` is a different job (ASR post-editor). Test asserts distinctness. `generateMeetingMinutes` caps at 80k chars, temp 0.3, 90s timeout.

3. **No auto-send to chat** — ✓ "发送到对话草稿" dispatches `cmspark:fill-composer`; `App.tsx:318` handler only `setText()` + focuses. Never sends.

4. **Origin fence tray denied** — ✓ `meeting-handlers.ts:77` gates **all** `meeting.*` on `isChromeExtensionOrigin` (`^chrome-extension://[A-Za-z0-9_-]+$`); tray `cmspark-tray://local` and missing origin refused (test covers tray denial). `session.origin` is the browser-enforced WS `req.headers.origin` (`server.ts:6455`, wired at `server.ts:6925`). `validateWsMessage` (with meeting cases, `server.ts:5853`) runs before `handleMessage` (`server.ts:6574`). WS→SW→panel round-trip confirmed (`ws-client.ts:93` → `index.ts:298` → `chrome.runtime.sendMessage`).

5. **Path containment** — ✓ `isSafeMeetingId` `^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$` rejects `..`/`/`/short ids (verified by execution); generated ids `mtg_`+16 hex pass. `resolveContained` double-checks resolved path stays under `meetings/` root. Store perms 0o700 dirs / 0o600 files.

## ADR-020 checklist

- Declaration present (Surface L0 / Compose pack+skill+append / Autonomy n/a / Trust / Channel community). ✓
- Axes fit: composition + L0 surface; no "中层 Agent" framing. ✓
- Pack-first: builtin `meeting-minutes` pack ships alongside the new panel. ✓
- No new confirmation family; no `securityConfirmations.request` changes → originWs N/A. ✓
- Trust monotonicity: `min_capability: L0`, tools `mode: unchanged`, no god-mode/auto_approve. ✓
- No new runtime: reuses `llmExtract` + existing WS router. ✓
- P1 watchlist: none touched (no config.set / evaluate / shell / confirm changes). ✓

## Nits (non-blocking)

- `meeting-store.ts:201` writes a JSON **array** into `transcript.jsonl` — filename implies NDJSON but content is one JSON blob. Harmless, misleading.
- `saveMeeting` writes `minutes.md` via plain `writeFileSync` (no tmp+rename) unlike the atomic writes used elsewhere; stale `minutes.json`/`minutes.md` can linger if minutes are later nulled.
- WS validator caps `meeting.set_transcript` text at 80k but not `meeting.append_transcript` / `meeting.generate_minutes` (generate is capped downstream in `generateMeetingMinutes`; append is unbounded at the validator — local-only store, low risk).
- No direct unit test for `isSafeMeetingId`/`resolveContained` or invalid-`meeting.set_status` rejection (floors verified by code inspection only).
- `meeting_privacy_ack_v1` is a client-only UI gate; the server doesn't enforce it (real boundary is the origin fence — matches declared trust, but the ack is bypassable by direct WS from the extension).
- `MeetingPanel.generate()` fires `set_transcript` then `generate_minutes` without awaiting; safe today (synchronous set_transcript handler, in-order WS dispatch, inline-text fallback) but fragile if a future path makes `set_transcript` async.

VERDICT: APPROVE_WITH_NITS
