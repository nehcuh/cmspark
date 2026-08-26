/**
 * Wait for an authenticated Chrome extension WS peer on auth.ok (event).
 * Overlay confirm without extension: attachChromeOnly then await this helper.
 * Timeout is an explicit error (never an approval).
 *
 * Pick is injected (lifecycle binds pickAuthenticatedClientWs) so this module
 * stays free of the WS server singleton. Fail path is a single timer.
 */
import { WebSocket } from "ws"

/** Chrome launch + extension auth.ok budget before overlay HITL fail-closes. */
export const DEFAULT_EXTENSION_PEER_WAIT_MS = 15_000

type OverlayAttachFn = () => void

function defaultOverlayAttach(): void {
  // Lazy require: tests stub attach so this must not spawn Chrome at import.
  const { attachChromeOnly } = require("../summoner/client") as typeof import("../summoner/client")
  const { getChromeOpener } = require("../platform") as typeof import("../platform")
  attachChromeOnly(getChromeOpener())
}

let overlayAttach: OverlayAttachFn = defaultOverlayAttach
let overlayPeerWaitMs = DEFAULT_EXTENSION_PEER_WAIT_MS

export function bindOverlayConfirmPeerForTests(opts: {
  attach?: OverlayAttachFn
  waitMs?: number
}): void {
  if (opts.attach) overlayAttach = opts.attach
  if (opts.waitMs != null) overlayPeerWaitMs = opts.waitMs
}

export const EXTENSION_PEER_TIMEOUT_CODE = "EXTENSION_UNAVAILABLE" as const

export type ExtensionPeerTimeoutError = Error & {
  approved: false
  error_code: typeof EXTENSION_PEER_TIMEOUT_CODE
}

type Picker = () => WebSocket | null

type Waiter = {
  resolve: (ws: WebSocket) => void
  reject: (err: ExtensionPeerTimeoutError) => void
  timer: NodeJS.Timeout
}

let pickAuthenticated: Picker = () => null
const waiters = new Set<Waiter>()

export function bindExtensionPeerPicker(pick: Picker): void {
  pickAuthenticated = pick
}

function makeTimeoutError(): ExtensionPeerTimeoutError {
  const err = new Error(
    "EXTENSION_UNAVAILABLE: Chrome extension peer did not authenticate in time",
  ) as ExtensionPeerTimeoutError
  err.name = "ExtensionPeerTimeoutError"
  err.approved = false
  err.error_code = EXTENSION_PEER_TIMEOUT_CODE
  return err
}

/**
 * Overlay/inbound HITL without an extension peer: attachChromeOnly (never
 * sidePanel.open), then wait for auth.ok. Timeout never approved.
 */
export async function ensureExtensionPeerForOverlayConfirm(opts?: {
  existing?: WebSocket | null
  timeoutMs?: number
}): Promise<WebSocket> {
  const existing = opts?.existing ?? null
  if (existing && existing.readyState === WebSocket.OPEN) return existing
  const already = pickAuthenticated()
  if (already) return already
  try {
    overlayAttach()
  } catch {
    throw makeTimeoutError()
  }
  return waitForExtensionPeer({
    timeoutMs: opts?.timeoutMs ?? overlayPeerWaitMs,
  })
}

/**
 * Resolve when an authenticated chrome-extension:// peer is available.
 * Immediate if pick() already succeeds; otherwise subscribe until
 * notifyExtensionPeerAuthenticated (auth.ok path) or timeoutMs.
 *
 * One fail-path timer only. Do not poll pick() on a repeating timer.
 */
export function waitForExtensionPeer(opts: { timeoutMs: number }): Promise<WebSocket> {
  const existing = pickAuthenticated()
  if (existing) return Promise.resolve(existing)

  const timeoutMs = Math.max(0, opts.timeoutMs)
  return new Promise<WebSocket>((resolve, reject) => {
    const waiter: Waiter = {
      resolve: (ws) => {
        clearTimeout(waiter.timer)
        waiters.delete(waiter)
        resolve(ws)
      },
      reject: (err) => {
        clearTimeout(waiter.timer)
        waiters.delete(waiter)
        reject(err)
      },
      timer: setTimeout(() => {
        waiters.delete(waiter)
        reject(makeTimeoutError())
      }, timeoutMs),
    }
    waiter.timer.unref?.()
    waiters.add(waiter)
  })
}

/**
 * Fire from extension auth.ok AFTER st.authenticated = true, only when
 * pickAuthenticatedClientWs() would succeed (chrome-extension://).
 */
export function notifyExtensionPeerAuthenticated(_ws?: WebSocket): void {
  const picked = pickAuthenticated()
  if (!picked) return
  const pending = [...waiters]
  waiters.clear()
  for (const w of pending) {
    w.resolve(picked)
  }
}

/** Drop in-flight waiters between tests (clears the fail-path timer). */
export function resetExtensionPeerWaitersForTests(): void {
  const pending = [...waiters]
  waiters.clear()
  pickAuthenticated = () => null
  overlayAttach = defaultOverlayAttach
  overlayPeerWaitMs = DEFAULT_EXTENSION_PEER_WAIT_MS
  for (const w of pending) {
    clearTimeout(w.timer)
  }
}
