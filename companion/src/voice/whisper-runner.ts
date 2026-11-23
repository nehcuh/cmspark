// Path B M1 — whisper.cpp CLI runner (ADR-023 L2/L5/L10).
// execFile only (no shell); fixed argv schema; timeout + AbortSignal kill.

import {
  execFile as defaultExecFile,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptions,
} from "node:child_process"
import * as path from "node:path"
import * as os from "node:os"
import { performance } from "node:perf_hooks"

import { STT_INFER_MAX_MS } from "./session-caps"
import {
  parseWhisperBackendEvidence,
  recordWhisperExecution,
  selectWindowsWhisperRuntime,
  supportsWindowsWhisperAcceleration,
  verifiedWindowsWhisperRuntime,
  type WhisperBackend,
  type WhisperExecution,
  type WhisperFallbackReason,
  type WhisperRuntimeChoice,
} from "./whisper-acceleration"
import { windowsSystemDirectory } from "./whisper-windows-hardware"

export type WhisperRunResult = { text: string; ms: number; execution?: WhisperExecution }

/** Injectable execFile (node:child_process.execFile compatible). */
export type ExecFileImpl = (
  file: string,
  args: readonly string[] | null | undefined,
  options: ExecFileOptions,
  callback: (
    error: ExecFileException | null,
    stdout: string | Buffer,
    stderr: string | Buffer,
  ) => void,
) => ChildProcess

export type RunWhisperTranscribeOpts = {
  binaryPath: string
  /** Absolute model path — must already be allowlist-resolved by caller. */
  modelPath: string
  audioPath: string
  /** Default zh. */
  lang?: string
  /** Default STT_INFER_MAX_MS (90s). */
  timeoutMs?: number
  signal?: AbortSignal
  /** Inject for tests. */
  execFileImpl?: ExecFileImpl
  acceleration?: {
    dataDir?: string
    /** Internal acceptance entry. GPU choices always use the verified install. */
    strictBackend?: WhisperBackend
    /** Inject Windows selection for deterministic runner tests. */
    selectRuntime?: (signal: AbortSignal) => Promise<WhisperRuntimeChoice>
  }
}

export type WhisperRunnerErrorCode =
  | "timeout" | "aborted" | "spawn_error" | "nonzero_exit"
  | "backend_unavailable" | "backend_unproven"

export class WhisperRunnerError extends Error {
  readonly code: WhisperRunnerErrorCode
  constructor(code: WhisperRunnerErrorCode, message: string) {
    super(message)
    this.name = "WhisperRunnerError"
    this.code = code
  }
}

/** Cap threads — large models + OpenMP can thrash / look like a hang on Windows. */
export function defaultWhisperThreadCount(): number {
  const n = typeof os.cpus === "function" ? os.cpus().length : 4
  return Math.max(2, Math.min(6, Math.floor(n / 2) || 4))
}

/**
 * whisper-cli / cmspark-whisper argv.
 * -ng: force CPU (avoids broken GPU init paths on some Windows builds)
 * -np: quieter stderr (still enough for errors; reduces maxBuffer pressure)
 * -nt: no timestamps (product expects plain text)
 * -t N: bounded threads
 */
export function buildWhisperArgs(opts: {
  modelPath: string
  audioPath: string
  lang: string
  threads?: number
  backend?: WhisperBackend
}): string[] {
  const threads = opts.threads ?? defaultWhisperThreadCount()
  return [
    "-m",
    opts.modelPath,
    "-f",
    opts.audioPath,
    "-l",
    opts.lang,
    "-nt",
    ...(!opts.backend || opts.backend === "cpu" ? ["-ng", "-np"] : []),
    "-t",
    String(threads),
  ]
}

/**
 * Parse whisper-cli stdout with `-nt` (no timestamps).
 * Strip ggml/whisper log lines; `[BLANK_AUDIO]` → empty; empty stdout ok.
 */
export function parseWhisperStdout(stdout: string): string {
  const lines = String(stdout ?? "").split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    const t = line.replaceAll("[BLANK_AUDIO]", " ").trim()
    if (!t) continue
    // Common whisper.cpp / ggml log prefixes (usually stderr, but be defensive)
    if (/^ggml[_:]/i.test(t)) continue
    if (/^whisper[_:]/i.test(t)) continue
    if (/^main:/i.test(t)) continue
    if (/^system_info:/i.test(t)) continue
    if (/^log[_ ]/i.test(t)) continue
    if (/^load(ing)?\s+/i.test(t)) continue
    if (/^metal\b/i.test(t)) continue
    if (/^use\s+/i.test(t) && /(metal|gpu|cpu|blas)/i.test(t)) continue
    if (/^error:/i.test(t)) continue
    if (/^warning:/i.test(t)) continue
    if (/^\[.*\]$/.test(t) && /BLANK/i.test(t)) continue
    kept.push(t)
  }
  if (kept.length === 0) return ""
  // Prefer joining remaining lines (short utterances are usually one line).
  // Last non-empty line is the conservative single-line pick; join is better for multi-line.
  return kept.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * Run cmspark-whisper / whisper-cli. No shell.
 * On abort or timeout: kill child (SIGTERM → SIGKILL escalate on abort).
 */
export async function runWhisperTranscribe(opts: RunWhisperTranscribeOpts): Promise<WhisperRunResult> {
  const timeoutMs = opts.timeoutMs ?? STT_INFER_MAX_MS
  const strict = opts.acceleration?.strictBackend
  const selectRuntime = opts.acceleration?.selectRuntime
  if (!strict && !selectRuntime && (opts.execFileImpl || !supportsWindowsWhisperAcceleration())) {
    const { text, ms } = await runWhisperAttempt(opts, opts.binaryPath, "cpu", timeoutMs, false)
    return { text, ms }
  }

  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const remaining = () => {
    if (opts.signal?.aborted) throw new WhisperRunnerError("aborted", "whisper aborted")
    const budget = Math.floor(timeoutMs - (performance.now() - started))
    if (budget < 1) throw timeoutError(timeoutMs)
    return budget
  }
  remaining()

  let runtime: WhisperRuntimeChoice = { backend: "cpu" }
  if (strict && strict !== "cpu") {
    const verified = await selectWithinDeadline(
      (signal) => verifiedWindowsWhisperRuntime(strict, opts.acceleration?.dataDir, signal),
      remaining(), timeoutMs, opts.signal,
    )
    remaining()
    if (!verified) throw new WhisperRunnerError("backend_unavailable", `verified Whisper ${strict} runtime unavailable`)
    runtime = verified
  } else if (!strict) {
    runtime = await selectWithinDeadline(
      selectRuntime ?? ((signal) => selectWindowsWhisperRuntime({ dataDir: opts.acceleration?.dataDir, signal })),
      remaining(), timeoutMs, opts.signal,
    )
  }

  const finish = (text: string, backend: WhisperBackend, device?: string, fallbackReason?: WhisperFallbackReason) => {
    remaining()
    const ms = elapsed()
    const execution: WhisperExecution = {
      backend,
      ...(device ? { device } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ms,
      at: Date.now(),
    }
    if (!strict && !selectRuntime && !opts.execFileImpl) recordWhisperExecution(execution)
    return { text, ms, execution }
  }

  let fallbackReason: WhisperFallbackReason | undefined
  if (runtime.backend !== "cpu") {
    try {
      const { text, stderr } = await runWhisperAttempt(opts, runtime.binaryPath, runtime.backend, remaining(), true)
      const evidence = parseWhisperBackendEvidence(runtime.backend, stderr)
      if (evidence) return finish(text, runtime.backend, evidence.device)
      if (strict) throw new WhisperRunnerError("backend_unproven", `Whisper did not prove ${runtime.backend} execution`)
      fallbackReason = `${runtime.backend}_unproven`
    } catch (error) {
      if (strict || error instanceof WhisperInputError ||
          !(error instanceof WhisperRunnerError) || error.code === "aborted" || error.code === "timeout") throw error
      fallbackReason = `${runtime.backend}_failed`
    }
  }

  const { text } = await runWhisperAttempt(opts, opts.binaryPath, "cpu", remaining(), true)
  return finish(text, "cpu", undefined, fallbackReason)
}

function timeoutError(timeoutMs: number): WhisperRunnerError {
  return new WhisperRunnerError("timeout", `whisper timed out after ${timeoutMs}ms`)
}

async function selectWithinDeadline<T>(
  select: (signal: AbortSignal) => Promise<T>,
  budget: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const verification = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const stop = new Promise<never>((_resolve, reject) => {
      const interrupt = (error: WhisperRunnerError) => {
        reject(error)
        verification.abort(error)
      }
      timer = setTimeout(() => interrupt(timeoutError(timeoutMs)), budget)
      onAbort = () => interrupt(new WhisperRunnerError("aborted", "whisper aborted"))
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    const selection = Promise.resolve().then(() => {
      verification.signal.throwIfAborted()
      return select(verification.signal)
    })
    return await Promise.race([selection, stop])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  }
}

class WhisperInputError extends WhisperRunnerError {
  constructor(input: "model" | "audio") {
    super("nonzero_exit", `whisper could not read the ${input} input`)
  }
}

function whisperInputFailure(stderr: string): WhisperInputError | undefined {
  if (/^error: (?:failed to read audio file|input file not found)\b/mi.test(stderr)) return new WhisperInputError("audio")
  if (/^whisper_init_from_file\w*: failed to open|^whisper_model_load: (?:invalid model\b|unknown tensor|tensor .* has wrong (?:size|shape) in model file|ERROR not all tensors loaded|WARN no tensors loaded)/mi.test(stderr)) {
    return new WhisperInputError("model")
  }
}

type WhisperAttempt = { text: string; ms: number; stderr: string }

function runWhisperAttempt(
  opts: RunWhisperTranscribeOpts,
  binaryPath: string,
  backend: WhisperBackend,
  timeoutMs: number,
  checkInput: boolean,
): Promise<WhisperAttempt> {
  const lang = opts.lang ?? "zh"
  const execFile = opts.execFileImpl ?? (defaultExecFile as ExecFileImpl)
  const args = buildWhisperArgs({
    modelPath: opts.modelPath,
    audioPath: opts.audioPath,
    lang,
    backend,
  })
  const started = Date.now()
  // Windows loads whisper/ggml DLLs from the directory of the *executable*.
  // Explicit cwd keeps sibling DLLs resolvable even if process.cwd is elsewhere.
  const binaryDir = path.dirname(path.resolve(binaryPath))
  const windowsGpu = process.platform === "win32" && backend !== "cpu"
  // Win32 accepts case-insensitive environment keys. Drop all forms before setting PATH.
  const parentEnv = windowsGpu
    ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:PATH|GGML_BACKEND_PATH)$/i.test(key)))
    : process.env

  if (opts.signal?.aborted) {
    throw new WhisperRunnerError("aborted", "whisper aborted before start")
  }

  return new Promise<WhisperAttempt>((resolve, reject) => {
    let settled = false
    let abortedBySignal = false
    let killEscalation: ReturnType<typeof setTimeout> | undefined
    let child: ChildProcess

    const finishReject = (err: WhisperRunnerError) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const finishResolve = (r: WhisperAttempt) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(r)
    }

    const onAbort = () => {
      abortedBySignal = true
      try {
        child?.kill("SIGTERM")
      } catch {
        /* ignore */
      }
      if (settled) return
      killEscalation = setTimeout(() => {
        try {
          child?.kill("SIGKILL")
        } catch {
          /* ignore */
        }
      }, 2_000)
      killEscalation.unref()
    }

    const cleanup = () => {
      if (killEscalation) clearTimeout(killEscalation)
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort)
      }
    }

    try {
      child = execFile(
        binaryPath,
        args,
        {
          timeout: timeoutMs,
          killSignal: "SIGTERM",
          // whisper.cpp logs can be chatty before -np; keep headroom
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: false,
          cwd: binaryDir,
          env: {
            // Inherit OS env (SystemRoot etc. required on Windows CRT) then override PATH
            ...parentEnv,
            PATH:
              process.platform === "win32"
                ? [binaryDir, windowsGpu ? windowsSystemDirectory() : process.env.PATH].filter(Boolean).join(path.delimiter)
                : process.env.PATH,
            // macOS: ensure @loader_path sibling dylibs resolve even if rpath is odd
            ...(process.platform === "darwin"
              ? {
                  DYLD_LIBRARY_PATH: [binaryDir, path.join(binaryDir, "..", "lib"), process.env.DYLD_LIBRARY_PATH]
                    .filter(Boolean)
                    .join(path.delimiter),
                  DYLD_FALLBACK_LIBRARY_PATH: [
                    binaryDir,
                    path.join(binaryDir, "..", "lib"),
                    "/opt/homebrew/lib",
                    "/usr/local/lib",
                    process.env.DYLD_FALLBACK_LIBRARY_PATH,
                  ]
                    .filter(Boolean)
                    .join(path.delimiter),
                }
              : {}),
          },
        },
        (err, stdout, stderr) => {
          const ms = Date.now() - started
          const out = String(stdout ?? "")
          const diagnostics = String(stderr ?? "")
          if (abortedBySignal || opts.signal?.aborted) {
            finishReject(new WhisperRunnerError("aborted", "whisper aborted"))
            return
          }
          if (!err) {
            const inputFailure = checkInput ? whisperInputFailure(diagnostics) : undefined
            if (inputFailure) finishReject(inputFailure)
            else finishResolve({ text: parseWhisperStdout(out), ms, stderr: diagnostics })
            return
          }
          const e = err
          // maxBuffer / spawn failures
          if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            finishReject(
              new WhisperRunnerError(
                "nonzero_exit",
                "whisper produced excessive output (stdio maxBuffer)",
              ),
            )
            return
          }
          // Node marks timeout kills with killed=true
          if (e.killed || e.signal === "SIGTERM" || e.signal === "SIGKILL") {
            // Early SIGKILL (dyld/OOM/broken binary) is NOT a wall-timeout
            if (e.signal === "SIGKILL" && ms < 2_000) {
              // Do NOT put "OOM" in this message — stt-session-service maps
              // oom via /\booms?\b/ before dyld (dual-review Pi nit: mislabel).
              finishReject(
                new WhisperRunnerError(
                  "spawn_error",
                  "whisper killed early (dyld missing libs / binary broken / SIGKILL)",
                ),
              )
              return
            }
            finishReject(
              timeoutError(timeoutMs),
            )
            return
          }
          if (typeof e.code === "number") {
            const inputFailure = checkInput ? whisperInputFailure(diagnostics) : undefined
            finishReject(
              inputFailure ?? new WhisperRunnerError(
                "nonzero_exit",
                e.message || `whisper exit ${e.code}`,
              ),
            )
            return
          }
          // ENOENT etc.
          finishReject(
            new WhisperRunnerError("spawn_error", e.message || "whisper spawn failed"),
          )
        },
      )
    } catch (e) {
      finishReject(
        new WhisperRunnerError(
          "spawn_error",
          e instanceof Error ? e.message : "whisper spawn threw",
        ),
      )
      return
    }

    if (!settled && opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true })
      if (opts.signal.aborted) onAbort()
    }
  })
}
