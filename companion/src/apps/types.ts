// App tab (win.app.* / win.cli.*) configuration — WP1 data layer ONLY.
// No WS handlers, no UI, no execution here.
//
// Mirrors the mcp block's config integration (config.ts): entries are keyed by
// token, writes go through a wholesale-swap helper (replaceAppsEntries), and
// direct config.json edits follow ADR-010 opt-in tampering semantics (design §6):
//   - unknown policy value        → coerce to "manual" + loud log
//   - schema failure              → entry disabled, never crashes the config load
//   - prototype-pollution keys    → rejected (entries-map keys and nested keys)
// Policy cap (Owner decision 3, 2026-07-18): user-writable-directory or unsigned
// apps are capped at "ai" — they can never be "auto" (normalizeAppEntry clamps).

import * as path from "path"
import { basenameToVault, isLolbinPath } from "./guards"

export type AppKind = "gui" | "cli"
export type AppSource = "preset" | "user"
export type AppPolicy = "auto" | "ai" | "manual"

export interface AppExeBlock {
  path: string
  sha256?: string
  /** Authenticode signer captured at add-time; absent/empty = unsigned. */
  signer?: string
  user_writable_dir: boolean
}

export interface AppEntry {
  token: string
  kind: AppKind
  display_name: string
  source: AppSource
  policy: AppPolicy
  enabled: boolean
  added_at: string
  exe?: AppExeBlock
  aumid?: string
  /** Phase-2 (adversary D12): P1 ships no templates — empty array when present. */
  templates?: []
  /** Phase-2 placeholder: may be an empty object until the CLI track lands. */
  cli_manifest?: Record<string, unknown> | null
  /**
   * A10 (coordinate computer-use): per-app opt-in bit for coordinate input
   * injection (host_computer). DEFAULT FALSE and structurally independent of
   * the launch policy — "allowed to launch" NEVER implies "allowed to be
   * clicked into". Setting it goes through the biometric gate; vault-mapped
   * and LOLBIN binaries can never hold it (normalizeAppEntry force-clears).
   */
  coordinateAllowed?: boolean
}

export interface AppsConfig {
  enabled: boolean
  entries: Record<string, AppEntry>
}

/** win.app.<slug> / win.cli.<slug>; slug 2–32 chars, lowercase (design §5). */
export const APP_TOKEN_PATTERN = /^win\.(app|cli)\.[a-z0-9][a-z0-9_\-]{1,31}$/

/** Adversary D11 (NIT): PackageFamilyName!AppId sanity check for UWP entries. */
const AUMID_PATTERN = /^[\w.\-]+![\w.\-]+$/

const VALID_POLICIES: ReadonlySet<string> = new Set(["auto", "ai", "manual"])

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** Recursive pollution-key scan — mirrors message-router.ts hasPrototypePollutionKey. */
function hasPrototypePollutionKey(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) return true
    const val = obj[key]
    if (typeof val === "object" && hasPrototypePollutionKey(val)) return true
  }
  return false
}

/**
 * Schema validation, mirroring validateMcpServerConfig's style: returns an error
 * string on failure, null on success.
 *
 * Deliberately NOT rejected here: unknown policy VALUES (any string passes) —
 * normalizeAppEntry coerces them to "manual" with a loud log per design §6
 * tampering semantics. A missing/non-string policy is still a schema failure.
 */
export function validateAppEntry(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "app entry must be an object"
  const e = raw as Record<string, any>
  if (hasPrototypePollutionKey(e)) return "Invalid app entry keys"
  if (typeof e.token !== "string" || !APP_TOKEN_PATTERN.test(e.token)) {
    return `Invalid app token "${e.token}" (must match win.app.<slug> / win.cli.<slug>)`
  }
  if (e.kind !== "gui" && e.kind !== "cli") {
    return `Invalid app kind "${e.kind}" (must be gui or cli)`
  }
  // Token namespace must agree with kind: win.app.* = gui, win.cli.* = cli.
  const ns: AppKind = e.token.startsWith("win.app.") ? "gui" : "cli"
  if (ns !== e.kind) {
    return `app token "${e.token}" namespace does not match kind "${e.kind}"`
  }
  if (typeof e.display_name !== "string" || !e.display_name) {
    return `app "${e.token}" requires a non-empty display_name`
  }
  if (e.source !== "preset" && e.source !== "user") {
    return `Invalid app source "${e.source}" (must be preset or user)`
  }
  if (typeof e.policy !== "string") {
    return `app "${e.token}" requires a policy string`
  }
  if (typeof e.enabled !== "boolean") {
    return `app "${e.token}" enabled must be a boolean`
  }
  if (typeof e.added_at !== "string" || !e.added_at) {
    return `app "${e.token}" requires an added_at timestamp string`
  }
  const hasExe = e.exe !== undefined && e.exe !== null
  const hasAumid = e.aumid !== undefined && e.aumid !== null
  if (e.kind === "gui") {
    // Exactly one of exe / aumid (XOR): win32 exe path or UWP AUMID.
    if (hasExe === hasAumid) {
      return `gui app "${e.token}" requires exactly one of exe / aumid`
    }
  } else {
    if (!hasExe) return `cli app "${e.token}" requires an exe block`
    if (hasAumid) return `cli app "${e.token}" must not have an aumid`
  }
  if (hasExe) {
    const exe = e.exe
    if (typeof exe !== "object" || Array.isArray(exe)) {
      return `app "${e.token}" exe must be an object`
    }
    if (typeof exe.path !== "string" || !exe.path) {
      return `app "${e.token}" exe.path must be a non-empty string`
    }
    if (exe.sha256 !== undefined && typeof exe.sha256 !== "string") {
      return `app "${e.token}" exe.sha256 must be a string`
    }
    if (exe.signer !== undefined && typeof exe.signer !== "string") {
      return `app "${e.token}" exe.signer must be a string`
    }
    if (typeof exe.user_writable_dir !== "boolean") {
      return `app "${e.token}" exe.user_writable_dir must be a boolean`
    }
  }
  if (hasAumid) {
    if (typeof e.aumid !== "string" || !AUMID_PATTERN.test(e.aumid)) {
      return `app "${e.token}" has invalid aumid "${e.aumid}"`
    }
  }
  if (e.templates !== undefined) {
    if (!Array.isArray(e.templates)) return `app "${e.token}" templates must be an array`
    if (e.templates.length > 0) {
      return `app "${e.token}" templates are Phase-2 (P1 ships none)`
    }
  }
  if (e.cli_manifest !== undefined && e.cli_manifest !== null) {
    if (typeof e.cli_manifest !== "object" || Array.isArray(e.cli_manifest)) {
      return `app "${e.token}" cli_manifest must be an object or null`
    }
  }
  if (e.coordinateAllowed !== undefined && typeof e.coordinateAllowed !== "boolean") {
    return `app "${e.token}" coordinateAllowed must be a boolean`
  }
  return null
}

/**
 * WP2 review W4: UNC paths (\\server\share\… or //server/share/…) — the
 * binary lives on a network share and is replaceable by ANYONE with write
 * access to that share (a weaker trust anchor than even a user-writable
 * local dir). Same ceiling as unsigned/user-writable: "ai".
 */
function isUncPath(p: string): boolean {
  return p.startsWith("\\\\") || p.startsWith("//")
}

/**
 * Policy ceiling for an entry (Owner decision 3): "ai" when the exe lives in a
 * user-writable directory or there is no signer on record (unsigned / AUMID —
 * a same-user process could replace the binary), else "auto".
 * WP2 review W4: UNC (network-share) paths also cap at "ai".
 */
export function maxPolicyForEntry(entry: AppEntry): "auto" | "ai" {
  const exe = entry.exe
  if (!exe) return "ai" // AUMID entry: no signer on record
  if (isUncPath(exe.path)) return "ai" // W4: network-share binary, replaceable upstream
  if (exe.user_writable_dir === true) return "ai"
  if (!exe.signer) return "ai" // absent or empty = unsigned
  return "auto"
}

const POLICY_RANK: Record<AppPolicy, number> = { manual: 0, ai: 1, auto: 2 }

/**
 * Normalize a schema-valid entry: coerce unknown policy values to "manual"
 * (loud log) and clamp the policy to maxPolicyForEntry (loud log when clamped).
 * Returns the input object unchanged when already normalized.
 */
export function normalizeAppEntry(entry: AppEntry): AppEntry {
  let policy = entry.policy as string
  if (!VALID_POLICIES.has(policy)) {
    console.error(
      `[cmspark-agent] apps entry "${entry.token}" has unknown policy "${policy}" — coercing to "manual" (config tampering / legacy value)`,
    )
    policy = "manual"
  }
  let normalized = policy as AppPolicy
  const cap = maxPolicyForEntry(entry)
  if (POLICY_RANK[normalized] > POLICY_RANK[cap]) {
    console.error(
      `[cmspark-agent] apps entry "${entry.token}" policy "${normalized}" exceeds cap "${cap}" (user-writable dir or unsigned) — clamped`,
    )
    normalized = cap
  }
  // A10.3: vault-mapped / LOLBIN binaries can NEVER hold coordinateAllowed —
  // structural exclusion, not a config option. A hand-edited config.json that
  // sets it is force-cleared with a loud log (ADR-010 tampering semantics).
  let coordinateAllowed = entry.coordinateAllowed
  if (coordinateAllowed === true && entry.exe?.path) {
    if (isLolbinPath(entry.exe.path) || basenameToVault(entry.exe.path) !== null) {
      console.error(
        `[cmspark-agent] apps entry "${entry.token}" has coordinateAllowed=true on a vault/LOLBIN binary — force-cleared (structural exclusion, A10)`,
      )
      coordinateAllowed = false
    }
  }
  const changed = normalized !== entry.policy || coordinateAllowed !== entry.coordinateAllowed
  if (!changed) return entry
  return {
    ...entry,
    policy: normalized,
    ...(coordinateAllowed !== entry.coordinateAllowed ? { coordinateAllowed } : {}),
  }
}

/**
 * Validate + normalize a raw entries map loaded from config.json. Never throws:
 * pollution keys are dropped, schema-failing entries are force-disabled (not
 * silently dropped — the panel can surface them), unknown/clamped policies are
 * normalized with loud logs. The whole config load must survive a hand-edited
 * or corrupt apps block (design §6 tampering semantics, H4 philosophy).
 */
export function sanitizeAppEntries(rawEntries: unknown): Record<string, AppEntry> {
  const clean: Record<string, AppEntry> = {}
  if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
    if (rawEntries !== undefined && rawEntries !== null) {
      console.error(
        `[cmspark-agent] apps.entries is not an object — dropping all entries (config tampering?)`,
      )
    }
    return clean
  }
  for (const key of Object.keys(rawEntries as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      console.error(`[cmspark-agent] apps.entries key "${key}" is a prototype-pollution key — dropped`)
      continue
    }
    const raw = (rawEntries as Record<string, unknown>)[key]
    const err = validateAppEntry(raw)
    if (err) {
      console.error(
        `[cmspark-agent] apps entry "${key}" failed validation: ${err} — entry disabled, config load continues`,
      )
      // Keep the entry visible but disabled (design: "entry disabled 不拖垮整体").
      // Non-object entries can't even be carried — drop them.
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        clean[key] = { ...(raw as object), enabled: false } as AppEntry
      }
      continue
    }
    const entry = raw as AppEntry
    if (entry.token !== key) {
      console.error(
        `[cmspark-agent] apps entry key "${key}" does not match entry.token "${entry.token}" — entry disabled`,
      )
      clean[key] = { ...entry, enabled: false }
      continue
    }
    clean[key] = normalizeAppEntry(entry)
  }
  return clean
}

/**
 * True when `p` resolves under a user-writable root (%LOCALAPPDATA%, %APPDATA%,
 * %USERPROFILE%). Used at add-time to stamp exe.user_writable_dir (WP2) — a
 * same-user process can replace binaries under these roots, so such apps are
 * capped at policy "ai" (Owner decision 3).
 *
 * Boundary formula (adversary A2, mirrors host-use/win/adapter.ts isWithinRoot):
 * exact match OR root + path.sep — a bare startsWith would admit sibling
 * prefixes like "%LOCALAPPDATA%-evil". Case-insensitive (NTFS), after
 * path.resolve on BOTH sides so ".." escapes are normalized before comparison.
 */
export function isUserWritablePath(p: string): boolean {
  if (!p || typeof p !== "string") return false
  const roots = [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.USERPROFILE]
  const resolved = path.resolve(p).toLowerCase()
  for (const root of roots) {
    if (!root || typeof root !== "string") continue
    const rootLower = path.resolve(root).toLowerCase()
    if (resolved === rootLower || resolved.startsWith(rootLower + path.sep)) return true
  }
  return false
}
