Patch verified non-stale — working tree matches. All 568 tests pass (including new `voiceLiveComposerText` test).

## Review

**Verified correct:**
- `voiceLiveComposerText` includes `processing` (text-merge.ts:57-62) — fixes the flashDisappear bug at its root.
- `ENGINE_RESULT` finalChunk flush (useVoiceInput.ts:183-192) keeps draft synced through segment gaps.
- Reducer already accepts `ENGINE_RESULT` during `processing` (session-reducer.ts:227-261) and `voiceLiveComposerText` plumbs the phase through correctly.
- `parseHotkeyChord` normalization (hotkey-chord.ts:64-68) handles `KeyM`→`m`, `Digit1`→`1` correctly.
- No new gates/tools/Surface changes — ADR-020 Surface/Compose/Autonomy/Trust/Channel not applicable.

**Nits (non-blocking):**

N1. **Typing race during processing** (App.tsx:1318-1323 + useVoiceInput.ts:183-192): textarea is now editable in `processing`, but `value={voice.liveOverlay !== null ? voice.liveOverlay : text}` overrides any `setText` from `handleChange` — user keystrokes are invisible. Then the new `ENGINE_RESULT` finalChunk flush (`o.onDraft(partial)`) `setText(merged)` silently overwrites user text on the next segment final. Comment claims "editable when not capturing mic" but editing doesn't actually work. Either keep `disabled` during `processing`, or fold user edits into `baseText` before flushing.

N2. **Untested new paths**:
   - `parseHotkeyChord` `KeyM`/`Digit1` normalization (hotkey-chord.ts:64-68) — no unit test in `tests/hotkey-chord.test.ts`.
   - `eventMatchesChord` defensive `chord.key.replace(/^key/, "")` branch (hotkey-chord.ts:111-115) — untested, and effectively dead because `parseHotkeyChord` already normalizes "KeyM"→"m" before storage.
   - `useVoiceInput` ENGINE_RESULT finalChunk → `onDraft` flush (useVoiceInput.ts:183-192) — hook side effect not covered; only the pure reducer is tested.

N3. **Regex inconsistency** (hotkey-chord.ts:111 vs 67): parser uses strict `/^key[a-z]$/`, matcher uses loose `/^key/`. Functionally safe due to length check, but the asymmetry is confusing.

N4. **Implementer prompt lacks ADR-020 capability declaration**. Per checklist this is a nit (not blocking) since the diff is pure UI/settings, no new tools/gates/primary-surface entry points.

N5. **Datalist preset** `Control+Shift+KeyM` (SettingsSlideout.tsx:1100) displays the technical `KeyM` form to users; works via normalization but the friendlier `Control+Shift+M` would match user expectation. Cosmetic.

No security regressions, no incomplete fixes, no wrong file:line, no over-claiming. Primary bug fix is correct and tested.

VERDICT: APPROVE_WITH_NITS
