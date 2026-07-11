// Advisory dangerous-API pattern detection for the `evaluate` tool result.
//
// ── AUDIT H9 (2026-07-09): ADVISORY ONLY — DOES NOT GATE ──────────────────
// This module does NOT decide whether `evaluate` runs. It only flags
// statically-matchable risky tokens so they can be surfaced in the tool
// result as a hint. The AUTHORITATIVE gate is the companion-side
// SecurityConfirmationManager (design decision A4②): every `evaluate` forces
// interactive confirmation unless explicitly auto-approved (per-domain
// whitelist or the global `auto_approve_dangerous` kill-switch). C1 WS auth
// rejects unauthenticated peers; the H2 security_token binds approvals.
//
// Why there is no extension-side block: a compromised companion is already
// game-over (it can read config.json, run osascript_eval, forge its own
// approval token), so an extension gate adds nothing there; an authenticated
// WS peer is trusted by design; and if the user enabled auto_approve_dangerous
// an extension hard-block would override their explicit opt-in.
//
// Static-analysis limit (documented, accepted): regex cannot resolve runtime
// dispatch — `window["ev"+"al"](...)`, `(0,eval)(...)`, `globalThis["Function"]`,
// `Reflect.apply(window.eval, ...)`. Those bypass these patterns by design and
// rely on the companion confirmation. Do NOT treat an empty result as "safe":
// it means "no statically-matchable risky token", nothing more. The result
// field is therefore named `risk_pattern_matches`, not `has_dangerous_apis`.

// Patterns kept in sync with companion/src/security.ts (the companion's own
// list drives the confirmation-dialog risk preview; this extension list only
// annotates the tool result).
export const DANGEROUS_API_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Direct API calls
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "localStorage", pattern: /\blocalStorage\b/ },
  { name: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { name: "document.cookie", pattern: /\bdocument\.cookie\b/ },
  { name: "window.open", pattern: /\bwindow\.open\s*\(/ },
  { name: "navigator.sendBeacon", pattern: /\bnavigator\.sendBeacon\s*\(/ },
  { name: "WebSocket", pattern: /\bnew\s+WebSocket\s*\(/ },
  { name: "EventSource", pattern: /\bnew\s+EventSource\s*\(/ },
  { name: "indexedDB", pattern: /\bindexedDB\b/ },
  // Bracket notation bypasses
  { name: "bracket-fetch", pattern: /\[\s*["']fetch["']\s*\]\s*\(/ },
  { name: "bracket-open", pattern: /\[\s*["']open["']\s*\]\s*\(/ },
  { name: "bracket-localStorage", pattern: /\[\s*["']localStorage["']\s*\]/ },
  { name: "bracket-sessionStorage", pattern: /\[\s*["']sessionStorage["']\s*\]/ },
  { name: "bracket-cookie", pattern: /\[\s*["']cookie["']\s*\]/ },
  { name: "bracket-sendBeacon", pattern: /\[\s*["']sendBeacon["']\s*\]\s*\(/ },
  { name: "bracket-indexedDB", pattern: /\[\s*["']indexedDB["']\s*\]/ },
  { name: "bracket-XMLHttpRequest", pattern: /\[\s*["']XMLHttpRequest["']\s*\]/ },
  // Method call / reflection bypasses
  { name: "fetch.call", pattern: /\.call\s*\(.*fetch/ },
  { name: "fetch.apply", pattern: /\.apply\s*\(.*fetch/ },
  { name: "Reflect.apply", pattern: /\bReflect\.apply\s*\(/ },
  { name: "Reflect.construct", pattern: /\bReflect\.construct\s*\(/ },
  { name: "Proxy", pattern: /\bnew\s+Proxy\s*\(/ },
  // Code generation
  { name: "eval", pattern: /\beval\s*\(/ },
  { name: "Function", pattern: /\bnew\s+Function\s*\(/ },
  { name: "setTimeout-string", pattern: /setTimeout\s*\(\s*["']/ },
  { name: "setInterval-string", pattern: /setInterval\s*\(\s*["']/ },
]

/**
 * Detect statically-matchable risky API tokens in evaluated code.
 *
 * ADVISORY ONLY (audit H9): the returned names annotate the `evaluate` tool
 * result as a hint; they do NOT gate execution. The companion-side
 * confirmation is authoritative. An empty result means "no statically-
 * matchable risky token" — NOT "safe" — because regex cannot resolve runtime
 * dispatch (e.g. `window["ev"+"al"](...)`).
 */
export function detectDangerousApis(code: string): string[] {
  const found = new Set<string>()
  for (const { name, pattern } of DANGEROUS_API_PATTERNS) {
    if (pattern.test(code)) found.add(name)
  }
  return Array.from(found)
}
