// macOS emergency-stop (WP3 + adversarial review C2 + tray-owned ownership 2026-08).
//
// Architecture: CGEventTap hotkey → UNIX socket proof-of-life.
//
// Ownership model (platform analysis + triple review):
//   Preferred: Aqua-launched MacOS/CMspark starts `estop` as a child BEFORE
//   Node tray (see host.swift launchAgentTrayAndExit). Product TCC identity
//   owns the event tap.
//   Companion ensureEstopHelper(): CONNECT first (with grace for tray boot);
//   daemon spawn is last-resort fallback only (logged).
//
// Flow:
//   1. tray/app owns: spawn cmspark-host/CMspark estop --socket-path …
//   2. companion connects to socket before task start
//   3. abortCheck polls: socket dead → EMERGENCY_STOP_LOST; flag file → hotkey
//
// Key security property (C2 fix): a killed estop process frees the socket
// path, but NO other process can rebind it without killing the companion's
// existing connection. The companion detects socket EOF immediately.

import { spawn, type ChildProcess } from "child_process"
import { createConnection, type Socket } from "net"
import * as fs from "fs"
import { resolveHostBinary } from "../host-use/darwin/host-bin"
import { resolveIntegrityHostBin } from "../host-use/darwin/host-integrity"
import { logger } from "../logger"

const ESTOP_SOCK_PATH = "/tmp/cmspark-estop.sock"
const ESTOP_FLAG_PATH = "/tmp/cmspark-estop.flag"

/** Grace period for tray/Aqua-owned estop to appear before daemon fallback spawn. */
const TRAY_OWNED_CONNECT_ATTEMPTS = 30 // 30 * 100ms = 3s
const SPAWN_CONNECT_ATTEMPTS = 50 // 5s after spawn

export function estopSocketPath(): string { return ESTOP_SOCK_PATH }
export function estopFlagPath(): string  { return ESTOP_FLAG_PATH }

export interface EstopResult { ok: boolean; reason?: string }

/**
 * Connect to the UNIX socket (proof of liveness). Returns an open socket
 * or rejects if the estop helper is not reachable.
 */
async function connectToEstop(timeoutMs = 2000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(ESTOP_SOCK_PATH)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error("estop socket connect timeout"))
    }, timeoutMs)
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
 * estopHeartbeatLost() starts failing closed.
 */
let liveSock: Socket | null = null
let liveChild: ChildProcess | null = null

function holdSocket(sock: Socket): void {
  if (liveSock && !liveSock.destroyed) liveSock.destroy()
  liveSock = sock
  sock.on("error", () => { /* liveness via sock.destroyed */ })
  sock.pause()
}

function unlinkEstopSocket(): void {
  try {
    fs.unlinkSync(ESTOP_SOCK_PATH)
  } catch {
    /* not present */
  }
}

async function tryConnectHeld(attempts: number, gapMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const sock = await connectToEstop(400)
      holdSocket(sock)
      return true
    } catch {
      await new Promise((r) => setTimeout(r, gapMs))
    }
  }
  return false
}

/**
 * Spawn estop once (daemon fallback). Prefer tray/Aqua ownership instead.
 */
async function spawnEstopOnce(): Promise<EstopResult> {
  unlinkEstopSocket()
  const bin = resolveHostBinary()
  // P2 residual: long-lived host spawn must pass integrity gate (same as spawnHostBin)
  let safeBin: string
  try {
    safeBin = resolveIntegrityHostBin(bin)
  } catch (err) {
    logger.warn("computer.estop.integrity_failed", { bin, error: String(err) })
    return { ok: false, reason: (err as Error).message || "host integrity failed" }
  }
  logger.info("computer.estop.spawn", { bin: safeBin, sock: ESTOP_SOCK_PATH, owner: "daemon-fallback" })

  const child = spawn(safeBin, ["estop", "--socket-path", ESTOP_SOCK_PATH], {
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

  for (let i = 0; i < SPAWN_CONNECT_ATTEMPTS; i++) {
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
      const sock = await connectToEstop(400)
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
 * Ensure the estop helper is running.
 *
 * 1. Held socket still alive → ok
 * 2. Connect to tray/Aqua-owned helper (grace period for app boot)
 * 3. Last resort: daemon spawns helper (may hit CGEventTap/TCC code 4)
 */
export async function ensureEstopHelper(): Promise<EstopResult> {
  if (liveSock && !liveSock.destroyed) return { ok: true }

  // Prefer existing tray-owned helper — do not kill/rebind their socket.
  if (await tryConnectHeld(TRAY_OWNED_CONNECT_ATTEMPTS, 100)) {
    logger.info("computer.estop.connected", { owner: "external-or-tray" })
    return { ok: true }
  }

  // Explicit opt-out of daemon spawn (tests / policy)
  if (process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN === "1") {
    return {
      ok: false,
      reason:
        "estop socket not available (tray/Aqua should start estop; CMSPARK_ESTOP_NO_DAEMON_SPAWN=1)",
    }
  }

  logger.warn("computer.estop.daemon_fallback", {
    note: "tray-owned estop not up after grace — spawning from companion (may fail TCC)",
  })

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
 * Tray/dev path: start estop as child of this Node process when not already up.
 * Used when `cmspark-agent.js tray` runs without MacOS/CMspark parent (npm dev).
 * Packaged app path should already have estop from host.swift.
 */
export function startTrayOwnedEstopBestEffort(): void {
  if (process.platform !== "darwin") return
  // Fire-and-forget connect-or-spawn; don't block tray UI.
  void (async () => {
    try {
      if (await tryConnectHeld(3, 50)) {
        logger.info("computer.estop.connected", { owner: "preexisting" })
        return
      }
      const r = await spawnEstopOnce()
      if (r.ok) {
        logger.info("computer.estop.connected", { owner: "tray-node" })
      } else {
        logger.warn("computer.estop.tray_start_failed", { reason: r.reason })
      }
    } catch (err) {
      logger.warn("computer.estop.tray_start_error", { error: String(err) })
    }
  })()
}

export function consumeEstopFlag(): boolean {
  try {
    const content = fs.readFileSync(ESTOP_FLAG_PATH, "utf-8")
    const parsed = JSON.parse(content) as { timestamp?: number }
    if (typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < 30000) {
      fs.unlinkSync(ESTOP_FLAG_PATH)
      return true
    }
  } catch {
    // File does not exist or is unparseable
  }
  return false
}

export function clearEstopFlag(): void {
  try { fs.unlinkSync(ESTOP_FLAG_PATH) } catch { /* does not exist */ }
}

export function estopHeartbeatLost(): boolean {
  return liveSock === null || liveSock.destroyed
}
