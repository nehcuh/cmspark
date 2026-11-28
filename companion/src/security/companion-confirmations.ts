import { SecurityConfirmationManager } from "../security-confirmation"

/** Pending confirmations shared by Companion connections and the native UI. */
export const securityConfirmations = new SecurityConfirmationManager()

securityConfirmations.setOnTerminal(({ confirmationId, reason }) => {
  try {
    // Resolve the running tray at completion. It may have restarted since the request.
    const { getTrayInstance } = require("../menu-bar-agent") as typeof import("../menu-bar-agent")
    const tray = getTrayInstance()
    if (!tray) return
    tray.cancelConfirm(confirmationId)
    tray.cancelHudConfirm?.(confirmationId)
    tray.notifyHudConfirmResolved?.(confirmationId, reason)
  } catch {
    /* UI cleanup must not interrupt the terminal decision. */
  }
})
