Tests confirmed: **545/545 pass**. Independent inspection complete.

## Review findings

### Capability declaration (ADR-020)
Present and correct: Surface L0, Compose none, Autonomy n/a, Trust mic + ack v3 + no auto-send, Channel community. ✓

### SoT floors (D1a scope)
1. ✓ Default `classic` — `initialState.voiceDictationMode = "classic"`; radio defaults to classic.
2. ✓ Continuous opt-in; `VOICE_CONTINUOUS_HARD_CAP_MS = 15 * 60_000`; abs ceiling 30min enforced via `Math.min(.., VOICE_CONTINUOUS_HARD_CAP_MAX_MS)` in `detect.ts:534`.
3. ✓ No auto-send — `useVoiceInput.ts:165` only calls `onDraft` on ENGINE_END; never `onSend`.
4. ✓ ENGINE_END not spuriously fired during continuous restart — `web-speech-adapter.ts:116-141` returns early before `handlers.onEnd()` when scheduling restart; `endedForGen` prevents double-fire.
5. ✓ Identity: composer draft only; no system injection path.
6. ✓ Classic path unchanged — `bindAndStart` honors `mode === "continuous"` gate; classic takes the terminal `handlers.onEnd()` path.
7. ✓ Trust: v3 ack body (`privacy-copy.ts`) explicitly discloses "浏览器听写在连续模式下可能在整个会话中将音频送往浏览器厂商语音服务".

### Trust monotonicity / originWs
Not applicable — no new tools, no new security confirmation family, no MCP/navigate touch. Voice stays L0 composer; no L2/evaluate/CU bypass. ✓

### Bugs / risks (all non-blocking)

**N1 — Persistent-error restart loop (continuous)** — `web-speech-adapter.ts:101-110, 116-141`. If Web Speech persistently errors with a non-`no-speech` code (e.g., `audio-capture` after device disconnect), the parent reducer transitions to `phase: "error"` but the adapter still has `wantListening=true` and will keep calling `bindAndStart(gen)` on each `onend`. Parent ignores the resulting `ENGINE_START`/`ENGINE_RESULT` (phase guard), but the adapter spins creating new `SpeechRecognition` instances until the 15-min hard cap fires (`useVoiceInput.ts:413-427`). Bounded but wasteful. Consider: cap restart count, or have parent call `adapter.abort()` when entering `error` phase. Follow-up, not a D1a blocker — manual stop recovers.

**N2 — Pack strip expansion deferred (residual, acknowledged by implementer)** — `companion/src/packs/types.ts:269-275`. Existing regex `^(voice|sttEngine|localModelId|voiceStt|voice_privacy|voiceAutoSend)/i` covers the new D1a keys (`voiceDictationMode`, `voice_privacy_ack_v3` — both via `^voice`). ADR-024 §5.3 further requires `*hotkey*`, `*cap*`, `asr_refiner*`, `refiner_prompt*`, `audio_retain`, `autoStart*`. Those features aren't shipped in D1a, so no current bug — but the strip regex must be expanded before D1b/D2 land those keys. Flagged as residual in the implementer prompt; consistent with D1a scope.

**N3 — v3 ack body references unshipped feature** — `privacy-copy.ts:22`. Body mentions "若开启「ASR 纠错」，转写文字会发送到你已配置的 LLM 服务商". ASR Refiner is D1b, not in this PR. Slightly confusing UX (consenting to a feature that doesn't exist yet), but architecturally consistent with v3 ack covering both continuous + Refiner under one gate (F-S-CD15). Acceptable.

**N4 — Storage key naming inconsistency** — `agentStore.tsx:486` writes `chrome.storage.local.set({ voiceDictationMode: mode })` (camelCase), while siblings use snake_case (`voice_privacy_ack_v3`). Pre-existing codebase already mixes conventions (`voiceInputEnabled` camelCase, `voice_privacy_ack_v1` snake). Cosmetic.

### Test coverage gaps (non-blocking)
- No test for N1 (persistent-error restart loop).
- No test for abort-during-restart race; analysis suggests it's not triggerable in practice (microtask runs before next user-input task), but an explicit test would lock the invariant.

### Stale patch check
`git diff main..HEAD --stat` matches the patch file's claimed stats (23 files, 2689/73). Patch is current.

---

N1–N4 are non-blocking; D1a scope (continuous browser listen + ack v3 + caps + classic regression) is correctly implemented, tested, and Trust-disclosed.

VERDICT: APPROVE_WITH_NITS
