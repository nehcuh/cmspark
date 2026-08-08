## Independent R2 review — `dictation-d2-docs-r2`

**Patch freshness**: confirmed. `git diff e6d659f..HEAD --stat` matches the r2 .patch file exactly (24 files, +1855/−6). HEAD `b3841f4` is the R2 fix commit on top of R1 implementation `556efbd`.

**ADR-020 capability checklist** — declaration present and consistent with the diff:
- Surface **L0** (composer draft only); no new tools, gates, or UI entry points beyond the prefs toggle.
- Compose: Pack strip extended — `VOICE_FORBIDDEN_KEY_RE` at `companion/src/packs/types.ts:270` now covers `hotkey|dictationHotkey|dictation_hotkey`, so Pack cannot set the hotkey. Hotkey is a Settings toggle, not a Pack scenario → **Pack-first holds**. No "中层 Agent" language.
- Autonomy: n/a.
- Trust: hold reuses the continuous privacy-v3 gate (`useVoiceInput.ts:481-487` requires `privacyAckV3` when `continuousMode`) — monotonic, no loosening. No new confirm dialect. Origin fence on `voice.dictation.hold_state` (`companion/src/voice/dictation-hotkey.ts:42`) uses the proven `chrome-extension://` regex; WS layer passes `session?.origin` (`message-router.ts:1928`). `originWs` N/A — no `securityConfirmations.request` added.
- Channel: community.
- Floors 1–6 (default off, no fn/Win+V, no auto-send, origin fence, pack-can't-set-hotkey, meeting↔dictation xor) verified at static level — `MeetingPanel.tsx:499,672` blocks on `dictationCaptureActive`; D2 `App.tsx:543` blocks on `meetingCaptureActive`.

**R1 blockers — fix verification**:

1. **R1 Claude #1 / Pi #1 (effect deps on `voice`)** — FIXED. `App.tsx:496-514` now keeps stable refs (`holdStartRef`, `holdStopRef`, `meetingCaptureRef`, `voiceAllowStartRef`, `privacyRef`) and the effect dep array is `[state.dictationHotkeyEnabled, state.dictationHotkeyChord]` (`App.tsx:594`). The 250ms `listenTick` re-renders no longer tear down the listeners mid-hold.

2. **R1 Claude #2 (queueMicrotask race)** — FIXED. `useVoiceInput.ts:665-687` removes the microtask entirely and replaces it with a reactive `useEffect` that watches `session.phase` and only restores when phase transitions to `idle`/`error` while a hold session is live. The race with `navigator.permissions.query().then(begin)` is gone — mode is read inside `begin()` (`useVoiceInput.ts:533`) after the async permission check resolves, by which point `modeRef.current === "continuous"`.

**Pure-logic tests** — verified by execution:
- `chrome-extension/tests/hotkey-chord.test.ts`: 4/4 pass (`npx tsx --test`).
- `companion/tests/dictation-hotkey.test.ts`: 2/2 pass.

### Non-blocking nits

1. **`chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:689-703`** — `holdStart` still returns `true` after passing its three guards even when `toggle()` will synchronously bail (continuous mode + missing v3 ack → `toggle` opens the v3 sheet and returns before `begin()`). `App.tsx:546-551` then calls `notifyHold(true)`, producing a brief false 「CMspark · 草稿」tray indication while nothing is actually recording. Self-corrects on key release (`holdStop` → `restoreModeAfterHold`); no recording ever starts; mode is restored. Severity: UX cosmetic. Fix suggestion: have `holdStart` synchronously check the same `continuousMode && privacyAckV3` predicate `toggle` uses, or defer `notifyHold(true)` in `App.tsx` until `session.phase` leaves `idle`.

2. **Process (carried from R1 #3)** — `docs/meeting-and-dictation-user-guide.md` still states 「实现侧不代跑；合入后由你本地验收」. The R1→R2 fixes (refs/effect-deps, queueMicrotask→`useEffect`) are verified by static reasoning only; no end-to-end hold smoke test was run by the implementer. The static fixes are sound and the deferred-verification posture is documented honestly, but a single ~3-second hold smoke test would have caught R1's bugs and would now confirm the R2 fix.

3. **Tests** — no coverage for the React hold effect lifecycle or the new `useEffect`-based mode-restore path (`useVoiceInput.ts:682-687`). Existing tests are pure-logic only; the R1 bugs lived in the integration path that remains untested.

4. **`companion/src/message-router.ts:1934`** — `require("node-notifier")` inside the handler hot path (carried from R1 nit). Node caches it after first call, but a module-top `import` would match the pattern in `menu-bar-agent.ts:30`.

5. **`companion/src/voice/dictation-hotkey.ts:13`** — `lastHoldActive` is a process-global mutable; acceptable for single-extension use, worth a one-line comment locking that assumption.

### Verdict

The two R1 REJECT-level blockers (effect teardown every 250ms; queueMicrotask race that always clobbered continuous mode) are correctly fixed at the static level. Pure-logic tests pass. ADR-020 capability axes fit; Pack-first, origin fence, default-off, fn/Win+V ban, and meeting↔dictation xor all hold. Residual issues (Pi's holdStart-return-value false tray notification; missing execution verification; missing React wiring tests) are non-blocking UX/process nits. Ship with the documented user-local verification checklist.

VERDICT: APPROVE_WITH_NITS
