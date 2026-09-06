// Embedded PTY sessions — at most one live process (spec §5).
// Kill tree on close / heartbeat / process exit. Ack watermark → pause.

import { spawn } from "child_process"
import { appendCapabilityAudit } from "../packs/audit-log"
import { loadNodePty, type PtyHandle, type PtySpawnFn } from "./load-native"
import { buildTerminalEnv } from "./env"

function killPidTree(pid: number): void {
  if (pid <= 0) return
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* ignore */
    }
  }
}

export const TERMINAL_DATA_CHUNK_BYTES = 16 * 1024
export const TERMINAL_HIGH_WATER_UNACKED = 64 * 1024
export const TERMINAL_LOW_WATER_UNACKED = 16 * 1024
export const TERMINAL_HEARTBEAT_MS = 45_000

export type TerminalClosedCode = number | "unsupported" | "denied" | "killed" | string

type LiveSession = {
  id: string
  handle: PtyHandle
  threadId?: string
  /** WS peer that opened this PTY; WS-close kills only this owner's session. */
  owner?: unknown
  cwd: string
  seq: number
  unacked: Map<number, number>
  unackedBytes: number
  paused: boolean
  lastClientAt: number
  heartbeat: ReturnType<typeof setInterval>
  send: (frame: Record<string, unknown>) => void
}

let live: LiveSession | null = null
let spawnOverride: PtySpawnFn | null = null
let heartbeatMs = TERMINAL_HEARTBEAT_MS
let platformOverride: NodeJS.Platform | null = null
let exitHookInstalled = false

export function __testSetPtySpawn(fn?: PtySpawnFn): void {
  spawnOverride = fn || null
}

export function __testSetPtyHeartbeatMs(ms?: number): void {
  heartbeatMs = typeof ms === "number" && ms > 0 ? ms : TERMINAL_HEARTBEAT_MS
}

export function __testSetPtyPlatform(p?: NodeJS.Platform): void {
  platformOverride = p ?? null
}

export function __testResetPtySessions(): void {
  const s = live
  live = null
  if (s) {
    clearInterval(s.heartbeat)
    try {
      s.handle.kill()
    } catch {
      /* ignore */
    }
  }
  spawnOverride = null
  heartbeatMs = TERMINAL_HEARTBEAT_MS
  platformOverride = null
}

export function getLivePtyId(): string | null {
  return live?.id ?? null
}

export function killPtyByThreadId(threadId: string): boolean {
  if (!live || live.threadId !== threadId) return false
  closeLive("killed")
  return true
}

/** Kill the live PTY only if it was opened by this WS peer (NIT-1). */
export function killPtyByPeer(peer: unknown): boolean {
  if (!peer || !live || live.owner !== peer) return false
  closeLive("killed")
  return true
}

export function killAllPty(): void {
  if (live) closeLive("killed")
}

export function ptyHostPlatform(): NodeJS.Platform {
  return platformOverride ?? process.platform
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  const halt = () => {
    try {
      killAllPty()
    } catch {
      /* ignore */
    }
  }
  process.on("SIGTERM", halt)
  process.on("SIGINT", halt)
  process.on("beforeExit", halt)
}

function closeLive(code: TerminalClosedCode, extra?: { signal?: number; error?: string }): void {
  const s = live
  if (!s) return
  live = null
  clearInterval(s.heartbeat)
  try {
    const pid = s.handle.pid
    if (typeof pid === "number" && pid > 0) killPidTree(pid)
    s.handle.kill()
  } catch {
    /* ignore */
  }
  appendCapabilityAudit({
    type: "terminal.close",
    at: new Date().toISOString(),
    id: s.id,
    cwd: s.cwd,
    pid: s.handle.pid,
    code,
    ...(s.threadId ? { thread_id: s.threadId } : {}),
  })
  s.send({
    type: "terminal.closed",
    id: s.id,
    code,
    signal: extra?.signal ?? 0,
    ...(extra?.error ? { error: extra.error } : {}),
  })
}

function maybePause(s: LiveSession): void {
  if (!s.paused && s.unackedBytes >= TERMINAL_HIGH_WATER_UNACKED) {
    s.paused = true
    try {
      s.handle.pause()
    } catch {
      /* ignore */
    }
  }
}

function maybeResume(s: LiveSession): void {
  if (s.paused && s.unackedBytes <= TERMINAL_LOW_WATER_UNACKED) {
    s.paused = false
    try {
      s.handle.resume()
    } catch {
      /* ignore */
    }
  }
}

function emitChunks(s: LiveSession, text: string): void {
  const buf = Buffer.from(text, "utf8")
  for (let i = 0; i < buf.length; i += TERMINAL_DATA_CHUNK_BYTES) {
    const slice = buf.subarray(i, i + TERMINAL_DATA_CHUNK_BYTES)
    s.seq += 1
    const seq = s.seq
    s.unacked.set(seq, slice.length)
    s.unackedBytes += slice.length
    s.send({
      type: "terminal.data",
      id: s.id,
      seq,
      b64: slice.toString("base64"),
    })
    maybePause(s)
  }
}

export function spawnPtySession(opts: {
  id: string
  cols: number
  rows: number
  cwd: string
  threadId?: string
  owner?: unknown
  send: (frame: Record<string, unknown>) => void
}): { ok: true; pid: number } | { ok: false; error: string; code?: TerminalClosedCode } {
  if (ptyHostPlatform() !== "darwin") {
    return {
      ok: false,
      error: "内嵌终端仅支持 macOS（darwin）；Windows/Linux 另票。",
      code: "unsupported",
    }
  }
  if (live) {
    return { ok: false, error: "terminal_busy" }
  }

  const cols = Math.min(500, Math.max(1, Math.floor(opts.cols) || 80))
  const rows = Math.min(200, Math.max(1, Math.floor(opts.rows) || 24))
  const file = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL : "/bin/zsh"
  const env = buildTerminalEnv()
  const spawnFn: PtySpawnFn = spawnOverride || ((f, a, o) => loadNodePty().spawn(f, a, o))

  let handle: PtyHandle
  try {
    handle = spawnFn(file, [], { name: "xterm-256color", cols, rows, cwd: opts.cwd, env })
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), code: "spawn_failed" }
  }

  installExitHook()
  const session: LiveSession = {
    id: opts.id,
    handle,
    threadId: opts.threadId,
    owner: opts.owner,
    cwd: opts.cwd,
    seq: 0,
    unacked: new Map(),
    unackedBytes: 0,
    paused: false,
    lastClientAt: Date.now(),
    heartbeat: setInterval(() => {
      const s = live
      if (!s || s.id !== opts.id) return
      // Last-resort orphan reclaim. Client ping/input/ack/resize reset lastClientAt
      // so a quiet-but-watched tab (vim/man/ssh idle) is not SIGKILL'd.
      if (Date.now() - s.lastClientAt > heartbeatMs) closeLive("killed")
    }, Math.min(heartbeatMs, 5000)),
    send: opts.send,
  }
  session.heartbeat.unref?.()
  live = session

  handle.onData((data) => {
    if (live?.id !== session.id) return
    emitChunks(session, data)
  })
  handle.onExit(({ exitCode, signal }) => {
    if (live?.id !== session.id) return
    closeLive(typeof exitCode === "number" ? exitCode : 0, { signal: signal ?? 0 })
  })

  appendCapabilityAudit({
    type: "terminal.open",
    at: new Date().toISOString(),
    id: opts.id,
    cwd: opts.cwd,
    pid: handle.pid,
    ...(opts.threadId ? { thread_id: opts.threadId } : {}),
  })

  return { ok: true, pid: handle.pid }
}

export function noteClientActivity(id: string): boolean {
  if (!live || live.id !== id) return false
  live.lastClientAt = Date.now()
  return true
}

/** Keepalive. Unknown id is a no-op (ext may ping after local close). */
export function pingPty(id: string): { ok: true } {
  noteClientActivity(id)
  return { ok: true }
}

export function writePtyInput(id: string, b64: string): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  let raw: Buffer
  try {
    raw = Buffer.from(b64, "base64")
  } catch {
    return { ok: false, error: "invalid_b64" }
  }
  try {
    live.handle.write(raw.toString("utf8"))
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
  return { ok: true }
}

export function resizePty(id: string, cols: number, rows: number): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  try {
    live.handle.resize(
      Math.min(500, Math.max(1, Math.floor(cols) || 80)),
      Math.min(200, Math.max(1, Math.floor(rows) || 24)),
    )
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
  return { ok: true }
}

export function ackPty(id: string, seq: number): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  const s = live
  for (const [q, n] of [...s.unacked.entries()]) {
    if (q <= seq) {
      s.unacked.delete(q)
      s.unackedBytes = Math.max(0, s.unackedBytes - n)
    }
  }
  maybeResume(s)
  return { ok: true }
}

export function pausePty(id: string): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  live.paused = true
  try {
    live.handle.pause()
  } catch {
    /* ignore */
  }
  return { ok: true }
}

export function resumePty(id: string): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  live.paused = false
  try {
    live.handle.resume()
  } catch {
    /* ignore */
  }
  return { ok: true }
}

export function closePty(id: string): { ok: true } | { ok: false; error: string } {
  if (!live || live.id !== id) return { ok: false, error: "terminal_not_found" }
  closeLive(0)
  return { ok: true }
}

/** Expose for tests: unacked byte count of the live session. */
export function __testPtyUnackedBytes(): number {
  return live?.unackedBytes ?? 0
}

export function __testPtyPaused(): boolean {
  return live?.paused === true
}

export function __testPtyLastClientAt(): number {
  return live?.lastClientAt ?? 0
}

export function __testAgePtyClient(ms: number): void {
  if (live) live.lastClientAt -= ms
}
