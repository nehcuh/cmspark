I have enough evidence to render a verdict. Let me write up the review.

---

# Independent Review — Meeting Mtg1 Live Capture

## Capability declaration (ADR-020 checklist)

Present in prompt — Surface (L0 workbench + existing voice.stt.* Surface), Compose (Pack meeting-minutes, system_prompt_append only), Autonomy (n/a), Trust (meeting_privacy_ack_v1 for meeting.start; voice_privacy_ack_v2 + model/binary for local STT; default-delete audio; minutes → existing LLM job), Channel (community). ✓

Axes fit, pack-first, trust monotonicity, origin fence, no new runtime, no new confirm dialect — all hold. meeting_privacy_ack_v1 is justified (different blast radius than voice: durable transcript + optional audio).

## Floor-by-floor verification

| # | Floor | Status | Evidence |
|---|---|---|---|
| 1 | No start without meeting ack | ✓ | `server.ts:5857-5863` validator rejects if `privacy_ack_v1 !== true`; `meeting-handlers.ts:94` returns `need_privacy_ack`; UI sets ack only from `meeting_privacy_ack_v1` storage key (`MeetingPanel.tsx:122-123, 383`). voice_privacy_ack_v3 cannot substitute (different key) |
| 2 | Pack still bare | ✓ | `pack.yaml` has only `skills` + `system_prompt_append`; no voice/autoStart/ack keys |
| 3 | Long capture local-only | ✓ | `MeetingPanel.tsx:10` imports `createLocalSttAdapter`; no `webkitSpeechRecognition` / web-speech-adapter import; `adapter.start({mode: "continuous"})` |
| 4 | Default delete audio policy | ✓ | `meeting-store.ts:305-307` `if (!audio_retained) audioDeleted = deleteMeetingAudio(...)`; `meeting-minutes.test.ts:179-220` test exercises full handler path under `npm test` (verified — passes) |
| 5 | Dictation ↔ meeting mutex | ✓ | `agentStore.tsx:685-688` reducers; `App.tsx:433-437` `voiceAllowStart &= !state.meetingCaptureActive`; `App.tsx:487-493` mirrors voice activity to `dictationCaptureActive`; `MeetingPanel.tsx:407-410` refuses Start when dictation active |
| 6 | Origin fence | ✓ | `meeting-handlers.ts:71-78` calls `isChromeExtensionOrigin`; `message-router.ts:1924-1937` passes `origin` through; `stt-handlers.ts:45` regex `/^chrome-extension:\/\/[A-Za-z0-9_-]+$/` |
| 7 | No auto-send to chat | ✓ | `ContextPanelHost.tsx:267-271` dispatches `cmspark:fill-composer` CustomEvent → fills draft only |
| 8 | No double meeting.end / generate | ✓ | `MeetingPanel.tsx:191` finalized guard + phase state machine; `stopLiveCapture:449` rejects re-entry when `stopping`/`idle`; `pendingGenerate` disables generate button. `local-stt-adapter.ts:541-565` `destroy()` sets `dead=true` and is silent (verified — does not fire onEnd) |

## Tests

- `companion/tests/meeting-minutes.test.ts` — **9/9 PASS** under `npm test` (production runner; CommonJS source-order requires let env-var assignment land before module load, so `DATA_DIR` resolves to tmp). The same test fails under `node --test --import tsx` due to ESM import hoisting — that is an artifact of the tsx loader, not a real bug.
- `chrome-extension/tests/meeting-capture-mutex.test.ts` — **3/3 PASS** under `npm test`.
- TS clean on both packages.

## Non-blocking nits

1. **`MeetingPanel.tsx:191` convoluted guard** — `if (finalizedRef.current && phaseRef.current === "idle") return` could be `if (finalizedRef.current) return`. Current form works because `setPhase("idle")` runs early in finalize, but it's harder to reason about than a single-flag guard.
2. **Close-during-capture leaves server-side session in `recording` state** — `MeetingPanel.tsx:529-532` calls `stopLiveCapture(false)` synchronously then immediately `props.onClose()`; unmount cleanup runs `destroyAdapter()` which sets `dead=true`, suppressing the in-flight `onEnd` from `adapter.stop()`. Net effect: `meeting.end` is never sent. No audio leak (default `audio_retained=false`), no security impact, but the meeting row will show "recording" in `listMeetings` until manually cleared. Worth either (a) sending `meeting.end` directly in the close handler when capturing, or (b) awaiting finalize before unmounting.
3. **`deleteMeetingAudio` returns `true` when audio dir is already absent** (`meeting-store.ts:322`) — defensible (policy satisfied) but the `audio_deleted: true` shape could mislead a future caller into believing bytes were actually removed. Comment-only nit.
4. **Test pollution** — running the meeting tests via `tsx` (not the production runner) creates real `mtg_*` dirs under `~/.cmspark-agent/meetings/`. The `process.env.CMSPARK_DATA_DIR` line at the top of `meeting-minutes.test.ts` only takes effect under CJS source-order semantics. Not a CI issue (npm test uses compiled CJS), but a footgun for anyone who runs the file directly with tsx/node-ts.

## Verdict

All 8 capability/security floors hold. Production code is sound. Tests pass under the CI runner. Issues above are state-hygiene / style / test-runner footguns, none blocking.

VERDICT: APPROVE_WITH_NITS
