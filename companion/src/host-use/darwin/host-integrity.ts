// S-P0-2 integrity guard for cmspark-host spawn paths.
//
// Mirrors swift-tray-bridge.ts:42-185: open fd → sha256 → capture inode+dev →
// spawn via realpath → post-spawn re-stat. Catches path-substitution TOCTOU
// between hash and exec; rejects binary mismatch pre-spawn.
//
// Used by BOTH:
//   - host-use/darwin/adapter.ts defaultDarwinRunner (mail/notes/files/biometric)
//   - computer/darwin-adapters.ts inject paths (click/type/key/scroll/drag)
//
// The single spawnHostBin() helper below is the authoritative spawn surface —
// do not call execFileAsync on cmspark-host directly elsewhere.
//
// Packaged TCC identity (2026-08-01): Contents/MacOS/CMspark is re-signed by
// `codesign --deep` at DMG time, which changes the file SHA256. The pinned
// CMSPARK_HOST_SHA256 still matches `companion/dist/cmspark-host` (dev). For
// binaries inside `*.app/Contents/`, we accept a verified codesign identity
// of com.cmspark.agent instead of the pre-sign pin (Pi dual-review B1).

import * as fs from "fs"
import * as crypto from "crypto"
import { promisify } from "util"
import { execFile, execFileSync, spawnSync } from "child_process"
import * as path from "path"

const execFileAsync = promisify(execFile)

/** Product identity embedded in host-Info.plist / codesign Identifier. */
export const CMSPARK_HOST_CODESIGN_ID = "com.cmspark.agent"

export interface HostIntegrityCheck {
  ok: boolean
  inode: number
  dev: number
  realpath: string
  /** How ok was decided — useful for tests/diagnostics. */
  reason?: "sha256" | "codesign-product" | "mismatch" | "error"
}

/**
 * Expected SHA256 of dist/cmspark-host. Updated automatically by build-host.sh
 * on every rebuild via perl in-place edit on the line below.
 *
 * DEV-TIME NOTE: every `bash build-host.sh` run mutates this constant in your
 * working tree. Commit the change in the same commit as any binary-affecting
 * change. CI (option A) asserts: if host.swift or host.entitlements change in
 * a PR, this constant must also change in the same PR.
 *
 * PROD-TIME NOTE: DMG installs ship with this constant pre-baked into the
 * bundled companion JS for the *pre-package* dist binary. Packaged
 * MacOS/CMspark is deep-signed and will NOT match this pin; see
 * codesignProductIdentityOk path in checkHostIntegrity.
 */
export const CMSPARK_HOST_SHA256 = "952c126b55902f4a10f4d74e7ed4d905f938144cff961e0797afb3ebad888758"

/**
 * True when realpath is inside a macOS .app Contents tree (packaged install).
 */
export function isPackagedAppHostPath(realpath: string): boolean {
  const norm = path.normalize(realpath)
  // POSIX and accidental backslash paths
  if (/\.app\/Contents\//i.test(norm)) return true
  if (norm.toLowerCase().includes(`${path.sep}.app${path.sep}contents${path.sep}`)) return true
  return false
}

/**
 * codesign --verify + Identifier=com.cmspark.agent (adhoc OK).
 * Used for packaged main binary whose SHA drifts after create-dmg deep-sign.
 */
export function codesignProductIdentityOk(binPath: string): boolean {
  try {
    execFileSync("codesign", ["--verify", binPath], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    return false
  }
  // codesign -dv writes metadata to stderr (exit 0)
  const r = spawnSync("codesign", ["-dv", binPath], { encoding: "utf-8" })
  const meta = `${r.stdout || ""}\n${r.stderr || ""}`
  const m = meta.match(/^Identifier=(.+)$/m)
  if (!m) return false
  return m[1].trim() === CMSPARK_HOST_CODESIGN_ID
}

/**
 * Hash the binary at binPath via an open fd (avoids path-substitution race
 * between stat and read). Returns ok=true if:
 *   - digest matches CMSPARK_HOST_SHA256 (dev / pre-package dist), OR
 *   - path is inside *.app/Contents/ AND codesign verifies as com.cmspark.agent
 *
 * Exported for unit testing. Production callers should use spawnHostBin().
 */
export function checkHostIntegrity(binPath: string): HostIntegrityCheck {
  let fd: number | null = null
  try {
    const realpath = fs.realpathSync(binPath)
    fd = fs.openSync(realpath, "r")
    const stat = fs.fstatSync(fd)
    const hash = crypto.createHash("sha256")
    const BUF = Buffer.alloc(64 * 1024)
    while (true) {
      const n = fs.readSync(fd, BUF, 0, BUF.length, null)
      if (n === 0) break
      hash.update(BUF.slice(0, n))
    }
    // Close before codesign so we don't hold exclusive locks
    try { fs.closeSync(fd) } catch { /* ignore */ }
    fd = null

    const digest = hash.digest("hex")
    if (digest === CMSPARK_HOST_SHA256) {
      return {
        ok: true,
        inode: stat.ino,
        dev: stat.dev,
        realpath,
        reason: "sha256",
      }
    }

    // Packaged app: deep-sign changes SHA; trust codesign product identity.
    if (isPackagedAppHostPath(realpath) && codesignProductIdentityOk(realpath)) {
      return {
        ok: true,
        inode: stat.ino,
        dev: stat.dev,
        realpath,
        reason: "codesign-product",
      }
    }

    return {
      ok: false,
      inode: stat.ino,
      dev: stat.dev,
      realpath,
      reason: "mismatch",
    }
  } catch {
    return { ok: false, inode: -1, dev: -1, realpath: "", reason: "error" }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  }
}

/** Exported for unit testing. */
export function getExpectedHash(): string {
  return CMSPARK_HOST_SHA256
}

export function statInodeDev(p: string): { inode: number; dev: number } | null {
  try {
    const s = fs.statSync(p)
    return { inode: s.ino, dev: s.dev }
  } catch {
    return null
  }
}

export interface SpawnHostBinOpts {
  timeoutMs?: number
}

/**
 * P2 residual: resolve cmspark-host path for *long-lived* spawns (estop, ax-watch)
 * after the same integrity gate as spawnHostBin. Callers then `spawn(realpath, …)`.
 * Returns the realpath to exec; throws on integrity failure.
 */
export function resolveIntegrityHostBin(bin: string): string {
  if (process.env.CMSPARK_SKIP_HOST_INTEGRITY === "1") {
    try {
      return fs.realpathSync(bin)
    } catch {
      return bin
    }
  }
  const pre = checkHostIntegrity(bin)
  if (!pre.ok) {
    throw new Error(
      `[host-integrity] Binary integrity check FAILED — refusing long-lived spawn. ` +
        `Expected SHA256 ${CMSPARK_HOST_SHA256.slice(0, 16)}… or codesign ` +
        `Identifier=${CMSPARK_HOST_CODESIGN_ID} inside *.app/Contents/ at ${bin}. ` +
        `If you just rebuilt, run \`bash companion/src/host-use/darwin/build-host.sh\` ` +
        `to auto-update the pin. If not, treat the binary as compromised.`,
    )
  }
  return pre.realpath
}

/**
 * Spawn cmspark-host with integrity gate + post-spawn TOCTOU re-stat.
 *
 * - Hashes the binary from an open fd pre-spawn (matches swift-tray-bridge.ts
 *   pattern; closes the path-substitution race between stat and read).
 * - Spawns via realpath (closes path-substitution TOCTOU between hash and exec).
 * - Re-stats inode+dev post-spawn; throws if they changed (substitution during
 *   the microseconds between hash and execve).
 *
 * Dev escape hatch: CMSPARK_SKIP_HOST_INTEGRITY=1 bypasses the gate entirely
 * (mirrors host-bin.ts:22-30 CMSPARK_ALLOW_HOST_BIN_OVERRIDE pattern; separate
 * env so the two consent scopes cannot collide).
 *
 * Returns stdout on success. Throws Error on integrity failure, TOCTOU
 * detected, or underlying execFile error (caller wraps in domain-specific
 * ComputerError / HostError as appropriate).
 */
export async function spawnHostBin(
  bin: string,
  args: string[],
  opts?: SpawnHostBinOpts,
): Promise<string> {
  const skipIntegrity = process.env.CMSPARK_SKIP_HOST_INTEGRITY === "1"

  if (skipIntegrity) {
    const result = await execFileAsync(bin, args, {
      encoding: "utf-8",
      timeout: opts?.timeoutMs,
    })
    return String(result.stdout)
  }

  const pre = checkHostIntegrity(bin)
  if (!pre.ok) {
    throw new Error(
      `[host-integrity] Binary integrity check FAILED — refusing to spawn. ` +
      `Expected SHA256 ${CMSPARK_HOST_SHA256.slice(0, 16)}… or codesign ` +
      `Identifier=${CMSPARK_HOST_CODESIGN_ID} inside *.app/Contents/ at ${bin}. ` +
      `If you just rebuilt, run \`bash companion/src/host-use/darwin/build-host.sh\` ` +
      `to auto-update the pin. If not, treat the binary as compromised.`,
    )
  }

  const result = await execFileAsync(pre.realpath, args, {
    encoding: "utf-8",
    timeout: opts?.timeoutMs,
  })

  const post = statInodeDev(pre.realpath)
  if (!post || post.inode !== pre.inode || post.dev !== pre.dev) {
    throw new Error(
      `[host-integrity] Post-spawn inode/dev mismatch — TOCTOU detected at ${bin} ` +
      `(pre inode=${pre.inode} dev=${pre.dev}, post inode=${post?.inode} dev=${post?.dev}). ` +
      `Possible binary substitution during spawn.`,
    )
  }

  return String(result.stdout)
}
