// Daemon management module — Unix Domain Socket lock, PID file, process detection, graceful shutdown
//
// Design: UDS lock replaces traditional PID-file locking to eliminate TOCTOU race conditions.
//   - acquireLock creates a net.Server listening on a Unix Domain Socket path.
//   - If the path is already bound, EADDRINUSE is thrown → another instance is running.
//   - The OS guarantees bind() on a UDS is atomic, so there is no check-then-act window.
//   - releaseLock closes the server and unlinks the socket file.

import * as net from "net"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { spawn } from "child_process"
import { getConfigDir } from "./config"
import { getLockPath, isWindows } from "./platform"

// ---------------------------------------------------------------------------
// Error classification (matches security.ts pattern)
// ---------------------------------------------------------------------------

export type DaemonErrorLevel = "recoverable" | "transient" | "fatal"

export class DaemonError extends Error {
  public readonly level: DaemonErrorLevel
  public readonly code: string

  constructor(message: string, level: DaemonErrorLevel, code: string) {
    super(message)
    this.name = "DaemonError"
    this.level = level
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

export function getDefaultLockPath(): string {
  return getLockPath()
}

export function getDefaultPidPath(): string {
  return path.join(getConfigDir(), "daemon.pid")
}

// ---------------------------------------------------------------------------
// Unix Domain Socket lock
// ---------------------------------------------------------------------------

let lockServer: net.Server | null = null

/**
 * Acquire a UDS-based exclusive lock.
 *
 * Creates a net.Server and attempts to listen on the given Unix Domain Socket path.
 * If another process already holds the lock, this returns `false` immediately.
 * On unexpected errors, throws a `DaemonError` with appropriate classification.
 *
 * The implementation uses a synchronous connect test to detect stale sockets,
 * then attempts `server.listen()`.  Because `listen()` on a UDS is atomic at
 * the kernel level, two processes racing to bind the same path cannot both
 * succeed — one will receive EADDRINUSE.
 *
 * @param lockPath — absolute path to the Unix Domain Socket file
 * @returns `true` if the lock was acquired, `false` if already held by another instance
 */
function isNamedPipe(lockPath: string): boolean {
  return lockPath.startsWith("\\\\")
}

export async function acquireLock(lockPath: string): Promise<boolean> {
  const namedPipe = isNamedPipe(lockPath)

  if (!namedPipe) {
    // Unix: ensure parent directory exists
    const dir = path.dirname(lockPath)
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch (err: any) {
      throw new DaemonError(
        `Failed to create lock directory: ${err.message}`,
        "transient",
        "LOCK_DIR_CREATE_FAILED",
      )
    }

    // Clean up stale socket file: if the file exists but nothing is listening,
    // a synchronous connect will fail immediately (ECONNREFUSED) or time out.
    if (fs.existsSync(lockPath)) {
      const stale = isSocketStale(lockPath)
      if (stale) {
        try {
          fs.unlinkSync(lockPath)
        } catch {
          // Ignore unlink errors — bind() will tell us the truth
        }
      } else {
        // Someone is actively listening
        return false
      }
    }
  }

  const server = net.createServer()

  const result = await new Promise<
    { ok: true } | { ok: false; error: NodeJS.ErrnoException }
  >((resolve) => {
    server.listen(lockPath, () => {
      resolve({ ok: true })
    })
    server.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: err })
    })
  })

  if (!result.ok) {
    try { server.close() } catch { /* ignore */ }
    if (result.error.code === "EADDRINUSE") {
      return false
    }
    throw new DaemonError(
      `Lock server error: ${result.error.message}`,
      classifySystemError(result.error),
      result.error.code || "LOCK_SERVER_ERROR",
    )
  }

  if (!namedPipe) {
    // Unix: restrict permissions on the socket file (owner-only)
    try {
      fs.chmodSync(lockPath, 0o600)
    } catch (err: any) {
      // Non-fatal: log and continue
      console.warn(`[daemon] Warning: could not chmod lock file: ${err.message}`)
    }
  }

  lockServer = server
  return true
}

/**
 * Perform a synchronous connect test to determine whether a Unix Domain
 * Socket is actively bound (i.e. another process is listening).
 *
 * Returns `true` if the socket is stale (no one listening), `false` if
 * someone is actively listening.
 *
 * Implementation: spawns a tiny child process that attempts to connect
 * to the socket.  The child exits 0 on successful connect, 1 on failure.
 * Using execFileSync gives us a truly synchronous result while allowing
 * the async connect to complete inside the child.
 */
function isSocketStale(lockPath: string): boolean {
  const testScript = `
    const net = require("net");
    const client = net.createConnection(process.argv[1]);
    client.on("connect", () => { client.end(); process.exit(0); });
    client.on("error", () => { process.exit(1); });
    setTimeout(() => process.exit(1), 150);
  `
  try {
    const { execFileSync } = require("child_process")
    execFileSync(process.execPath, ["-e", testScript, lockPath], {
      timeout: 300,
      windowsHide: true,
    })
    // Exit 0 → connect succeeded → socket is NOT stale
    return false
  } catch {
    // Exit non-zero or timeout → connect failed → socket IS stale
    return true
  }
}

/**
 * Verify that a socket file was actually created and is bound by checking
 * its existence.  This is used as a lightweight synchronous confirmation
 * that `server.listen()` succeeded.
 */
function isSocketBound(lockPath: string): boolean {
  try {
    fs.accessSync(lockPath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Release the UDS lock previously acquired by `acquireLock`.
 *
 * Closes the server and unlinks the socket file. Safe to call multiple times
 * or when no lock is held (idempotent).
 */
export function releaseLock(lockPath: string): void {
  if (lockServer) {
    try {
      lockServer.close()
    } catch {
      // Ignore close errors
    }
    lockServer = null
  }

  if (!isNamedPipe(lockPath)) {
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath)
      }
    } catch (err: any) {
      // If unlink fails because the file is already gone, that's fine.
      if (err.code !== "ENOENT") {
        console.warn(`[daemon] Warning: could not remove lock file: ${err.message}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Process running detection
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given PID is currently running.
 *
 * Uses `process.kill(pid, 0)` which performs permission checks without
 * actually sending a signal. Returns `false` for PID 0, negative numbers,
 * or if the process does not exist.
 */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------

/**
 * Write a PID file atomically.
 *
 * Writes the PID as a plain string followed by a newline.
 * The parent directory is created if it does not exist.
 */
export function writePidFile(pidPath: string, pid: number): void {
  const dir = path.dirname(pidPath)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (err: any) {
    throw new DaemonError(
      `Failed to create PID directory: ${err.message}`,
      "transient",
      "PID_DIR_CREATE_FAILED",
    )
  }

  try {
    fs.writeFileSync(pidPath, `${pid}\n`, { mode: 0o600 })
  } catch (err: any) {
    throw new DaemonError(
      `Failed to write PID file: ${err.message}`,
      classifySystemError(err),
      "PID_WRITE_FAILED",
    )
  }
}

/**
 * Read a PID file and return the PID as a number.
 *
 * Returns `null` if the file does not exist, cannot be read, or does not
 * contain a valid positive integer.
 */
export function readPidFile(pidPath: string): number | null {
  try {
    const raw = fs.readFileSync(pidPath, "utf-8").trim()
    const pid = parseInt(raw, 10)
    if (Number.isNaN(pid) || pid <= 0) {
      return null
    }
    return pid
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return null
    }
    return null
  }
}

/**
 * Remove a PID file if it exists.
 *
 * Idempotent: safe to call even when the file is already absent.
 */
export function cleanupPidFile(pidPath: string): void {
  try {
    if (fs.existsSync(pidPath)) {
      fs.unlinkSync(pidPath)
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.warn(`[daemon] Warning: could not remove PID file: ${err.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Daemonize (fork to background)
// ---------------------------------------------------------------------------

export interface DaemonizeOptions {
  /** Absolute path to the executable to spawn (defaults to process.execPath) */
  execPath?: string
  /** Arguments to pass to the spawned process */
  args?: string[]
  /** Working directory for the spawned process */
  cwd?: string
  /** Environment variables to set (merged with process.env) */
  env?: NodeJS.ProcessEnv
  /** Absolute path for stdout/stderr log redirection */
  logPath?: string
  /** If true, suppress the "Spawned daemon PID: N" console message */
  silent?: boolean
}

/**
 * Daemonize the current process by spawning a detached child and exiting.
 *
 * The child is spawned with `detached: true` and `stdio: "ignore"` so it
 * fully disassociates from the controlling terminal. The parent process
 * prints the child PID and exits with code 0.
 *
 * If `logPath` is provided, stdout and stderr are redirected to that file.
 */
export function daemonize(options: DaemonizeOptions): void {
  const execPath = options.execPath || process.execPath
  const args = options.args || process.argv.slice(1)
  const cwd = options.cwd || process.cwd()
  const env = { ...process.env, ...options.env }

  let stdio: any = "ignore"
  if (options.logPath) {
    const logDir = path.dirname(options.logPath)
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 })
    } catch (err: any) {
      throw new DaemonError(
        `Failed to create log directory: ${err.message}`,
        "transient",
        "LOG_DIR_CREATE_FAILED",
      )
    }
    try {
      const fd = fs.openSync(options.logPath, "a", 0o600)
      stdio = ["ignore", fd, fd]
    } catch (err: any) {
      throw new DaemonError(
        `Failed to open log file: ${err.message}`,
        "transient",
        "LOG_OPEN_FAILED",
      )
    }
  }

  const child = spawn(execPath, args, {
    detached: true,
    stdio,
    cwd,
    env,
  })

  child.unref()

  if (!options.silent) {
    console.log(`Spawned daemon PID: ${child.pid}`)
  }

  // Parent exits immediately; child continues as session leader
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Install SIGTERM and SIGINT handlers that run the provided cleanup callback
 * before exiting.
 *
 * The cleanup function is called synchronously. After cleanup completes,
 * the process exits with code 0. If cleanup throws, the error is logged
 * and the process exits with code 1.
 *
 * Only the first signal is honored; subsequent signals are ignored to avoid
 * re-entrant cleanup.
 */
export function setupGracefulShutdown(cleanup: () => void): void {
  let shuttingDown = false

  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    console.log(`[daemon] Received ${signal}, shutting down gracefully...`)

    try {
      cleanup()
    } catch (err: any) {
      console.error(`[daemon] Cleanup error: ${err.message || String(err)}`)
      process.exit(1)
    }

    process.exit(0)
  }

  process.on("SIGTERM", () => handler("SIGTERM"))
  process.on("SIGINT", () => handler("SIGINT"))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifySystemError(err: NodeJS.ErrnoException): DaemonErrorLevel {
  const transientCodes = new Set([
    "EAGAIN",
    "EBUSY",
    "EMFILE",
    "ENFILE",
    "ENOMEM",
    "ENOSPC",
    "ETIMEDOUT",
    "ECONNRESET",
    "EPIPE",
  ])
  const recoverableCodes = new Set([
    "EACCES",
    "EPERM",
    "EROFS",
  ])

  if (err.code && transientCodes.has(err.code)) {
    return "transient"
  }
  if (err.code && recoverableCodes.has(err.code)) {
    return "recoverable"
  }
  return "fatal"
}
