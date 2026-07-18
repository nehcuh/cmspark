// Origin-bound confirmation channel for coordinate computer-use.
// A1/E5 discipline: EVERY confirmation raised by the computer executor (task
// L2 renewals, budget exhaustion, dialog pauses, danger pauses) MUST be bound
// to the originating WebSocket — a rogue loopback peer must never resolve or
// burn them. The originWs is a REQUIRED property here (type-level enforcement):
// there is no way to build this channel without one.

import type { WebSocket } from "ws"
import type {
  SecurityConfirmationDetails,
  SecurityConfirmationDecision,
  SecurityConfirmationManager,
} from "../security-confirmation"
import type { ComputerConfirmationChannel } from "./executor"

export interface OriginBoundConfirmationDeps {
  send: (data: any) => void
  /** REQUIRED — the socket this confirmation flow belongs to. */
  originWs: WebSocket
  manager: SecurityConfirmationManager
}

export function createOriginBoundConfirmation(deps: OriginBoundConfirmationDeps): ComputerConfirmationChannel {
  const { send, originWs, manager } = deps
  return (details: SecurityConfirmationDetails): Promise<SecurityConfirmationDecision> =>
    manager.request(send, details, { originWs })
}
