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

import { STT_INFER_MAX_MS } from "./session-caps"

export type WhisperRunResult = { text: string; ms: number }

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
}

export type WhisperRunnerErrorCode = "timeout" | "aborted" | "spawn_error" | "nonzero_exit"

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
    "-ng",
    "-np",
    "-t",
    String(threads),
  ]
}

/**
 * Parse whisper-cli stdout with `-nt` (no timestamps).
 * Strip ggml/whisper log lines; `[BLANK_AUDIO]` → empty; empty stdout ok.
 */
export function parseWhisperStdout(stdout: string): string {
  const raw = String(stdout ?? "")
  if (raw.includes("[BLANK_AUDIO]")) return ""

  const lines = raw.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
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
export async function runWhisperTranscribe(
  opts: RunWhisperTranscribeOpts,
): Promise<WhisperRunResult> {
  const lang = opts.lang ?? "zh"
  const timeoutMs = opts.timeoutMs ?? STT_INFER_MAX_MS
  const execFile = opts.execFileImpl ?? (defaultExecFile as ExecFileImpl)
  const args = buildWhisperArgs({
    modelPath: opts.modelPath,
    audioPath: opts.audioPath,
    lang,
  })
  const started = Date.now()
  // Windows loads whisper/ggml DLLs from the directory of the *executable*.
  // Explicit cwd keeps sibling DLLs resolvable even if process.cwd is elsewhere.
  const binaryDir = path.dirname(path.resolve(opts.binaryPath))

  if (opts.signal?.aborted) {
    throw new WhisperRunnerError("aborted", "whisper aborted before start")
  }

  return new Promise<WhisperRunResult>((resolve, reject) => {
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
    const finishResolve = (r: WhisperRunResult) => {
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
      killEscalation = setTimeout(() => {
        try {
          child?.kill("SIGKILL")
        } catch {
          /* ignore */
        }
      }, 2_000)
      if (typeof (killEscalation as any).unref === "function") {
        ;(killEscalation as any).unref()
      }
    }

    const cleanup = () => {
      if (killEscalation) clearTimeout(killEscalation)
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort)
      }
    }

    try {
      child = execFile(
        opts.binaryPath,
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
            ...process.env,
            PATH:
              process.platform === "win32"
                ? `${binaryDir}${path.delimiter}${process.env.PATH || ""}`
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
        (err, stdout, _stderr) => {
          const ms = Date.now() - started
          const out = String(stdout ?? "")
          if (!err) {
            finishResolve({ text: parseWhisperStdout(out), ms })
            return
          }
          if (abortedBySignal || opts.signal?.aborted) {
            finishReject(new WhisperRunnerError("aborted", "whisper aborted"))
            return
          }
          const e = err as ExecFileException & { killed?: boolean; code?: string | number }
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
              new WhisperRunnerError(
                "timeout",
                `whisper timed out after ${timeoutMs}ms`,
              ),
            )
            return
          }
          if (typeof e.code === "number") {
            finishReject(
              new WhisperRunnerError(
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

    if (opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true })
      if (opts.signal.aborted) onAbort()
    }
  })
}
