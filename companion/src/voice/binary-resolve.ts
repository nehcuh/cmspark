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

/** Sidecar written by brew/local install — binds primary + dylib digests. */
export const WHISPER_USER_INSTALL_MANIFEST = "install.manifest.json"

export type WhisperUserInstallManifest = {
  version: 1
  primary: string
  sha256: string
  files: Record<string, string>
  installedAt: string
  source?: string
}

/** Verify user-install dir has matching install.manifest.json (anti-substitution). */
export function verifyUserWhisperInstallManifest(
  destDir: string,
  primaryPath: string,
  primaryDigest: string,
): boolean {
  try {
    const manPath = path.join(destDir, WHISPER_USER_INSTALL_MANIFEST)
    if (!fs.existsSync(manPath)) return false
    const man = JSON.parse(fs.readFileSync(manPath, "utf8")) as WhisperUserInstallManifest
    if (man.version !== 1 || typeof man.sha256 !== "string") return false
    if (man.sha256.toLowerCase() !== primaryDigest.toLowerCase()) return false
    const primaryBase = path.basename(primaryPath)
    if (man.primary && man.primary !== primaryBase) return false
    if (man.files && typeof man.files === "object") {
      for (const [name, want] of Object.entries(man.files)) {
        if (name === WHISPER_USER_INSTALL_MANIFEST) continue
        const fp = path.join(destDir, name)
        if (!fs.existsSync(fp)) return false
        const got = sha256FileSync(fp)
        if (got.toLowerCase() !== String(want).toLowerCase()) return false
      }
    }
    return true
  } catch {
    return false
  }
}

/** Write install.manifest.json after staging a user-local whisper install. */
export function writeUserWhisperInstallManifest(
  destDir: string,
  primaryName: string,
  source?: string,
): WhisperUserInstallManifest {
  const primaryPath = path.join(destDir, primaryName)
  const files: Record<string, string> = {}
  for (const name of fs.readdirSync(destDir)) {
    if (name === WHISPER_USER_INSTALL_MANIFEST) continue
    const fp = path.join(destDir, name)
    try {
      if (!fs.statSync(fp).isFile()) continue
      files[name] = sha256FileSync(fp)
    } catch {
      /* skip */
    }
  }
  const man: WhisperUserInstallManifest = {
    version: 1,
    primary: primaryName,
    sha256: files[primaryName] || sha256FileSync(primaryPath),
    files,
    installedAt: new Date().toISOString(),
    source,
  }
  fs.writeFileSync(
    path.join(destDir, WHISPER_USER_INSTALL_MANIFEST),
    JSON.stringify(man, null, 2),
    { mode: 0o600 },
  )
  return man
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
  const pin = opts.expectedSha256?.toLowerCase() || null
  /** Candidates that exist but fail pin — prefer later roots (e.g. user install) over early mismatch. */
  let mismatch: {
    path: string
    sha256: string
  } | null = null

  for (const root of opts.searchRoots) {
    for (const name of names) {
      const p = path.join(root, name)
      try {
        if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue
      } catch {
        continue
      }
      let digest: string
      try {
        digest = sha256FileSync(p)
      } catch (e: any) {
        return {
          ok: false,
          reason: "unreadable",
          arch,
          path: p,
          message: e?.message || "unreadable binary",
        }
      }
      if (pin) {
        if (digest !== pin) {
          // User-cache: accept only if install.manifest.json digests still match (no bare pin skip).
          const isUserInstall = p.includes(`${path.sep}bin${path.sep}whisper${path.sep}`)
          if (isUserInstall && verifyUserWhisperInstallManifest(path.dirname(p), p, digest)) {
            return { ok: true, path: p, arch, sha256: digest, pinned: false }
          }
          if (!mismatch) mismatch = { path: p, sha256: digest }
          continue
        }
        return { ok: true, path: p, arch, sha256: digest, pinned: true }
      }
      if (opts.allowUnpinned === false) {
        if (!mismatch) mismatch = { path: p, sha256: digest }
        continue
      }
      return { ok: true, path: p, arch, sha256: digest, pinned: false }
    }
  }

  if (mismatch) {
    return {
      ok: false,
      reason: "hash_mismatch",
      arch,
      path: mismatch.path,
      sha256: mismatch.sha256,
      message: pin
        ? `SHA256 mismatch for ${mismatch.path}`
        : "expectedSha256 required (allowUnpinned=false)",
    }
  }
  return {
    ok: false,
    reason: "not_found",
    arch,
    message: `cmspark-whisper not found under: ${opts.searchRoots.join(", ")}`,
  }
}

/** Default search roots relative to companion package (dev layout). */
export function defaultWhisperSearchRoots(companionRoot: string): string[] {
  return [
    path.join(companionRoot, "dist", "bin"),
    path.join(companionRoot, "bin"),
    path.join(companionRoot, "dist"),
    // Allow binary placed next to package root / SEA exe (not only under bin/).
    companionRoot,
  ]
}

/**
 * Full search list for production: companion module roots + packaged SEA layout.
 * package.sh stages → `<exeDir>/bin/cmspark-whisper-<arch>[.exe]`.
 * Without execPath roots, Windows SEA never finds the staged binary (__dirname is
 * not the install directory).
 */
export function allWhisperSearchRoots(opts?: {
  /** Module roots (same as defaultCompanionRoots / tests). */
  companionRoots?: string[]
  /** Override process.execPath (tests). */
  execPath?: string
  /** User-cache install dir (auto-download). Default: ~/.cmspark-agent/bin/whisper/<arch> */
  userInstallDir?: string | null
  /** Override arch for user-cache path. */
  arch?: string
  dataDir?: string
}): string[] {
  const companionRoots = opts?.companionRoots ?? []
  const seen = new Set<string>()
  const out: string[] = []
  const push = (dir: string) => {
    const abs = path.resolve(dir)
    if (!seen.has(abs)) {
      seen.add(abs)
      out.push(abs)
    }
  }
  const pushRoots = (packageRoot: string) => {
    for (const r of defaultWhisperSearchRoots(packageRoot)) {
      push(r)
    }
  }
  // Packaged SEA / companion first
  for (const root of companionRoots) pushRoots(root)
  const execPath = opts?.execPath ?? process.execPath
  if (typeof execPath === "string" && execPath) {
    try {
      pushRoots(path.dirname(execPath))
    } catch {
      /* ignore */
    }
  }
  // User auto-download cache (after packaged so ship-with-app wins)
  if (opts?.userInstallDir !== null) {
    const arch = opts?.arch ?? resolveWhisperArch()
    const userDir =
      opts?.userInstallDir || defaultWhisperBinaryInstallDir(arch, opts?.dataDir)
    if (userDir) push(userDir)
  }
  return out
}

/** Home-cache path for spike-downloaded CLI (not production ship path). */
export function spikeWhisperCacheDir(dataDir?: string): string {
  const base = dataDir || path.join(os.homedir(), ".cmspark-agent")
  return path.join(base, "spike", "whisper")
}

/**
 * User auto-download install dir: ~/.cmspark-agent/bin/whisper/<arch>
 * (same contract as whisper-binary-download.defaultWhisperBinaryInstallDir)
 */
export function defaultWhisperBinaryInstallDir(
  arch: string = resolveWhisperArch(),
  dataDir?: string,
): string {
  const base = dataDir || path.join(os.homedir(), ".cmspark-agent")
  return path.join(base, "bin", "whisper", arch)
}

/**
 * Dev/PATH fallback when packaged cmspark-whisper is missing or only a dyld-broken copy.
 * Returns absolute path to whisper-cli if found on PATH / common Homebrew locations.
 */
export function resolveWhisperCliOnPath(
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathEnv = process.env.PATH || ""
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)
  if (platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin")
  }
  const names = platform === "win32" ? ["whisper-cli.exe", "whisper-cli"] : ["whisper-cli"]
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name)
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
      } catch {
        /* continue */
      }
    }
  }
  return null
}
