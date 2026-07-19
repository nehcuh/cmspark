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

/** One-shot readiness check — never throws (a broken helper = NOT ready). */
export function checkEstopReady(deps: EstopCheckDeps = {}): EstopStatus {
  const f = fsOf(deps)
  const now = deps.now ?? (() => Date.now())
  const maxAge = deps.maxAgeMs ?? ESTOP_HEARTBEAT_MAX_AGE_MS
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

/** Production spawn: detached powershell running computer-estop.ps1. */
export function spawnEstopHelper(scriptPath: string = resolveWinScript("computer-estop.ps1")): void {
  const ps = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe"
  const child = spawn(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
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
 */
export async function ensureEstopHelper(deps: EnsureEstopDeps = {}): Promise<EstopStatus> {
  const first = checkEstopReady(deps)
  if (first.ok) return first
  const spawnHelper = deps.spawnHelper ?? (() => spawnEstopHelper())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const attempts = deps.attempts ?? 8
  const intervalMs = deps.intervalMs ?? 350
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
