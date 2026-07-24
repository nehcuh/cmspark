// App tab (WP2) — D5 preset seeding (minimal, detection-based).
//
// Exactly one preset ships in P1: 网易云音乐 (win.app.cloudmusic). Presets are
// NEVER persisted undetected (an entry without exe/aumid would fail the WP1
// schema); instead apps.list runs a lazy filesystem probe — the first time a
// known install path exists, the preset entry materializes with:
//   source: "preset", policy: "manual" (D5: presets ship manual; →auto needs
//   the D2 biometric gate), enabled: true (design §1: preset 区可禁用不可删 —
//   enabled:false was the undetected state, which never reaches disk).
//
// Materialization is a ONE-TIME cost (the entry persists afterwards), so it
// can afford the same rigor as the user add-flow: realpath canonicalization
// (junction/8.3) and an Authenticode signer probe. Without the signer record
// the entry would cap at "ai" forever (maxPolicyForEntry), making the D5
// upgrade→auto-via-biometric path unreachable — with it, a signed binary in
// Program Files is auto-eligible exactly like a user-added app.
//
// Detection paths verified against real installs (incl. this repo owner's
// machine, 2026-07): Program Files / Program Files (x86) / per-user variants.

import * as fs from "fs"
import * as path from "path"
import type { AppEntry } from "./types"
import { isUserWritablePath } from "./types"
import { probeSigner } from "./add-flow"

export interface PresetAppDef {
  token: string
  displayName: string
  /** Candidate exe paths, first existing wins. %VAR% env expansion applied. */
  detectCandidates: string[]
}

export const PRESET_CLOUDMUSIC_TOKEN = "win.app.cloudmusic"

export const PRESET_APPS: readonly PresetAppDef[] = [
  {
    token: PRESET_CLOUDMUSIC_TOKEN,
    displayName: "网易云音乐",
    detectCandidates: [
      "%LOCALAPPDATA%\\NetEase\\CloudMusic\\cloudmusic.exe",
      "%LOCALAPPDATA%\\Programs\\Netease\\CloudMusic\\NeteaseCloudMusic.exe",
      "C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe",
      "C:\\Program Files (x86)\\Netease\\CloudMusic\\cloudmusic.exe",
    ],
  },
]

function expandEnv(p: string): string {
  return p.replace(/%([^%]+)%/g, (m, name) => {
    const v = process.env[String(name)]
    return typeof v === "string" && v ? v : m
  })
}

/** First existing detection candidate (list order), or undefined. */
export function detectPresetExe(
  def: PresetAppDef,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | undefined {
  for (const candidate of def.detectCandidates) {
    const expanded = expandEnv(candidate)
    try {
      if (exists(expanded)) return path.resolve(expanded)
    } catch {
      // probe failure on one candidate must not kill detection of the rest
    }
  }
  return undefined
}

export interface PresetStatus {
  token: string
  display_name: string
  detected: boolean
  /** True when the entry has materialized into the persisted entries map. */
  persisted: boolean
}

export interface MaterializePresetsDeps {
  exists?: (p: string) => boolean
  realpath?: (p: string) => string
  /** Defaults to the apps-signer.ps1 probe; failure → unsigned (cap "ai"). */
  signerProbe?: (exePath: string) => Promise<string | undefined>
  now?: () => Date
}

/**
 * Lazy preset materialization (called at apps.list time). Returns the entries
 * map to persist (input unchanged when nothing was detected), the list of
 * newly materialized tokens, and per-preset status for the panel.
 *
 * A persisted preset entry is NEVER re-probed or mutated here — the user owns
 * its policy/enabled state afterward (removal is refused in apps.remove).
 */
export async function materializePresets(
  entries: Record<string, AppEntry>,
  deps: MaterializePresetsDeps = {},
): Promise<{ entries: Record<string, AppEntry>; added: string[]; presets: PresetStatus[] }> {
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p))
  const realpath = deps.realpath ?? ((p: string) => fs.realpathSync(p))
  const signerProbeFn = deps.signerProbe ?? ((p: string) => probeSigner(p))
  const now = deps.now ?? (() => new Date())
  let out = entries
  const added: string[] = []
  const presets: PresetStatus[] = []

  for (const def of PRESET_APPS) {
    const persistedEntry = entries[def.token]
    if (persistedEntry) {
      let detected = false
      if (persistedEntry.exe?.path) {
        try {
          detected = exists(persistedEntry.exe.path)
        } catch {
          detected = false
        }
      }
      presets.push({ token: def.token, display_name: def.displayName, detected, persisted: true })
      continue
    }
    const exePath = detectPresetExe(def, exists)
    if (!exePath) {
      presets.push({ token: def.token, display_name: def.displayName, detected: false, persisted: false })
      continue
    }
    // Canonicalize (junction/8.3 — same boundary rigor as the user add-flow).
    let canonical: string
    try {
      canonical = realpath(exePath)
    } catch {
      presets.push({ token: def.token, display_name: def.displayName, detected: false, persisted: false })
      continue
    }
    // One-time signer probe; failure fails safe to unsigned (cap "ai").
    let signer: string | undefined
    try {
      signer = await signerProbeFn(canonical)
    } catch {
      signer = undefined
    }
    if (out === entries) out = { ...entries }
    const entry: AppEntry = {
      token: def.token,
      kind: "gui",
      display_name: def.displayName,
      source: "preset",
      policy: "manual",
      enabled: true,
      added_at: now().toISOString(),
      exe: {
        path: canonical,
        ...(signer ? { signer } : {}),
        // LOCALAPPDATA detection → user-writable → cap "ai" + 黄标 (D5).
        user_writable_dir: isUserWritablePath(canonical),
      },
    }
    out[def.token] = entry
    added.push(def.token)
    presets.push({ token: def.token, display_name: def.displayName, detected: true, persisted: true })
  }

  return { entries: out, added, presets }
}
