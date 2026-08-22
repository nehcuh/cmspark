import type { WebSocket } from "ws"

export const BROWSER_UNAVAILABLE = "BROWSER_UNAVAILABLE" as const

export function browserUnavailableResult(): {
  success: false
  error: string
  error_code: typeof BROWSER_UNAVAILABLE
} {
  return {
    success: false,
    error_code: BROWSER_UNAVAILABLE,
    error: "BROWSER_UNAVAILABLE: Chrome extension peer missing",
  }
}

export type L1ActuatorDeps = {
  getAuth: (ws: WebSocket) => { origin?: string; authenticated?: boolean } | undefined
  pickExtensionWs: () => WebSocket | null
}

export function resolveL1ActuatorWs(
  originatingWs: WebSocket,
  deps: L1ActuatorDeps,
): { ok: true; ws: WebSocket } | { ok: false; error_code: typeof BROWSER_UNAVAILABLE } {
  const origin = deps.getAuth(originatingWs)?.origin || ""
  if (/^chrome-extension:\/\//i.test(origin)) {
    return { ok: true, ws: originatingWs }
  }
  const ext = deps.pickExtensionWs()
  if (!ext) return { ok: false, error_code: BROWSER_UNAVAILABLE }
  return { ok: true, ws: ext }
}
