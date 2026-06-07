// Risk scoring engine — calculates a 0-10 risk score for tool execution based on
// dangerous API usage, code complexity, domain trust, and historical patterns.

import { createHash } from "crypto"
import { isTrustedDomain } from "../security"

/** Risk score breakdown by category. */
export interface RiskScore {
  /** Total risk score (0-10, integer). */
  total: number
  /** Per-category breakdown. */
  breakdown: {
    /** Dangerous API weight (0-4). */
    apiRisk: number
    /** Code complexity (0-2). */
    codeComplexity: number
    /** Target domain trust level (0-2). */
    domainTrust: number
    /** Historical behavior pattern (0-2). */
    historyPattern: number
  }
  /** Names of patterns that matched. */
  matchedPatterns: string[]
  /** Human-readable reason for the score. */
  reason: string
}

/** Weight mapping for dangerous APIs (higher = more dangerous). */
export const API_WEIGHTS: Record<string, number> = {
  eval: 4,
  "new Function": 4,
  "setTimeout(string)": 4,
  "setInterval(string)": 4,
  Function: 3,
  "fetch": 3,
  XMLHttpRequest: 3,
  "Reflect.apply": 3,
  "Reflect.construct": 3,
  Proxy: 3,
  "document.cookie": 2,
  "localStorage.setItem": 2,
  localStorage: 2,
  sessionStorage: 2,
  "window.open": 2,
  "navigator.sendBeacon": 2,
  WebSocket: 2,
  EventSource: 2,
  indexedDB: 2,
  "bracket-fetch": 3,
  "bracket-open": 2,
  "bracket-localStorage": 2,
  "bracket-sessionStorage": 2,
  "bracket-cookie": 2,
  "bracket-sendBeacon": 2,
  "bracket-indexedDB": 2,
  "bracket-XMLHttpRequest": 3,
  "fetch.call": 3,
  "fetch.apply": 3,
}

/** Extended dangerous API patterns (48 total). */
export const DANGEROUS_API_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Direct API calls (1-16)
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
  { name: "eval", pattern: /\beval\s*\(/ },
  { name: "Function", pattern: /\bnew\s+Function\s*\(/ },
  { name: "setTimeout(string)", pattern: /setTimeout\s*\(\s*["']/ },
  { name: "setInterval(string)", pattern: /setInterval\s*\(\s*["']/ },
  { name: "Reflect.apply", pattern: /\bReflect\.apply\s*\(/ },
  { name: "Reflect.construct", pattern: /\bReflect\.construct\s*\(/ },
  // Obfuscation / bypass patterns (17-32)
  { name: "bracket-fetch", pattern: /\[\s*["']fetch["']\s*\]\s*\(/ },
  { name: "bracket-open", pattern: /\[\s*["']open["']\s*\]\s*\(/ },
  { name: "bracket-localStorage", pattern: /\[\s*["']localStorage["']\s*\]/ },
  { name: "bracket-sessionStorage", pattern: /\[\s*["']sessionStorage["']\s*\]/ },
  { name: "bracket-cookie", pattern: /\[\s*["']cookie["']\s*\]/ },
  { name: "bracket-sendBeacon", pattern: /\[\s*["']sendBeacon["']\s*\]\s*\(/ },
  { name: "bracket-indexedDB", pattern: /\[\s*["']indexedDB["']\s*\]/ },
  { name: "bracket-XMLHttpRequest", pattern: /\[\s*["']XMLHttpRequest["']\s*\]/ },
  { name: "fetch.call", pattern: /\.call\s*\(.*fetch/ },
  { name: "fetch.apply", pattern: /\.apply\s*\(.*fetch/ },
  { name: "Proxy", pattern: /\bnew\s+Proxy\s*\(/ },
  { name: "constructor-call", pattern: /\["constructor"\]\s*\(/ },
  { name: "__proto__", pattern: /\b__proto__\b/ },
  { name: "prototype-pollution", pattern: /prototype\s*\[\s*["'][^"']+["']\s*\]\s*=/ },
  { name: "Object.assign", pattern: /\bObject\.assign\s*\(/ },
  { name: "defineProperty", pattern: /\bObject\.defineProperty\s*\(/ },
  // Network / data exfiltration (33-40)
  { name: "navigator.clipboard", pattern: /\bnavigator\.clipboard\b/ },
  { name: "postMessage", pattern: /\bpostMessage\s*\(/ },
  { name: "openDatabase", pattern: /\bopenDatabase\s*\(/ },
  { name: "requestFileSystem", pattern: /\brequestFileSystem\s*\(/ },
  { name: "webkitRequestFileSystem", pattern: /\bwebkitRequestFileSystem\s*\(/ },
  { name: "RTCPeerConnection", pattern: /\bnew\s+RTCPeerConnection\s*\(/ },
  { name: "Worker", pattern: /\bnew\s+Worker\s*\(/ },
  { name: "SharedWorker", pattern: /\bnew\s+SharedWorker\s*\(/ },
  // DOM manipulation / injection (41-48)
  { name: "innerHTML", pattern: /\.innerHTML\s*=/ },
  { name: "outerHTML", pattern: /\.outerHTML\s*=/ },
  { name: "insertAdjacentHTML", pattern: /\.insertAdjacentHTML\s*\(/ },
  { name: "document.write", pattern: /\bdocument\.write\s*\(/ },
  { name: "document.writeln", pattern: /\bdocument\.writeln\s*\(/ },
  { name: "createElement-script", pattern: /createElement\s*\(\s*["']script["']\s*\)/ },
  { name: "appendChild", pattern: /\.appendChild\s*\(/ },
  { name: "removeChild", pattern: /\.removeChild\s*\(/ },
]

/** Detect dangerous APIs in code. */
export function detectDangerousApis(code: string): string[] {
  return DANGEROUS_API_PATTERNS
    .filter(({ pattern }) => pattern.test(code))
    .map(({ name }) => name)
}

/** Cache for risk scores keyed by code hash. */
export const riskScoreCache = new Map<string, { score: RiskScore; timestamp: number }>()

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Generate a hash for the given code. */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 16)
}

/**
 * Calculate the risk score for a tool execution.
 *
 * @param toolName - The tool being executed (e.g. "evaluate", "osascript_eval").
 * @param code - The code/expression to evaluate.
 * @param context - Optional context for domain trust and history.
 * @returns A structured RiskScore.
 */
export function calculateRiskScore(
  toolName: string,
  code: string,
  context: { trustedDomains?: string[]; threadId?: string; history?: any[] } = {},
): RiskScore {
  const codeHash = hashCode(`${toolName}:${code}`)
  const cached = riskScoreCache.get(codeHash)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.score
  }

  const matchedPatterns = detectDangerousApis(code || "")

  // 1. API risk (0-4)
  let apiRisk = 0
  for (const pattern of matchedPatterns) {
    const weight = API_WEIGHTS[pattern] || 1
    apiRisk = Math.max(apiRisk, weight)
  }
  apiRisk = Math.min(apiRisk, 4)

  // 2. Code complexity (0-2)
  let codeComplexity = 0
  const lines = (code || "").split("\n").length
  const length = (code || "").length
  if (lines > 20) codeComplexity += 1
  if (length > 1000) codeComplexity += 1
  codeComplexity = Math.min(codeComplexity, 2)

  // 3. Domain trust (0-2)
  let domainTrust = 0
  // Extract potential URLs from code
  const urlMatches = (code || "").match(/https?:\/\/[^\s"'`]+/g) || []
  if (urlMatches.length === 0) {
    domainTrust = 1 // Neutral when no external URLs
  } else {
    const trustedCount = urlMatches.filter((url) => {
      try {
        const hostname = new URL(url).hostname
        return isTrustedDomain(hostname)
      } catch {
        return false
      }
    }).length
    if (trustedCount === urlMatches.length) {
      domainTrust = 0 // All trusted
    } else if (trustedCount > 0) {
      domainTrust = 1 // Mixed
    } else {
      domainTrust = 2 // All untrusted
    }
  }

  // 4. History pattern (0-2)
  let historyPattern = 0
  const history = context.history || []
  if (history.length > 0) {
    const recentErrors = history.filter((h: any) => h.error && h.error.includes("Security Block")).length
    const recentHighRisk = history.filter((h: any) => {
      const apis = h.dangerousApis || []
      return apis.length > 0
    }).length
    if (recentErrors > 2) historyPattern += 1
    if (recentHighRisk > 3) historyPattern += 1
  }
  historyPattern = Math.min(historyPattern, 2)

  const total = Math.min(apiRisk + codeComplexity + domainTrust + historyPattern, 10)

  const reason = buildReason(toolName, matchedPatterns, { apiRisk, codeComplexity, domainTrust, historyPattern })

  const score: RiskScore = {
    total,
    breakdown: { apiRisk, codeComplexity, domainTrust, historyPattern },
    matchedPatterns,
    reason,
  }

  riskScoreCache.set(codeHash, { score, timestamp: Date.now() })
  return score
}

function buildReason(
  toolName: string,
  matchedPatterns: string[],
  breakdown: { apiRisk: number; codeComplexity: number; domainTrust: number; historyPattern: number },
): string {
  const parts: string[] = []
  if (matchedPatterns.length > 0) {
    parts.push(`detected ${matchedPatterns.length} dangerous API(s): ${matchedPatterns.join(", ")}`)
  }
  if (breakdown.codeComplexity > 0) {
    parts.push(`code complexity ${breakdown.codeComplexity}/2`)
  }
  if (breakdown.domainTrust > 0) {
    parts.push(`domain trust risk ${breakdown.domainTrust}/2`)
  }
  if (breakdown.historyPattern > 0) {
    parts.push(`history pattern risk ${breakdown.historyPattern}/2`)
  }
  if (parts.length === 0) {
    return `${toolName}: no risk patterns detected`
  }
  return `${toolName}: ${parts.join("; ")}`
}

/** Privilege mode for execution decisions. */
export type PrivilegeMode = "readonly" | "standard" | "advanced"

/**
 * Determine the execution decision based on risk score and privilege mode.
 *
 * @param score - The calculated risk score.
 * @param privilegeMode - Current privilege level.
 * @param threadContext - Thread-specific confirmation state.
 * @returns Action recommendation and reason.
 */
export function getRiskDecision(
  score: RiskScore,
  privilegeMode: PrivilegeMode,
  threadContext: { confirmedHashes?: Set<string>; confirmedToolNames?: Set<string> } = {},
): { action: "auto" | "confirm" | "block"; reason: string } {
  const { total, matchedPatterns } = score
  const confirmedHashes = threadContext.confirmedHashes || new Set()
  const confirmedToolNames = threadContext.confirmedToolNames || new Set()

  // readonly mode: block anything with any risk
  if (privilegeMode === "readonly") {
    if (total === 0) {
      return { action: "auto", reason: "readonly mode: no risk detected" }
    }
    return { action: "block", reason: `readonly mode: risk score ${total} exceeds threshold (0)` }
  }

  // advanced mode: auto-execute if previously confirmed
  if (privilegeMode === "advanced") {
    if (total <= 3) {
      return { action: "auto", reason: `advanced mode: low risk (${total}/10)` }
    }
    if (total >= 9) {
      return { action: "block", reason: `advanced mode: critical risk (${total}/10) — execution blocked` }
    }
    return { action: "confirm", reason: `advanced mode: moderate risk (${total}/10) — confirmation required` }
  }

  // standard mode (default)
  if (total === 0) {
    return { action: "auto", reason: "standard mode: no risk detected" }
  }
  if (total <= 2) {
    return { action: "auto", reason: `standard mode: low risk (${total}/10)` }
  }
  if (total >= 8) {
    return { action: "block", reason: `standard mode: high risk (${total}/10) — execution blocked` }
  }
  return { action: "confirm", reason: `standard mode: moderate risk (${total}/10) — confirmation required` }
}
