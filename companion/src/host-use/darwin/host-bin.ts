// Shared cmspark-host binary resolution — single source of truth (audit M4).
// darwin/index.ts and darwin/adapter.ts previously each carried a private
// copy with DIVERGENT candidate lists (the adapter's copy missed the DMG
// staged layout, so readOne/writeOne/listReadTargets would ENOENT under
// packaged installs while hostRead worked). Both call sites now import this.

import * as path from "path"
import * as fs from "fs"

export function resolveHostBinary(): string {
  // S-P0-1 (2026-07-24 diagnosis): CMSPARK_HOST_BIN was previously gated by
  // `NODE_ENV !== "production"` — but packaged Electron/pkg/S EA apps rarely
  // set NODE_ENV at all, so the override was live in production. A user-mode
  // attacker with `launchctl setenv CMSPARK_HOST_BIN /tmp/evil` could substitute
  // the binary that performs Touch ID (biometricVerify) and host_read — defeating
  // the Q1 ship blocker ("biometric per-call for writes is non-negotiable").
  //
  // Now: ONLY honored when an explicit opt-in env (`CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1`)
  // is set. This is intentionally separate from NODE_ENV so a misconfigured
  // NODE_ENV cannot re-open the hole. Tests that need to inject a mock binary
  // set CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1 in their setup.
  if (process.env.CMSPARK_HOST_BIN) {
    if (process.env.CMSPARK_ALLOW_HOST_BIN_OVERRIDE === "1") {
      return process.env.CMSPARK_HOST_BIN
    }
    throw new Error(
      "host-use/darwin: CMSPARK_HOST_BIN override ignored. " +
      "Set CMSPARK_ALLOW_HOST_BIN_OVERRIDE=1 to enable (dev/test only).",
    )
  }
  // Search order covers 4 deployment modes:
  //   1. DMG / packaged install: the bundled cmspark-agent.js sits in
  //      <App>/Contents/Resources with cmspark-host as a SAME-DIR sibling
  //      (__dirname IS the staging dir once bundled — do not assume it is
  //      one level below, or Touch ID/biometric-verify ENOENTs and silently
  //      downgrades to the manual-nonce gate).
  //   2. Unbundled staging: STAGING/<sub>/cmspark-agent.js + STAGING/cmspark-host
  //      (binary one level up from the entry's dir).
  //   3. npm dev mode: companion/dist/host-use/darwin/index.js → projectRoot = companion/
  //      binary at companion/dist/cmspark-host (3 levels up from darwin/)
  //   4. Repo root scripts: rare; check both candidates and return whichever exists.
  const candidates = [
    path.resolve(__dirname, "cmspark-host"),              // same-dir sibling (DMG bundle)
    path.resolve(__dirname, "../cmspark-host"),           // staged one level up
    path.resolve(__dirname, "../../cmspark-host"),        // alt staging layout
    path.resolve(__dirname, "../../dist/cmspark-host"),   // dev mode: companion/dist/
    path.resolve(__dirname, "../../../dist/cmspark-host"),// dev mode: repo-root/dist/
  ]
  for (const c of candidates) {
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
