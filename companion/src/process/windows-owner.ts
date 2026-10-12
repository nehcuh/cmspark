// Resolve the exact Companion instance without blocking its event loop. A PID
// or process.uptime estimate cannot replace the kernel creation FILETIME.
import { execFile } from "node:child_process"
import { windowsPowerShellExePath } from "../acp/win-spawn"

function abortError(): Error {
  return Object.assign(new Error("Windows process ownership initialization cancelled"), { name: "AbortError" })
}

export function queryWindowsOwner(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let closed = false
    let result: { error: Error | null; value: string } | undefined
    const settle = () => {
      if (closed && result) result.error ? reject(result.error) : resolve(result.value)
    }
    // Direct .NET access avoids loading the Get-Process cmdlet's module. The
    // shell and environment belong to Companion, never the configured target.
    const child = execFile(windowsPowerShellExePath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference='Stop'; $owner=[Diagnostics.Process]::GetProcessById(${process.pid}); try { $owner.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) } finally { $owner.Dispose() }`],
    { encoding: "utf8", windowsHide: true, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 4096, signal },
    (error, stdout) => { result = { error, value: stdout.trim() }; settle() })
    // AbortError can invoke execFile's callback before the killed process has
    // closed. Await the handle's close as well before releasing its lifetime.
    child.once("close", () => { closed = true; settle() })
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
