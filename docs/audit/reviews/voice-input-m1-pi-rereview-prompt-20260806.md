# Pi re-review: Voice Input M1 implementation

**Batch:** `voice-input-m1`  
**Stage:** Implementation review after SoT lock + M0.5 spike  
**Date:** 2026-08-06  

## Prior gates

| Gate | Result |
|------|--------|
| Four-lane adversary → SoT | LOCKED |
| Pi design re-review | APPROVE_WITH_NITS (nits absorbed) |
| M0.5 machine G1–G5 | PASS |
| M0.5 human G7 onresult | still optional before marketing default-on |

## SoT (must match)

Read: `docs/superpowers/specs/2026-08-06-voice-input-design.md`

Hard locks:
- Draft only — **no auto-send**
- Main thread composer only (hide on worker)
- Privacy three-channel honesty (Chrome STT may leave device; not via Companion)
- No `audioCapture` manifest
- prefs: `chrome.storage.local` only
- `thread_busy`: cannot start dictation
- Stop: abort recognition **before** chat.abort
- Max 45s; no silent continuous restart
- Permission bootstrap tab when denied

## Implementation files to inspect

```
chrome-extension/src/sidepanel/voice/detect.ts
chrome-extension/src/sidepanel/voice/error-map.ts
chrome-extension/src/sidepanel/voice/types.ts
chrome-extension/src/sidepanel/voice/text-merge.ts
chrome-extension/src/sidepanel/voice/session-reducer.ts
chrome-extension/src/sidepanel/voice/web-speech-adapter.ts
chrome-extension/src/sidepanel/hooks/useVoiceInput.ts
chrome-extension/src/sidepanel/components/VoiceMicButton.tsx
chrome-extension/src/sidepanel/App.tsx          # InputArea wire
chrome-extension/src/sidepanel/store/agentStore.tsx
chrome-extension/src/sidepanel/hooks/useWebSocket.ts
chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
chrome-extension/src/tabs/voice-permission.tsx
chrome-extension/src/tabs/voice-spike.tsx       # M0.5 harness (ok if diagnostic-only)
chrome-extension/tests/voice-detect.test.ts
chrome-extension/tests/voice-session-reducer.test.ts
chrome-extension/package.json                   # no audioCapture
```

Also run if tools allow:

```bash
cd chrome-extension && npx tsc --noEmit
npx tsx --test tests/voice-detect.test.ts tests/voice-session-reducer.test.ts
```

## Review focus (hostile)

1. **SoT compliance** — any auto-send path? Companion audio? Trust elevation?
2. **Abort races** — chat.abort / thread switch / unmount drop finals correctly?
3. **Busy matrix** — thread_busy vs run_busy vs l2_task vs worker hide
4. **Privacy** — first-run copy honest? settings honest?
5. **Double-send / double-final / committed flag**
6. **Permission bootstrap** — denied → tab; no audioCapture
7. **Missing tests / incomplete SM**
8. **Regression** — composer send/stop still works when voice idle

## Verdict rules

End with **exactly one** line:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

- **REJECT** if SoT hard locks violated, security/privacy false claims, or clear ship-blocker bugs (wrong-thread merge, auto-send, audio to companion).
- **APPROVE_WITH_NITS** if correct but non-blocking gaps (tests, UX polish, docs).
- **APPROVE** if ready to ship M1 behind existing prefs (default enabled after privacy ack is OK per SoT).

Cite file paths for blocking issues. Do not rubber-stamp.
