// Security policy — trusted domains, evaluate safety, error classification

import * as net from "net"
import * as dns from "dns"
import { getConfig } from "./config"

/**
 * Match a hostname against a list of patterns.
 * Supported patterns:
 *   - "*"            matches any hostname (global wildcard) — REJECTED at config
 *                    save time (validateWildcardPattern in saveConfig), so this
 *                    branch only fires for hand-edited configs that bypass validation.
 *   - "example.com"  exact match (apex or bare hostname)
 *   - "*.example.com" matches any subdomain of example.com, plus the bare apex
 *                    (so "*.company.com" matches "hr.company.com" AND "company.com")
 *
 * Apex-collapse is INTENTIONAL and documented in ADR-007: a user typing
 * `*.example.com` typically does want the apex covered too. The P0 finding
 * (S-P0-4, 2026-07-24) was that `*.com` would match every `.com` host AND
 * the bare `com` — but that's blocked at config-save time, not here. The
 * runtime matcher intentionally accepts legacy/hand-edited configs verbatim.
 *
 * Extracted from isTrustedDomain so auto_approved_domains and trusted_domains
 * share identical semantics.
 */
export function matchDomain(patterns: string[], domain: string): boolean {
  if (!patterns || patterns.length === 0) return false
  const host = String(domain || "").toLowerCase()
  if (!host) return false
  return patterns.some(pattern => {
    const p = String(pattern || "").toLowerCase()
    if (!p) return false
    if (p === "*") return true
    if (p === host) return true
    if (p.startsWith("*.")) {
      const suffix = p.slice(1) // ".example.com"
      return host.endsWith(suffix) || host === p.slice(2)
    }
    return false
  })
}

/**
 * S-P0-4 (2026-07-24): Reject dangerous wildcard patterns at config save.
 * Returns true if the pattern is safe to accept, false if it must be rejected.
 *
 * Rejected patterns:
 *   - `*` (global wildcard) — too broad; use explicit domains
 *   - `*.com`, `*.org`, `*.net`, `*.io`, `*.cn`, `*.jp`, etc. — bare TLD
 *     matches every host under that TLD
 *   - `*.co.jp`, `*.com.cn` — compound TLDs (Public Suffix List)
 *   - empty string, whitespace-only
 *
 * Accepted: exact domains, deep wildcards (`*.example.com`).
 *
 * A8 (Grok round 2 — RESIDUAL, TRACK AS P1): Multi-label eTLD wildcards are
 * NOT caught by the hardcoded set. After the A10 partial expansion, the
 * following still pass validation:
 *   `*.azurewebsites.net`, `*.cloudfront.net`, `*.firebaseapp.com`,
 *   `*.web.app`, `*.fly.dev`, `*.run.app`, `*.edgeapp.net`,
 *   `*.on-aws.com`, `*.lovable.app`, `*.lover.ai`
 * These would auto-approve EVERY user-project subdomain on those platforms.
 * The real fix is to use the `publicsuffix-list` npm package (auto-updates
 * from the official PSL). Tracked as P1 — see diagnosis-synthesis.md.
 * Operators who need to mitigate now: prefer exact domains over wildcards
 * for multi-tenant hosts.
 */
const PUBLIC_SUFFIXES = new Set([
  // Generic TLDs (subset of the most-abusable)
  "com", "org", "net", "io", "co", "ai", "app", "dev", "xyz", "info", "biz",
  "me", "us", "uk", "eu", "de", "fr", "jp", "cn", "kr", "ru", "in", "br",
  "au", "ca", "ch", "nl", "se", "no", "it", "es", "pl",
  // Common two-label compound suffixes (not exhaustive — see Public Suffix List)
  "co.jp", "co.uk", "co.kr", "co.in", "co.nz", "co.za",
  "com.cn", "com.hk", "com.tw", "com.sg", "com.au", "com.br",
  "org.cn", "net.cn", "gov.cn", "edu.cn", "ac.cn",
  // A10 + P1 expansion: multi-tenant / shared-hosting eTLDs (not exhaustive PSL).
  "github.io", "appspot.com", "vercel.app", "pages.dev",
  "herokuapp.com", "netlify.app", "gitlab.io", "onrender.com",
  "s3.amazonaws.com", "s3-website.us-east-1.amazonaws.com",
  // P1 SEC-05: residual multi-tenant platforms previously still accepted
  "azurewebsites.net", "cloudfront.net", "firebaseapp.com", "web.app",
  "fly.dev", "run.app", "edgeapp.net", "on-aws.com", "lovable.app",
  "workers.dev", "pages.github.io", "azurestaticapps.net", "web.app",
  "ngrok.io", "ngrok-free.app", "trycloudflare.com", "r2.dev",
])

/**
 * True when `rest` (the part after `*.`) is a multi-tenant / public suffix that
 * must not be wildcarded (e.g. `*.azurewebsites.net`, `*.com`).
 */
export function isMultiTenantOrPublicSuffix(rest: string): boolean {
  const r = String(rest || "").trim().toLowerCase()
  if (!r) return true
  if (PUBLIC_SUFFIXES.has(r)) return true
  // Also reject when any right-hand public suffix is the full rest of a
  // multi-label eTLD already in the set (exact match only — `example.com` OK).
  return false
}

export function validateWildcardPattern(pattern: string): { ok: boolean; reason?: string } {
  const p = String(pattern || "").trim().toLowerCase()
  if (!p) return { ok: false, reason: "empty pattern" }
  if (p === "*") return { ok: false, reason: "global wildcard '*' is too broad; use explicit domains" }

  if (p.startsWith("*.")) {
    const rest = p.slice(2)
    // Reject `*.com`, `*.co.jp`, multi-tenant platforms, etc.
    if (isMultiTenantOrPublicSuffix(rest)) {
      return { ok: false, reason: `wildcard '*.${rest}' matches the entire .${rest} shared suffix — too broad` }
    }
    // Require at least one dot in the suffix (so `*.example` is also rejected;
    // it would match every host ending in `.example`).
    if (!rest.includes(".")) {
      return { ok: false, reason: `wildcard '*.${rest}' has no parent domain — too broad` }
    }
    return { ok: true }
  }

  // Exact domain — accept.
  return { ok: true }
}

/**
 * Check if a domain is in the trusted_domains list (gates cookie tools).
 * Supports wildcards: *.company.com matches hr.company.com, finance.company.com
 */
export function isTrustedDomain(domain: string): boolean {
  return matchDomain(getConfig().trusted_domains, domain)
}

/**
 * User/agent-facing copy when cookie tools are blocked by trusted_domains.
 * Keeps "Security Block:" prefix so classifyError stays on the security path.
 */
export function cookieTrustBlockedMessage(targetDomain: string, toolName?: string): string {
  const domain = (targetDomain || "").trim() || "（未指定域名）"
  const isGlobal = /global|all domains|\*/i.test(domain) || domain === "*"
  const suggest = isGlobal
    ? "list_all_cookies 需要信任域中包含通配 *（仅建议在隔离调试环境使用，风险极高）。"
    : `建议添加：${domain}  或  *.${domain.split(".").slice(-2).join(".")}（若需整站子域）`
  const toolBit = toolName ? `工具「${toolName}」` : "Cookie 相关工具"

  return (
    `Security Block: ${toolBit}无法访问域名「${domain}」的 Cookie——该域名不在「Cookie 信任域」名单中。\n` +
    `\n` +
    `这与「全自动巡航 / 自动批准域名」不是同一开关：\n` +
    `· 全自动巡航：少弹确认（evaluate / navigate 等）\n` +
    `· Cookie 信任域：是否允许读写该站登录态（get_cookies / set_cookie 等）\n` +
    `\n` +
    `操作路径：\n` +
    `1. 打开侧栏 → 设置（齿轮）→「安全设置」→「Cookie 信任域」\n` +
    `2. 点「管理信任域（需二次确认）」\n` +
    `3. 每行一个域名，保存后请 Agent 重试本工具\n` +
    `4. ${suggest}\n` +
    `\n` +
    `若不需要读 Cookie，可忽略此提示，改用页面文字/接口响应判断登录态。`
  )
}

/** Structured fields for Side Panel tool-card hints (user_hint_zh). */
export function cookieTrustBlockedPayload(
  targetDomain: string,
  toolName?: string,
): { success: false; error: string; data: { error_code: string; user_hint_zh: string; target_domain: string } } {
  const domain = (targetDomain || "").trim() || "unknown"
  const error = cookieTrustBlockedMessage(targetDomain, toolName)
  return {
    success: false,
    error,
    data: {
      error_code: "COOKIE_TRUST_DENIED",
      target_domain: domain,
      user_hint_zh:
        `Cookie 被拦：域名「${domain}」不在信任名单。` +
        `请到 设置 → 安全设置 → Cookie 信任域 添加该域名后重试。` +
        `（全自动巡航不会自动放行 Cookie）`,
    },
  }
}

/**
 * Check if a domain is in the auto_approved_domains list (skips tool-call
 * confirmations for evaluate/navigate/etc.). Same matcher as isTrustedDomain
 * but reads from a separate config field so the two gates don't bleed together.
 */
export function isAutoApprovedDomain(domain: string): boolean {
  return matchDomain(getConfig().auto_approved_domains, domain)
}

/**
 * Parse an IPv6 literal into eight 16-bit groups. Handles `::` compression and
 * a trailing embedded dotted-quad (`::ffff:169.254.169.254`). Returns null for
 * non-IPv6 input (guarded by net.isIPv6, so garbage never parses).
 */
function parseIpv6Groups(addr: string): number[] | null {
  if (!net.isIPv6(addr)) return null
  let h = addr.toLowerCase()
  // Split off an embedded dotted-quad tail (v4-mapped / v4-compatible).
  let v4Groups: number[] = []
  const lastColon = h.lastIndexOf(":")
  const tail = h.slice(lastColon + 1)
  if (tail.includes(".") && net.isIPv4(tail)) {
    const p = tail.split(".").map((n) => parseInt(n, 10))
    v4Groups = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]]
    h = h.slice(0, lastColon + 1) // keep the trailing colon
  }
  const halves = h.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : []
  for (const g of [...left, ...right]) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
  }
  const leftNums = left.map((g) => parseInt(g, 16))
  const rightNums = [...right.map((g) => parseInt(g, 16)), ...v4Groups]
  const total = leftNums.length + rightNums.length
  if (halves.length === 2) {
    if (total > 7) return null
    return [...leftNums, ...new Array(8 - total).fill(0), ...rightNums]
  }
  if (total !== 8) return null
  return [...leftNums, ...rightNums]
}

/**
 * Dotted-quad embedded in a transitional IPv6 group list, else null.
 * Covers v4-mapped (`::ffff:a9fe:a9fe`), v4-compatible (`::a9fe:a9fe`),
 * NAT64 well-known prefix (`64:ff9b::a9fe:a9fe`, RFC 6052), and 6to4
 * (`2002:a9fe:a9fe::`, RFC 3056) so the IPv4 range tables apply to all of
 * them. v4-compatible skips 0.0.0.0/8 so `::` and `::1` keep their native
 * IPv6 (unspecified / loopback) semantics.
 */
function embeddedV4FromGroups(groups: number[]): string | null {
  const dotted = (hi: number, lo: number) =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return dotted(groups[6], groups[7]) // v4-mapped
  }
  // IPv4-translated (RFC 2765 SIIT): ::ffff:0:0:0/96 — groups[4]=ffff, [5]=0
  if (
    groups.slice(0, 4).every((g) => g === 0) &&
    groups[4] === 0xffff &&
    groups[5] === 0
  ) {
    return dotted(groups[6], groups[7])
  }
  if (groups.slice(0, 6).every((g) => g === 0) && groups[6] >> 8 !== 0) {
    return dotted(groups[6], groups[7]) // v4-compatible (0.0.0.0/8 excluded)
  }
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return dotted(groups[6], groups[7]) // NAT64 (RFC 6052 well-known prefix)
  }
  if (groups[0] === 0x2002) {
    return dotted(groups[1], groups[2]) // 6to4 (RFC 3056)
  }
  return null
}

/**
 * Canonicalize an IP literal for range checks.
 * - strips the brackets `new URL().hostname` keeps on IPv6 (`[fe80::1]`)
 * - expands compressed IPv6 to eight 4-digit hex groups so `::` compression
 *   cannot dodge an exact/prefix match (`fd00:ec2::254` →
 *   `fd00:0ec2:0000:0000:0000:0000:0000:0254`)
 * - reduces v4-mapped IPv6 to the dotted quad — both the dotted form
 *   (`::ffff:169.254.169.254`) and the hex form WHATWG URL serializes it to
 *   (`::ffff:a9fe:a9fe`) — plus the other transitional forms that embed an
 *   IPv4 address (v4-compatible `::a9fe:a9fe`, NAT64 `64:ff9b::/96`,
 *   6to4 `2002::/16`) — so the IPv4 range tables apply
 * Returns null when the input is not an IP literal (i.e. a DNS name).
 */
export function normalizeIpLiteral(hostname: string): string | null {
  let h = String(hostname || "").toLowerCase().trim()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  if (net.isIPv4(h)) return h
  const groups = parseIpv6Groups(h)
  if (!groups) return null
  const v4 = embeddedV4FromGroups(groups)
  if (v4) return v4
  return groups.map((g) => g.toString(16).padStart(4, "0")).join(":")
}

/** First-hextet range test on the expanded form from normalizeIpLiteral. */
function ipv6FirstHextetIn(expanded: string, prefix: number, mask: number): boolean {
  return (parseInt(expanded.split(":")[0], 16) & mask) === prefix
}

/**
 * Is `hostname` a cloud instance-metadata endpoint? These expose ephemeral
 * IAM credentials / tokens reachable from inside the host and have NO legitimate
 * analyze_image use case → IMAGE_FETCH_GATE hard-blocks them outright (§6.1.4).
 * Accepts `new URL(url).hostname` output verbatim — IPv6 brackets and the
 * hex-serialized v4-mapped form are normalized inside (normalizeIpLiteral).
 */
export function isCloudMetadataIp(hostname: string): boolean {
  let h = String(hostname || "").toLowerCase().trim()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  // Trailing-dot FQDN (S-GCPDOT): metadata.google.internal. === the alias.
  h = h.replace(/\.+$/, "")
  // GCP/Azure alias (resolves to 169.254.169.254).
  if (h === "metadata.google.internal") return true
  const ip = normalizeIpLiteral(h)
  if (!ip) return false
  // AWS IMDSv1/v2 (169.254.169.254), ECS task metadata (169.254.170.2).
  if (net.isIPv4(ip)) return ip === "169.254.169.254" || ip === "169.254.170.2"
  // AWS IMDS over IPv6 (fd00:ec2::254, expanded form).
  return ip === "fd00:0ec2:0000:0000:0000:0000:0000:0254"
}

/**
 * User-configured LLM / vision endpoint (config.test, settings-web /api/test*).
 * Allows RFC1918 / loopback / CGNAT so intranet OpenAI-compatible servers
 * (e.g. http://10.251.241.12/v1) work. Still hard-blocks cloud metadata and
 * link-local IMDS. Untrusted fetches (skill/knowledge import) must keep using
 * assertOutboundFetchUrlAllowed.
 */
export function assertLlmEndpointUrlAllowed(urlStr: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(String(urlStr || ""))
  } catch {
    return "Invalid URL"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `URL protocol not allowed: ${parsed.protocol}`
  }
  const hostname = parsed.hostname
  if (!hostname) return "Invalid URL hostname"
  if (isCloudMetadataIp(hostname) || isLinkLocalImdsHost(hostname)) {
    return LLM_ENDPOINT_IMDS_ERROR
  }
  return null
}

export const LLM_ENDPOINT_IMDS_ERROR = "Cloud-metadata / link-local hosts are not allowed"
export const LLM_ENDPOINT_DNS_ERROR = "Could not resolve LLM host (DNS failed)"

/** Strip IPv6 brackets and trailing FQDN dots for allowlist / IMDS / DNS. */
export function canonicalizeLlmHostname(hostname: string): string {
  let h = String(hostname || "").toLowerCase().trim()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  return h.replace(/\.+$/, "")
}

export type LlmHostDnsKind = "ok" | "imds" | "unresolved"

/**
 * S-NODNS: after the lexical LLM-endpoint allow, DNS-resolve names.
 * Fail-closed: empty answers and lookup errors are `unresolved` (not IMDS).
 * IP literals skip DNS.
 */
export async function classifyLlmHostnameDns(hostname: string): Promise<LlmHostDnsKind> {
  const h = canonicalizeLlmHostname(hostname)
  if (!h) return "unresolved"
  if (net.isIP(h)) {
    return isCloudMetadataIp(h) || isLinkLocalImdsHost(h) ? "imds" : "ok"
  }
  try {
    const result = await dns.promises.lookup(h, { all: true })
    if (result.length === 0) return "unresolved"
    if (result.some((r) => isCloudMetadataIp(r.address) || isLinkLocalImdsHost(r.address))) {
      return "imds"
    }
    return "ok"
  } catch {
    return "unresolved"
  }
}

/** True when DNS is IMDS *or* fail-closed unresolved. Name is historical. */
export async function hostnameResolvesToImds(hostname: string): Promise<boolean> {
  return (await classifyLlmHostnameDns(hostname)) !== "ok"
}

/** Lexical IMDS gate + DNS rebinding check. Distinct copy for DNS vs IMDS. */
export async function assertLlmEndpointAllowedAsync(urlStr: string): Promise<string | null> {
  const lexical = assertLlmEndpointUrlAllowed(urlStr)
  if (lexical) return lexical
  let host: string
  try {
    host = new URL(String(urlStr || "")).hostname
  } catch {
    return "Invalid URL"
  }
  const kind = await classifyLlmHostnameDns(host)
  if (kind === "imds") return LLM_ENDPOINT_IMDS_ERROR
  if (kind === "unresolved") return LLM_ENDPOINT_DNS_ERROR
  return null
}

/** Request-path choke: throw before fetch / SDK create. */
export async function throwIfLlmEndpointBlocked(urlStr: string): Promise<void> {
  const blocked = await assertLlmEndpointAllowedAsync(urlStr)
  if (blocked) throw new Error(blocked)
}

/** 169.254/16 IPv4 + IPv6 link-local — IMDS / APIPA, never a legitimate LLM. */
function isLinkLocalImdsHost(hostname: string): boolean {
  const ip = normalizeIpLiteral(hostname)
  if (!ip) return false
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((p) => parseInt(p, 10))
    return a === 169 && b === 254
  }
  return ipv6FirstHextetIn(ip, 0xfe80, 0xffc0) // fe80::/10
}

/**
 * Shared SSRF gate for outbound companion fetches (skill/knowledge import).
 * Returns null when the URL is allowed; otherwise a short error string.
 * Do NOT use this for user-configured LLM base_url — see assertLlmEndpointUrlAllowed.
 */
export function assertOutboundFetchUrlAllowed(urlStr: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(String(urlStr || ""))
  } catch {
    return "Invalid URL"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `URL protocol not allowed: ${parsed.protocol}`
  }
  const hostname = parsed.hostname
  if (!hostname) return "Invalid URL hostname"
  if (isPrivateOrLoopbackIp(hostname) || isCloudMetadataIp(hostname)) {
    return "Internal / private / cloud-metadata hosts are not allowed"
  }
  // DNS-rebinding-ish hostnames that embed dotted IPs (127.0.0.1.nip.io, …)
  const h = hostname.toLowerCase()
  if (/\b\d{1,3}[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3}\b/.test(h)) {
    return "Internal / private / cloud-metadata hosts are not allowed"
  }
  return null
}

/**
 * Is `hostname` a private / loopback / link-local address? Such hosts are
 * reachable from the extension's `<all_urls>` service worker but not from the
 * public internet → IMAGE_FETCH_GATE requires user confirmation (not a hard
 * block, since a user may legitimately analyze an image on a local dashboard).
 * Cloud-metadata endpoints are a stricter subset handled by isCloudMetadataIp.
 */
export function isPrivateOrLoopbackIp(hostname: string): boolean {
  const h = String(hostname || "").toLowerCase().trim()
  if (!h) return false
  if (h === "localhost") return true
  const ip = normalizeIpLiteral(h)
  if (!ip) return false
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((p) => parseInt(p, 10))
    if (a === 10) return true                       // 10.0.0.0/8
    if (a === 127) return true                      // 127.0.0.0/8 loopback
    if (a === 0) return true                        // 0.0.0.0/8 "this network"
    if (a === 169 && b === 254) return true         // 169.254.0.0/16 link-local (incl. metadata)
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    return false
  }
  // IPv6 (expanded form): ::1 loopback, :: unspecified,
  // fc00::/7 ULA, fe80::/10 link-local
  if (ip === "0000:0000:0000:0000:0000:0000:0000:0001") return true
  if (ip === "0000:0000:0000:0000:0000:0000:0000:0000") return true
  if (ipv6FirstHextetIn(ip, 0xfc00, 0xfe00)) return true
  if (ipv6FirstHextetIn(ip, 0xfe80, 0xffc0)) return true
  return false
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
export const DANGEROUS_API_PATTERNS: Array<{ name: string; pattern: RegExp; critical?: boolean }> = [
  // Direct API calls (1-16)
  { name: "fetch", pattern: /\bfetch\s*\(/, critical: true },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/, critical: true },
  { name: "localStorage", pattern: /\blocalStorage\b/, critical: true },
  { name: "sessionStorage", pattern: /\bsessionStorage\b/, critical: true },
  { name: "document.cookie", pattern: /\bdocument\.cookie\b/, critical: true },
  { name: "window.open", pattern: /\bwindow\.open\s*\(/ },
  { name: "navigator.sendBeacon", pattern: /\bnavigator\.sendBeacon\s*\(/, critical: true },
  { name: "WebSocket", pattern: /\bnew\s+WebSocket\s*\(/, critical: true },
  { name: "EventSource", pattern: /\bnew\s+EventSource\s*\(/ },
  { name: "indexedDB", pattern: /\bindexedDB\b/ },
  { name: "eval", pattern: /\beval\s*\(/, critical: true },
  { name: "Function", pattern: /\bnew\s+Function\s*\(/, critical: true },
  { name: "setTimeout(string)", pattern: /setTimeout\s*\(\s*["']/, critical: true },
  { name: "setInterval(string)", pattern: /setInterval\s*\(\s*["']/, critical: true },
  { name: "Reflect.apply", pattern: /\bReflect\.apply\s*\(/, critical: true },
  { name: "Reflect.construct", pattern: /\bReflect\.construct\s*\(/, critical: true },
  // Obfuscation / bypass patterns (17-32)
  { name: "bracket-fetch", pattern: /\[\s*["']fetch["']\s*\]\s*\(/, critical: true },
  { name: "bracket-open", pattern: /\[\s*["']open["']\s*\]\s*\(/ },
  { name: "bracket-localStorage", pattern: /\[\s*["']localStorage["']\s*\]/, critical: true },
  { name: "bracket-sessionStorage", pattern: /\[\s*["']sessionStorage["']\s*\]/, critical: true },
  { name: "bracket-cookie", pattern: /\[\s*["']cookie["']\s*\]/, critical: true },
  { name: "bracket-sendBeacon", pattern: /\[\s*["']sendBeacon["']\s*\]\s*\(/, critical: true },
  { name: "bracket-indexedDB", pattern: /\[\s*["']indexedDB["']\s*\]/ },
  { name: "bracket-XMLHttpRequest", pattern: /\[\s*["']XMLHttpRequest["']\s*\]/, critical: true },
  // bracket-eval / bracket-Function close the window["eval"]() / window["Function"]()
  // dynamic-dispatch bypass of the eval/Function patterns (§6.2.2 obfuscation critical).
  { name: "bracket-eval", pattern: /\[\s*["']eval["']\s*\]\s*\(/, critical: true },
  { name: "bracket-Function", pattern: /\[\s*["']Function["']\s*\]\s*\(/, critical: true },
  // fetch.call / fetch.apply: catch the indirect-invocation bypass
  // `fetch.call(null, url)` / `fetch.apply(null, [url])` (fetch as the receiver
  // of Function.prototype.call/apply). The previous `/\.call\s*\(.*fetch/` form
  // matched the WRONG order (`.call(...,fetch)` — fetch as an arg) and was both
  // missing the real bypass and FP-prone (`console.log.call(console,'fetching')`).
  // Fixed in M3' (§6.2) now that these are critical — a critical pattern must
  // actually detect its target vector.
  { name: "fetch.call", pattern: /\bfetch\s*\.\s*call\s*\(/, critical: true },
  { name: "fetch.apply", pattern: /\bfetch\s*\.\s*apply\s*\(/, critical: true },
  { name: "Proxy", pattern: /\bnew\s+Proxy\s*\(/, critical: true },
  { name: "constructor", pattern: /\[\s*["']constructor["']\s*\]\s*\(/, critical: true },
  { name: "__proto__", pattern: /\b__proto__\b/, critical: true },
  { name: "prototype-pollution", pattern: /prototype\s*\[\s*["'][^"']+["']\s*\]\s*=/, critical: true },
  { name: "Object.assign", pattern: /\bObject\.assign\s*\(/ },
  { name: "defineProperty", pattern: /\bObject\.defineProperty\s*\(/ },
  // Network / data exfiltration (33-40)
  { name: "navigator.clipboard", pattern: /\bnavigator\.clipboard\b/, critical: true },
  { name: "postMessage", pattern: /\bpostMessage\s*\(/ },
  { name: "openDatabase", pattern: /\bopenDatabase\s*\(/ },
  { name: "requestFileSystem", pattern: /\brequestFileSystem\s*\(/ },
  { name: "webkitRequestFileSystem", pattern: /\bwebkitRequestFileSystem\s*\(/ },
  { name: "RTCPeerConnection", pattern: /\bnew\s+RTCPeerConnection\s*\(/, critical: true },
  { name: "Worker", pattern: /\bnew\s+Worker\s*\(/, critical: true },
  { name: "SharedWorker", pattern: /\bnew\s+SharedWorker\s*\(/, critical: true },
  // DOM manipulation / injection (41-48)
  { name: "innerHTML", pattern: /\.innerHTML\s*=/ },
  { name: "outerHTML", pattern: /\.outerHTML\s*=/ },
  { name: "insertAdjacentHTML", pattern: /\.insertAdjacentHTML\s*\(/ },
  { name: "document.write", pattern: /\bdocument\.write\s*\(/ },
  { name: "document.writeln", pattern: /\bdocument\.writeln\s*\(/ },
  { name: "createElement-script", pattern: /createElement\s*\(\s*["']script["']\s*\)/ },
  { name: "appendChild", pattern: /\.appendChild\s*\(/ },
  { name: "removeChild", pattern: /\.removeChild\s*\(/ },
  // Exfiltration / sandbox-escape bypass patterns (49+) — added in audit item 2.
  // These cover common ways a hostile page can sneak data out or escape the
  // regex blocklist above. Detection here escalates the risk preview shown to
  // the user during the (now-always-required) confirmation prompt for evaluate.
  { name: "location-assign", pattern: /\blocation\.(assign|replace)\s*\(/ },
  { name: "location-href-set", pattern: /location\.href\s*=/ },
  { name: "location-bare", pattern: /\blocation\s*=/ },
  { name: "dynamic-import", pattern: /\bimport\s*\(/, critical: true },
  { name: "globalThis-index", pattern: /(?:globalThis|window|self|top)\s*\[\s*["']/ },
  { name: "comma-eval", pattern: /\(\s*0\s*,\s*(?:eval|Function)/, critical: true },
  { name: "reflect-get", pattern: /\bReflect\.get\s*\(/ },
  { name: "image-src-exfil", pattern: /new\s+Image\s*\(\s*\)\s*[\s\S]{0,40}\.src\s*=/, critical: true },
  { name: "atob-function", pattern: /\batob\s*\([\s\S]{0,200}Function/, critical: true },
]

export function detectDangerousApis(code: string): string[] {
  return DANGEROUS_API_PATTERNS
    .filter(({ pattern }) => pattern.test(code))
    .map(({ name }) => name)
}

/**
 * Detect CRITICAL dangerous APIs — the never-auto-approved subset (exfil +
 * sandbox-escape + their obfuscation variants). Per §6.2 (CRITICAL_API_GATE),
 * even when god-mode (`allow_all_schemes`) / `auto_approve_dangerous` /
 * domain-whitelist would otherwise skip the confirmation gate, a non-empty
 * critical set forces interactive confirmation. god-mode bypasses the UI
 * prompt, not this capability boundary (mirror of §6.1.5). The critical set is
 * a subset of detectDangerousApis() (same table, `critical: true` filter).
 */
export function detectCriticalApis(code: string): string[] {
  return DANGEROUS_API_PATTERNS
    .filter(({ critical, pattern }) => critical === true && pattern.test(code))
    .map(({ name }) => name)
}

// ─── §6.3 MCP_CAPABILITY_GATE (follow-up C) ─────────────────────────────────
// MCP tool calls carry no JS code string to scan (unlike evaluate's
// detectCriticalApis). Their capability lives in the (server, tool, args)
// tuple, so we classify the call by name + serialized args. This is the MCP
// analog of §6.2: a `trusted` server or a `first-use`-cached tool can otherwise
// skip ALL confirmation (server.ts needsConfirm), letting a destructive/exfil
// call execute zero-confirmation. The critical subset forces confirmation
// regardless of trust_level/cache/god-mode — same invariant as §6.1.5/§6.2:
// god-mode (and trust_level) bypass the UI prompt, not the capability boundary.
//
// Phase 1 (here): inferred from tool name + args. Phase 2-B adds a user-declared
// `security_capabilities` field on McpServerConfig (McpDeclaredCapability[]) as
// the primary source, merged with this inference via mergeCapabilities() below.
// The merge is a fail-safe union (Option C, kimi-approved 2026-07-12): a
// positively-inferred critical capability can NEVER be suppressed by a
// declaration; a declaration only (a) escalates (adds caps inference missed)
// or (b) resolves the "unknown" sentinel when inference found nothing.

export type McpCapability =
  | "file-read" | "file-write" | "exec" | "network-egress"
  | "db-read" | "db-mutate" | "read-only" | "unknown"

/**
 * The subset a user may declare for a server via McpServerConfig. Excludes
 * "unknown" — a non-declarable sentinel meaning "inference found nothing"
 * (declaring "I don't know" is meaningless). The read variants are kept so a
 * user can explicitly vouch for read-only behavior to resolve a false-positive
 * (see mergeCapabilities, Option C case I2).
 */
export type McpDeclaredCapability = Exclude<McpCapability, "unknown">

/**
 * The never-auto-approved subset — mirror of §6.2 `critical: true`. A call
 * touching any of these forces interactive confirmation and is NEVER cached
 * (per-call confirm, like DESTRUCTIVE_MCP_TOOL_PATTERN → manual at server.ts).
 * `unknown` is critical: if we cannot classify, we confirm (err on caution).
 *
 * Reads (file-read/db-read/read-only) are intentionally NON-critical — their
 * exfil risk is real but lower than write/exec/egress, and is mitigated by M2
 * `<untrusted>` (result treated as data, not instructions) + the server's
 * trust_level. (See follow-up C §6.6 / RFC D8 — kimi-approved trade-off.)
 */
export const CRITICAL_MCP_CAPABILITIES: ReadonlySet<McpCapability> = new Set([
  "file-write", "exec", "network-egress", "db-mutate", "unknown",
])

/**
 * §6.3 Phase 2-A: MCP META-tools that force interactive confirmation regardless
 * of trust_level / first-use cache / god-mode — the meta-tool analog of the
 * Phase 1 namespaced-tool gate. These are NOT namespaced (`isMcpNamespaced` is
 * false), so executeMcpTool's gate never sees them; executeMcpMetaTool is a
 * separate dispatch path (server.ts) that historically had NO capability gate
 * and NO confirmation at all.
 *
 *   - `mcp_read_resource`: reads an arbitrary resource URI (e.g.
 *     `file:///etc/passwd`, `data:`, `http://…`) on a server. Unlike a
 *     namespaced `read_*` tool, the URI is NOT constrained by the server's
 *     `roots`, so this is a broader read surface. D8's "reads are non-critical,
 *     mitigated by M2 + trust_level" does NOT hold here: executeMcpMetaTool
 *     doesn't even consult trust_level. Force-confirm closes the bypass.
 *   - `mcp_get_prompt`: returns prompt template text — a prompt-injection
 *     surface that can shape subsequent instructions. Treated as critical.
 *
 * `mcp_list_resources` is intentionally NOT in this set: it only enumerates
 * resource metadata (URIs), risk-equivalent to a namespaced `list_*` read tool,
 * so it stays D8-non-critical and is gated purely by trust_level (manual /
 * first-use-uncached → confirm; trusted / first-use-cached → skip).
 *
 * This set is deliberately SEPARATE from CRITICAL_MCP_CAPABILITIES: adding
 * "file-read" to the capability set would re-criticalize all namespaced read
 * tools and contradict the Phase 1 D8 decision. Meta-tools get their own gate.
 */
export const CRITICAL_MCP_META_TOOLS: ReadonlySet<string> = new Set([
  "mcp_read_resource", "mcp_get_prompt",
])

// Name heuristics. Intentionally BROADER than DESTRUCTIVE_MCP_TOOL_PATTERN
// (server.ts:137) — that regex only catches write|delete|exec|...|destroy and
// misses save/put/create/mkdir/upload/etc., so a `trusted` server's `save_file`
// or `put_record` would otherwise skip confirmation entirely. A false positive
// only costs one prompt; a false negative exfils.
//
// Token boundary: `(?<![a-z0-9])…(?![a-z0-9])`, NOT `\b`. `\b` treats `_` as a
// word char (it's in `\w`), so `\bwrite\b` does NOT match `write_file` /
// `exec_cmd` / `read_file` — exactly the snake_case names MCP tools use. The
// custom boundary splits on `_`, `-`, and any non-alphanumeric, so each regex
// matches a whole token whether the name uses snake_case, kebab-case, or
// camelCase. (`write` won't match inside `rewrite`/`writer` since those are
// `r…e[a-z]`; same substring guard `\b` gave.)
const _L = "(?<![a-z0-9])"
const _R = "(?![a-z0-9])"
const MCP_NAME_FILE_WRITE = new RegExp(`${_L}(write|create|save|put|append|truncate|rm|remove|delete|destroy|wipe|move|copy|mkdir|touch|chmod|chown|rename|upload|set)${_R}`, "i")
const MCP_NAME_DB_MUTATE = new RegExp(`${_L}(insert|update|drop|alter|merge|upsert|commit)${_R}`, "i")
const MCP_NAME_EXEC = new RegExp(`${_L}(exec|run|spawn|shell|bash|cmd|process|subprocess|system|kill|fork|popen|terminal)${_R}`, "i")
const MCP_NAME_EGRESS = new RegExp(`${_L}(curl|wget|download|upload|send|post|request|crawl|scrape|fetch|http)${_R}`, "i")
const MCP_NAME_READ = new RegExp(`${_L}(read|cat|head|tail|grep|find|glob|list|stat|search|query|select|describe|show|get|info|status|directory|tree|walk|traverse|enumerate)${_R}`, "i")

// Arg heuristics — the real exfil/escape detector. Name heuristics are evadable
// (`fetch_data`/`get_info`/`query` pass DESTRUCTIVE_MCP_TOOL_PATTERN); the arg
// scan catches the actual payload regardless of tool name.
//
// Loopback host anchor: each loopback literal is followed by a host-TERMINATOR
// guard (`.`/digit for IPv4, `[a-z0-9.-]` for hostname/IPv6-bracket). Without
// it, a prefix-based `(?!localhost)` would treat `https://localhost.attacker.com`
// and `https://127.0.0.1.attacker.com` as loopback (lookahead sees the loopback
// prefix and bails) — an attacker-controlled domain exfiling zero-confirmation.
//
// §6.3 Phase 2-E: expand URL scheme set to any network-egress scheme
// (ftp/ftps/ws/wss) and add a host:port signal for scheme-less targets.
// file:// / data:// / mailto: are intentionally excluded — they do not open a
// remote socket. Private RFC1918 addresses are intentionally NOT whitelisted:
// SSRF pivoting into 192.168.x.x / 10.x.x.x is exactly what we want to catch.
const MCP_ARG_EXTERNAL_URL = /(?:https?|ftps?|wss?):\/\/(?!(?:127\.0\.0\.1(?![.\d])|localhost(?![a-z0-9.-])|\[::1\](?![a-z0-9.-])))/i
// host:port is a high-precision socket signal — much lower false-positive rate
// than bare hostnames (which appear in docs/error messages). Loopback is removed
// by a second pass; private ranges remain egress (SSRF pivot).
const MCP_ARG_HOST_PORT = /(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})\b/i
const MCP_ARG_LOOPBACK_HOST_PORT = /(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\b/i
const MCP_ARG_SHELL = /(?:^|[^a-z0-9_])(?:bash|\/bin\/sh|zsh|cmd\.exe|powershell)\b|\brm\s+-rf\b|\bsudo\b|\bsh\s+-c\b/i
const MCP_ARG_WRITE_PAIR = /\b(?:content|body|payload|data|text|bytes)\b/i

/**
 * Classify an MCP tool call by the capabilities it touches. Returns the matched
 * capability set (defaulting to ["unknown"] — critical — when nothing matches).
 * Used by executeMcpTool (server.ts) to compute `forceMcpConfirm`.
 */
export function classifyMcpCall(toolName: string, params: unknown): McpCapability[] {
  const caps = new Set<McpCapability>()
  const name = String(toolName || "")
  let args = ""
  try {
    const full = JSON.stringify(params ?? {})
    // §6.3 Phase 2-E: scan both head and tail of very large args so an attacker
    // cannot hide a URL/shell marker beyond the 4000-char prefix. A space
    // separator prevents accidental cross-boundary matches.
    args = full.length > 6000 ? full.slice(0, 4000) + " " + full.slice(-2000) : full
  } catch { args = "" }

  if (MCP_NAME_FILE_WRITE.test(name)) caps.add("file-write")
  if (MCP_NAME_DB_MUTATE.test(name)) caps.add("db-mutate")
  if (MCP_NAME_EXEC.test(name)) caps.add("exec")
  if (MCP_NAME_EGRESS.test(name)) caps.add("network-egress")
  if (MCP_NAME_READ.test(name)) caps.add("read-only")

  // Arg-based (independent of name — catches name-evasion).
  if (MCP_ARG_EXTERNAL_URL.test(args)) caps.add("network-egress")
  // host:port signal: remove loopback occurrences first, then re-test so a mixed
  // arg (loopback + attacker host) is still flagged.
  if (MCP_ARG_HOST_PORT.test(args)) {
    const withoutLoopback = args.replace(MCP_ARG_LOOPBACK_HOST_PORT, "")
    if (MCP_ARG_HOST_PORT.test(withoutLoopback)) caps.add("network-egress")
  }
  if (MCP_ARG_SHELL.test(args)) caps.add("exec")
  // file-write: a destination path arg paired with a content arg.
  if (MCP_ARG_WRITE_PAIR.test(args) && /\b(?:path|file|filename|dest|destination|output|to)\b/i.test(args)) {
    caps.add("file-write")
  }

  if (caps.size === 0) caps.add("unknown")
  return Array.from(caps)
}

/**
 * §6.3 Phase 2-B: merge inferred capabilities (classifyMcpCall) with the
 * server's user-declared `security_capabilities`. Fail-safe union — Option C,
 * kimi-approved 2026-07-12 (see docs/followup-c-p2b-declared-capabilities-rfc-2026-07-12.md §4).
 *
 *   inferred = classifyMcpCall(toolName, params)   // may include "unknown"
 *   inferredK = inferred minus "unknown"           // strip the non-declarable sentinel
 *
 *   - inferredK non-empty → union with declared (inferred ALWAYS applies; a
 *     declaration can only ESCALATE). [I1: a positively-inferred critical cap
 *     is never suppressible.]
 *   - inferredK empty + declared non-empty → use declared (resolves the
 *     "unknown" ambiguity — the user is explicitly vouching). [I2]
 *   - both empty → ["unknown"] (Phase 1 default → critical). [I4]
 *
 * Unknown declared values are ignored here (sanitizeMcpConfig already strips
 * them with a warning, but this stays robust to direct callers). Returns the
 * final capability array and a flag indicating whether a declaration RESOLVED
 * an "unknown" (for forensic logging — kimi suggestion: make the trust grant
 * traceable).
 */
export interface MergedCapabilities {
  capabilities: McpCapability[]
  /** True when inference found nothing AND a declaration replaced "unknown".
   *  The caller should warn-log this so the trust grant is auditable. */
  declaredResolvedUnknown: boolean
}

const VALID_DECLARED_CAPABILITIES: ReadonlySet<string> = new Set<McpDeclaredCapability>([
  "file-read", "file-write", "exec", "network-egress",
  "db-read", "db-mutate", "read-only",
])

/** Whether `value` is a valid user-declarable capability (used by config
 *  sanitization to strip typos without dropping the whole server). */
export function isValidDeclaredCapability(value: unknown): value is McpDeclaredCapability {
  return typeof value === "string" && VALID_DECLARED_CAPABILITIES.has(value)
}

export function mergeCapabilities(
  inferred: McpCapability[],
  declared: readonly string[] | undefined | null,
): MergedCapabilities {
  const inferredKnown = inferred.filter((c) => c !== "unknown")

  // Filter declared to known, non-"unknown" values only (defense-in-depth even
  // though sanitizeMcpConfig should have already stripped them).
  const declaredKnown = (declared ?? []).filter(
    (c): c is McpDeclaredCapability => VALID_DECLARED_CAPABILITIES.has(c),
  )

  const seen = new Set<McpCapability>()
  const out: McpCapability[] = []
  const push = (c: McpCapability) => {
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }

  if (inferredKnown.length > 0) {
    for (const c of inferredKnown) push(c)
    for (const c of declaredKnown) push(c)
    return { capabilities: out, declaredResolvedUnknown: false }
  }

  // Inference found nothing (only "unknown", or genuinely empty).
  if (declaredKnown.length > 0) {
    for (const c of declaredKnown) push(c)
    return { capabilities: out, declaredResolvedUnknown: true }
  }

  // No signal at all — Phase 1 default.
  return { capabilities: ["unknown"], declaredResolvedUnknown: false }
}

/** Legacy check result for backward compatibility. */
export interface HighRiskCheckResult {
  blocked: boolean
  dangerousApis: string[]
  error?: string
}

/**
 * Check if execution is high-risk and return detailed risk information.
 *
 * `blocked` means "preview as high-risk" for the L2 dialog. It must NOT
 * hard-refuse after a valid security_token (regex is not a second gate).
 *
 * @param toolName - The tool being executed.
 * @param code - The code/expression to evaluate.
 * @returns Detailed check result.
 */
export function checkHighRiskExecution(toolName: string, code: string): HighRiskCheckResult {
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
export function classifyError(
  errorMessage: string,
  context?: { toolName?: string; domain?: string; error_code?: string },
): ErrorLevel {
  // Typed missing-peer must not retry even if the message contains timeout/disconnected/not found.
  if (context?.error_code === "BROWSER_UNAVAILABLE") return "non_recoverable"
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
    "disconnected",
    "does not advertise the resources capability",
    // Filesystem TCC denials (macOS protects ~/.Trash, ~/Library/Mail, etc. even
    // for processes with FS access). Upstream MCP server surfaces these as
    // `EPERM: operation not permitted, scandir <path>`. The LLM should narrow
    // scope and retry (e.g. scan ~/.cmspark-agent/knowledge/global instead of
    // the home dir), not bail the whole conversation.
    "eperm",
    "operation not permitted",
    // Coordinate computer-use: LLM may re-locate / re-read client bounds after
    // a near-miss or Retina image-pixel vs client-logical mismatch.
    "outside client rect",
    "out_of_bounds",
    // Mission Pack DevSec: missing workspace is user-actionable (pick folder)
    "workspace_root not set",
    "pick a folder first",
    // Default sandbox ~/CMspark-projects create/resolve failure (Scheme 1)
    "default_sandbox_unavailable",
    "cannot create default sandbox",
    "module_disabled",
    "workspace path must come from",
    // Scene (Mission Pack) tool surface — exit scene or use allowed tools
    "tool_not_allowed",
    "not in thread tool_whitelist",
    "当前场景不允许",
    "可退出场景后重试",
    // Filesystem missing path (Node raw: "ENOENT: no such file or directory, stat …").
    // Note: "not found" above does NOT match "no such file" — they are different
    // English. Without these, workspace_read_file / MCP filesystem on a missing
    // path kills the whole turn as chat.error "不可恢复错误" (thread n2486l).
    "enoent",
    "no such file",
    "file not found",
    // workspace_read_file on a directory (agent path typo) — list_dir and retry
    "not a file",
    "path is not a directory",
    // ADR-015 tab lease: LLM can close_tab / list_tab_locks and retry (not fatal)
    "tab_lease_cap",
    "already holds",
    "tab lease cap",
    "tab_locked",
    "tab_busy_confirming",
    "tab_force_releasing",
    "tab_id_required",
    // Missing / malformed tool args: LLM should re-call with correct shape
    // (was default non_recoverable → chat.error "不可恢复错误: url and expression required")
    "url and expression required",
    "requires url and expression",
    "requires expression",
    "no url and no tab url",
    "missing required",
    "required parameters",
    "tabid not in url cache",
    "not in url cache",
    // MCP filesystem path / allowlist — agent can mkdir parent or ask user to expand allow-dirs
    // (was non_recoverable "不可恢复错误" for Parent directory does not exist — thread 6zhrh6)
    "parent directory does not exist",
    "does not exist",
    "access denied",
    "not allowed",
    "allowed director", // "allowed directories" / "allowed directory"
    "outside allowed",
    "path is outside",
    // Web act-loop W1/W3′/W4 coded errors (default is non_recoverable)
    "selector_or_text_required",
    "wait_condition_required",
    "selector or network_idle",
    "network_idle is required",
    "element_not_found",
    "element_ambiguous",
    "invalid_selector",
    "wrong_origin",
    "cdp_attach_failed",
    "eval_dead_world",
    "eval_thrown",
    "dom_script_loop_capped",
    "dom_script_volume_capped",
    "type_unsupported_editor",
    "site_op_banned",
    "tab_attach_frozen",
  ]
  if (recoverable.some(p => msg.includes(p))) {
    return "recoverable"
  }

  // Default to non-recoverable
  return "non_recoverable"
}
