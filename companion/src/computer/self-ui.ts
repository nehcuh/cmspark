// Companion self-UI foreground detection (side panel / tray).
//
// Product model: the user authorizes computer-use in the Chrome side panel.
// That makes the browser frontmost — which is EXPECTED, not a foreign takeover.
// The executor must silently recover (re-raise target, skip re-L2) instead of
// asking "前台被 Chrome 接管" every step (thread 3ffkgl / product paradox).
//
// Identity of the frontmost process differs by platform:
//   Windows: exe path  →  …/chrome.exe   → exeBasename → "chrome"
//   macOS:   bundle id →  com.google.Chrome
//
// Matching only exeBasename() on macOS is wrong: exeBasename("com.google.Chrome")
// returns "com" (first dot), so chrome never matches the allow-list and every
// side-panel click looks like a hostile foreground yield.

import { exeBasename } from "../apps/guards"

/** Known macOS browser / agent bundle ids that host CMspark UI. */
const MAC_COMPANION_BUNDLE_IDS = [
  "com.google.chrome",
  "com.google.chrome.beta",
  "com.google.chrome.canary",
  "com.google.chrome.dev",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.beta",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "company.thebrowser.browser", // Arc
  "com.brave.browser",
  "com.operasoftware.opera",
]

/**
 * True when `fgOwner` is CMspark's own UI host (browser side panel or agent).
 *
 * @param fgOwner  Windows: full exe path or process name. macOS: bundle id
 *                 (WindowInfo.exePath is set to bundleId on Darwin adapters).
 * @param basenames  Config allow-list (lowercased basenames, no extension),
 *                   e.g. ["chrome","msedge","cmspark-agent"].
 */
export function isCompanionUiOwner(
  fgOwner: string | null | undefined,
  basenames: readonly string[],
): boolean {
  if (!fgOwner) return false
  const allow = new Set(
    basenames.map((b) => String(b || "").toLowerCase()).filter((b) => b.length > 0),
  )
  // Empty allow-list = operator disabled self-UI recovery (fail closed to re-L2).
  if (allow.size === 0) return false
  const raw = String(fgOwner).toLowerCase().replace(/\\/g, "/")
  const base = exeBasename(fgOwner)
  // S23: overlay/tray/host process is gated by window-rect hit-test, never silent FG continue.
  if (isDeniedCompanionUiProcess(raw, base)) {
    return false
  }

  // Exact allow-list hit (path basename or full string).
  if (allow.has(base) || allow.has(raw)) return true

  // macOS / reverse-DNS bundle id: last segment often matches basename
  // (com.google.chrome → "chrome"; com.brave.browser → "browser" — weaker).
  if (raw.includes(".")) {
    const last = raw.split(".").pop() || ""
    if (last && allow.has(last)) return true
    if (MAC_COMPANION_BUNDLE_IDS.some((id) => raw === id || raw.startsWith(`${id}.`))) {
      return true
    }
    // com.google.chrome* when allow-list has "chrome"
    if (allow.has("chrome") && (raw.includes("google.chrome") || raw.includes(".chrome"))) {
      return true
    }
    if (allow.has("msedge") && raw.includes("edgemac")) return true
    if (allow.has("firefox") && raw.includes("firefox")) return true
    if (allow.has("brave") && raw.includes("brave")) return true
    if (allow.has("arc") && raw.includes("thebrowser")) return true
    if (allow.has("opera") && raw.includes("opera")) return true
  }

  // Path-shaped: .../Google Chrome.app/... or .../chrome.exe
  for (const b of allow) {
    if (b.length < 3) continue
    if (raw.includes(`/${b}.app`) || raw.includes(`/${b}.exe`) || raw.endsWith(`/${b}`)) {
      return true
    }
  }

  return false
}

function isDeniedCompanionUiProcess(raw: string, base: string): boolean {
  if (
    base === "cmspark-tray" ||
    raw === "cmspark-tray" ||
    raw.endsWith("/cmspark-tray") ||
    raw.endsWith("/cmspark-tray.exe")
  ) {
    return true
  }
  if (raw === "com.cmspark.agent" || raw.startsWith("com.cmspark.agent.")) return true
  if (raw === "com.cmspark.host" || raw.startsWith("com.cmspark.host.")) return true
  if (raw === "com.cmspark.tray" || raw.startsWith("com.cmspark.tray.")) return true
  return false
}
