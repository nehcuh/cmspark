// Path B — resolve cmspark-whisper + optional SHA256 pin (Spike S4 / ADR-023 L5).
// Pattern aligned with tray integrity (hash before use); no auto-rebuild on mismatch.

import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

export type WhisperArch =
  | "darwin-arm64"
  | "darwin-x64"
  | "win-x64"
  | "linux-x64"
  | "unsupported"

/** Map process.platform + arch → package identity. */
export function resolveWhisperArch(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): WhisperArch {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "darwin" && (arch === "x64" || arch === "x86_64")) return "darwin-x64"
  if (platform === "win32" && (arch === "x64" || arch === "x86_64")) return "win-x64"
  if (platform === "linux" && (arch === "x64" || arch === "x86_64")) return "linux-x64"
  return "unsupported"
}

/**
 * Candidate relative basenames for the shipped helper.
 * Prod pins one per platform package; dev may use unsuffixed name.
 */
export function whisperBinaryBasenames(warch: WhisperArch): string[] {
  if (warch === "unsupported") return []
  const exe = warch.startsWith("win") ? ".exe" : ""
  return [
    `cmspark-whisper-${warch}${exe}`,
    `cmspark-whisper${exe}`,
  ]
}

export interface ResolveWhisperBinaryOpts {
  /** Package / dist roots to search (first hit wins). */
  searchRoots: string[]
  platform?: NodeJS.Platform
  arch?: string
  /** If set, require digest match; mismatch → refuse. */
  expectedSha256?: string | null
  /** When true (default), missing pin is OK for dev; production should pin. */
  allowUnpinned?: boolean
}

export type ResolveWhisperBinaryResult =
  | { ok: true; path: string; arch: WhisperArch; sha256: string; pinned: boolean }
  | {
      ok: false
      reason: "unsupported_arch" | "not_found" | "hash_mismatch" | "unreadable"
      arch: WhisperArch
      path?: string
      sha256?: string
      message: string
    }

export function sha256FileSync(filePath: string): string {
  const hash = crypto.createHash("sha256")
  hash.update(fs.readFileSync(filePath))
  return hash.digest("hex")
}

/**
 * Resolve whisper binary under search roots. Does not spawn.
 * Spike S4: unit-tested with temp files; production wires package layout.
 */
export function resolveWhisperBinary(opts: ResolveWhisperBinaryOpts): ResolveWhisperBinaryResult {
  const arch = resolveWhisperArch(opts.platform, opts.arch)
  if (arch === "unsupported") {
    return {
      ok: false,
      reason: "unsupported_arch",
      arch,
      message: `whisper binary not shipped for ${opts.platform ?? process.platform}/${opts.arch ?? process.arch}`,
    }
  }
  const names = whisperBinaryBasenames(arch)
  let found: string | undefined
  for (const root of opts.searchRoots) {
    for (const name of names) {
      const p = path.join(root, name)
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          found = p
          break
        }
      } catch {
        /* continue */
      }
    }
    if (found) break
  }
  if (!found) {
    return {
      ok: false,
      reason: "not_found",
      arch,
      message: `cmspark-whisper not found under: ${opts.searchRoots.join(", ")}`,
    }
  }
  let digest: string
  try {
    digest = sha256FileSync(found)
  } catch (e: any) {
    return {
      ok: false,
      reason: "unreadable",
      arch,
      path: found,
      message: e?.message || "unreadable binary",
    }
  }
  const pin = opts.expectedSha256?.toLowerCase() || null
  if (pin) {
    if (digest !== pin) {
      return {
        ok: false,
        reason: "hash_mismatch",
        arch,
        path: found,
        sha256: digest,
        message: `SHA256 mismatch for ${found}`,
      }
    }
    return { ok: true, path: found, arch, sha256: digest, pinned: true }
  }
  if (opts.allowUnpinned === false) {
    return {
      ok: false,
      reason: "hash_mismatch",
      arch,
      path: found,
      sha256: digest,
      message: "expectedSha256 required (allowUnpinned=false)",
    }
  }
  return { ok: true, path: found, arch, sha256: digest, pinned: false }
}

/** Default search roots relative to companion package (dev layout). */
export function defaultWhisperSearchRoots(companionRoot: string): string[] {
  return [
    path.join(companionRoot, "dist", "bin"),
    path.join(companionRoot, "bin"),
    path.join(companionRoot, "dist"),
  ]
}

/** Home-cache path for spike-downloaded CLI (not production ship path). */
export function spikeWhisperCacheDir(dataDir?: string): string {
  const base = dataDir || path.join(os.homedir(), ".cmspark-agent")
  return path.join(base, "spike", "whisper")
}
