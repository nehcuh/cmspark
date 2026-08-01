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
    path.resolve(fromDir, "../../cmspark-host"),
    path.resolve(fromDir, "../../dist/cmspark-host"),
    path.resolve(fromDir, "../../../dist/cmspark-host"),
  ]
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
  // Search order covers packaged + legacy DMG + staging + npm dev modes:
  //   1. Packaged app: __dirname = Contents/Resources → prefer ../MacOS/CMspark
  //      so host IPC inherits the main binary's TCC product identity (D6/A3/A18).
  //   2. Legacy DMG: cmspark-host as same-dir sibling under Resources.
  //   3. Unbundled staging: binary one level up or under dist/.
  //   4. npm dev: companion/dist/cmspark-host from host-use/darwin/.
  for (const c of resolveHostBinaryCandidates(__dirname)) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // ignore — try next candidate
    }
  }
  // Fall back to dev-mode path (will ENOENT at execFile with clear error
  // pointing to the missing binary; better than silent wrong-path).
  return path.resolve(__dirname, "../../dist/cmspark-host")
}
