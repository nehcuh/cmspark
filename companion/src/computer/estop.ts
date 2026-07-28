// Emergency-stop preflight + flag paths (WP2, plan §E.6).
//
// Three abort channels:
//   1. PS resident hotkey helper (computer-estop.ps1, Ctrl+Alt+End) writes
//      %TEMP%/cmspark-computer/estop.flag on press — the executor's abortCheck
//      polls for the file, and computer-input.ps1 checks it mid-type
//      (-StopFile) so a long type batch stops between characters.
//   2. Panel WS abort (computer.task.abort) — the server's task registry,
//      polled by the same abortCheck.
//   3. Budget exhaustion — already in-executor (BUDGET_DENIED re-L2).
//
// Preflight (fail-closed): a computer task may ONLY start while the hotkey
// helper is alive — ready.json must parse, hotkeyOk must be true, and the
// heartbeat must be fresher than ESTOP_HEARTBEAT_MAX_AGE_MS. Otherwise the
// server refuses with EMERGENCY_STOP_UNAVAILABLE: an injection loop with no
// working kill switch must never start.

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { resolveWinScript } from "../host-use/win/powershell"
import { computerTempDir } from "./win-adapters"

/** fs surface the preflight needs (injectable for unit tests). */
export interface EstopFsLike {
  readFileSync(p: string, enc: "utf8"): string
  existsSync(p: string): boolean
  rmSync(p: string, opts?: { force?: boolean }): unknown
}

/** Optional process liveness probe (injectable for tests). */
export type EstopProcessAlive = (pid: number) => boolean

export interface EstopReadyFile {
  pid?: number
  hotkeyOk?: boolean
  /** epoch ms of the helper's last heartbeat write. */
  heartbeat?: number
}

export interface EstopStatus {
  ok: boolean
  reason?: string
  ready?: EstopReadyFile
}

export interface EstopCheckDeps {
  fs?: EstopFsLike
  now?: () => number
  /** Override the cmspark-computer temp dir (tests). */
  dir?: string
  maxAgeMs?: number
  /** Return true if the helper PID is still a live process. */
  isProcessAlive?: EstopProcessAlive
}

export const ESTOP_HEARTBEAT_MAX_AGE_MS = 3000

export function estopReadyPath(dir?: string): string {
  return path.join(dir ?? computerTempDir(), "estop-ready.json")
}

export function estopFlagPath(dir?: string): string {
  return path.join(dir ?? computerTempDir(), "estop.flag")
}

function fsOf(deps: EstopCheckDeps): EstopFsLike {
  return deps.fs ?? (fs as unknown as EstopFsLike)
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    // signal 0 = existence check; throws ESRCH if gone (Windows too on Node)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Remove ready.json tombstone left by a killed helper (finally may not run). */
export function clearEstopReady(deps: EstopCheckDeps = {}): void {
  try {
    fsOf(deps).rmSync(estopReadyPath(deps.dir), { force: true })
  } catch {
    /* best-effort */
  }
}

/** One-shot readiness check — never throws (a broken helper = NOT ready). */
export function checkEstopReady(deps: EstopCheckDeps = {}): EstopStatus {
  const f = fsOf(deps)
  const now = deps.now ?? (() => Date.now())
  const maxAge = deps.maxAgeMs ?? ESTOP_HEARTBEAT_MAX_AGE_MS
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive
  let raw: string
  try {
    raw = f.readFileSync(estopReadyPath(deps.dir), "utf8")
  } catch {
    return { ok: false, reason: "estop helper ready file missing (helper not running)" }
  }
  let ready: EstopReadyFile
  try {
    ready = JSON.parse(raw) as EstopReadyFile
  } catch {
    return { ok: false, reason: "estop helper ready file is corrupt" }
  }
  if (ready.hotkeyOk !== true) {
    return { ok: false, reason: "estop helper reports hotkey registration failed", ready }
  }
  // Dead PID + leftover ready.json (kill -9 / taskkill) is the common "stale
  // for days" failure mode — surface it explicitly before age math.
  if (typeof ready.pid === "number" && !isAlive(ready.pid)) {
    return {
      ok: false,
      reason: `estop helper process not running (pid ${ready.pid} dead; ready.json is a tombstone)`,
      ready,
    }
  }
  const hb = typeof ready.heartbeat === "number" ? ready.heartbeat : 0
  const age = now() - hb
  if (age > maxAge) {
    return { ok: false, reason: `estop helper heartbeat stale (${age}ms > ${maxAge}ms)`, ready }
  }
  return { ok: true, ready }
}

/** Hotkey flag present = Ctrl+Alt+End was pressed since the last clear. */
export function consumeEstopFlag(deps: EstopCheckDeps = {}): boolean {
  try {
    return fsOf(deps).existsSync(estopFlagPath(deps.dir))
  } catch {
    return false
  }
}

/**
 * Clear the flag at task start — a STALE press (before this task) must never
 * abort a fresh run. The flag file's mere existence is the signal, so the
 * helper re-creates it on every press.
 */
export function clearEstopFlag(deps: EstopCheckDeps = {}): void {
  try {
    fsOf(deps).rmSync(estopFlagPath(deps.dir), { force: true })
  } catch {
    /* best-effort */
  }
}

/** Last spawn diagnostic (script missing / spawn error) for ensureEstopHelper reason. */
let lastSpawnDiag: string | undefined

export function getLastEstopSpawnDiag(): string | undefined {
  return lastSpawnDiag
}

/**
 * Production spawn: powershell running computer-estop.ps1.
 *
 * Windows note: `detached: true` makes `powershell -File computer-estop.ps1`
 * exit immediately (code 1) with no ready.json — verified 2026-07-28. Keep the
 * helper as a normal child (stdio ignored, windowsHide) so Add-Type + the
 * heartbeat loop actually run. unref() still lets the event loop idle; helper
 * lifetime tracks the companion process (desired for kill-switch co-lifetime).
 */
export function spawnEstopHelper(scriptPath: string = resolveWinScript("computer-estop.ps1")): void {
  lastSpawnDiag = undefined
  if (!fs.existsSync(scriptPath)) {
    // Packaged SEA without host-scripts-win/ next to the exe is the common
    // "ready file missing" root cause — surface the path, not only ENOENT later.
    lastSpawnDiag = `computer-estop.ps1 not found at ${scriptPath} (stage host-scripts-win next to cmspark-agent.exe)`
    console.error(`[estop] ${lastSpawnDiag}`)
    return
  }
  const ps = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe"
  const child = spawn(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  })
  // Spawn failure (e.g. powershell.exe missing) is delivered ASYNCHRONOUSLY as
  // an 'error' event — the try/catch in ensureEstopHelper cannot see it, and
  // an unhandled 'error' on a ChildProcess becomes an uncaughtException that
  // kills the whole daemon (crash.log 2026-07-21). Swallow it here: the
  // preflight's ready-file polling already surfaces "helper never came up" as
  // a fail-closed EMERGENCY_STOP_UNAVAILABLE refusal.
  child.on("error", (err) => {
    lastSpawnDiag = `spawn failed: ${err.message} (script=${scriptPath})`
    console.error(`[estop] ${lastSpawnDiag}`)
  })
  child.unref()
}

export interface EnsureEstopDeps extends EstopCheckDeps {
  /** Injectable for tests; production default spawns the ps1 helper. */
  spawnHelper?: () => void
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  intervalMs?: number
}

/**
 * Preflight gate: if the helper is not ready, spawn it and poll until its
 * first heartbeat lands. Returns the last status — callers refuse the task
 * on !ok (EMERGENCY_STOP_UNAVAILABLE).
 *
 * Critical: a dead helper often leaves estop-ready.json behind (taskkill
 * skips the ps1 `finally` cleanup). Without clearing that tombstone, spawn
 * + poll keeps reading the same multi-day-stale heartbeat and never recovers.
 */
export async function ensureEstopHelper(deps: EnsureEstopDeps = {}): Promise<EstopStatus> {
  const first = checkEstopReady(deps)
  if (first.ok) return first
  // Drop tombstone / corrupt ready so the next Write-Heartbeat is the only file.
  clearEstopReady(deps)
  const spawnHelper = deps.spawnHelper ?? (() => spawnEstopHelper())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  // ~8 * 350ms ≈ 2.8s was tight when powershell cold-starts Add-Type; give more.
  const attempts = deps.attempts ?? 20
  const intervalMs = deps.intervalMs ?? 400
  try {
    spawnHelper()
  } catch {
    /* fall through to polling — an instance may already be starting */
  }
  let last = first
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs)
    last = checkEstopReady(deps)
    if (last.ok) return last
  }
  // Last-ditch: one more spawn if still missing (first spawn may have raced
  // with a dying shell that re-deleted ready.json in its finally).
  if (!last.ok) {
    try {
      clearEstopReady(deps)
      spawnHelper()
    } catch {
      /* ignore */
    }
    for (let i = 0; i < 10; i++) {
      await sleep(intervalMs)
      last = checkEstopReady(deps)
      if (last.ok) return last
    }
  }
  // Attach spawn diag so "script not found" is not masked as ready-file-missing.
  if (!last.ok && lastSpawnDiag) {
    return { ...last, reason: `${last.reason ?? "estop helper not ready"}; ${lastSpawnDiag}` }
  }
  return last
}

/**
 * In-flight watchdog (adversary WP2 X1 / §E.6). The takeoff preflight checks
 * helper health ONCE; the server's abortCheck polls THIS during the task
 * (before every action, inside waits, immediately before SendInput). Returns
 * true when the helper is unhealthy — ready file missing/corrupt, hotkey
 * lost, or heartbeat older than maxAgeMs — because a dead helper means the
 * Ctrl+Alt+End hotkey silently stops working: an injection loop whose kill
 * switch died must fail CLOSED and abort (EMERGENCY_STOP_LOST).
 *
 * Documented residual: a disk failure that stalls the heartbeat WRITE also
 * trips this — the abort direction is fail-closed, which is acceptable.
 */
export function estopHeartbeatLost(deps: EstopCheckDeps = {}): boolean {
  return !checkEstopReady(deps).ok
}
