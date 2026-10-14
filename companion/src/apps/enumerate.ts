// App tab (WP2) — enumeration of add-app candidates via apps-enumerate.ps1.
// Thin wrapper over the argv-only PowerShell infra (runPs/resolveWinScript/
// parsePsJson/rethrowPsError) — no new spawn paths.

import {
  runPs,
  resolveWinScript,
  parsePsJson,
  rethrowPsError,
  type PsRunner,
} from "../host-use/win/powershell"

export interface EnumeratedAppCandidate {
  name: string
  source: "running" | "startapps" | "registry"
  /** win32 exe path (exactly one of path/aumid is set). */
  path?: string
  /** UWP AUMID (PackageFamilyName!AppId). */
  aumid?: string
}

export const APPS_ENUMERATE_TIMEOUT_MS = 20000

/** Resolver kept as a named export so tests/callers can assert staging picks it up. */
export function resolveAppsEnumerateScript(): string {
  return resolveWinScript("apps-enumerate.ps1")
}

export const REGISTRY_DISCOVERY_REASONS = ["KEY_LIMIT","CANDIDATE_LIMIT","OUTPUT_LIMIT","VALUE_LIMIT","ACCESS_DENIED","REGISTRY_READ_FAILED"] as const
export type RegistryDiscoverySummary = { status: "complete" | "partial" | "unavailable"; reasons: (typeof REGISTRY_DISCOVERY_REASONS[number])[] }
export interface WindowsAppEnumeration { candidates: EnumeratedAppCandidate[]; registry_summary: RegistryDiscoverySummary | null }

/** Optional diagnostics are finite view metadata, never authority or raw errors. */
export function parseRegistryDiscoverySummary(raw: unknown, registryRows: number): RegistryDiscoverySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => k !== "status" && k !== "reasons") || !Array.isArray(v.reasons) || v.reasons.length > 6) return null
  const reasons = v.reasons
  if (reasons.some(r => typeof r !== "string" || !(REGISTRY_DISCOVERY_REASONS as readonly string[]).includes(r)) || new Set(reasons).size !== reasons.length) return null
  if (v.status === "complete" ? reasons.length !== 0 : v.status === "partial" ? reasons.length === 0
    : v.status === "unavailable" ? reasons.length === 0 || registryRows > 0 || reasons.some(r => r !== "ACCESS_DENIED" && r !== "REGISTRY_READ_FAILED") : true) return null
  return { status: v.status as RegistryDiscoverySummary["status"], reasons: REGISTRY_DISCOVERY_REASONS.filter(r => reasons.includes(r)) }
}

export async function enumerateAppsDetailed(runner: PsRunner = runPs): Promise<WindowsAppEnumeration> {
  try {
    const stdout = await runner(resolveAppsEnumerateScript(), [], { timeoutMs: APPS_ENUMERATE_TIMEOUT_MS })
    const parsed = parsePsJson<{ apps?: unknown; registry_summary?: unknown }>(stdout, "apps-enumerate")
    if (!Array.isArray(parsed.apps)) throw new Error("apps-enumerate: payload missing apps array")
    const out: EnumeratedAppCandidate[] = []
    let malformedRegistry = false
    for (const raw of parsed.apps) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
      const r = raw as Record<string, unknown>
      if (typeof r.name !== "string" || !r.name) { if (r.source === "registry") malformedRegistry = true; continue }
      if (r.source !== "running" && r.source !== "startapps" && r.source !== "registry") continue
      const path = typeof r.path === "string" && r.path ? r.path : undefined
      const aumid = typeof r.aumid === "string" && r.aumid ? r.aumid : undefined
      if (r.source === "registry" && (!path || aumid !== undefined || r.aumid !== undefined || r.bundleId !== undefined
        || r.name.length > 256 || /[\x00-\x1f\x7f]/.test(r.name) || path.length > 1024 || !/^[A-Za-z]:\\/.test(path)
        || !/\.exe$/i.test(path) || /[\x00-\x1f\x7f"<>|?*]/.test(path) || path.slice(2).includes(":") || path.includes("/")
        || path.slice(3).split("\\").some(p => !p || p === "." || p === ".."))) { malformedRegistry = true; continue }
      if ((path === undefined) === (aumid === undefined)) continue
      out.push({ name: r.name, source: r.source, ...(path ? { path } : {}), ...(aumid ? { aumid } : {}) })
    }
    return { candidates: out, registry_summary: malformedRegistry ? null : parseRegistryDiscoverySummary(parsed.registry_summary, out.filter(r => r.source === "registry").length) }
  } catch (err: any) { rethrowPsError(err, "apps.enumerate") }
}

/** Keep the original array API for callers which do not consume view diagnostics. */
export async function enumerateApps(runner: PsRunner = runPs): Promise<EnumeratedAppCandidate[]> {
  return (await enumerateAppsDetailed(runner)).candidates
}

// macOS WP3: scan /Applications and ~/Applications for .app bundles.
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { execFileSync } from "child_process"

export interface EnumeratedMacCandidate {
  name: string
  source: "installed"
  bundleId: string
  path: string
}

function readPlistString(plistPath: string, key: string): string | null {
  try {
    const output = execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    return output.trim() || null
  } catch {
    return null
  }
}

export function enumerateMacApps(): EnumeratedMacCandidate[] {
  const dirs = ["/Applications", path.join(os.homedir(), "Applications")]
  const results: EnumeratedMacCandidate[] = []
  const seen = new Set<string>()

  for (const dir of dirs) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue
      const infoPath = path.join(dir, entry.name, "Contents", "Info.plist")
      if (!fs.existsSync(infoPath)) continue

      const bundleId = readPlistString(infoPath, "CFBundleIdentifier")
      if (!bundleId || seen.has(bundleId)) continue
      seen.add(bundleId)

      const displayName = readPlistString(infoPath, "CFBundleDisplayName")
        ?? readPlistString(infoPath, "CFBundleName")
        ?? entry.name.replace(/\.app$/, "")

      results.push({ name: displayName, source: "installed", bundleId, path: path.join(dir, entry.name) })
    }
  }
  return results
}
