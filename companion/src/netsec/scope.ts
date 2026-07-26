// NetSec target allowlist matching — IPv4 CIDR + hostname globs (P2)
// Spec §7.3D: *.example.com matches multi-level; does NOT match apex; IPv6 reject

import * as net from "net"
import { isIP } from "net"

export type ScopeRule = string

function normalizeHost(input: string): string {
  let h = input.trim().toLowerCase()
  // strip trailing dot
  if (h.endsWith(".")) h = h.slice(0, -1)
  // strip brackets for IPv6
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  // strip port if present for hostname:port (not for IPv6 without brackets)
  if (!net.isIP(h) && h.includes(":") && !h.includes("::")) {
    h = h.split(":")[0]
  }
  return h
}

/** Parse IPv4 CIDR → { network, mask } or null */
function parseCidrV4(rule: string): { network: number; mask: number } | null {
  const m = rule.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/)
  if (!m) return null
  const bits = parseInt(m[2], 10)
  if (bits < 0 || bits > 32) return null
  const parts = m[1].split(".").map((x) => parseInt(x, 10))
  if (parts.some((p) => p < 0 || p > 255)) return null
  const ip =
    ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0)
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return { network: (ip & mask) >>> 0, mask }
}

function ipv4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null
  const parts = ip.split(".").map((x) => parseInt(x, 10))
  return (
    ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0)
  )
}

/**
 * Returns true if target is allowed by any rule.
 * Empty allowlist → deny all.
 */
export function isTargetAllowed(target: string, allowlist: ScopeRule[]): boolean {
  if (!allowlist || allowlist.length === 0) return false
  const t = normalizeHost(target)
  if (!t) return false

  // IPv6 not supported in P2
  if (isIP(t) === 6) return false

  for (const raw of allowlist) {
    const rule = raw.trim().toLowerCase()
    if (!rule) continue

    // CIDR
    const cidr = parseCidrV4(rule)
    if (cidr) {
      const ipInt = ipv4ToInt(t)
      if (ipInt !== null && (ipInt & cidr.mask) === cidr.network) return true
      continue
    }

    // Exact IPv4 or hostname
    if (!rule.startsWith("*.")) {
      if (normalizeHost(rule) === t) return true
      continue
    }

    // *.example.com — multi-level suffix; NOT apex
    const suffix = rule.slice(2) // example.com
    if (!suffix || suffix.includes("*")) continue
    if (t === suffix) continue // apex not matched
    if (t.endsWith("." + suffix)) return true
  }
  return false
}

export function assertTargetsAllowed(
  targets: string[],
  allowlist: ScopeRule[],
): { ok: true } | { ok: false; error: string; denied: string[] } {
  const denied: string[] = []
  for (const t of targets) {
    if (!isTargetAllowed(t, allowlist)) denied.push(t)
  }
  if (denied.length) {
    return {
      ok: false,
      error: `targets not in netsec.target_allowlist (or IPv6 unsupported): ${denied.join(", ")}`,
      denied,
    }
  }
  return { ok: true }
}
