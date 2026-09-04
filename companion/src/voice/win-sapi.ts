// #259 — Windows 系统语音识别兜底（SAPI helper 桥）。
// spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md §3.2
//
// 仅 System.Speech.Recognition（桌面、纯本地）；Windows.Media.SpeechRecognition
// （WinRT）部分 SKU 走云，禁用（spec §3.2「音频不出本机」）。
//
// helper 是一次性子进程：stdin 收一行 JSON 请求，stdout 回一行 JSON 帧后退出。
// ADR-023 L5 精神：路径固定安装目录（<exeDir>/bin 优先），sha256 sidecar 校验，
// 不经 PATH 解析未知二进制。

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const SAPI_HELPER_TIMEOUT_MS = 15_000
export const WIN_SAPI_HELPER_EXE_NAME = "win-sapi-helper.exe"
export const WIN_SAPI_HELPER_SHA256_NAME = "win-sapi-helper.sha256"
const WIN_SAPI_UNPINNED_ENV = "CMSPARK_WIN_SAPI_UNPINNED"

// --- lang → recognizer culture（spec §3.2：跟随听写语言，zh-CN / en-US）------

export function mapSttLangToSapiCulture(lang?: string): string {
  if (!lang) return "zh-CN"
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) return "zh-CN"
  if (lower.startsWith("en")) return "en-US"
  return lang
}

// --- 行 JSON 协议编解码 --------------------------------------------------------

export type SapiRequest = { probe: true } | { wav_path: string; lang: string }

export function encodeSapiRequestLine(req: SapiRequest): string {
  return JSON.stringify(req)
}

export type SapiResponse =
  | { kind: "text"; text: string }
  | { kind: "error"; error: string; code?: string }
  | { kind: "available"; available: boolean; reason?: string }

export function parseSapiResponseLine(line: string): SapiResponse | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof obj !== "object" || obj === null) return null
  const o = obj as Record<string, unknown>
  if (typeof o.text === "string") return { kind: "text", text: o.text }
  if (typeof o.error === "string") {
    return {
      kind: "error",
      error: o.error,
      ...(typeof o.code === "string" ? { code: o.code } : {}),
    }
  }
  if (typeof o.available === "boolean") {
    return {
      kind: "available",
      available: o.available,
      ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
    }
  }
  return null
}

// --- helper 解析 + sha256 校验（打包 sidecar pin；csc 产物 hash 随工具链变，
//     所以 pin 在打包期生成 sidecar，而不是仓库常数） --------------------------

export type WinSapiResolveOk = { ok: true; path: string; sha256: string; pinned: boolean }
export type WinSapiResolveFail = {
  ok: false
  reason: "not_win32" | "missing" | "hash_fail" | "unpinned"
  message: string
}

export function resolveWinSapiHelper(deps?: {
  platform?: NodeJS.Platform
  roots?: string[]
  env?: Record<string, string | undefined>
}): WinSapiResolveOk | WinSapiResolveFail {
  const platform = deps?.platform ?? process.platform
  if (platform !== "win32") {
    return { ok: false, reason: "not_win32", message: "System STT engine is Windows-only" }
  }
  const unpinned = (deps?.env ?? process.env)[WIN_SAPI_UNPINNED_ENV] === "1"
  const roots = deps?.roots ?? defaultHelperRoots()
  for (const root of roots) {
    const exePath = path.join(root, WIN_SAPI_HELPER_EXE_NAME)
    if (!fs.existsSync(exePath)) continue
    const sidecar = path.join(root, WIN_SAPI_HELPER_SHA256_NAME)
    if (!fs.existsSync(sidecar)) {
      if (!unpinned) {
        return {
          ok: false,
          reason: "unpinned",
          message: `helper sha256 sidecar missing: ${sidecar}`,
        }
      }
      return { ok: true, path: exePath, sha256: "", pinned: false }
    }
    const expected = fs.readFileSync(sidecar, "utf8").trim().toLowerCase()
    const actual = createHash("sha256").update(fs.readFileSync(exePath)).digest("hex")
    if (expected !== actual) {
      if (!unpinned) {
        return { ok: false, reason: "hash_fail", message: `helper sha256 mismatch: ${exePath}` }
      }
      return { ok: true, path: exePath, sha256: actual, pinned: false }
    }
    return { ok: true, path: exePath, sha256: actual, pinned: true }
  }
  return {
    ok: false,
    reason: "missing",
    message: `${WIN_SAPI_HELPER_EXE_NAME} not found under: ${roots.join(", ")}`,
  }
}

function defaultHelperRoots(): string[] {
  // SEA 包布局：<exeDir>\bin\win-sapi-helper.exe（与 whisper sidecar 同目录）；
  // dev 布局：companion/dist/bin（tsc 产物旁）。不查 PATH。
  const exeDir = path.dirname(process.execPath)
  return [path.join(exeDir, "bin"), exeDir]
}

// --- 子进程抽象（可注入，供单测） ----------------------------------------------

export interface SapiChild {
  write(line: string): void
  kill(): void
  once(event: "line", cb: (line: string) => void): void
  once(event: "close", cb: (code: number | null) => void): void
}

export type SpawnSapiHelper = (helperPath: string) => SapiChild

export function spawnRealSapiHelper(helperPath: string): SapiChild {
  const child = spawn(helperPath, [], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  })
  let buf = ""
  const lineCbs = new Set<(l: string) => void>()
  const closeCbs = new Set<(c: number | null) => void>()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d: string) => {
    buf += d
    let nl = buf.indexOf("\n")
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) lineCbs.forEach((cb) => cb(line))
      nl = buf.indexOf("\n")
    }
  })
  child.on("close", (code) => closeCbs.forEach((cb) => cb(code)))
  child.on("error", () => closeCbs.forEach((cb) => cb(null)))
  return {
    write(line: string): void {
      child.stdin.write(line + "\n")
    },
    kill(): void {
      try {
        child.kill()
      } catch {
        // already dead
      }
    },
    once(event: "line" | "close", cb: (v: any) => void): void {
      if (event === "line") {
        const wrapped = (l: string) => {
          lineCbs.delete(wrapped)
          cb(l)
        }
        lineCbs.add(wrapped)
      } else {
        const wrapped = (c: number | null) => {
          closeCbs.delete(wrapped)
          cb(c)
        }
        closeCbs.add(wrapped)
      }
    },
  }
}

// --- 错误 ----------------------------------------------------------------------

export type WinSapiErrorCode =
  | "not_win32"
  | "unavailable"
  | "spawn_failed"
  | "timeout"
  | "aborted"
  | "protocol"
  | "helper_error"
  | "system_lang_unsupported"

export class WinSapiError extends Error {
  constructor(
    public readonly code: WinSapiErrorCode,
    message: string,
    public readonly helperCode?: string,
  ) {
    super(message)
    this.name = "WinSapiError"
  }
}

// --- 一次性请求骨架：注册 waiters → 写请求行 → 等首帧/close/超时/中止 ----------

interface OneShotHandle {
  child: SapiChild
  promise: Promise<string>
}

function runOneShot(
  child: SapiChild,
  requestLine: string,
  timeoutMs: number,
  signal?: AbortSignal,
): OneShotHandle {
  let settle: (line: string) => void
  let fail: (err: WinSapiError) => void
  const promise = new Promise<string>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  let done = false
  const finish = (fn: () => void) => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
    try {
      child.kill()
    } catch {
      // already dead
    }
    fn()
  }
  const timer = setTimeout(
    () => finish(() => fail(new WinSapiError("timeout", `helper timed out after ${timeoutMs}ms`))),
    timeoutMs,
  )
  const onAbort = signal
    ? () => finish(() => fail(new WinSapiError("aborted", "helper run aborted")))
    : null
  if (onAbort && signal) {
    if (signal.aborted) {
      finish(() => fail(new WinSapiError("aborted", "helper run aborted")))
    } else {
      signal.addEventListener("abort", onAbort)
    }
  }
  child.once("line", (line) => finish(() => settle(line)))
  child.once("close", (code) =>
    finish(() =>
      fail(
        new WinSapiError(
          "spawn_failed",
          `helper exited before responding (code=${code ?? "signal"})`,
        ),
      ),
    ),
  )
  child.write(requestLine)
  return { child, promise }
}

// --- 转写（voice.stt session system 引擎端点） ----------------------------------

export interface RunWinSapiOptions {
  wavPath: string
  lang?: string
  timeoutMs?: number
  signal?: AbortSignal
  spawn?: SpawnSapiHelper
  helperPath?: string
}

export async function runWinSapiTranscribe(opts: RunWinSapiOptions): Promise<{ text: string }> {
  const spawnFn = opts.spawn ?? spawnRealSapiHelper
  let helperPath = opts.helperPath
  if (!helperPath) {
    if (opts.spawn) {
      helperPath = WIN_SAPI_HELPER_EXE_NAME
    } else {
      const resolved = resolveWinSapiHelper()
      if (!resolved.ok) {
        throw new WinSapiError(
          resolved.reason === "not_win32" ? "not_win32" : "unavailable",
          resolved.message,
        )
      }
      helperPath = resolved.path
    }
  }
  const request = encodeSapiRequestLine({
    wav_path: opts.wavPath,
    lang: mapSttLangToSapiCulture(opts.lang),
  })
  const handle = runOneShot(
    spawnFn(helperPath),
    request,
    opts.timeoutMs ?? SAPI_HELPER_TIMEOUT_MS,
    opts.signal,
  )
  const line = await handle.promise
  const frame = parseSapiResponseLine(line)
  if (frame === null) {
    throw new WinSapiError("protocol", `helper returned non-JSON frame: ${line.slice(0, 200)}`)
  }
  if (frame.kind === "text") return { text: frame.text }
  if (frame.kind === "error") {
    if (frame.code === "unsupported_culture") {
      throw new WinSapiError(
        "system_lang_unsupported",
        `系统语音识别不支持当前语言: ${frame.error}`,
        frame.code,
      )
    }
    throw new WinSapiError("helper_error", `helper error: ${frame.error}`, frame.code)
  }
  throw new WinSapiError("protocol", `unexpected available frame on transcribe: ${line}`)
}

// --- 探测（voice.system.state 后端；绝不 throw） -------------------------------

export interface ProbeWinSapiOptions {
  platform?: NodeJS.Platform
  roots?: string[]
  env?: Record<string, string | undefined>
  spawn?: SpawnSapiHelper
  timeoutMs?: number
}

export interface WinSapiProbeResult {
  available: boolean
  reason?: string
}

export async function probeWinSapiSystemSpeech(
  opts?: ProbeWinSapiOptions,
): Promise<WinSapiProbeResult> {
  const platform = opts?.platform ?? process.platform
  if (platform !== "win32") return { available: false, reason: "not_win32" }
  const resolved = resolveWinSapiHelper({ platform, roots: opts?.roots, env: opts?.env })
  if (!resolved.ok) return { available: false, reason: resolved.reason }
  const spawnFn = opts?.spawn ?? spawnRealSapiHelper
  try {
    const handle = runOneShot(
      spawnFn(resolved.path),
      encodeSapiRequestLine({ probe: true }),
      opts?.timeoutMs ?? SAPI_HELPER_TIMEOUT_MS,
    )
    const line = await handle.promise
    const frame = parseSapiResponseLine(line)
    if (frame?.kind === "available") {
      return { available: frame.available, reason: frame.reason }
    }
    return { available: false, reason: "protocol" }
  } catch (err) {
    const code = err instanceof WinSapiError ? err.code : "probe_failed"
    return { available: false, reason: code }
  }
}
