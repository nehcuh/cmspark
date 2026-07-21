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
 * Ensure the estop helper is running. Spawns it if not already alive.
 * Returns ok:true when the helper is connected and the hotkey is registered.
 */
export async function ensureEstopHelper(): Promise<EstopResult> {
  // 1. Try existing connection
  try {
    const sock = await connectToEstop()
    sock.destroy()
    return { ok: true }
  } catch {
    // Not running — spawn
  }

  // 2. Spawn cmspark-host estop (NOT detached — lives and dies with companion)
  const child = spawn(resolveHostBinary(), ["estop", "--socket-path", ESTOP_SOCK_PATH], {
    detached: false,
    stdio: "ignore",
  })
  child.unref()

  // 3. Wait for socket to appear (max 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    try {
      const sock = await connectToEstop()
      sock.destroy()
      return { ok: true }
    } catch {
      /* retry */
    }
  }

  return { ok: false, reason: "estop helper did not start within 5s" }
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
 * Check if the estop helper's socket connection is still alive.
 * A failed connection means the helper process died → EMERGENCY_STOP_LOST.
 */
export function estopHeartbeatLost(): boolean {
  try {
    const sock = createConnection(ESTOP_SOCK_PATH)
    sock.destroy()
    return false // connection succeeded — helper is alive
  } catch {
    return true // connection failed — helper is dead
  }
}
