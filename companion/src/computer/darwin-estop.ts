// macOS emergency-stop (WP3 + adversarial review C2).
//
// Architecture: CGEventTap hotkey → UNIX socket proof-of-life.
// Replaces the Windows file-heartbeat model with process-level liveness.
//
// Flow:
//   1. spawn cmspark-host estop --socket-path /tmp/cmspark-estop.sock
//      → registers Ctrl+Shift+Alt+Cmd+E as global hotkey
//      → listens on UNIX socket for ECHO commands
//      → on hotkey press: writes estop.flag + pushes event over socket
//   2. companion connects to socket before task start
//   3. abortCheck polls: socket.read() fails? → EMERGENCY_STOP_LOST
//                        consumeEstopFlag() → file changed since task start? → "hotkey"
//
// Key security property (C2 fix): a killed estop process frees the socket
// path, but NO other process can rebind it without killing the companion's
// existing connection. The companion detects socket EOF immediately.

import { spawn, type ChildProcess } from "child_process"
import { createConnection, type Socket } from "net"
import * as fs from "fs"
import { resolveHostBinary } from "../host-use/darwin/host-bin"
import { logger } from "../logger"

const ESTOP_SOCK_PATH = "/tmp/cmspark-estop.sock"
const ESTOP_FLAG_PATH = "/tmp/cmspark-estop.flag"

export function estopSocketPath(): string { return ESTOP_SOCK_PATH }
export function estopFlagPath(): string  { return ESTOP_FLAG_PATH }

export interface EstopResult { ok: boolean; reason?: string }

/**
 * Connect to the UNIX socket (proof of liveness). Returns an open socket
 * or rejects if the estop helper is not reachable.
 */
async function connectToEstop(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(ESTOP_SOCK_PATH)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error("estop socket connect timeout"))
    }, 2000)
    sock.on("connect", () => {
      clearTimeout(timer)
      resolve(sock)
    })
    sock.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Held proof-of-life connection (C2). ensureEstopHelper keeps this socket
 * OPEN after connecting; the helper dying closes it (EOF) and
 * estopHeartbeatLost() starts failing closed. Matches the header flow:
 * "abortCheck polls: socket.read() fails? → EMERGENCY_STOP_LOST".
 */
let liveSock: Socket | null = null
let liveChild: ChildProcess | null = null

function holdSocket(sock: Socket): void {
  if (liveSock && !liveSock.destroyed) liveSock.destroy()
  liveSock = sock
  // A dead helper errors/closes the connection asynchronously — without an
  // 'error' listener that surfaces as an uncaughtException and kills the
  // daemon (same crash class as the 2026-07-21 powershell ENOENT).
  sock.on("error", () => { /* liveness is read via sock.destroyed */ })
  sock.pause()  // "estop\n" event lines are advisory; flag file is the signal
}

function unlinkEstopSocket(): void {
  try {
    fs.unlinkSync(ESTOP_SOCK_PATH)
  } catch {
    /* not present */
  }
}

/**
 * Spawn estop once; return ok or a diagnostic reason (includes stderr snippet).
 */
async function spawnEstopOnce(): Promise<EstopResult> {
  unlinkEstopSocket()
  const bin = resolveHostBinary()
  logger.info("computer.estop.spawn", { bin, sock: ESTOP_SOCK_PATH })

  const child = spawn(bin, ["estop", "--socket-path", ESTOP_SOCK_PATH], {
    detached: false,
    stdio: ["ignore", "ignore", "pipe"],
    env: process.env,
  })
  liveChild = child

  let stderrBuf = ""
  child.stderr?.on("data", (d: Buffer | string) => {
    stderrBuf += String(d)
    if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000)
  })

  let earlyExit: number | null = null
  child.on("error", (err) => {
    earlyExit = -1
    logger.warn("computer.estop.spawn_error", { bin, error: String(err) })
  })
  child.on("exit", (code) => {
    earlyExit = code ?? -1
    if (liveChild === child) liveChild = null
  })
  // Do NOT unref until connected — keeps lifecycle tied to successful start.

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (earlyExit !== null) {
      const snip = stderrBuf.trim().slice(0, 400)
      logger.warn("computer.estop.early_exit", { bin, code: earlyExit, stderr: snip })
      return {
        ok: false,
        reason:
          `estop helper exited at startup (code ${earlyExit})` +
          (snip ? `: ${snip}` : " — check Accessibility + Input Monitoring for CMspark"),
      }
    }
    try {
      const sock = await connectToEstop()
      holdSocket(sock)
      child.unref()
      return { ok: true }
    } catch {
      /* retry */
    }
  }

  try {
    child.kill()
  } catch {
    /* ignore */
  }
  return { ok: false, reason: `estop helper did not start within 5s (bin=${bin})` }
}

/**
 * Ensure the estop helper is running. Spawns it if not already alive.
 * Returns ok:true when the helper is connected and the hotkey is registered.
 *
 * Retries once on exit code 4 (CGEventTap / Accessibility) so a just-granted
 * TCC prompt can take effect without requiring a full daemon restart.
 */
export async function ensureEstopHelper(): Promise<EstopResult> {
  // 1. Held connection from a previous task still alive?
  if (liveSock && !liveSock.destroyed) return { ok: true }

  // 2. Try connecting to an already-running helper
  try {
    const sock = await connectToEstop()
    holdSocket(sock)
    return { ok: true }
  } catch {
    // Not running — spawn
  }

  // 3. Spawn (retry once on Accessibility/tap failure)
  let last: EstopResult = { ok: false, reason: "estop not started" }
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await spawnEstopOnce()
    if (last.ok) return last
    const code4 = last.reason?.includes("code 4")
    if (!code4 || attempt === 2) break
    logger.info("computer.estop.retry_after_ax", { attempt, reason: last.reason })
    await new Promise((r) => setTimeout(r, 1500))
  }
  return last
}

/**
 * Consume the estop flag file. Returns true if the flag was written after
 * the task start and within the last 30 seconds (fresh press).
 */
export function consumeEstopFlag(): boolean {
  try {
    const content = fs.readFileSync(ESTOP_FLAG_PATH, "utf-8")
    const parsed = JSON.parse(content) as { timestamp?: number }
    if (typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < 30000) {
      fs.unlinkSync(ESTOP_FLAG_PATH)
      return true
    }
  } catch {
    // File does not exist or is unparseable — no flag to consume
  }
  return false
}

/** Clear the estop flag before a new task starts (stale press from previous task). */
export function clearEstopFlag(): void {
  try { fs.unlinkSync(ESTOP_FLAG_PATH) } catch { /* does not exist */ }
}

/**
 * Check if the estop helper is still alive via the HELD proof-of-life socket:
 * a closed/errored connection means the helper process died → fail closed
 * (EMERGENCY_STOP_LOST). Before the first successful ensureEstopHelper()
 * there is no held connection, which also reads as "lost" (fail-closed).
 *
 * NOTE: the previous implementation called createConnection() inside a
 * synchronous try/catch — connection failure is ASYNC, so it could never
 * catch anything and ALWAYS returned false ("alive"): a dead helper's kill
 * switch silently looked healthy.
 */
export function estopHeartbeatLost(): boolean {
  return liveSock === null || liveSock.destroyed
}
