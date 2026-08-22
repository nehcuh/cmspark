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

export type L1ForwardResult = {
  success: boolean
  data?: any
  error?: string
  error_code?: typeof BROWSER_UNAVAILABLE
}

export type ForwardL1OrUnavailableOpts = {
  originatingWs: WebSocket
  getAuth: L1ActuatorDeps["getAuth"]
  pickExtensionWs: L1ActuatorDeps["pickExtensionWs"]
  toolCallId: string
  toolName: string
  startedAt: number
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
  forward: (args: { ws: WebSocket }) => Promise<L1ForwardResult>
}

/**
 * L1 (extension CDP) dispatch: never send tool.execute to tray/summoner.
 * Resolve actuator via resolveL1ActuatorWs; if missing, return BROWSER_UNAVAILABLE
 * without calling forward.
 */
export async function forwardL1OrUnavailable(
  opts: ForwardL1OrUnavailableOpts,
): Promise<L1ForwardResult> {
  const resolved = resolveL1ActuatorWs(opts.originatingWs, {
    getAuth: opts.getAuth,
    pickExtensionWs: opts.pickExtensionWs,
  })
  if (!resolved.ok) {
    const result = browserUnavailableResult()
    opts.logToolFinish(opts.toolCallId, opts.toolName, opts.startedAt, result)
    return result
  }
  return opts.forward({ ws: resolved.ws })
}
