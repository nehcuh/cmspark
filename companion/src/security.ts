// Security policy — trusted domains, evaluate safety, error classification

import { getConfig } from "./config"
import type { RiskScore } from "./security/risk-engine"

/**
 * Check if a domain is in the trusted domain list.
 * Supports wildcards: *.company.com matches hr.company.com, finance.company.com
 */
export function isTrustedDomain(domain: string): boolean {
  const config = getConfig()
  const trusted = config.trusted_domains

  if (trusted.length === 0) return false

  return trusted.some(pattern => {
    if (pattern === "*") return true
    if (pattern === domain) return true
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1) // ".company.com"
      return domain.endsWith(suffix) || domain === pattern.slice(2)
    }
    return false
  })
}

/** Weight mapping for dangerous APIs (higher = more dangerous). */
export const API_WEIGHTS: Record<string, number> = {
  eval: 4,
  "new Function": 4,
  "setTimeout(string)": 4,
  "setInterval(string)": 4,
  Function: 3,
  fetch: 3,
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
  constructor: 3,
  "__proto__": 3,
  "prototype-pollution": 3,
  "Object.assign": 2,
  defineProperty: 2,
  "navigator.clipboard": 2,
  postMessage: 2,
  openDatabase: 2,
  requestFileSystem: 2,
  webkitRequestFileSystem: 2,
  RTCPeerConnection: 2,
  Worker: 2,
  SharedWorker: 2,
  innerHTML: 3,
  outerHTML: 3,
  insertAdjacentHTML: 3,
  "document.write": 3,
  "document.writeln": 3,
  "createElement-script": 3,
  appendChild: 1,
  removeChild: 1,
}

/**
 * Detect dangerous APIs in JavaScript code using regex with word boundaries.
 * Avoids false positives like "prefetch" matching "fetch" or "window.openModal" matching "window.open".
 */
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
  { name: "constructor", pattern: /\["constructor"\]\s*\(/ },
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

export function detectDangerousApis(code: string): string[] {
  return DANGEROUS_API_PATTERNS
    .filter(({ pattern }) => pattern.test(code))
    .map(({ name }) => name)
}

/** Legacy check result for backward compatibility. */
export interface HighRiskCheckResult {
  blocked: boolean
  dangerousApis: string[]
  error?: string
  riskScore?: RiskScore
}

/**
 * Check if execution is high-risk and return detailed risk information.
 *
 * @param toolName - The tool being executed.
 * @param code - The code/expression to evaluate.
 * @returns Detailed check result including risk score.
 */
export function checkHighRiskExecution(toolName: string, code: string): HighRiskCheckResult {
  const dangerousApis = detectDangerousApis(code || "")
  if (dangerousApis.length === 0) {
    return { blocked: false, dangerousApis }
  }

  // Build a simple risk score for backward compatibility
  let apiRisk = 0
  for (const pattern of dangerousApis) {
    const weight = API_WEIGHTS[pattern] || 1
    apiRisk = Math.max(apiRisk, weight)
  }

  const riskScore: RiskScore = {
    total: Math.min(apiRisk, 10),
    breakdown: {
      apiRisk: Math.min(apiRisk, 4),
      codeComplexity: 0,
      domainTrust: 0,
      historyPattern: 0,
    },
    matchedPatterns: dangerousApis,
    reason: `${toolName}: detected ${dangerousApis.length} dangerous API(s): ${dangerousApis.join(", ")}`,
  }

  return {
    blocked: true,
    dangerousApis,
    error: `Security Block: ${toolName} contains high-risk APIs (${dangerousApis.join(", ")}). Execution requires user confirmation.`,
    riskScore,
  }
}

/** Backward-compatible isDangerous check. */
export function isDangerous(code: string): boolean {
  return detectDangerousApis(code).length > 0
}

export function highRiskExecutionDeniedError(
  toolName: string,
  dangerousApis: string[],
  reason: "denied" | "timeout" | "disconnect" | "unavailable",
): string {
  const suffix = reason === "denied"
    ? "User denied execution."
    : reason === "timeout"
      ? "User confirmation timed out."
      : reason === "disconnect"
        ? "WebSocket disconnected before confirmation."
        : "User confirmation is unavailable."
  return `Security Block: ${toolName} contains high-risk APIs (${dangerousApis.join(", ")}). ${suffix}`
}

export type ErrorLevel = "recoverable" | "non_recoverable" | "security"

/**
 * Classify an error to determine the response strategy.
 */
export function classifyError(errorMessage: string, context?: { toolName?: string; domain?: string }): ErrorLevel {
  const msg = errorMessage.toLowerCase()

  if (msg.includes("security block")) {
    return "security"
  }

  // Security: untrusted domain access
  if (context?.domain && !isTrustedDomain(context.domain)) {
    if (msg.includes("cookie") || context.toolName?.includes("cookie")) {
      return "security"
    }
  }

  // Security: blocked by user
  if (msg.includes("blocked by user") || msg.includes("user rejected") || msg.includes("user denied")) {
    return "security"
  }

  // Non-recoverable — truly fatal errors
  const nonRecoverable = [
    "permission denied",
    "permission not granted",
    "not in trusted domains",
    "cookie domain mismatch",
    "chrome.permission",
  ]
  if (nonRecoverable.some(p => msg.includes(p))) {
    return "non_recoverable"
  }

  // Recoverable (timeout, transient, element not found, permission, wrong page type, bad tab id, platform mismatch)
  const recoverable = [
    "timeout",
    "timed out",
    "econnrefused",
    "econnreset",
    "enotfound",
    "selector not found",
    "element not found",
    "element not visible",
    "not found",
    "no tab with id",
    "no tab with given id",
    "network error",
    "connection refused",
    "cannot access",
    "script injection failed",
    "script evaluation failed",
    "dom fallback failed",
    "chrome-extension://",
    "503",
    "502",
    "429",
    "macos-only",
    "platform not supported",
    "not supported on",
    "unknown tool",
  ]
  if (recoverable.some(p => msg.includes(p))) {
    return "recoverable"
  }

  // Default to non-recoverable
  return "non_recoverable"
}
