Review complete. All REJECT conditions checked against the diff, spec, and freshly executed tests.

---

# Re-review: voice/meeting UX #5–#7 (`fix/voice-meeting-ux-5-7` vs `main`)

## REJECT checklist

**1. #5 uses `model_missing` for fallback sessions — NOT PRESENT [inspected]**
New `local_fallback` code throughout: dispatch at `useVoiceInput.ts:646-650`, separate `case "local_fallback"` at `error-map.ts:237` (adjacent to, not reusing, `model_missing`). `model_missing` semantics untouched. Reducer guard at `session-reducer.ts:322` excludes `local_fallback` from hard-error remapping, so it can't fall into `mapVoiceError` and produce a bogus error banner.

**2. #6 get_state omits lastDownloadError after fail — NOT PRESENT [executed]**
`whisper-handlers.ts` `get_state` returns `attachLastDownloadError(state)`; `lastDownloadErrorMem` set on non-abort fail, cleared on success (`download.completed`) and abort. New companion test asserts `hydrated.lastDownloadError` matches `/HTTP 403/` — ran it, passes. Reset in `_resetVoiceModelHandlersForTests`, no disk persist (non-goal respected).

**3. Settings open blanks voiceModelError before hydration — NOT PRESENT [inspected]**
The `SET_VOICE_MODEL_ERROR: null` dispatch at open is removed (`SettingsSlideout.tsx:238`, replaced by comment); get_state callback only sets error on *send failure*. Hydration flows via `useWebSocket.ts:1599-1605` (`"lastDownloadError" in msg` → set-or-clear, guarded for older companion). Since companion now always attaches the field, any `voice.model.state` both sets and clears — no stale-error lock-in.

**4. #7 status has no K echo — NOT PRESENT [inspected]**
`formatMeetingDiarizeStatus` appends ` · K=N` for finite k≥1 (audio + text_gap); `MeetingPanel.tsx:666-670` uses it and syncs `setDiarizeK(k)` for k∈2..4 (k floored, missing k → null → no sync, per spec); summoner `paintDiarized` appends the same ` · K=N` suffix.

**5. File-range overlap reverting another ID — NOT PRESENT [inspected]**
Verified hunk-by-hunk: each file touched by exactly one ID's changes (reducer/types/error-map/useVoiceInput → #5; whisper-handlers/useWebSocket/SettingsSlideout/whisper-settings-copy → #6; MeetingPanel/summoner-web → #7). No cross-revert. CTA wiring at `App.tsx:850` needed no change — `sttEngine === "local"` holds during per-session fallback, so the「去设置」CTA renders.

## Test verification [executed]

- companion `voice-whisper-handlers`: **26/26** (incl. download-fail→hydrate→success-clears)
- chrome-extension targeted 4 files: **36/36**; full suite **871/871** (no regressions)

## Nits (non-blocking)

1. **Empty-finals ENGINE_END drops the fallback chip** — `session-reducer.ts:335-353` (empty branch) sets banner to emptyMsg and errorCode falls to null, so a no-speech fallback session loses the CTA. Spec scopes the keep to "successful idle" and the test covers the success path, so defensible — but the edge exists.
2. **Copy wording drift** — spec quotes「可改**上方**模型下载源」; implementation says「可改**设置里的**模型下载源」(`whisper-settings-copy.ts:189,192,200`). Semantically equivalent; loses the spatial pointer.
3. Summoner `paintDiarized` k-check omits `Number.isFinite` — safe since JSON can't carry NaN/Infinity; noting for symmetry only.
4. Status echoes K for any k≥1 while dropdown sync is 2–4 — intentional per spec (echo-only outside picker range), noting the asymmetry.

CHANGELOG entries accurately describe all three fixes.

VERDICT: APPROVE_WITH_NITS
