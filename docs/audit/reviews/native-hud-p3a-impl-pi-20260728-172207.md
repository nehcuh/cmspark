All 7 blocking criteria verified against source code. Here's the evidence:

**Criterion 1 — One binary:** Single `SWIFT_TRAY_SHA256` gate at `companion/src/tray/swift-tray-bridge.ts:49`. `HudController` defined in same `Tray.swift` as `TrayDelegate`/`ConfirmController`; same `NSApplication.shared.run()` entry point. ✅

**Criterion 2 — Close ≠ stop:** `Tray.swift` `HudController.hide(reason:)` calls `window?.orderOut(nil)`, emits `hud.closed`, explicitly comments "N4: do not terminate NSApplication". `windowWillClose` (red-dot/Cmd+W) emits `hud.closed` with reason "user", never calls `NSApplication.shared.terminate`. `abortClicked` emits separate `hud.abort` event. `swift-tray-bridge.ts:392` confirms "N4: close ≠ stop — do not kill process". ✅

**Criterion 3 — Single-writer:** `security-confirmation.ts` — `respond()` (line 491) and `respondFrom()` (line 401) both `pending.delete(confirmationId)` before resolve. Late calls return `false` / `{ outcome: "unknown" }`. `fireTerminal()` lives inside the `if (pending)` block, called exactly once per terminal path. `server.ts:267-275` wires `setOnTerminal` → `cancelConfirm` + `cancelHudConfirm` + `notifyHudConfirmResolved`. Tests at `security-confirmation-broadcast.test.ts` confirm: late respond = unknown, no re-fire. ✅

**Criterion 4 — Spike scope:** `spike.ts` `buildSpikeHydrate()` sets `dual_track: { conclusions: [], steps: [] }`. `Tray.swift` `applyHydrate()` reads `dual_track` defensively (no crash). Gate is `CMSPARK_HUD_SPIKE === "1"` — off by default. No production `hud.shell` UI exists. Ship note §4.4: "Production hud.shell setting not shipped". ✅

**Criterion 5 — Race safety:** Three paths examined:
- `spike.ts:130` — `Promise.race([wsPromise, hudPromise])`, winner-takes-all; HUD win → `respond()`; manager win → `cancelHudConfirm`. Only one branch executes.
- `server.ts:1430-1450` — `Promise.race([wsPromise, trayPromise])`, same pattern; WS win → `cancelConfirm`; tray win → `respond()`.
- `server.ts:5030-5087` — dual-process `hud.spike.start` → `hud.spike.confirm_response` → `respond()`. Manager timeout path also guarded by `pending.delete()`.
No double-respond path found. ✅

**Criterion 6 — Integrity:** `swift-tray-bridge.ts:95-102` — `checkIntegrity()` returns `{ ok: false }` on hash mismatch (never throws). `start()` at line 175 throws on `!pre.ok` — refuses to spawn. Auto-rebuild only on `!fs.existsSync(binPath)` (line 169), explicitly not on mismatch. `handleCrash()` re-checks before respawn. Tests at `swift-tray-integrity.test.ts` confirm mismatch → `ok: false`, no silent rebuild. ✅

**Criterion 7 — Ship note honesty:** Status line says "full dual-process operator checklist partial". §8 says Task 6 Step 4: "**partial** (stdin open proven; full spike env session optional follow-up)". §5: "NO-GO until implementation dual-review APPROVE". Known gaps §4.1 explicitly documented. No over-claiming. ✅

All 27 targeted unit tests pass (hud-protocol, hud-shell-router, hud-spike, swift-tray-integrity, security-confirmation-broadcast).

VERDICT: APPROVE
