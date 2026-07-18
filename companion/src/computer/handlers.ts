// computer.* WS handlers (A10). The global coordinate switch flips only
// through the biometric gate (same D2 pattern as the App tab add-auto flow);
// disabling is always free (fail-closed direction).

import { getConfig, setComputerCoordinateEnabled } from "../config"
import { logger } from "../logger"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"
import { requireAppsBiometric } from "../apps/biometric-gate"

export interface ComputerHandlerContext {
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
}

export interface ComputerHandlerDeps {
  gate?: typeof requireAppsBiometric
}

function computerError(error: string, extra?: Record<string, unknown>) {
  return { type: "error", family: "computer" as const, error, ...extra }
}

function statePayload() {
  const cfg = getConfig()
  return {
    type: "computer.state",
    coordinateEnabled: cfg.computer?.coordinateEnabled === true,
  }
}

export async function handleComputerMessage(
  msg: any,
  ctx: ComputerHandlerContext = {},
  deps: ComputerHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg

  switch (type) {
    case "computer.get_state":
      return statePayload()

    case "computer.set_enabled": {
      if (typeof rest.enabled !== "boolean") {
        return computerError("computer.set_enabled requires boolean enabled", { code: "INVALID_ENABLED" })
      }
      // Disabling is always free — fail-closed direction.
      if (rest.enabled === false) {
        setComputerCoordinateEnabled(false)
        logger.info("computer.coordinate_disabled", {})
        ctx.broadcast?.(statePayload())
        return statePayload()
      }
      // Enabling = persistent capability grant -> biometric gate (A10.1).
      if (!ctx.requestConfirmation) {
        return computerError("computer.set_enabled(true) requires an interactive confirmation channel", {
          code: "NO_CONFIRMATION_CHANNEL",
        })
      }
      const gate = deps.gate ?? requireAppsBiometric
      const outcome = await gate({
        action: "computer.set_enabled",
        reason: "Enable coordinate computer-use (input injection into whitelisted app windows)",
        requestConfirmation: ctx.requestConfirmation,
      })
      if (!outcome.approved) {
        logger.warn("computer.coordinate_enable_denied", { reason: outcome.reason })
        return computerError(
          `enabling coordinate computer-use ${outcome.reason === "cancelled" ? "cancelled by user" : `denied (${outcome.reason})`} — stays OFF`,
          { code: "BIOMETRIC_DENIED", reason: outcome.reason },
        )
      }
      setComputerCoordinateEnabled(true)
      logger.info("computer.coordinate_enabled", { method: outcome.method })
      ctx.broadcast?.(statePayload())
      return statePayload()
    }

    default:
      return computerError(`Unknown computer message type: ${type}`)
  }
}
