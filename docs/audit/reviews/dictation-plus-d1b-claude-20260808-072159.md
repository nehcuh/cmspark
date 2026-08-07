I've completed an independent review of the diff against the merge-base (`752ae6d`), read the actual code on both sides, and re-ran the test suites to confirm machine claims.

## Verification (executed)

- `node --test .test-dist/tests/voice-asr-refiner.test.js` → **13/13 pass** `[executed]`
- `node --test .test-dist/tests/voice-session-reducer.test.js` → **13/13 pass** (incl. 2 new D1b tests) `[executed]`
- `npx tsc -p tsconfig.test.json` (companion + extension) → clean `[executed]`
- Patch stat (`997 insertions / 16 deletions across 15 files`) matches the working tree `[inspected]`

## ADR-020 capability check

Declaration is present and accurate. Axes fit is correct:
- **Surface L0** — text-only into composer; no host/computer/shell touch. ✓
- **Compose none** — Pack strip extension is defense, not a new Compose axis. ✓
- **Autonomy n/a** — no worker/board. ✓
- **Trust monotonicity** — refiner requires privacy-ack v3 (the strictest voice tier); no god-mode / auto_approve bypass; no security confirmation channel touched. ✓
- **Pack-first** — no new primary Side Panel chrome (just a settings checkbox). ✓
- **originWs** — refiner doesn't call `securityConfirmations.request`, so no originWs binding needed. ✓
- **P1 watchlist** — none of P1-1..P1-4 touched. ✓

## Floors verified

1. **Default off / no auto-send** — `initialState.asrRefinerEnabled = false` (`agentStore.tsx:329`); refiner only writes via `onDraft`, never sends. ✓
2. **Prompt immutable** — `ASR_REFINER_SYSTEM_PROMPT` is `export const` (`asr-refiner.ts:10`); handler logs-and-ignores client `systemPrompt`/`system_prompt` (`refine-handlers.ts:122-124`); happy-path test injects a `"IGNORE ME ATTACK"` prompt and confirms it's dropped. ✓
3. **Fail-open to raw** — `runAsrRefine` returns `{ok:false}` on llm_error / abort / any guard reject; raw draft was already written to composer before the WS request fired (`useVoiceInput.ts:180`). ✓
4. **Origin fence tray denied** — `isChromeExtensionOrigin` regex rejects `cmspark-tray://local`; dedicated test passes. ✓
5. **Character-identical path tested** — `guard: character-identical pass-through` + reducer D1b test. ✓
6. **Pack strip covers new keys** — regex extended visually (`packs/types.ts:270`); regex is case-insensitive prefix-match consistent with existing style.

## Non-blocking nits

1. **Abort signal not propagated to `llmExtract`** — `asr-refiner.ts:144-160`. The outer race rejects on cancel, but the underlying `provider.complete` HTTP request keeps running for up to `timeout+1000` ms (≤46s). `llmExtract` doesn't accept an external `signal`. Bounded, text-only, no PII beyond transcript — non-blocking, but worth a follow-up to plumb `signal` through `llmExtract`.

2. **`TOOLISH_RE` cannot match tag-form output at start-of-string** — `asr-refiner.ts:54-55`. Because `\b` requires a word/non-word transition and `<` is non-word, `</?tool` never matches `<tool>` at offset 0; only `foo<tool` would. Defense-in-depth only (output goes to composer as plain text, not tool exec, and the prompt forbids tool format), but the alternative is essentially dead. Either drop it or re-anchor without `\b`.

3. **No client-side timeout on refine** — `useVoiceInput.ts:224-279`. If companion crashes / WS drops mid-request, extension stays in `"refining"` phase indefinitely (UI says "纠错中…点击取消"). Recoverable by clicking mic, but unbounded. Consider a client-side 50s watchdog that dispatches `REFINE_FAIL`.

4. **`refine-handlers` doesn't check `peerId`** — `refine-handlers.ts:95-102`. `voice.stt.*` checks both origin and peerId; refine only checks origin. Not a regression (origin + HMAC auth is the real gate, and refine is stateless), but inconsistent with sibling voice handlers.

5. **Pack forbidden regex extension lacks test coverage** — `voice-pack-deny.test.ts:97-107` does not assert any of the newly added prefixes (`asr_refiner`, `refiner_prompt`, `dictation_polish`, `rewrite_mode`, `audio_retain`, `autoStart`). The regex is correct visually, but the implementer's "Pack strip covers new keys" floor claim isn't pinned by a test.

6. **`inflight` abort race on key reuse** — `refine-handlers.ts:148-160`. If a `sessionId#refineGen` key is reused (e.g., extension remount resets `refineGenCounter` to 0, recreating `refine-1`), the previous run's `finally { inflight.delete(key) }` can delete the new controller. Practically bounded by extension incrementing `refineGen` per ENGINE_END; very unlikely, but a `if (inflight.get(key) === ac)` guard in the `finally` would close it.

7. **Stale comment in SettingsSlideout** — `SettingsSlideout.tsx:1029`: "user must open mic once or we set flag after ack in App" — App never sets the flag post-ack; the v3 gate is enforced at mic-toggle time in `useVoiceInput.ts:458-465`. Comment is misleading; behavior is fine.

8. **Dead defense-in-depth branch** — `session-reducer.ts:102-111` (`USER_TOGGLE_STOP` while `refining`) is unreachable from `toggle()` because the latter intercepts refining via `CANCEL_REFINE`. Defense-in-depth is fine, but flag as intentional.

9. **Missing handler tests** — no unit test for the `voice.refine.abort` happy path or for the `secretish` guard. Both are minor coverage gaps in an otherwise thorough test file.

## Verdict

Core security and correctness floors are met. Capability declaration is accurate. Tests pass. Findings above are all non-blocking observations.

VERDICT: APPROVE_WITH_NITS
