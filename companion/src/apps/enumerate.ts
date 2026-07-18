// App tab (WP2) — enumeration of add-app candidates via apps-enumerate.ps1.
// Thin wrapper over the argv-only PowerShell infra (runPs/resolveWinScript/
// parsePsJson/rethrowPsError) — no new spawn paths.

import {
  runPs,
  resolveWinScript,
  parsePsJson,
  rethrowPsError,
  type PsRunner,
} from "../host-use/win/powershell"

export interface EnumeratedAppCandidate {
  name: string
  source: "running" | "startapps"
  /** win32 exe path (exactly one of path/aumid is set). */
  path?: string
  /** UWP AUMID (PackageFamilyName!AppId). */
  aumid?: string
}

export const APPS_ENUMERATE_TIMEOUT_MS = 20000

/** Resolver kept as a named export so tests/callers can assert staging picks it up. */
export function resolveAppsEnumerateScript(): string {
  return resolveWinScript("apps-enumerate.ps1")
}

/**
 * Run the enumeration script and validate its single-line JSON contract.
 * Malformed entries are dropped (never trusted blindly — the script output is
 * local but still crosses a process boundary).
 */
export async function enumerateApps(
  runner: PsRunner = runPs,
): Promise<EnumeratedAppCandidate[]> {
  try {
    const stdout = await runner(resolveAppsEnumerateScript(), [], {
      timeoutMs: APPS_ENUMERATE_TIMEOUT_MS,
    })
    const parsed = parsePsJson<{ apps?: unknown }>(stdout, "apps-enumerate")
    if (!Array.isArray(parsed.apps)) {
      throw new Error("apps-enumerate: payload missing apps array")
    }
    const out: EnumeratedAppCandidate[] = []
    for (const raw of parsed.apps) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
      const r = raw as Record<string, unknown>
      if (typeof r.name !== "string" || !r.name) continue
      if (r.source !== "running" && r.source !== "startapps") continue
      const path = typeof r.path === "string" && r.path ? r.path : undefined
      const aumid = typeof r.aumid === "string" && r.aumid ? r.aumid : undefined
      if ((path === undefined) === (aumid === undefined)) continue // XOR, mirrors AppEntry
      out.push({ name: r.name, source: r.source, ...(path ? { path } : {}), ...(aumid ? { aumid } : {}) })
    }
    return out
  } catch (err: any) {
    rethrowPsError(err, "apps.enumerate")
  }
}
