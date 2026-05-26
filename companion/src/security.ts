// Security policy — trusted domains, evaluate safety, error classification

import { getConfig } from "./config"

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

/**
 * Detect dangerous APIs in JavaScript code.
 */
export const DANGEROUS_APIS = [
  "fetch(",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "window.open",
  "navigator.sendBeacon",
  "WebSocket",
  "EventSource",
  "indexedDB",
]

export function detectDangerousApis(code: string): string[] {
  return DANGEROUS_APIS.filter(api => code.includes(api))
}

export function checkHighRiskExecution(toolName: string, code: string): { blocked: boolean; dangerousApis: string[]; error?: string } {
  const dangerousApis = detectDangerousApis(code || "")
  if (dangerousApis.length === 0) {
    return { blocked: false, dangerousApis }
  }
  return {
    blocked: true,
    dangerousApis,
    error: `Security Block: ${toolName} contains high-risk APIs (${dangerousApis.join(", ")}). Execution requires user confirmation.`,
  }
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

  // Recoverable (timeout, transient, element not found, permission, wrong page type)
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
    "network error",
    "connection refused",
    "cannot access",
    "chrome-extension://",
    "503",
    "502",
    "429",
  ]
  if (recoverable.some(p => msg.includes(p))) {
    return "recoverable"
  }

  // Default to non-recoverable
  return "non_recoverable"
}
