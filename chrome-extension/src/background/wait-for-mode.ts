/**
 * wait_for condition resolver (pure).
 *
 * Thread 1snvlv: GLM called wait_for({tabId}) after create_tab returned empty
 * url/title. Catalog only requires tabId; runtime used to throw
 * "selector or network_idle is required" (non_recoverable → chat ⚠️).
 * TabId-only / timeout-only defaults to network_idle.
 */

/** Must stay under companion TOOL_EXECUTION_TIMEOUT_MS (15s) including settle. */
export const DEFAULT_WAIT_TIMEOUT_MS = 12_000
export const DEFAULT_SETTLE_MS = 2_000
export const MAX_SETTLE_MS = 5_000

export type WaitForMode =
  | { kind: "selector"; selector: string; expectVisible: boolean }
  | { kind: "network_idle"; timeoutMs: number; settleMs: number }
  | { kind: "invalid"; error: string }

function positiveMs(v: unknown, fallback: number, cap?: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return fallback
  return cap != null ? Math.min(v, cap) : v
}

function nonNegativeMs(v: unknown, fallback: number, cap?: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fallback
  return cap != null ? Math.min(v, cap) : v
}

export function resolveWaitForMode(params: Record<string, unknown>): WaitForMode {
  const selector = typeof params.selector === "string" ? params.selector.trim() : ""
  if (selector) {
    return {
      kind: "selector",
      selector,
      expectVisible: params.state !== "hidden",
    }
  }
  // Explicit false without a selector is the only remaining invalid shape.
  if (params.network_idle === false) {
    return { kind: "invalid", error: "selector or network_idle is required" }
  }
  return {
    kind: "network_idle",
    timeoutMs: positiveMs(params.timeout, DEFAULT_WAIT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS),
    settleMs: nonNegativeMs(params.settle_ms, DEFAULT_SETTLE_MS, MAX_SETTLE_MS),
  }
}
