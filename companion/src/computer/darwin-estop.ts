// macOS emergency-stop (WP3 + adversarial review C2 + tray-owned ownership 2026-08
// + B2 DATA_DIR identity #245).
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
// Identity (B2 / pin 12): the socket lives under DATA_DIR (never anonymous
// /tmp/cmspark-estop.*). CONNECT-first success is NOT armed unless the helper
// presents a 0600 nonce greeting. Pre-bind of /tmp or of a DATA_DIR socket
// without nonce/peer is fail-closed. Proof-of-life after arm is the long-lived
// held connection (EOF when the helper dies) — hotkey/TCC contract unchanged.
//
// Flow:
//   1. tray/app owns: spawn cmspark-host/CMspark estop --socket-path … --flag-path … --nonce-file …
//   2. companion connects, verifies greeting, holds the socket
//   3. abortCheck polls: socket dead → EMERGENCY_STOP_LOST; flag file → hotkey
//
// Key security property (C2 fix): a killed estop process frees the socket
// path, but NO other process can rebind it without killing the companion's
// existing connection. The companion detects socket EOF immediately.

import { spawn, type ChildProcess } from "child_process"
import { createConnection, type Socket } from "net"
import { randomBytes, timingSafeEqual } from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { resolveHostBinary } from "../host-use/darwin/host-bin"
import { resolveIntegrityHostBin } from "../host-use/darwin/host-integrity"
import { logger } from "../logger"

/** sockaddr_un.sun_path on Darwin is 104 bytes including the terminating NUL. */
export const ESTOP_SUN_PATH_MAX = 104
const GREETING_PREFIX = "cmspark-estop "

/** Grace period for tray/Aqua-owned estop to appear before daemon fallback spawn. */
const TRAY_OWNED_CONNECT_ATTEMPTS = 30 // 30 * 100ms = 3s
const SPAWN_CONNECT_ATTEMPTS = 50 // 5s after spawn

function estopDataDir(): string {
  return process.env.CMSPARK_DATA_DIR || path.join(os.homedir(), ".cmspark-agent")
}

export function estopSocketPath(): string {
  return path.join(estopDataDir(), "estop.sock")
}

export function estopFlagPath(): string {
  return path.join(estopDataDir(), "estop.flag")
}

export function estopNoncePath(): string {
  return path.join(estopDataDir(), "estop.nonce")
}

function connectAttempts(fallback: number): number {
  const n = Number(process.env.CMSPARK_ESTOP_CONNECT_ATTEMPTS)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function connectGapMs(): number {
  const n = Number(process.env.CMSPARK_ESTOP_CONNECT_GAP_MS)
  return Number.isFinite(n) && n >= 0 ? n : 100
}

function ensureEstopDir(): void {
  fs.mkdirSync(estopDataDir(), { recursive: true, mode: 0o700 })
}

function sunPathTooLong(sockPath: string): string | null {
  const bytes = Buffer.byteLength(sockPath, "utf8")
  if (bytes >= ESTOP_SUN_PATH_MAX) {
    return `estop socket path too long (${bytes} bytes; sun_path max ${ESTOP_SUN_PATH_MAX - 1})`
  }
  return null
}

/** Reject sockets/files that are group/other accessible (want 0600). */
function isOwnerOnly0600(p: string): boolean {
  try {
    const st = fs.statSync(p)
    if ((st.mode & 0o077) !== 0) return false
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) return false
    return true
  } catch {
    return false
  }
}

function readNonceFile(): string {
  const p = estopNoncePath()
  const raw = fs.readFileSync(p, "utf8").trim()
  if (!/^[0-9a-f]{32}$/i.test(raw)) {
    throw new Error("estop nonce file is not a 32-hex identity")
  }
  if (!isOwnerOnly0600(p)) {
    throw new Error("estop nonce file identity rejected (mode/owner)")
  }
  return raw.toLowerCase()
}

function writeNonceFile(): string {
  ensureEstopDir()
  const p = estopNoncePath()
  const nonce = randomBytes(16).toString("hex")
  fs.writeFileSync(p, nonce, { encoding: "utf8", mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* umask already 0600 */
  }
  return nonce
}

function greetingMatches(line: string, nonce: string): boolean {
  if (!line.startsWith(GREETING_PREFIX)) return false
  const got = line.slice(GREETING_PREFIX.length).trim().toLowerCase()
  if (got.length !== nonce.length) return false
  try {
    return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(nonce, "utf8"))
  } catch {
    return false
  }
}

function readGreeting(sock: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("estop greeting timeout"))
    }, timeoutMs)
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      const nl = buf.indexOf("\n")
      if (nl >= 0) {
        cleanup()
        resolve(buf.slice(0, nl).trim())
      }
    }
    const onErr = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      clearTimeout(timer)
      sock.off("data", onData)
      sock.off("error", onErr)
    }
    sock.on("data", onData)
    sock.on("error", onErr)
  })
}

export interface EstopResult { ok: boolean; reason?: string }

/**
 * Connect to the UNIX socket and verify DATA_DIR identity (0600 + nonce
 * greeting). Returns an open socket or rejects if the helper is not the
 * product estop (CONNECT-first without identity is not armed).
 */
async function connectToEstop(timeoutMs = 2000): Promise<Socket> {
  const sockPath = estopSocketPath()
  const tooLong = sunPathTooLong(sockPath)
  if (tooLong) throw new Error(tooLong)
  const nonce = readNonceFile()
  if (!isOwnerOnly0600(sockPath)) {
    throw new Error("estop socket identity rejected (mode/owner)")
  }
  const sock = await new Promise<Socket>((resolve, reject) => {
    const s = createConnection({ path: sockPath })
    const timer = setTimeout(() => {
      s.destroy()
      reject(new Error("estop socket connect timeout"))
    }, timeoutMs)
    s.on("connect", () => {
      clearTimeout(timer)
      resolve(s)
    })
    s.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
  try {
    const line = await readGreeting(sock, timeoutMs)
    if (!greetingMatches(line, nonce)) {
      sock.destroy()
      throw new Error("estop greeting mismatch")
    }
    return sock
  } catch (err) {
    sock.destroy()
    throw err
  }
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
    fs.unlinkSync(estopSocketPath())
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
  ensureEstopDir()
  const sockPath = estopSocketPath()
  const flagPath = estopFlagPath()
  const nonceFile = estopNoncePath()
  const tooLong = sunPathTooLong(sockPath)
  if (tooLong) return { ok: false, reason: tooLong }

  unlinkEstopSocket()
  writeNonceFile()

  const bin = resolveHostBinary()
  // P2 residual: long-lived host spawn must pass integrity gate (same as spawnHostBin)
  let safeBin: string
  try {
    safeBin = resolveIntegrityHostBin(bin)
  } catch (err) {
    logger.warn("computer.estop.integrity_failed", { bin, error: String(err) })
    return { ok: false, reason: (err as Error).message || "host integrity failed" }
  }
  logger.info("computer.estop.spawn", { bin: safeBin, sock: sockPath, owner: "daemon-fallback" })

  const child = spawn(safeBin, [
    "estop",
    "--socket-path", sockPath,
    "--flag-path", flagPath,
    "--nonce-file", nonceFile,
  ], {
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
 * 2. Connect to tray/Aqua-owned helper (grace period for app boot) WITH identity
 * 3. Last resort: daemon spawns helper (may hit CGEventTap/TCC code 4)
 *
 * CONNECT-first without DATA_DIR nonce/0600 is not armed.
 */
export async function ensureEstopHelper(): Promise<EstopResult> {
  if (liveSock && !liveSock.destroyed) return { ok: true }

  const sockPath = estopSocketPath()
  const tooLong = sunPathTooLong(sockPath)
  if (tooLong) return { ok: false, reason: tooLong }

  // Prefer existing tray-owned helper — do not kill/rebind their socket.
  if (await tryConnectHeld(connectAttempts(TRAY_OWNED_CONNECT_ATTEMPTS), connectGapMs())) {
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
    const content = fs.readFileSync(estopFlagPath(), "utf-8")
    const parsed = JSON.parse(content) as { timestamp?: number }
    if (typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < 30000) {
      fs.unlinkSync(estopFlagPath())
      return true
    }
  } catch {
    // File does not exist or is unparseable
  }
  return false
}

export function clearEstopFlag(): void {
  try { fs.unlinkSync(estopFlagPath()) } catch { /* does not exist */ }
}

export function estopHeartbeatLost(): boolean {
  return liveSock === null || liveSock.destroyed
}

/** Test-only: drop the held proof-of-life so the next ensure is a fresh connect. */
export function resetDarwinEstopForTests(): void {
  if (liveSock && !liveSock.destroyed) {
    try {
      liveSock.destroy()
    } catch {
      /* */
    }
  }
  liveSock = null
  if (liveChild && liveChild.exitCode === null && !liveChild.killed) {
    try {
      liveChild.kill()
    } catch {
      /* */
    }
  }
  liveChild = null
}
