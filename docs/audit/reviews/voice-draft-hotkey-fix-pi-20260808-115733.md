## Review — voice-draft-hotkey-fix (e9521ca)

**Patch freshness**: `git diff 36d5168..HEAD` matches the provided patch exactly (same 6 files, same +126/−23 stat; only commit `e9521ca`). Not stale. `npm test`: 568 pass, 0 fail.

### Core fix — verified correct
- `voiceLiveComposerText` (text-merge.ts:49–66) now includes `processing`, so the overlay no longer drops during local segment gaps — the flash/disappear bug is closed.
- Per-final flush in `useVoiceInput.ts:181–192` keeps `text` in sync so the fallback after overlay-drop is never stale.
- `App.tsx:1318–1323` disables only while the mic is open (`listening && !processing`); refining/stopping still disabled.
- Floors held: no auto-send change; hotkey fences (bare key / `Meta+V` / `fn` rejection in `parseHotkeyChord`) intact; unit tests added for live text during `processing` (voice-session-reducer.test.ts:31–58, covers listening/processing/idle).
- Hotkey free-text path works end-to-end: "Control+Shift+KeyM" → parsed to `key:"m"` → `eventMatchesChord` matches `e.key`/`e.code`; storage stays raw and parse guards invalid combos.

### Nits (non-blocking)

1. **`useVoiceInput.ts:184–192` — flush doesn't verify the reducer actually incorporated the final.** On hard-abort drop paths (`chat_abort`/`thread_switch`/`unmount`), the reducer returns state unchanged, but the flush condition (`!next.committed && next.finals.length > 0`) still fires and calls `onDraft(baseText + finals)` with pre-abort finals. This bypasses the SM's explicit contract "hard aborts drop late ENGINE_RESULT, no merge" (tested at `voice-session-processing.test.ts:177`). Impact is narrow — per-final flushing already puts finals in the composer pre-abort, so the stale re-write only *clobbers edits made during the abort window* — but the side-effect layer should mirror the SM: guard with `next.finals.length > prev.finals.length` (or `shouldApplyDraft(next)`).

2. **`App.tsx:1315–1322` — "editable during processing" is a false affordance.** The textarea is enabled during `processing`, but its value is pinned to `liveOverlay`; any keystroke is reset on the next render and the next final flush overwrites `text` anyway. Edits in a processing gap are silently discarded. Consider keeping it disabled during `processing`, or tracking divergence between `text` and the overlay before flushing.

3. **No tests for the hotkey changes.** `hotkey-chord.test.ts` covers only the existing space/default cases; the new `KeyM`/`Digit1` normalization in `parseHotkeyChord` and the `eventMatchesChord` additions are untested, despite this being new free-text input surface (the floor only mandated live-text tests, which were done).

4. **ADR-020 declaration missing** from the implementer prompt (Surface/Compose/Autonomy/Trust/Channel). Per checklist this is a nit here — no tools/gates/confirmations/originWs added, no security surface touched (P1 watchlist items untouched, trust monotonicity N/A, no new runtime).

No blocking issues: the reported bug is fixed, floors are met, all tests pass, and the remaining items are narrow races/coverage gaps with no security impact.

VERDICT: APPROVE_WITH_NITS
