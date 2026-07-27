# P0a Tray — focus-preservation fix brief (for Grok review)

## Context

P0a Tray adds a second native confirmation channel (Swift `NSPanel` dispatched
from `menu-bar-agent.ts`) that races the existing WS Side Panel channel. The
**entire reason** this channel exists is that the Chrome Side Panel, when it
pops the confirmation, makes Chrome frontmost. After the user approves, the
companion injects CGEvents at coordinates that are now wrong (Chrome is
frontmost, not the target app e.g. TextEdit).

P0a Tray's value proposition: a native macOS status-item dialog that does
**not** steal frontmost.

## Initial implementation (had a bug)

`companion/src/tray/Tray.swift` `ConfirmController`:

```swift
func show(...) {
  // ...
  NSApp.activate(ignoringOtherApps: true)   // ← STEALS FOREGROUND
  window.center()
  window.makeKeyAndOrderFront(nil)
  window.orderFrontRegardless()
}

private func makeWindow() -> NSWindow? {
  let style: NSWindow.StyleMask = [.titled, .closable]
  let win = NSWindow(contentRect: ..., styleMask: style, ...)
  // ...
}
```

`NSApp.activate(ignoringOtherApps: true)` makes the tray's `.accessory` app
frontmost — exactly the bug class P0a was meant to fix. Verified with a
reproducer (start TextEdit, dispatch `show-confirm` to the tray, query
frontmost via `osascript`) — frontmost flipped from TextEdit to the tray.

## Fix

1. Drop `NSApp.activate(ignoringOtherApps: true)` entirely.
2. Switch window class from `NSWindow` → `NSPanel` with style mask including
   `.nonactivatingPanel`:
   ```swift
   let style: NSWindow.StyleMask = [.titled, .closable, .nonactivatingPanel]
   let panel = NSPanel(contentRect: ..., styleMask: style, ...)
   panel.becomesKeyOnlyIfNeeded = false   // never steal key from target app
   panel.hidesOnDeactivate = false        // survive app deactivation
   ```
3. Keep `window.makeKeyAndOrderFront(nil)` + `window.orderFrontRegardless()` —
   for an `.nonactivatingPanel`, these order the panel front and make it key
   WITHOUT activating the owning app.

## Verification

Before fix: frontmost flipped TextEdit → cmspark-tray on dialog show.
After fix: frontmost stayed TextEdit throughout the dialog's lifetime
(verified with `osascript -e 'tell application "System Events" to name of
first application process whose frontmost is true'` before and during).

End-to-end race wiring (in `server.ts` around line 746–862):

```ts
const sharedConfirmId = randomUUID()
const tray = getTrayInstance()
const trayEligible = !!tray && !winL2NonceChallenge
const trayReq: TrayConfirmRequest | null = trayEligible ? { id: sharedConfirmId, ... } : null
const trayPromise = trayReq && tray
  ? tray.showConfirmDialog(trayReq).then((r) => ({ source: "tray" as const, approved: r.approved }))
  : null

const wsPromise = securityConfirmations.request(send, details, options, sharedConfirmId)

if (!trayPromise) return wsPromise

const winner = await Promise.race([
  wsPromise.then((d) => ({ source: "ws" as const, decision: d })),
  trayPromise.then((r) => ({ source: "tray" as const, approved: r.approved })),
])

if (winner.source === "ws") {
  tray!.cancelConfirm(sharedConfirmId)   // close the panel silently
  return winner.decision
}
// Tray responded first — propagate to manager so WS Side Panel also gets its resolved event.
securityConfirmations.respond(sharedConfirmId, winner.approved)
return await wsPromise
```

- WS wins → tray panel closed silently via `cancel-confirm` IPC.
- Tray wins → privileged `respond()` (bypasses `originWs` check) propagates
  to manager, which then sends `security.confirmation.resolved` to WS; WS
  Side Panel closes.

`SecurityConfirmationManager.request()` now takes an optional 4th param
`preGeneratedId?: string` so WS + tray share the same id; first responder
claims the manager's pending entry, second responder is a no-op.

## Open questions for review

Q1. Is `.nonactivatingPanel` + `becomesKeyOnlyIfNeeded = false` the correct
incantation to guarantee the target app stays frontmost while still letting
the user click Allow / Deny?

Q2. Does clicking an `NSButton` on a non-activating panel reliably fire its
action without the owning app activating? (i.e., after click, is target
app still frontmost?)

Q3. The privileged `securityConfirmations.respond()` bypasses the `originWs`
check. Is this safe given the tray is a single-instance local subprocess
whose stdin pipe is not exposed to any remote peer?

Q4. Promise.race leaves the losing promise pending. WS loser is fine
(manager marks pending as resolved; subsequent WS responses are no-op via
`respondFrom` returning `outcome: "unknown"`). Tray loser is cleared via
`cancelConfirm(id)` → `clearTimeout` + `pendingConfirms.delete` + IPC to
Swift. Any leak risk?

Q5. For the Windows Hello manual-nonce path (`winL2NonceChallenge` set),
tray is deliberately NOT engaged (`trayEligible = !!tray && !winL2NonceChallenge`)
because the tray panel has no nonce input UI. Sound?

Q6. The tray panel has `.closable` style — user can close it via the red
traffic light. `windowWillClose` hook treats this as deny (via `pendingId`
guard). Acceptable? Or should close be a silent cancel like `cancel()`?
