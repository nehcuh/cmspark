# Spec: voice/meeting UX #5–#7 (Kimi P2, re-review CONFIRMED)

**Date**: 2026-08-31  
**Status**: IMPLEMENTED (spec Claude/Kimi AWN)  
**Blast**: T2 UX — no Trust/L2 change  
**Branch**: `fix/voice-meeting-ux-5-7`

## Capability

```text
Surface:      L0 Side Panel voice + meeting chrome
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        local fallback already discloses cloud residual; this adds recovery CTA
Channel:      community
```

Independent file ranges (no overlap):

| ID | Files |
|----|--------|
| #5 | `error-map.ts`, `types.ts`, `session-reducer.ts`, `useVoiceInput.ts`, `App.tsx` (CTA wiring only), composer tests |
| #6 | `whisper-handlers.ts`, `useWebSocket.ts` (voice.model.state), `SettingsSlideout.tsx` open-clear, `whisper-settings-copy.ts` |
| #7 | `MeetingPanel.tsx`, `summoner-web.ts` `paintDiarized` |

## #5 — fallback banner CTA + keep until dismiss/next start

**Bug**: `SOFT_CAP_HINT` sets `banner` only. `App.tsx` CTA is `localSttBannerCta(voice.errorCode)`; `errorCode` is null → no「去设置」. `ENGINE_END` drops the chip.

**Design**:

1. New code `local_fallback` (do **not** reuse `model_missing` — that is fail-closed when autoFallback is off).
2. `SOFT_CAP_HINT` event optional `code?: string`. Fallback dispatch `{ message: LOCAL_FALLBACK_BROWSER_BANNER, code: "local_fallback" }`. Continuous-cap hint stays code-less.
3. Reducer: set `errorCode` from `event.code` when present.
4. `localSttBannerCta("local_fallback")` → `{ kind: "open_settings", label: CTA_OPEN_SETTINGS }`. `null`/`""` still null.
5. `ENGINE_END` / successful idle: if `errorCode === "local_fallback"`, keep `banner` + `errorCode` (timeout banner still wins). `USER_TOGGLE_START` / `DISMISS_BANNER` still clear.

**Tests**: `localSttBannerCta("local_fallback")`; reducer SOFT_CAP_HINT+code; ENGINE_END keeps fallback chip; continuous SOFT_CAP_HINT still no code.

## #6 — download error survives settings open; copy points at mirror

**Bug**: `lastDownloadError` is broadcast-only, never on `get_state`, never read by UI. Settings open does `SET_VOICE_MODEL_ERROR: null` then `get_state` without the field.

**Design**:

1. Process-level `lastDownloadError` / `lastDownloadModelId` in `whisper-handlers` (reset in `_resetVoiceModelHandlersForTests`). Set on fail (non-abort); clear on success/cancel-success.
2. `get_state` and post-download `voice.model.state` always include `lastDownloadError: string | null` (and modelId when set).
3. `useWebSocket` `voice.model.state`: if `"lastDownloadError" in msg`, `SET_VOICE_MODEL_ERROR` to that string or null.
4. `SettingsSlideout` **must not** blank `SET_VOICE_MODEL_ERROR` at open; let get_state/WS apply.
5. `modelProbeErrorLabel` `http-error` / `network-error` (and HTTP default) append「可改上方模型下载源（如 hf-mirror.com）」。

**Tests**: download fail → get_state has lastDownloadError; success clears; copy strings; no disk persist.

## #7 — echo auto-selected K

**Bug**: `meeting.diarize.k` persisted; Side Panel status only uses `method`; dropdown stays「自动」。

**Design**:

1. Pure `formatMeetingDiarizeStatus(method, k): string` — audio: `已自动标匿名发言人（实验 · 非身份识别）· K=N` when `k` is a finite number ≥ 1; text_gap unchanged (or `· K=N` if present).
2. `meeting.diarized`: `setImportStatus(format…)`; if `k` in 2..4, `setDiarizeK(k)` (leave 0/自动 if k missing).
3. Summoner `paintDiarized`: same K suffix in `setStatus`. Summoner K picker has no auto-0; status echo only.

**Tests**: format helper cases; optional summoner string grep if cheap.

## Non-goals

Silent sttEngine write; persist lastDownloadError to config.json; speaker-embedding; W1e/adapter PRs.
