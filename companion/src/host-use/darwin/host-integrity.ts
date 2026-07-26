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

import * as fs from "fs"
import * as crypto from "crypto"
import { promisify } from "util"
import { execFile } from "child_process"

const execFileAsync = promisify(execFile)

export interface HostIntegrityCheck {
  ok: boolean
  inode: number
  dev: number
  realpath: string
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
 * bundled companion JS. End users never run build-host.sh.
 */
export const CMSPARK_HOST_SHA256 = "c76eed837ac45c83c9626cec51e45c6dbfc6183410dceaf7654585f9e54fe6e4"

/**
 * Hash the binary at binPath via an open fd (avoids path-substitution race
 * between stat and read). Returns ok=true only if digest matches the pinned
 * constant. On any fs error, returns ok=false with sentinel inode/dev=-1.
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
    const digest = hash.digest("hex")
    return {
      ok: digest === CMSPARK_HOST_SHA256,
      inode: stat.ino,
      dev: stat.dev,
      realpath,
    }
  } catch {
    return { ok: false, inode: -1, dev: -1, realpath: "" }
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
      `Expected SHA256 ${CMSPARK_HOST_SHA256.slice(0, 16)}… at ${bin}. ` +
      `If you just rebuilt, run \`bash companion/src/host-use/darwin/build-host.sh\` ` +
      `to auto-update this constant. If not, treat the binary as compromised.`,
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
