# Dual External Review — `dictation-d2-docs-r2` (PR #146, HEAD b3841f4)

## Patch freshness
`git diff e6d659f` stat matches the patch file (24 files, +1855/−6); patch header `b3841f4` == HEAD. Fresh.

## R1 REJECT items — verified fixed in code
1. **Effect teardown every render** (`App.tsx:496–530`): deps are now only `[state.dictationHotkeyEnabled, state.dictationHotkeyChord]`; `holdStart/holdStop/meetingCaptureActive/voiceAllowStart/privacy` are read via refs updated each render. The 250ms `listenTick` no longer re-runs the effect — cleanup no longer kills live holds.
2. **queueMicrotask clobbering** (`useVoiceInput.ts:683–715`): microtask removed; `holdStart` sets `holdSessionRef=true` + forces `modeRef="continuous"` *synchronously before* `toggle(extra)`; restore is now driven by a `session.phase` effect (idle/error) and `holdStop`. `toggle()`'s async `perms.query().then(begin)` path is the only remaining async window.

## ADR-020 capability checklist
- Declaration present and matches the diff: Surface L0 (draft only), Compose pack-strip, Autonomy n/a, Trust v3 reuse, Channel community. No bare "中层 Agent" anywhere.
- **Pack-first**: hotkey is a Settings toggle, not a new scenario; `VOICE_FORBIDDEN_KEY_RE` extended with `hotkey|dictationHotkey|dictation_hotkey`, enforced in both `packs/types.ts:295` and `packs/validator.ts:74`. Pack cannot set the hotkey.
- **Trust monotonicity**: hold forces continuous → `toggle()` requires `privacyAckV3` for continuous; no loosening, no new confirm dialect, `originWs` N/A (no new `securityConfirmations.request`).
- **Origin fence**: `hold_state` handler requires `chrome-extension://[A-Za-z0-9_-]+` origin derived from the WS handshake (browser-enforced, fail-closed on missing session) + `v:1` schema in `server.ts`. No new runtime.
- **Floors 1–6**: default off (`initialState`), no bare fn/Win+V (parser rejects + dropdown presets only safe chords), no auto-send (normal draft pipeline), origin fence, pack fence, meeting↔dictation xor (`meetingCaptureRef` block). All hold.

## Tests
- chrome-extension: 567/567 pass (incl. new `hotkey-chord` 4 tests).
- companion: 2625 pass / 14 fail — **all 14 failures reproduced at base e6d659f** (computer-executor/computer-uia-watch, untouched files); new `dictation-hotkey` 2/2 pass. No regression.

## Docs
ADR-024 exists; GOAL G22, README index, mission-pack link, Mtg3 parking all accurate. User guide §2.3 is internally consistent ("面板需焦点" / "失焦会结束 hold" matches the onBlur handler) and honestly scopes D2; the 真机清单 with "实现侧不代跑" is a disclosure, not over-claiming.

## Nits (non-blocking)
- `useVoiceInput.ts:683–715` — residual fast-tap race: keyup before the async `perms.query().then(begin)` leaves phase `"idle"`, so `holdStop` skips `toggle()` and restores mode; `begin()` then starts a **classic** 45s session after release. Window is a few ms vs. a real hold (hundreds of ms), consequence is the same as pressing 🎤 (visible UI, 45s cap, no auto-send) — acceptable, but a `holdPending` guard or `toggle`-return would close it.
- `useVoiceInput.ts:703` — `holdStart` returns `true` unconditionally after guards, so `App.tsx` sends `hold_state active:true` even when gates fail (e.g., missing v3 ack opens the sheet, nothing records) → transient false "CMspark · 草稿" notification (2s timeout, cosmetic).
- `companion/src/message-router.ts:1934` — inline `require("node-notifier")`; module-level import would match `menu-bar-agent.ts`.
- `companion/tests/dictation-hotkey.test.ts` — no `bad_version` (v:2) case despite the handler branch.
- No real-device execution of the T2 hold path (honestly disclosed; static fixes verified but the acceptance item 「按住 ≥2s 松手」 remains user-verified per the checklist).

Both R1 blocking bugs are genuinely fixed, the security/capability fences are intact, and tests show no regression. Remaining items are edge-case/process nits.

VERDICT: APPROVE_WITH_NITS
