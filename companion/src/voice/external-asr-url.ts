// External chat ASR URL canonicalization. No fetch and no DNS.

export type ExternalAsrStyle = "deepseek" | "openai"
export type ExternalLimitNote = "deepseek-docs" | "openai-file-cap" | "unprobed-local-default"

export type CanonicalExternalUrl =
  | { ok: true; url: string; limitNote: ExternalLimitNote }
  | { ok: false }

const FAIL: CanonicalExternalUrl = { ok: false }

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".")
  if (parts.length !== 4) return null
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return (((nums[0]! << 24) >>> 0) + (nums[1]! << 16) + (nums[2]! << 8) + nums[3]!) >>> 0
}

function isIpv4LoopbackOrPrivate(host: string): boolean {
  const n = ipv4ToInt(host)
  if (n == null) return false
  const a = n >>> 24
  const b = (n >>> 16) & 0xff
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function expandIpv6(host: string): number[] | null {
  const lower = host.toLowerCase()
  if (!lower.includes(":")) return null
  const halves = lower.split("::")
  if (halves.length > 2) return null
  const parseSide = (side: string): number[] | null => {
    if (side === "") return []
    const groups = side.split(":")
    const nums = groups.map((group) => /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : NaN)
    return nums.some((n) => Number.isNaN(n)) ? null : nums
  }
  const left = parseSide(halves[0] ?? "")
  const right = halves.length === 2 ? parseSide(halves[1] ?? "") : []
  if (!left || !right) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  return [...left, ...Array(missing).fill(0), ...right]
}

/** ::ffff:0:0/96 only. NAT64 64:ff9b::/96 is left untouched. */
function mappedIpv4(host: string): string | null {
  const groups = expandIpv6(host)
  if (!groups || groups.length !== 8) return null
  if (groups.slice(0, 5).some((n) => n !== 0) || groups[5] !== 0xffff) return null
  const hi = groups[6]!
  const lo = groups[7]!
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
}

function isBlockedLiteral(hostname: string): boolean {
  const mapped = mappedIpv4(hostname)
  const v4 = ipv4ToInt(mapped ?? hostname)
  if (v4 != null) {
    const a = v4 >>> 24
    const b = (v4 >>> 16) & 0xff
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a >= 224 && a <= 239) return true
    return false
  }
  if (!hostname.includes(":")) return false
  const lower = hostname.toLowerCase()
  if (lower === "::") return true
  if (lower.startsWith("ff")) return true
  const head = lower.split(":")[0] || "0"
  const first = Number.parseInt(head || "0", 16)
  if (Number.isNaN(first)) return false
  return (first & 0xffc0) === 0xfe80
}

function isHttpHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost") return true
  if (host === "::1") return true
  if (isIpv4LoopbackOrPrivate(host)) return true
  if (!host.includes(":")) return false
  const head = host.split(":")[0] || "0"
  const first = Number.parseInt(head || "0", 16)
  if (Number.isNaN(first)) return false
  return (first & 0xfe00) === 0xfc00
}

function limitNoteFor(style: ExternalAsrStyle, hostname: string): ExternalLimitNote {
  if (style === "deepseek") return "deepseek-docs"
  return hostname.toLowerCase() === "api.openai.com" ? "openai-file-cap" : "unprobed-local-default"
}

export function canonicalExternalUrl(style: ExternalAsrStyle, raw: string): CanonicalExternalUrl {
  const trimmed = raw.trim()
  const input = trimmed === ""
    ? (style === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1")
    : trimmed
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return FAIL
  }
  if (url.username !== "" || url.password !== "") return FAIL
  if (url.search !== "" || url.hash !== "") return FAIL
  if (url.protocol !== "https:" && url.protocol !== "http:") return FAIL
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (isBlockedLiteral(hostname)) return FAIL
  if (url.protocol === "http:" && !isHttpHostAllowed(hostname)) return FAIL

  let path = url.pathname.replace(/\/+$/, "")
  if (style === "deepseek") {
    if (path !== "/v1/tools/asr") {
      if (path !== "" && path !== "/v1") return FAIL
      path = "/v1/tools/asr"
    }
  } else if (!path.endsWith("/audio/transcriptions")) {
    path = `${path === "" ? "" : path}/audio/transcriptions`
  }
  const port = url.port === "" ? "" : `:${url.port}`
  const host = hostname.includes(":") ? `[${hostname}]` : hostname
  return {
    ok: true,
    url: `${url.protocol}//${host}${port}${path}`,
    limitNote: limitNoteFor(style, hostname),
  }
}
