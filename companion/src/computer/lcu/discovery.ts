// #775. Passive discovery is separate from explicitly approved execution.
import { constants, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import {
  lcuCandidates, lcuEnableRefusal, lcuEnvironment, projectLcuStatus,
  supportedLcuPlatform, validLcuCommand, type LcuObservedStatus,
} from "./contract"

export interface LcuCommandIdentity {
  command: string
  realPath: string
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

export async function lcuCommandIdentity(command: string): Promise<LcuCommandIdentity | undefined> {
  if (!validLcuCommand(command)) return
  try {
    const realPath = await fs.realpath(command)
    const stat = await fs.stat(realPath)
    const uid = process.getuid?.()
    if (!stat.isFile() || (uid !== undefined && stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0) return
    await fs.access(realPath, constants.X_OK)
    return { command, realPath, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch { return undefined }
}

export interface LcuDiscoveryDeps {
  platform?: string
  arch?: string
  home?: string
  identity?: (command: string) => Promise<LcuCommandIdentity | undefined>
}

export async function discoverLcu(command?: string, deps: LcuDiscoveryDeps = {}) {
  const platform = deps.platform ?? process.platform, arch = deps.arch ?? process.arch
  if (supportedLcuPlatform(platform, arch) === "unsupported") return { status: "unsupported_platform" as const }
  if (command !== undefined && !validLcuCommand(command)) return { status: "invalid_command" as const }
  for (const candidate of lcuCandidates(platform, arch, deps.home ?? os.homedir(), command)) {
    const identity = await (deps.identity ?? lcuCommandIdentity)(candidate)
    if (identity) return { status: "detected_unverified" as const, identity }
  }
  return { status: "missing_lcu" as const }
}

export type LcuStatusExecution = { ok: true; stdout: string } | { ok: false; reason: "aborted" | "timeout" | "invalid_output" | "process_failed" | "teardown_unknown" }

/** Fixed read-only command; bounded output and an owned POSIX process group. */
export function runLcuStatus(command: string, signal?: AbortSignal): Promise<LcuStatusExecution> {
  if (!path.isAbsolute(command) || command.length > 4096 || /[\x00-\x1f\x7f]/.test(command) || process.platform === "win32") return Promise.resolve({ ok: false, reason: "process_failed" })
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" })
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(command, ["status", "--json"], {
        shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"],
        env: lcuEnvironment(process.env),
      })
    } catch { resolve({ ok: false, reason: "process_failed" }); return }
    let done = false, refused: Exclude<LcuStatusExecution, { ok: true }>["reason"] | undefined
    let bytes = 0, stderrBytes = 0
    const chunks: Buffer[] = []
    let escalation: ReturnType<typeof setTimeout> | undefined
    let teardown: ReturnType<typeof setTimeout> | undefined
    const killOwned = (kind: "SIGTERM" | "SIGKILL") => {
      if (!child.pid) return
      try { process.kill(-child.pid, kind) } catch { /* close/error remains authoritative */ }
    }
    const finish = (result: LcuStatusExecution) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      if (escalation) clearTimeout(escalation)
      if (teardown) clearTimeout(teardown)
      signal?.removeEventListener("abort", onAbort)
      child.stdout?.destroy(); child.stderr?.destroy()
      resolve(result)
    }
    const stop = (reason: typeof refused) => {
      if (done || refused) return
      refused = reason
      chunks.length = 0
      killOwned("SIGTERM")
      escalation = setTimeout(() => killOwned("SIGKILL"), 500)
      teardown = setTimeout(() => {
        killOwned("SIGKILL")
        finish({ ok: false, reason: "teardown_unknown" })
      }, 3000)
    }
    const onAbort = () => stop("aborted")
    const deadline = setTimeout(() => stop("timeout"), 15000)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 256 * 1024) stop("invalid_output")
      else if (!refused) chunks.push(Buffer.from(chunk))
    })
    // Drain, count and discard; upstream stderr may contain account/application paths.
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 256 * 1024) stop("invalid_output")
    })
    child.once("error", () => { if (!refused) stop("process_failed") })
    child.once("close", (code, closeSignal) => {
      if (refused) finish({ ok: false, reason: refused })
      else if (code !== 0 || closeSignal !== null) finish({ ok: false, reason: "process_failed" })
      else {
        try {
          const stdout = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
          finish({ ok: true, stdout })
        } catch { finish({ ok: false, reason: "invalid_output" }) }
      }
    })
  })
}

export interface LcuProbe {
  status: "checked" | "refused"
  identity?: LcuCommandIdentity
  observed?: LcuObservedStatus
  refusal?: string
}

export async function probeLcu(
  identity: LcuCommandIdentity,
  signal?: AbortSignal,
  deps: {
    identity?: (command: string) => Promise<LcuCommandIdentity | undefined>
    run?: (command: string, signal?: AbortSignal) => Promise<LcuStatusExecution>
  } = {},
): Promise<LcuProbe> {
  const readIdentity = deps.identity ?? lcuCommandIdentity
  const before = await readIdentity(identity.command)
  if (!before || JSON.stringify(before) !== JSON.stringify(identity)) return { status: "refused", refusal: "LCU_INSTALLATION_CHANGED" }
  const output = await (deps.run ?? runLcuStatus)(identity.realPath, signal)
  if (!output.ok) return { status: "refused", refusal: `LCU_PROBE_${output.reason.toUpperCase()}` }
  const after = await readIdentity(identity.command)
  if (signal?.aborted || !after || JSON.stringify(before) !== JSON.stringify(after)) return { status: "refused", refusal: "LCU_INSTALLATION_CHANGED_OR_CANCELLED" }
  let observed: LcuObservedStatus | undefined
  try {
    const parsed: unknown = JSON.parse(output.stdout)
    observed = projectLcuStatus(parsed)
  } catch { /* raw output never becomes an error message or log */ }
  if (!observed) return { status: "refused", refusal: "LCU_STATUS_INVALID" }
  return { status: "checked", identity: after, observed, refusal: lcuEnableRefusal(observed) }
}
