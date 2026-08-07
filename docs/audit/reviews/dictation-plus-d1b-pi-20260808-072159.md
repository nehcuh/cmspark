All verification complete. Here's my review summary:

## Review: Dictation+ D1b ASR Refiner

**Patch freshness**: ✅ Live `git diff main HEAD` matches the provided patch (15 files, 997 insertions, commit `ee53846`).

### ADR-020 capability checklist
- **Declaration present and accurate**: Surface L0 / L2 none / Compose none / Autonomy n/a / Trust (v3 ack) / Channel community. Hangs on the Surface axis correctly — single-shot `llmExtract` call, **no** "中层 Agent", no new runtime.
- **Pack-first**: no new primary chrome duplicating pack capability; feature is a settings toggle + fixed server handler. ✅
- **Confirm dialects**: reuses existing `voice_privacy_ack_v3`; no new confirmation family; no `securityConfirmations.request` (originWs n/a). ✅
- **Trust monotonicity**: no auto-approve, no looser L0 semantics; refine fail-open to raw is not an escalation. ✅
- P1 watchlist (god-mode/originWs/evaluate/shell): untouched. ✅

### Floors verified (all pass)
1. **Default off / no auto-send** — `initialState.asrRefinerEnabled: false`; grep confirms zero chat-send calls in the voice pipeline; `onDraft` only writes the composer.
2. **Prompt immutable** — `ASR_REFINER_SYSTEM_PROMPT` verified **character-identical** to SoT §7.4; handler logs-and-ignores any client `systemPrompt`; no pack/settings path exists.
3. **Fail-open to raw** — raw-first `onDraft(merged)` runs before `START_REFINE`; every failure path (`REFINE_FAIL` with draft_dirty / abort / guard / send_failed / llm_not_configured) leaves the raw draft in the composer.
4. **Origin fence** — `isChromeExtensionOrigin` (same regex as ADR-023 `voice.stt.*`), applied before any type branch; tray denied + unit-tested.
5. **Character-identical path tested** — guard + `runAsrRefine` mock tests cover `unchanged: true`.
6. **Pack strip** — `VOICE_FORBIDDEN_KEY_RE` extended (`asr_refiner|refiner_prompt|dictation_polish|rewrite_mode|audio_retain|autoStart`), enforced recursively with **no trust-block exception** in `scanForbidden`.

### Test claims verified
- Companion `voice-asr-refiner.test.js`: **13/13 pass** (ran it).
- Extension suite: **549 pass** (+2 new reducer tests; I ran 550 including my own temp sim test, then removed it).
- Full companion suite shows 14 failures — **all in `computer-executor.test.js`**, a file this diff does not touch (verified via `git diff --name-only`); pre-existing environment failures, not regressions.
- State-machine simulation confirmed the continuous-mode restart seam does **not** fire `ENGINE_END` mid-listen (adapter restarts internally), so refine only fires on the final stop — no SM conflict.

### Nits (non-blocking)
1. `App.tsx:1248-1266` — the 还原识别原文 button is rendered **while `phase==="refining"`** (banner "纠错中…" matches `/纠错/`). Clicking it restores raw, but the in-flight result then passes the dirty check (draft === rawSnapshot) and silently overwrites the restore. Button should be suppressed during refining (or cancel the refine).
2. `asr-refiner.ts` race — a **timeout** surfaces as `code: "aborted"` (any AbortError maps to aborted), so the client shows "已取消纠错" on a timeout the user never initiated. Harmless (fail-open) but misleading; also the race listener isn't removed when `extractPromise` wins (bounded to ~45s request lifetime).
3. `SettingsSlideout.tsx` checkbox `onChange` has a dead conditional — both branches dispatch the same `enabled` value; the "requires v3 to enable" intent isn't actually enforced there (it's correctly enforced at mic-toggle time in `useVoiceInput`).
4. Late `ENGINE_END` while refining (post-cancel adapter seam) resets to idle via `resetToIdle`, clearing `rawSnapshot`/banner — raw text stays in composer and the in-flight result is dropped, so fail-open holds, but the banner vanishes silently.
5. `REFINE_OK`'s `text.startsWith(base)` fallback could double-apply `base` if the model echoes a full transcript that doesn't prefix-match; bounded by the length guard, extremely unlikely.

All security floors hold, spec compliance to ADR-024/SoT §7 is solid, and the implementation is conservative with meaningful unit coverage.

VERDICT: APPROVE_WITH_NITS
