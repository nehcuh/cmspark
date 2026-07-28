I have inspected the diff, source, tests, and binary. Here is my review.

## Verification summary

**One binary (claim 1):** Verified. `Tray.swift` houses both `TrayDelegate` (NSStatusBar) and `HudController` (lazy NSWindow) in the same process. Single `SWIFT_TRAY_SHA256` gate at `swift-tray-bridge.ts:50`. Binary on disk matches pinned hash (`shasum -a 256 companion/dist/cmspark-tray` → `5929b53c…`, identical to source).

**Close ≠ stop (claim 2):** Verified. `Tray.swift:1016-1021` `hide(reason:)` calls `orderOut(nil)` + emits `hud.closed` with comment `// N4: do not terminate NSApplication`. `windowWillClose` (line 1080-1084) also just stops heartbeat and emits — no `NSApplication.shared.terminate`. `abortClicked` (line 1069) emits separate `hud.abort` event.

**Single-writer (claim 3):** Verified. `security-confirmation.ts:409` returns `outcome:"unknown"` when no pending entry (late respond). `respond()` (line 491-505) deletes pending before resolve + fires `fireTerminal` exactly once. `server.ts:267-277` `setOnTerminal` fans cancel/resolved to tray popover + HUD. Tests `security-confirmation-broadcast.test.ts` cover the N5 hook.

**Spike scope (claim 4):** Verified. `protocol.ts:44` types `dual_track` as `{ conclusions: never[]; steps: never[] }`; `spike.ts:38` ships empty arrays. All HUD code gated by `CMSPARK_HUD_SPIKE=1` (`spike.ts:17-23`, `menu-bar-agent.ts:702`, `server.ts:4761,5031,5080,5089`). No production settings UI ships.

**Race safety (claim 5):** Acceptable for spike. `Promise.race` in `spike.ts:133` picks first settle. `pendingHudConfirms`/`pendingConfirms`/`pending` maps all delete-before-resolve, so a late responder finds no entry and is dropped. Swift `clearConfirm` is guarded by `pendingConfirmId != id` (Tray.swift:1000), making fan-out idempotent.

**Integrity (claim 6):** Verified. `swift-tray-bridge.ts:206-216` — hash mismatch throws "Binary integrity check FAILED — refusing to spawn", no rebuild. Auto-build only on missing binary (`!fs.existsSync`, line 198). Restart path (`handleCrash`, line 574-578) re-runs `checkIntegrity` and refuses tampered binary. Matches S-P0-2 / A5.

**Ship note honesty (claim 7):** Verified. Section 4 lists "Operator dual-process checklist: not every checkbox filled" and "WS multi-client fan-out … may remain incomplete". Section 5 marks screenshot flood **NO-GO**. Section 2 says "Cold dual-process: Not timed this session". No overclaiming.

**Tests:** 20/20 pass on `hud-protocol`, `hud-shell-router`, `hud-spike`, `swift-tray-integrity`. Stdin smoke `printf '{"cmd":"hud.open",...}' | cmspark-tray` emits `hud.ready` + `hud.closed` immediately.

## Non-blocking nits

1. **`spike.ts:143-144`** — when manager wins the race, the spike explicitly calls `cancelHudConfirm` + `notifyHudConfirmResolved`, but `onTerminal` (fired synchronously inside `manager.respond`) has already called both. Idempotent on Swift, but redundant pipe traffic. Same redundancy in reverse for HUD-wins path (`respond` → `onTerminal`).

2. **`server.ts:267-277`** — `onTerminal` fans out `cancelConfirm` + `cancelHudConfirm` + `notifyHudConfirmResolved` for *every* terminal confirmation, including Side-Panel-only ones whose id was never on HUD/tray. Swift guards make this a no-op, but it generates spurious `hud.confirm.cancel`/`hud.confirm.resolved` messages.

3. **`Tray.swift:1080-1084`** — quit sequence emits a trailing `{"type":"hud.closed","reason":"user"}` *after* `{"type":"exit","code":0}` (observed in stdin smoke). Cosmetic; parent has torn down by then.

4. **`server.ts:5088-5095`** — `hud.spike.abort` only logs; no task cancellation. Acknowledged spike non-goal, but worth noting for P3b.

VERDICT: APPROVE_WITH_NITS
