All verification complete. Summary of findings:

## Floors verification (all pass)

1. **Ack required** ✓ — `meeting-handlers.ts:96` requires `privacy_ack_v1 !== true` → `need_privacy_ack`; only v1 counts, no v3 substitution. `server.ts` validator enforces the same. UI `ensureAck()` gates 开始录制/generate. Test `start requires privacy_ack_v1` passes.
2. **Pack clean** ✓ — `pack.yaml` has no `voice*/autoStart/ack` keys; prompt rule 4 requires explicit workbench start + ack; `min_capability: L0`.
3. **Local-only capture** ✓ — MeetingPanel imports only `createLocalSttAdapter` (continuous mode, hard cap), zero Web Speech.
4. **Default audio delete** ✓ — `endMeetingRecording` deletes `meetings/<id>/audio` when not retained; test writes residual `seg0.wav`, asserts `audio_deleted === true` + file gone; retain-opt-in test asserts file kept. `resolveContained` prevents traversal; void→boolean return has no other callers.
5. **Mutex** ✓ — store flags + reducer tests 3/3; `voiceAllowStart` blocks dictation while `meetingCaptureActive`; `startLiveCapture` blocks while `dictationCaptureActive`; mirror `busy` covers listening/starting/stopping/processing/refining (no gap in continuous mode); both flags reset on unmount.
6. **Origin fence** ✓ — `handleMeetingMessage` rejects non-`chrome-extension` origin for all `meeting.*` incl. start/end; router passes `session?.origin`.
7. **No auto-send** ✓ — minutes only go to draft via explicit button.
8. **No double end/generate** ✓ — phase guard + `finalizedRef` + adapter single-path `onEnd`.

**ADR-020**: Capability declaration present and matches implementation (Surface L0 + reuse of `voice.stt.*` surface; Compose pack skills+prompt only; Trust ack gates + default delete; Channel community). No "中层 Agent" language, no new runtime, no new `securityConfirmations.request` (originWs N/A), no P1 watchlist files touched; trust monotonicity preserved (ack is server-enforced, capture doesn't loosen L0). Tests: companion 9/9, extension mutex 3/3, tsc clean both packages.

## Nits (non-blocking)

- **Close-while-recording can leave server session stuck `recording`** — `ContextPanelHost` unmounts MeetingPanel on close, and unmount cleanup `destroyAdapter()` is silent (never fires `onEnd`), so `meeting.end` can be skipped. The header 收起 button/Esc calls `closePanel()` directly with no stop attempt (only the panel's own 关闭 button calls `stopLiveCapture(false)`, and even that races the async `onEnd`). Consequence: stale `status:"recording"` row; `meeting.start` on that id → `already_recording` (recoverable via 新建会议会话). No audio leak (UI never sets `audio_retained`, bucket only created when retained). Fix: send `meeting.end` synchronously in the close path before unmount, or in the unmount cleanup instead of silent destroy.
- `finalizeCapture` guard `if (finalizedRef.current && phaseRef.current === "idle") return` reads as if it should be `||` — harmless in practice (adapter destroyed after first finalize makes re-entry impossible) but confusing.
- Ack copy says "默认转写成功后删除音频（若启用录音）" while the UI never exposes the retain option (`audio_retained` hardcoded `false`) — server-side retain path is untestable from UI.

VERDICT: APPROVE_WITH_NITS
