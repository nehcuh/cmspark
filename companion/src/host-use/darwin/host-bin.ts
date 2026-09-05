// Shared cmspark-host binary resolution — single source of truth (audit M4).
// darwin/index.ts and darwin/adapter.ts previously each carried a private
// copy with DIVERGENT candidate lists (the adapter's copy missed the DMG
// staged layout, so readOne/writeOne/listReadTargets would ENOENT under
// packaged installs while hostRead worked). Both call sites now import this.

import * as path from "path"
import * as fs from "fs"

/**
 * Pure candidate list for host binary resolution (testable without env).
 * Order matters: packaged app prefers Contents/MacOS/CMspark (same TCC
 * product identity as the main process) over Resources/cmspark-host.
 */
export function resolveHostBinaryCandidates(fromDir: string): string[] {
  return [
    path.resolve(fromDir, "../MacOS/CMspark"),           // packaged preferred
    path.resolve(fromDir, "CMspark"),
    path.resolve(fromDir, "cmspark-host"),               // same-dir sibling (legacy DMG)
    path.resolve(fromDir, "../cmspark-host"),
    // compiled __dirname = <root>/companion/dist/host-use/darwin: up 2 to the
    // dist top level (companion/dist/cmspark-host) — dev-src __dirname misses
    // here (companion/src has no binary) and falls through to the dist hop below.
    path.resolve(fromDir, "../../cmspark-host"),
    // repo-root dist hop: from compiled darwin ../../../dist = <root>/companion/
    // dist; from dev-src ../../../dist also = <root>/companion/dist (host-bin.ts
    // always sits 3 dirs under the companion root). This is the dev-src hit and
    // the compiled-state fallback after ../../cmspark-host.
    path.resolve(fromDir, "../../../dist/cmspark-host"),
  ]
}

/**
 * Detect `Something.app/Contents` from the running agent entry or node binary.
 * Packaged CMspark always runs as:
 *   Resources/node  Resources/cmspark-agent.js …
 * so argv[1] / execPath sit under Contents/ — more reliable than esbuild
 * __dirname for finding MacOS/CMspark (TCC product identity).
 */
export function resolvePackagedContentsDir(
  argv1: string = process.argv[1] || "",
  execPath: string = process.execPath,
): string | null {
  const marker = `${path.sep}Contents${path.sep}`
  for (const raw of [argv1, execPath]) {
    if (!raw) continue
    let abs: string
    try {
      abs = path.resolve(raw)
    } catch {
      continue
    }
    if (!abs.includes(".app")) continue
    const idx = abs.indexOf(marker)
    if (idx === -1) continue
    return abs.slice(0, idx + `${path.sep}Contents`.length)
  }
  return null
}

export function resolveHostBinary(): string {
  // S-P0-1 (2026-07-24 diagnosis): CMSPARK_HOST_BIN was previously gated by
  // `NODE_ENV !== "production"` — but packaged Electron/pkg/SEA apps rarely
  // set NODE_ENV at all, so the override was live in production. A user-mode
  // attacker with `launchctl setenv CMSPARK_HOST_BIN /tmp/evil` could substitute
  // the binary that performs Touch ID (biometricVerify) and host_read — defeating
  // the Q1 ship blocker ("biometric per-call for writes is non-negotiable").
  //
  // Now: ONLY honored when an explicit opt-in env (`CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1`)
  // is set. This is intentionally separate from NODE_ENV so a misconfigured
  // NODE_ENV cannot re-open the hole. Tests that need to inject a mock binary
  // set CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1 in their setup.
  // KEEP existing override logic EXACTLY (dual opt-in / D10).
  if (process.env.CMSPARK_HOST_BIN) {
    if (process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE === "1") {
      return process.env.CMSPARK_HOST_BIN
    }
    throw new Error(
      "host-use/darwin: CMSPARK_HOST_BIN override ignored. " +
      "Set CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1 to enable (dev/test only).",
    )
  }

  // 0. Packaged .app (authoritative for TCC identity D4/D6)
  const contents = resolvePackagedContentsDir()
  if (contents) {
    const mainBin = path.join(contents, "MacOS", "CMspark")
    try {
      if (fs.existsSync(mainBin)) return mainBin
    } catch {
      /* continue */
    }
    const legacy = path.join(contents, "Resources", "cmspark-host")
    try {
      if (fs.existsSync(legacy)) return legacy
    } catch {
      /* continue */
    }
  }

  // 1–4. __dirname candidates (dev / staging / legacy layouts)
  const roots = new Set<string>()
  roots.add(__dirname)
  if (process.argv[1]) {
    try {
      roots.add(path.dirname(path.resolve(process.argv[1])))
    } catch {
      /* ignore */
    }
  }
  for (const root of roots) {
    for (const c of resolveHostBinaryCandidates(root)) {
      try {
        if (fs.existsSync(c)) return c
      } catch {
        // ignore — try next candidate
      }
    }
  }
  // Fall back to dev-mode path (will ENOENT at execFile with clear error
  // pointing to the missing binary; better than silent wrong-path).
  // See resolveHostBinaryCandidates: ../../../dist is the repo-root dist
  // layout from both compiled and dev-src __dirname (host-bin.ts always sits
  // 3 dirs under the companion root).
  return path.resolve(__dirname, "../../../dist/cmspark-host")
}
