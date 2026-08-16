// Windows spawn helpers for ACP coding agents.
//
// npm / nvm-windows install a pair of shims next to node.exe:
//   claude        — POSIX `#!/bin/sh` script (CreateProcess → ENOENT)
//   claude.cmd    — cmd.exe wrapper (CreateProcess → EINVAL without a console host)
// `where claude` lists the shebang first. Discovery and spawn must prefer
// .exe/.cmd and unwrap cmd-shims to a PE or `node script.js` so JSON-RPC
// stdio does not go through a hidden `cmd.exe`.

import { spawn, type ChildProcess, type SpawnOptions } from "child_process"
import * as fs from "fs"
import * as path from "path"

export type AcpSpawnSpec = {
  command: string
  args: string[]
  options: {
    windowsHide?: boolean
    windowsVerbatimArguments?: boolean
  }
}

export type WinFsDeps = {
  exists?: (p: string) => boolean
  isShebang?: (p: string) => boolean
  readHead?: (p: string) => string
  readFile?: (p: string) => string
  /** Injectable process.execPath (tests / packaged-exe refusal). */
  execPath?: string
}

function defaultExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** First 256 bytes look like a POSIX shebang (`#!/bin/sh`, `#!/usr/bin/env node`). */
export function looksLikeWindowsShebangScript(
  filePath: string,
  deps?: WinFsDeps,
): boolean {
  try {
    const head = (deps?.readHead || ((p) => fs.readFileSync(p, { encoding: "utf8" }).slice(0, 256)))(
      filePath,
    )
    return /^#![ \t]*\//.test(head)
  } catch {
    return false
  }
}

/**
 * Rank `where` hits for a spawnable Windows target.
 * `.exe`/`.com` > `.cmd`/`.bat` > other non-shebang > (never) shebang-only.
 */
export function pickWindowsWhereHit(lines: string[], deps?: WinFsDeps): string | undefined {
  const exists = deps?.exists ?? defaultExists
  const isShebang = deps?.isShebang ?? ((p: string) => looksLikeWindowsShebangScript(p, deps))
  const files = [...new Set(lines.map((l) => l.trim()).filter(Boolean))].filter(exists)
  if (!files.length) return undefined

  const rank = (p: string): number => {
    const ext = path.extname(p).toLowerCase()
    if (ext === ".exe" || ext === ".com") return 0
    if (ext === ".cmd" || ext === ".bat") return 1
    if (isShebang(p)) return 9
    return 5
  }
  files.sort((a, b) => rank(a) - rank(b) || a.length - b.length)
  const best = files[0]
  if (!best || rank(best) >= 9) return undefined
  return best
}

/** If `p` is extensionless (or a shebang), return sibling `.exe` / `.cmd` / `.bat`. */
export function findWindowsSiblingShim(p: string, deps?: WinFsDeps): string | undefined {
  const exists = deps?.exists ?? defaultExists
  const trimmed = p.trim()
  if (!trimmed) return undefined
  const ext = path.extname(trimmed)
  const base = ext ? trimmed.slice(0, -ext.length) : trimmed
  for (const e of [".exe", ".com", ".cmd", ".bat"]) {
    const cand = base + e
    if (cand !== trimmed && exists(cand)) return cand
  }
  return undefined
}

export type UnwrappedCmd = {
  command: string
  prefixArgs: string[]
}

/**
 * Join a `%dp0%` / `%~dp0` relative path onto the shim directory.
 * Normalizes both `/` and `\` so fixtures work on POSIX test hosts (R11).
 */
export function joinDp0Relative(shimDir: string, rel: string): string {
  const parts = String(rel)
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== ".")
  return path.join(shimDir, ...parts)
}

/**
 * Node binary for a JS cmd-shim.
 * Prefer sibling `node.exe`. Fall back to process.execPath only when it is
 * actually Node — never a packaged companion PE (cmspark-agent.exe) (R9).
 */
export function resolveNodeForJsShim(
  shimDir: string,
  deps?: WinFsDeps,
): string | null {
  const exists = deps?.exists ?? defaultExists
  const sibling = path.join(shimDir, "node.exe")
  if (exists(sibling)) return sibling
  const exec = deps?.execPath ?? process.execPath
  const base = winBasename(exec)
  if (base === "node.exe" || base === "node") return exec
  return null
}

const DP0_PREFIX = "%(?:~dp0\\\\?|dp0%[\\\\/]?)"

/**
 * Parse npm / Claude / pnpm `.cmd` shims into a PE or `node script.js`.
 * Accepts `%dp0%\\rel` and `%~dp0rel` / `%~dp0\\rel` (R10).
 */
export function unwrapWindowsCmdShim(cmdPath: string, deps?: WinFsDeps): UnwrappedCmd | null {
  const ext = path.extname(cmdPath).toLowerCase()
  if (ext !== ".cmd" && ext !== ".bat") return null
  let text: string
  try {
    text = deps?.readFile ? deps.readFile(cmdPath) : fs.readFileSync(cmdPath, "utf8")
  } catch {
    return null
  }
  if (text.length > 32_000) text = text.slice(0, 32_000)
  const dir = path.dirname(cmdPath)
  const exists = deps?.exists ?? defaultExists

  // "%dp0%\rel.exe" %*   /   "%~dp0rel.exe" %*
  const exe = text.match(new RegExp(`"${DP0_PREFIX}([^"\\r\\n]+\\.exe)"\\s*%\\*`, "i"))
  if (exe?.[1]) {
    const resolved = joinDp0Relative(dir, exe[1])
    if (exists(resolved)) return { command: resolved, prefixArgs: [] }
  }

  // "%~dp0\node.exe"  "%~dp0\…\cli.js" %*
  const nodeJs = text.match(
    new RegExp(
      `"${DP0_PREFIX}([^"\\r\\n]*node\\.exe)"\\s+"${DP0_PREFIX}([^"\\r\\n]+\\.(?:js|mjs|cjs))"`,
      "i",
    ),
  )
  if (nodeJs?.[1] && nodeJs[2]) {
    const node = joinDp0Relative(dir, nodeJs[1])
    const script = joinDp0Relative(dir, nodeJs[2])
    if (exists(node) && exists(script)) return { command: node, prefixArgs: [script] }
  }

  // "%_prog%"  "%dp0%\…\cli.js" %*   (and %~dp0 form)
  const js = text.match(
    new RegExp(`"%_prog%"\\s+"${DP0_PREFIX}([^"\\r\\n]+\\.(?:js|mjs|cjs))"`, "i"),
  )
  if (js?.[1]) {
    const script = joinDp0Relative(dir, js[1])
    if (!exists(script)) return null
    const node = resolveNodeForJsShim(dir, deps)
    if (!node) return null
    return { command: node, prefixArgs: [script] }
  }

  return null
}

/**
 * Map a discovered / configured command to something CreateProcess can run.
 * Never returns a POSIX shebang path when a sibling `.cmd`/`.exe` exists.
 */
export function resolveWindowsAgentCommand(command: string, deps?: WinFsDeps): string {
  const exists = deps?.exists ?? defaultExists
  const trimmed = command.trim()
  if (!trimmed) return command

  const ext = path.extname(trimmed).toLowerCase()
  if (ext === ".exe" || ext === ".com") return trimmed
  if (ext === ".cmd" || ext === ".bat") return trimmed

  const sibling = findWindowsSiblingShim(trimmed, deps)
  if (sibling) return sibling

  const isShebang = deps?.isShebang ?? ((p: string) => looksLikeWindowsShebangScript(p, deps))
  if (exists(trimmed) && isShebang(trimmed)) {
    // last resort: keep it (caller may still wrap via cmd — will fail, but honest)
    return trimmed
  }
  return trimmed
}

/** Windows-aware basename (`\` and `/`) so POSIX test hosts still classify cmd.exe. */
function winBasename(p: string): string {
  const norm = String(p || "").replace(/\//g, "\\")
  const i = norm.lastIndexOf("\\")
  return (i >= 0 ? norm.slice(i + 1) : norm).toLowerCase()
}

const CMD_META = /[\s"&<>|^%!()]/
/** Drop from wrapViaCmd: long tokens, newlines, or cmd metacharacters that can split `/c`. */
const CMD_WRAP_UNSAFE = /[\r\n&|<>^%!"]/
const CMD_WRAP_MAX_ARG = 256

/**
 * cmd.exe argument quoting (not POSIX / Node).
 * Quote when the token is empty, has whitespace, or has cmd metacharacters.
 * `"` → `""` (not backslash-quote). `%` → `%%` (blocks env expansion).
 */
export function quoteCmdArg(s: string): string {
  const raw = String(s)
  const escaped = raw.replace(/%/g, "%%").replace(/"/g, '""')
  if (raw !== "" && !CMD_META.test(raw)) return raw
  return `"${escaped}"`
}

/**
 * Strip prompt / page_context / other unsafe tokens before wrapViaCmd.
 * Drops `-p`/`--print` and the following non-flag value.
 * Drops any arg that is long, has newlines, or contains `&|<>^%!"`.
 * Keeps short flags such as `--output-format text`.
 */
export function argvForCmdWrap(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "-p" || a === "--print") {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith("-")) i++
      continue
    }
    if (a.length > CMD_WRAP_MAX_ARG || CMD_WRAP_UNSAFE.test(a)) continue
    out.push(a)
  }
  return out
}

/** True when the resolved spawn command is a cmd.exe host (wrapViaCmd fallback). */
export function acpSpawnUsesCmdHost(spec: { command: string }): boolean {
  const base = winBasename(spec.command)
  return base === "cmd.exe" || base === "cmd"
}

/**
 * cmd /d /s /c with the entire cmdline wrapped in one extra pair of quotes
 * (Node `shell:true` idiom). Never pass raw user/page prompt — callers must
 * feed argvForCmdWrap, and wrapViaCmd applies it again.
 */
function wrapViaCmd(command: string, args: string[]): AcpSpawnSpec {
  const safeArgs = argvForCmdWrap(args)
  const inner = [command, ...safeArgs].map(quoteCmdArg).join(" ")
  const cmdline = `"${inner}"`
  const comspec = process.env.ComSpec || "cmd.exe"
  return {
    command: comspec,
    args: ["/d", "/s", "/c", cmdline],
    options: { windowsHide: true, windowsVerbatimArguments: true },
  }
}

export function resolveAcpSpawn(
  command: string,
  args: string[],
  opts?: WinFsDeps & { platform?: NodeJS.Platform },
): AcpSpawnSpec {
  const platform = opts?.platform ?? process.platform
  if (platform !== "win32") {
    return { command, args, options: {} }
  }

  const target = resolveWindowsAgentCommand(command, opts)
  const ext = path.extname(target).toLowerCase()

  if (ext === ".exe" || ext === ".com") {
    return { command: target, args, options: { windowsHide: true } }
  }

  const unwrapped = unwrapWindowsCmdShim(target, opts)
  if (unwrapped) {
    return {
      command: unwrapped.command,
      args: [...unwrapped.prefixArgs, ...args],
      options: { windowsHide: true },
    }
  }

  if (ext === ".cmd" || ext === ".bat") {
    return wrapViaCmd(target, args)
  }

  // Bare / unknown: still go through cmd so PATHEXT can resolve .cmd
  return wrapViaCmd(target, args)
}

export function spawnAcpChild(
  command: string,
  args: string[],
  options: SpawnOptions,
): ReturnType<typeof spawn> {
  const spec = resolveAcpSpawn(command, args)
  return spawn(spec.command, spec.args, {
    ...options,
    shell: false,
    windowsHide: spec.options.windowsHide ?? (options.windowsHide as boolean | undefined),
    windowsVerbatimArguments:
      spec.options.windowsVerbatimArguments ??
      (options.windowsVerbatimArguments as boolean | undefined),
  })
}

/** Absolute System32\taskkill.exe (never PATH / hijack). */
export function windowsTaskkillPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows"
  return path.join(root, "System32", "taskkill.exe")
}

/** Exclusive create (O_EXCL / `wx`) so a pre-planted TEMP file cannot be overwritten. */
export function writeExclusiveUtf8(filePath: string, body: string): void {
  fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600, flag: "wx" })
}

/** Best-effort delayed unlink (Mode C PS1/task must stay until the new window reads them). */
export function scheduleUnlink(paths: string[], delayMs = 60_000): void {
  const t = setTimeout(() => {
    for (const p of paths) {
      try {
        fs.unlinkSync(p)
      } catch {
        /* */
      }
    }
  }, delayMs)
  t.unref?.()
}

/** Kill ACP child + descendants (win32 taskkill tree; POSIX SIGTERM). */
export function killAcpChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid
  if (pid == null || pid <= 0) return
  if (process.platform === "win32") {
    try {
      const k = spawn(windowsTaskkillPath(), ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
      k.once("error", () => {
        try {
          child.kill()
        } catch {
          /* */
        }
      })
    } catch {
      try {
        child.kill()
      } catch {
        /* */
      }
    }
    return
  }
  try {
    child.kill(signal)
  } catch {
    /* */
  }
}
