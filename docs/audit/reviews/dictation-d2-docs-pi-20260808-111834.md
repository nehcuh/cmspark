## Dual external review — `dictation-d2-docs` (PR #146)

**Scope verified**: patch is current — `git diff e6d659f..HEAD` matches the review patch byte-for-byte (19 files, +697/−6). New unit tests pass via the project harness (`tsc`-compiled: `hotkey-chord` 4/4, `dictation-hotkey` 2/2).

**ADR-020 capability checklist** — declaration present and consistent with the diff:
- Surface L0 (composer draft only) ✓; no new tools/gates beyond the declared axis.
- Compose: Pack strip extended — `VOICE_FORBIDDEN_KEY_RE` now covers `hotkey|dictationHotkey|dictation_hotkey` (`companion/src/packs/types.ts:270`), so Pack cannot set the hotkey; hotkey is a Settings toggle, not a new scenario → Pack-first holds. No bare "中层 Agent" language anywhere.
- Trust: hold reuses the continuous privacy-v3 gate (`toggle` in `useVoiceInput.ts` requires `privacyAckV3` when `continuousMode`) — monotonic, no loosening. No new confirm dialect (reuses v3 sheet). `originWs` N/A — no `securityConfirmations.request` added. Origin fence on `hold_state` mirrors the proven M1 pattern (`chrome-extension://` regex + `v:1`), and the WS origin is browser-enforced. No new runtime.
- Floors 1–5 (default off, no fn/Win+V, no auto-send, origin fence, pack-can't-set-hotkey, meeting↔dictation xor) hold at static level — `MeetingPanel.tsx:499,672` block on `dictationCaptureActive` and D2 blocks on `meetingCaptureActive`.

**Blocking issue (functional — the headline feature does not work as specified):**

1. `chrome-extension/src/sidepanel/App.tsx:589–594` (dep array) + `App.tsx:582–586` (cleanup) + `useVoiceInput.ts:721–745` (return object)
   The D2 effect depends on `voice`, which `useVoiceInput` returns as a **fresh object literal on every render**. During a hold, `InputArea` re-renders constantly (session phase transitions, `onDraft → setText` on every transcript merge, the 250ms `listenTick` interval, agentStore updates). Every re-render re-runs the effect, whose cleanup executes `if (down) { voice.holdStop(); notifyHold(false) }` — killing the live session. Worse, because Chrome's `perms.query().then(begin)` start path is async, `holdStart`'s `queueMicrotask` (`useVoiceInput.ts:677–683`) resets `holdSessionRef=false` and restores the saved mode ("classic") *before* `begin()` runs. Net effect on real Chrome: a classic 45s session starts (not continuous), release-to-stop never fires (the new closure's `down` is false, so `onKeyUp` early-returns), and the tray indicator blinks active→inactive while recording silently continues. Hold-to-talk (press→continuous, release→stop) is broken; the guide's own acceptance item 「按住 ≥2s 松手 → 字进草稿 / 松手结束」 cannot pass.

2. `useVoiceInput.ts:682` — `holdStart` returns `true` unconditionally after passing guards, so `App.tsx` `if (ok) notifyHold(true)` always sends `hold_state active:true` even when the toggle's gates fail (e.g., missing v3 ack opens the privacy sheet instead of starting) → false "CMspark · 草稿" tray indication with nothing recording.

**Nits (non-blocking):**
- `useVoiceInput.ts:738` `holdActive: holdSessionRef.current` is a render-time ref read — never updates post-mount and has zero consumers; dead/stale API.
- Docs over-claim: `docs/GOAL.md` G22 and `docs/meeting-and-dictation-user-guide.md` §2.3 mark D2 已实现 with hold semantics, while the wiring is broken and real-device verification is explicitly deferred.
- Guide §2.3 says "Side Panel 已打开（可失焦）" yet also "焦点在侧栏时…捕获" — window-level listeners only fire when the panel window is focused; internal contradiction (minor).
- No test covers the React hold wiring — only pure `parseHotkeyChord`/`formatChord` and the companion handler; the critical bug is untested.

VERDICT: REJECT
