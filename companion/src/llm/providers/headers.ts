/**
 * LLM request header policy (Anthropic protocol P0 / L7).
 *
 * - Clean default identity: User-Agent: cmspark-companion/<version>
 * - Optional claude_code_compat profile (UA + x-app) only when protocol=anthropic
 *   and the target host is NOT a first-party Anthropic host
 * - L7 union deny: first-party + (profile ≠ none OR extra_headers spoof/override)
 *   → hard refuse (throw), never silent warn
 *
 * Values of sensitive headers are never logged by this module (callers must only
 * log header_names[] + profile + base_host).
 */

import * as fs from "fs"
import * as path from "path"
import type {
  LlmAuthStyle,
  LlmClientHeaderProfile,
  LlmProtocol,
} from "../../config"

/** Default pin when config omits claude_code_compat_version. */
export const DEFAULT_CLAUDE_CODE_COMPAT_VERSION = "2.1.220"

/** Default Anthropic-Version header value. */
export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01"

/** Hop-by-hop / forbidden request header names (case-insensitive). */
const FORBIDDEN_EXTRA_HEADER_NAMES = new Set([
  "host",
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "content-length",
  "content-type", // body ownership — not free-form
  "x-api-key", // auth path only
])

/** Spoof-class / identity keys that extra_headers must not override on first-party. */
const SPOOF_CLASS_HEADER_NAMES = new Set([
  "user-agent",
  "x-app",
  "anthropic-beta",
])

/**
 * Resolve companion package version for clean User-Agent.
 * Best-effort read of package.json; falls back to "0.0.0".
 */
export function getCompanionVersion(): string {
  try {
    // dist/llm/providers → dist → package root; src/llm/providers → src → package root
    const candidates = [
      path.join(__dirname, "..", "..", "..", "package.json"),
      path.join(__dirname, "..", "..", "package.json"),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, "utf-8")) as { version?: string }
        if (typeof pkg.version === "string" && pkg.version.length > 0) {
          return pkg.version
        }
      }
    }
  } catch {
    /* fall through */
  }
  return "0.0.0"
}

/** Clean identity User-Agent for all protocols when profile=none. */
export function cleanCompanionUserAgent(version?: string): string {
  return `cmspark-companion/${version ?? getCompanionVersion()}`
}

/**
 * First-party Anthropic hosts (L7 denylist).
 *
 * Match rules (M2):
 * - exact: api.anthropic.com, claude.ai, anthropic.com
 * - suffix: ends with **`.anthropic.com`** or **`.claude.ai`** (leading-dot semantics)
 *
 * NEVER use bare `endsWith("anthropic.com")` — that false-positives `evilanthropic.com`.
 */
export function isAnthropicFirstPartyHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== "string") return false
  // Strip port if present (e.g. "api.anthropic.com:443")
  // Strip trailing FQDN dot (DNS absolute name): api.anthropic.com. ≡ api.anthropic.com
  const host = hostname.toLowerCase().split(":")[0].trim().replace(/\.$/, "")
  if (!host) return false

  if (host === "api.anthropic.com" || host === "anthropic.com") return true
  if (host === "claude.ai") return true
  if (host.endsWith(".anthropic.com")) return true
  if (host.endsWith(".claude.ai")) return true
  return false
}

/**
 * Extract hostname from a base URL string. Returns empty string if unparseable.
 * Normalizes trailing FQDN dots (api.anthropic.com. → api.anthropic.com) so L7
 * first-party checks cannot be bypassed via absolute DNS spelling.
 */
export function hostnameFromBaseUrl(baseUrl: string): string {
  if (!baseUrl || typeof baseUrl !== "string") return ""
  try {
    // Ensure absolute URL for URL parser
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)
      ? baseUrl
      : `https://${baseUrl}`
    // URL.hostname may preserve a trailing FQDN dot; strip it for policy matching.
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "")
  } catch {
    return ""
  }
}

export class HeaderPolicyError extends Error {
  readonly code = "HEADER_POLICY_DENIED" as const

  constructor(message: string) {
    super(message)
    this.name = "HeaderPolicyError"
  }
}

export interface HeaderPolicyInput {
  /** Target API base URL (or full request URL). Used for first-party host check. */
  baseUrl: string
  protocol?: LlmProtocol
  client_header_profile?: LlmClientHeaderProfile
  extra_headers?: Record<string, string>
}

/**
 * L7 pre-flight: hard deny any non-clean client identity injection on first-party hosts.
 *
 * Triggers (union): host is first-party AND any of:
 * - client_header_profile !== "none"
 * - extra_headers present with any key (first-party forbids any extra override;
 *   only clean User-Agent: cmspark-companion/<version> is allowed)
 *
 * Also validates extra_headers for CRLF / forbidden names regardless of host.
 */
export function assertHeaderPolicy(input: HeaderPolicyInput): void {
  const profile = input.client_header_profile ?? "none"
  const host = hostnameFromBaseUrl(input.baseUrl)
  const firstParty = isAnthropicFirstPartyHost(host)
  const extras = input.extra_headers

  if (extras) {
    validateExtraHeadersShape(extras)
  }

  if (!firstParty) return

  // First-party: only clean identity. Profile or any extra_headers → refuse.
  if (profile !== "none") {
    throw new HeaderPolicyError(
      "官方 Anthropic 主机不允许 Coding Plan 兼容头；请关闭兼容头或改用中继 Base URL",
    )
  }
  if (extras && Object.keys(extras).length > 0) {
    throw new HeaderPolicyError(
      "官方 Anthropic 主机不允许自定义 extra_headers / 客户端伪装头；请清空 extra_headers 或改用中继 Base URL",
    )
  }
}

/**
 * Reject CRLF injection, empty names, and forbidden hop-by-hop / identity-control keys
 * in extra_headers (applied on all hosts before merge).
 */
function validateExtraHeadersShape(extras: Record<string, string>): void {
  for (const [rawName, rawValue] of Object.entries(extras)) {
    if (typeof rawName !== "string" || rawName.length === 0) {
      throw new HeaderPolicyError("extra_headers: empty header name is not allowed")
    }
    if (/[\r\n]/.test(rawName) || (typeof rawValue === "string" && /[\r\n]/.test(rawValue))) {
      throw new HeaderPolicyError("extra_headers: CRLF in header name or value is not allowed")
    }
    const name = rawName.toLowerCase().trim()
    if (FORBIDDEN_EXTRA_HEADER_NAMES.has(name)) {
      throw new HeaderPolicyError(
        `extra_headers: header "${rawName}" is not allowed (hop-by-hop / auth / host control)`,
      )
    }
    if (typeof rawValue !== "string") {
      throw new HeaderPolicyError(`extra_headers: value for "${rawName}" must be a string`)
    }
  }
}

export interface BuildRequestHeadersInput {
  baseUrl: string
  protocol: LlmProtocol
  apiKey: string
  auth_style?: LlmAuthStyle
  client_header_profile?: LlmClientHeaderProfile
  claude_code_compat_version?: string
  anthropic_version?: string
  extra_headers?: Record<string, string>
  /** Override companion version in clean UA (tests). */
  companionVersion?: string
}

/**
 * Build HTTP headers for an LLM request under the current protocol + profile.
 *
 * - Always sets clean `User-Agent: cmspark-companion/<version>` first
 * - Auth: openai → Bearer; anthropic → x-api-key (or Bearer if auth_style=bearer)
 * - Anthropic path also sets `anthropic-version`
 * - `claude_code_compat` injects UA + x-app **only** when protocol=anthropic and host is not first-party
 * - L7 assert runs before any spoof-class injection
 * - Never sets Host (caller / fetch owns that)
 */
export function buildRequestHeaders(input: BuildRequestHeadersInput): Record<string, string> {
  const protocol = input.protocol ?? "openai"
  const profile = input.client_header_profile ?? "none"
  const authStyle = input.auth_style ?? "auto"
  const host = hostnameFromBaseUrl(input.baseUrl)

  // L7 pre-flight (union deny on first-party)
  assertHeaderPolicy({
    baseUrl: input.baseUrl,
    protocol,
    client_header_profile: profile,
    extra_headers: input.extra_headers,
  })

  const headers: Record<string, string> = {
    "user-agent": cleanCompanionUserAgent(input.companionVersion),
    "content-type": "application/json",
  }

  // Auth
  const key = input.apiKey ?? ""
  if (protocol === "anthropic") {
    const useBearer = authStyle === "bearer"
    if (useBearer) {
      headers["authorization"] = `Bearer ${key}`
    } else {
      // auto or x-api-key
      headers["x-api-key"] = key
    }
    headers["anthropic-version"] =
      input.anthropic_version?.trim() || DEFAULT_ANTHROPIC_VERSION
  } else {
    // openai (and auth_style x-api-key is unusual but honor explicit override)
    if (authStyle === "x-api-key") {
      headers["x-api-key"] = key
    } else {
      headers["authorization"] = `Bearer ${key}`
    }
  }

  // Gateway-compat profile: only anthropic + not first-party (L7 already denied first-party)
  if (
    protocol === "anthropic" &&
    profile === "claude_code_compat" &&
    !isAnthropicFirstPartyHost(host)
  ) {
    const ver =
      input.claude_code_compat_version?.trim() || DEFAULT_CLAUDE_CODE_COMPAT_VERSION
    headers["user-agent"] = `claude-cli/${ver} (external, cli)`
    headers["x-app"] = "cli"
  }
  // profile=claude_code_compat + protocol=openai → silent no-op (documented inertness)

  // Merge extra_headers (already shape-validated by assertHeaderPolicy when present).
  // On non-first-party, allowlisted extras may override non-forbidden keys including UA.
  if (input.extra_headers) {
    for (const [rawName, value] of Object.entries(input.extra_headers)) {
      const name = rawName.toLowerCase().trim()
      // Double-check spoof-class is fine (first-party already refused any extras)
      if (isAnthropicFirstPartyHost(host) && SPOOF_CLASS_HEADER_NAMES.has(name)) {
        throw new HeaderPolicyError(
          "官方 Anthropic 主机不允许 Coding Plan 兼容头；请关闭兼容头或改用中继 Base URL",
        )
      }
      headers[name] = value
    }
  }

  return headers
}

/** Header names only — safe for logging (never log values). */
export function headerNamesForLog(headers: Record<string, string>): string[] {
  return Object.keys(headers).sort()
}
