/**
 * #259 — engine chain resolution for the Windows SAPI fallback.
 * Spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md §3.1
 *
 * Chain (Windows): local (whisper ready) → browser (autoFallbackToBrowser)
 * → system (browser failed network/service-not-allowed + win32). Every hop
 * is visible; nothing silently degrades.
 *
 * This module is PURE so the state machine is unit-testable. The existing
 * local→browser hop stays in resolveLocalFallbackActive (useVoiceInput) —
 * this module only answers the system questions around it:
 *   1. resolveSystemEngineSelection — what does configured:"system" mean here?
 *   2. shouldEscalateBrowserToSystem — is a browser error eligible for the
 *      third hop?
 */

export type ChainPlatform = "win32" | "other"

export type ChainEngine = "local" | "browser" | "system"

export interface SystemEngineSelection {
  engine: ChainEngine
  /** Machine-readable why (UI shows honest copy from error-map). */
  reason?:
    | "system_not_win32"
    | "system_unavailable"
    | "system_selected"
    | "system_unselected"
}

export interface SystemEngineSelectionInput {
  platform: ChainPlatform
  configured: "browser" | "local" | "system"
  /** voice.system.state mirror: win32 && helper verified && System.Speech ok. */
  systemAvailable: boolean
}

/**
 * Configured "system" resolves to the system engine ONLY on win32 with the
 * helper probe green; everywhere else it fail-closes to browser (spec §3.1
 * non-win32 fail-closed; settings never offers the option off Windows, this
 * covers stale configs).
 */
export function resolveSystemEngineSelection(
  input: SystemEngineSelectionInput,
): SystemEngineSelection {
  if (input.configured !== "system") {
    return { engine: input.configured, reason: "system_unselected" }
  }
  if (input.platform !== "win32") {
    return { engine: "browser", reason: "system_not_win32" }
  }
  if (!input.systemAvailable) {
    return { engine: "browser", reason: "system_unavailable" }
  }
  return { engine: "system", reason: "system_selected" }
}

/** Browser adapter error codes eligible for the third hop (spec §2/§3.1). */
export function isBrowserFatalNetworkError(code: string): boolean {
  const c = (code || "").toLowerCase()
  return c === "network" || c === "service-not-allowed"
}

export interface EscalateInput {
  platform: ChainPlatform
  /** Raw error code from the browser adapter onError. */
  browserErrorCode: string
  systemAvailable: boolean
}

/**
 * Third hop: browser failed with a network-class error (Google speech
 * unreachable — the exact scenario #259 exists for) on win32 with the system
 * probe green → escalate to the system engine for this session.
 */
export function shouldEscalateBrowserToSystem(input: EscalateInput): boolean {
  return (
    input.platform === "win32" &&
    input.systemAvailable &&
    isBrowserFatalNetworkError(input.browserErrorCode)
  )
}

/** Panel-side platform detection (Chrome UAData platform; "Win32" on Windows). */
export function detectChainPlatform(): ChainPlatform {
  try {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string }
      platform?: string
    }
    const p = (nav.userAgentData?.platform || nav.platform || "").toLowerCase()
    return p.includes("win") ? "win32" : "other"
  } catch {
    return "other"
  }
}
