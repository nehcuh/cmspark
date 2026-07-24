// App tab (WP3) — L0 no-arg launch engine (win32).
//
// Launch mechanics:
//   - exe entries   → spawn(entry.exe.path, [], {detached, stdio:"ignore",
//                     shell:false}) + unref — argv-only, no shell, no args
//                     (owner decision 1: auto = 仅启动免确认, and P1 ships no
//                     with-args op at all).
//   - AUMID entries → %SystemRoot%\explorer.exe shell:AppsFolder\<AUMID>
//                     (absolute explorer path — PATH-hijack immune, same
//                     philosophy as resolvePowerShellExe; explorer's shell:
//                     protocol is its documented internal mechanism, adversary
//                     D11 exemption). AUMID is re-validated against the D11
//                     regex AT EXEC TIME — config.json may have been
//                     hand-edited after the add-time schema check (ADR-010).
//
// Result determination (adversary D7 — semantic existence recheck, NOT a
// quick-exit heuristic): probe the process image by exact name BEFORE spawn
// and again ~2s AFTER spawn:
//   after.running && before.running  → "already_running"  (single-instance
//                                       app —网易云 stub hands off and exits;
//                                       this is SUCCESS, never a failure)
//   after.running && !before.running → "process_running"  (fresh start)
//   !after.running                   → "requested_no_pid" (honest: the launch
//                                       was requested but no same-image
//                                       process is detectable — a stub may
//                                       have handed off to a differently
//                                       named process; NOT reported as failed)
// AUMID launches are always "requested_no_pid" (explorer broker → no pid, no
// reliable image name to probe).
//
// Probe failures never block a launch (best-effort evidence); spawn-target
// absence (uninstalled / binary drift) DOES fail with a typed error.

import * as fs from "fs"
import * as path from "path"
import { spawn as cpSpawn } from "child_process"
import {
  runPs,
  resolveWinScript,
  parsePsJson,
  type PsRunner,
} from "../host-use/win/powershell"
import type { AppEntry } from "./types"

/** D11: PackageFamilyName!AppId — same regex as the WP1 schema, re-checked here. */
const AUMID_PATTERN = /^[\w.\-]+![\w.\-]+$/

/** Settle time between spawn and the post-launch existence probe (D7: ~2s). */
export const LAUNCH_SETTLE_WAIT_MS = 2000

export type LaunchEvidence = "process_running" | "already_running" | "requested_no_pid"

export interface LaunchOutcome {
  launched: true
  evidence: LaunchEvidence
  duration_ms: number
  /** Human-readable caveat for the honest-evidence cases. */
  detail?: string
}

export interface ProbeResult {
  running: boolean
  count: number
}

export type ProcessProbe = (imageName: string) => Promise<ProbeResult>

export interface LaunchDeps {
  /** Default: child_process.spawn. Injectable for tests. */
  spawn?: (file: string, args: string[], opts: Record<string, unknown>) => { unref?: () => void; on?: (ev: string, cb: (e: any) => void) => void }
  /** Default: apps-probe.ps1 via the argv-only runPs infra. Injectable. */
  probe?: ProcessProbe
  /** Default: fs.existsSync. Injectable. */
  exists?: (p: string) => boolean
  waitMs?: number
  /** Default: setTimeout-based sleep. Injectable for fast tests. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Process image name for the existence probe: exe basename minus the .exe
 * suffix (Get-Process ProcessName semantics). Deliberately NOT exeBasename()
 * from guards.ts — that helper is prefix-before-first-dot for fail-closed
 * denylist matching (W1), which would mis-probe multi-dot image names like
 * "my.app.exe" (real process name "my.app").
 */
export function processImageName(exePath: string): string {
  const segments = String(exePath || "").split(/[\\/]/)
  return (segments[segments.length - 1] || "").replace(/\.exe$/i, "")
}

/** Default probe — apps-probe.ps1 (exact ProcessName match, no wildcards). */
export async function probeProcess(
  imageName: string,
  runner: PsRunner = runPs,
): Promise<ProbeResult> {
  const stdout = await runner(resolveWinScript("apps-probe.ps1"), ["-ImageName", imageName], {
    timeoutMs: 10000,
  })
  const parsed = parsePsJson<{ running?: unknown; count?: unknown }>(stdout, "apps-probe")
  return {
    running: parsed.running === true,
    count: typeof parsed.count === "number" ? parsed.count : 0,
  }
}

function resolveExplorerExe(): string {
  return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "explorer.exe")
}

/**
 * Launch a whitelisted app (L0 no-arg). Resolves LaunchOutcome on a
 * successful spawn request (evidence may legitimately be "requested_no_pid");
 * throws Error on a missing spawn target or invalid AUMID (typed failures
 * the executor maps to {success:false}).
 */
export async function launchApp(entry: AppEntry, deps: LaunchDeps = {}): Promise<LaunchOutcome> {
  const startedAt = Date.now()
  const spawnFn = deps.spawn ?? ((file: string, args: string[], opts: Record<string, unknown>) => cpSpawn(file, args, opts as any))
  const probe = deps.probe ?? ((name: string) => probeProcess(name))
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const waitMs = deps.waitMs ?? LAUNCH_SETTLE_WAIT_MS

  const spawnDetached = (file: string, args: string[]) => {
    const child = spawnFn(file, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false,
    })
    // A late async spawn error (e.g. access denied after the existsSync
    // pre-check) must NOT crash the process as an unhandled 'error' event —
    // the post-spawn D7 probe is the honest evidence channel.
    child.on?.("error", () => { /* surfaced via the D7 probe, not here */ })
    child.unref?.()
  }

  // ---- AUMID branch (UWP) --------------------------------------------------
  if (entry.aumid) {
    const aumid = entry.aumid
    // D11: re-validate at exec time — the add-time schema check can be
    // bypassed by a hand-edited config.json (ADR-010 opt-in tampering).
    if (!AUMID_PATTERN.test(aumid)) {
      throw new Error(`invalid aumid "${aumid}" in app "${entry.token}" (must match PackageFamilyName!AppId — config tampering?)`)
    }
    const explorer = resolveExplorerExe()
    if (!exists(explorer)) {
      throw new Error(`explorer.exe not found at ${explorer} (cannot broker UWP launch)`)
    }
    spawnDetached(explorer, [`shell:AppsFolder\\${aumid}`])
    await sleep(waitMs)
    return {
      launched: true,
      evidence: "requested_no_pid",
      duration_ms: Date.now() - startedAt,
      detail: "UWP launch requested via explorer shell:AppsFolder — no pid or process probe is possible for a brokered UWP start",
    }
  }

  // ---- macOS bundleId branch ------------------------------------------------
  if (entry.bundleId) {
    // Use `open -b <bundleId>` to launch on macOS
    const child = spawnFn("/usr/bin/open", ["-b", entry.bundleId], {
      detached: true,
      stdio: "ignore",
    })
    child.on?.("error", () => { /* surfaced via probe */ })
    child.unref?.()
    await sleep(waitMs)
    return {
      launched: true,
      evidence: "requested_no_pid",
      duration_ms: Date.now() - startedAt,
      detail: `macOS launch requested via open -b ${entry.bundleId}`,
    }
  }

  // ---- exe branch (win32) --------------------------------------------------
  const exePath = entry.exe?.path
  if (!exePath) {
    throw new Error(`app "${entry.token}" has neither exe nor aumid (schema violation — entry should have been disabled)`)
  }
  if (!exists(exePath)) {
    throw new Error(`exe not found: ${exePath} (app uninstalled or binary moved — re-add it in the App tab)`)
  }
  const imageName = processImageName(exePath)

  // D7 pre-launch probe — distinguishes a fresh start from a single-instance
  // app that is ALREADY running (stub-launcher hand-off must read as
  // "already_running", never as a failed launch).
  let before: ProbeResult = { running: false, count: 0 }
  try {
    before = await probe(imageName)
  } catch {
    // Probe failure must not block the launch — evidence degrades honestly.
  }

  spawnDetached(exePath, [])
  await sleep(waitMs)

  let after: ProbeResult = before
  let probeFailed = false
  try {
    after = await probe(imageName)
  } catch {
    probeFailed = true
  }

  const evidence: LaunchEvidence = after.running
    ? before.running ? "already_running" : "process_running"
    : "requested_no_pid"
  const detail = evidence === "requested_no_pid"
    ? probeFailed
      ? `launch requested; process probe unavailable — cannot confirm "${imageName}" is running`
      : `launch requested; no running "${imageName}" process detected after ${waitMs}ms — the app may have handed off to a differently-named process (stub launcher) or exited on its own`
    : undefined
  return {
    launched: true,
    evidence,
    duration_ms: Date.now() - startedAt,
    ...(detail ? { detail } : {}),
  }
}
