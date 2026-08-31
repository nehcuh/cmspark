All six live-code claims verified. Here is the review.

---

# Dual re-review — voice/meeting UX #5–#7 spec (plan only)

**Scope**: `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md` against live code on `fix/voice-meeting-ux-5-7`. Read-only; all findings `[inspected]` (static code-path verification; nothing executed — plan-only review).

## Rule-by-rule

**Rule 1 — #5 must not reuse `model_missing`. PASS.**
Spec design point 1 (`2026-08-31-voice-meeting-ux-5-7.md:33`) creates a new `local_fallback` code and explicitly forbids `model_missing`. Live code confirms the semantic split is real and necessary: `model_missing` is the fail-closed gate (`useVoiceInput.ts:471` → `ENGINE_ERROR`, banner「本机模型未就绪，请先在设置下载」`error-map.ts:105`), while `SOFT_CAP_HINT` at `useVoiceInput.ts:646` is a non-terminal info chip for a session **already running on browser STT** with cloud-residual disclosure (`LOCAL_FALLBACK_BROWSER_BANNER`, `error-map.ts:188`). Conflating them would tell a fallback user the model is missing when the session is in fact transcribing fine.

Bug claims verified: reducer `SOFT_CAP_HINT` sets `banner` only (`session-reducer.ts:216-223`); event type has no `code` (`types.ts:51`); `App.tsx:850` CTA is null because `errorCode` is null; `ENGINE_END` success path drops the chip (`session-reducer.ts:361-366`, banner → `timeoutBanner`/null). The two dispatch sites match the spec's split (fallback at 646; continuous-cap at 680-683 stays code-less per design point 2).

**Rule 2 — #6 get_state must carry lastDownloadError. PASS.**
Bug verified: `lastDownloadError`/`lastDownloadModelId` exist only as ad-hoc fields on the post-failure broadcast (`whisper-handlers.ts:264-268`); `statePayload` → `buildVoiceModelState` (`whisper-handlers.ts:115-125`) has no such field, so `get_state` never carries it. `SettingsSlideout.tsx:238-250` blanks `SET_VOICE_MODEL_ERROR` at open and the `get_state` callback only sets an error on transport failure — the download error is lost. `useWebSocket.ts:1553-1607` mirrors state but ignores the field. Design points 2/3/4 address all three: field on `get_state` + post-download broadcast, `in msg` guard in the WS handler, and removal of the open-blank. `_resetVoiceModelHandlersForTests` exists (`whisper-handlers.ts:76`) so the process-level state reset is implementable. `modelProbeErrorLabel` `http-error`/`network-error`/HTTP-default sites exist (`whisper-settings-copy.ts:188-200`).

**Rule 3 — #7 K must have UI echo. PASS.**
Bug verified: `meeting-handlers.ts:374-391` persists `diarize: { method, k, … }` and returns it on `meeting.diarized`; `MeetingPanel.tsx:664-669` uses only `method`; `summoner-web.ts:2227-2228` same. Design adds `formatMeetingDiarizeStatus(method, k)` with `· K=N` suffix in both Side Panel and summoner `setStatus`. The `k in 2..4 → setDiarizeK(k)` guard matches the picker domain exactly (options 0/2/3/4, `MeetingPanel.tsx:1481-1484`; onChange clamps 0–4).

**Rule 4 — calibration. PASS.**
Non-goals explicitly exclude silent `sttEngine` write, config.json persist of `lastDownloadError`, speaker embeddings, and adapter PRs. No auto-K on the summoner picker is proposed ("status echo only"). Tests scoped to pure helpers + reducer + handler state. Appropriate for P2 UX; I raise nothing beyond it.

**Rule 5 — disjoint file ranges. PASS.**
#5 {error-map, types, session-reducer, useVoiceInput, App.tsx-CTA-wiring, composer tests} ∩ #6 {whisper-handlers, useWebSocket, SettingsSlideout, whisper-settings-copy} ∩ #7 {MeetingPanel, summoner-web} — no file appears twice. `useVoiceInput.ts` (#5) vs `useWebSocket.ts` (#6) are distinct files.

## Nits (non-blocking)

1. **#5 ENGINE_END carve-out not spelled out.** `session-reducer.ts:314-326` maps any non-excluded `errorCode` through `mapVoiceError`; `"local_fallback"` would hit the default → `mapSpeechError` and could clobber the banner with generic copy. Design point 5 implies a special case, but the implementer should add `local_fallback` to the exclusion set (or branch before line 314). One sentence in the spec would prevent this.
2. **#6 copy「上方模型下载源」** assumes the endpoint control renders above both error display sites (`SettingsSlideout.tsx:1536`, `:1825`) — verify orientation at implementation.
3. **#7 text_gap wording** "unchanged (or `· K=N` if present)" is ambiguous — pick one behavior during implementation.
4. Header still reads `STRAWMAN (awaiting Claude/Kimi dual)` though both review docs exist — stale status line, cosmetic.

## Conclusion

All three REJECT conditions cleared; the spec's bug claims are accurate against live code; designs are implementable at the stated file ranges; calibration respected. The four nits are copy/clarity items that don't warrant a rejection round.

VERDICT: APPROVE_WITH_NITS
