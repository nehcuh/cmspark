// Resolve the exact Companion instance without blocking its event loop. A PID
// or process.uptime estimate cannot replace the kernel creation FILETIME.
import { execFile, type ChildProcess } from "node:child_process"
import { windowsPowerShellExePath } from "../acp/win-spawn"
import { logger } from "../logger"

const PROBE_ERROR_CODES = new Set(["ABORT_ERR", "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "EINVAL", "ENOMEM", "EIO", "EPIPE",
  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE"])
const PROBE_SIGNALS = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGINT", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGQUIT", "SIGHUP"])
const diagnosticStatus = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 4294967295 ? value : null
const diagnosticSignal = (value: unknown): string | null =>
  typeof value === "string" ? PROBE_SIGNALS.has(value) ? value : "unknown" : null

function abortError(): Error {
  return Object.assign(new Error("Windows process ownership initialization cancelled"), { name: "AbortError" })
}

export function queryWindowsOwner(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const elapsed = () => Math.max(0, Math.round((performance.now() - started) * 1000) / 1000)
    let closed = false
    let settled = false
    let child: ChildProcess | undefined
    let spawnedAt: number | null = null, returnedAt: number | null = null, closedAt: number | null = null
    let closeStatus: number | null = null, closeSignal: string | null = null
    let result: { error: Error | null; value: string } | undefined
    const reportFailure = (error: unknown, phase: "exec" | "launch" | "probe") => {
      const facts = error as { code?: unknown; killed?: unknown; signal?: unknown } | null
      const rawCode = facts?.code
      const errorCode = rawCode == null ? null : typeof rawCode === "number" ? diagnosticStatus(rawCode)
        : typeof rawCode === "string" && PROBE_ERROR_CODES.has(rawCode) ? rawCode : "unknown"
      // Only facts and timings: execFile's exception contains command, stderr
      // and inherited environment details. Never log that object or FILETIME.
      logger.warn("process.windows_owner_probe.failed", {
        phase, timeout_ms: 10000, spawn_elapsed_ms: spawnedAt, callback_elapsed_ms: returnedAt,
        close_elapsed_ms: closedAt, returned_elapsed_ms: elapsed(),
        close_exit_status: closeStatus, close_signal: closeSignal,
        error_code: errorCode, error_killed: typeof facts?.killed === "boolean" ? facts.killed : null,
        error_signal: diagnosticSignal(facts?.signal), child_killed: typeof child?.killed === "boolean" ? child.killed : null,
        aborted: signal.aborted,
      })
    }
    const settle = () => {
      if (!closed || !result || settled) return
      settled = true
      if (result.error) {
        reportFailure(result.error, spawnedAt === null ? "launch" : "probe")
        reject(result.error)
      } else resolve(result.value)
    }
    // Direct .NET access avoids loading the Get-Process cmdlet's module. The
    // shell and environment belong to Companion, never the configured target.
    try {
      child = execFile(windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference='Stop'; $owner=[Diagnostics.Process]::GetProcessById(${process.pid}); try { $owner.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) } finally { $owner.Dispose() }`],
        { encoding: "utf8", windowsHide: true, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 4096, signal },
      (error, stdout) => { returnedAt = elapsed(); result = { error, value: stdout.trim() }; settle() })
    } catch (error) {
      reportFailure(error, "exec")
      reject(error)
      return
    }
    child.once("spawn", () => { spawnedAt = elapsed() })
    // AbortError can invoke execFile's callback before the killed process has
    // closed. Await the handle's close as well before releasing its lifetime.
    child.once("close", (code, endedSignal) => {
      closedAt = elapsed(); closeStatus = diagnosticStatus(code); closeSignal = diagnosticSignal(endedSignal)
      closed = true; settle()
    })
  })
}

type PendingOwner = { controller: AbortController; promise: Promise<string>; waiters: number; settled: boolean }

export class WindowsJobOwner {
  private value?: string
  private pending?: PendingOwner

  constructor(private readonly query = queryWindowsOwner) {}

  get created(): string {
    if (!this.value) throw new Error("Windows process ownership must be initialized before spawning")
    return this.value
  }

  async prepare(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError()
    if (this.value) return
    let pending = this.pending
    if (!pending || pending.controller.signal.aborted) {
      const controller = new AbortController()
      pending = { controller, promise: Promise.resolve().then(() => this.query(controller.signal)), waiters: 0, settled: false }
      const current = pending
      current.promise = current.promise.then(value => {
        if (controller.signal.aborted) throw abortError()
        if (!/^[0-9]{1,20}$/.test(value) || BigInt(value) === 0n || BigInt(value) > 0xffffffffffffffffn)
          throw new Error("Cannot establish Windows process ownership")
        this.value = value
        return value
      }).finally(() => {
        current.settled = true
        if (this.pending === current) this.pending = undefined
      })
      this.pending = current
    }
    const current = pending
    current.waiters++
    let onAbort: (() => void) | undefined
    try {
      await new Promise<string>((resolve, reject) => {
        onAbort = () => reject(abortError())
        signal?.addEventListener("abort", onAbort, { once: true })
        current.promise.then(resolve, reject)
      })
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort)
      current.waiters--
      if (!current.waiters && !current.settled) {
        current.controller.abort()
        // execFile settles after its owned query exits. Last cancellation must
        // not leave a query running or cache its late result.
        await current.promise.catch(() => {})
      }
    }
  }
}

export const windowsJobOwner = new WindowsJobOwner()
export const prepareWindowsJob = (signal?: AbortSignal): Promise<void> => windowsJobOwner.prepare(signal)
