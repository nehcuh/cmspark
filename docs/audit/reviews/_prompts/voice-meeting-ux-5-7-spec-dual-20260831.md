# Dual re-review — UX #5–#7 spec (plan only)

READ-ONLY. Independent senior reviewer.

Work in: `/Users/huchen/Projects/cmspark` branch `fix/voice-meeting-ux-5-7`

## Capability

```text
Surface: L0 Side Panel voice + meeting | Blast: T2 UX
Trust: fallback already discloses cloud residual; add CTA + error hydration + K echo
```

## Inputs

1. Spec: `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md`
2. Live: `useVoiceInput.ts` SOFT_CAP_HINT; `App.tsx` localSttBannerCta; `whisper-handlers.ts` lastDownloadError; `SettingsSlideout.tsx` open clear; `MeetingPanel.tsx` meeting.diarized; `summoner-web.ts` paintDiarized

## Rules

1. REJECT if #5 reuses `model_missing` for a session that is already on browser STT (fail-closed vs fallback confusion).
2. REJECT if #6 still loses the error when user opens settings after a failed download (get_state must carry lastDownloadError).
3. REJECT if #7 still leaves K only in JSON with no UI echo.
4. Calibration: P2 UX. Do not demand durable audit log, disk persist of download errors, or auto-K on summoner picker.
5. File ranges must stay disjoint.

Final line exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
