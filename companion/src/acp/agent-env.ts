// Env for coding-agent children (ACP Client + CLI bridge).
// Product goal: same credentials/tools as launching the agent in a normal terminal.
//
// Prior bug: manager only passed PATH/HOME/LANG — stripped ANTHROPIC_API_KEY etc.
// Companion (tray/.app) may also lack interactive-shell exports; we merge a
// best-effort login-shell env snapshot so GUI-launched Companion matches Terminal.

import { execFileSync } from "child_process"
import { getUserEnvVars } from "../user-env"
import { hardenPath } from "../process-path"
import { logger } from "../logger"

export type BuildAcpAgentEnvOpts = {
  sessionId: string
  mode: string
  /** Per-agent config.env overrides (highest precedence before markers). */
  serverEnv?: Record<string, string>
  /** Injectable for tests (defaults to process.env). */
  processEnv?: NodeJS.ProcessEnv
  /** Injectable for tests (defaults to getUserEnvVars()). */
  userEnv?: Record<string, string>
  /** Injectable login-shell snapshot (defaults to cached probe). */
  loginShellEnv?: Record<string, string>
  /** Skip login-shell probe (tests / CMSPARK_SKIP_LOGIN_ENV). */
  skipLoginShell?: boolean
}

let loginShellEnvCache: Record<string, string> | null = null
let loginShellEnvProbed = false

/** Test helper — reset login-shell cache. */
export function clearLoginShellEnvCache(): void {
  loginShellEnvCache = null
  loginShellEnvProbed = false
}

/**
 * Parse `env -0` / NUL-separated KEY=VALUE stream into a plain object.
 * Skips empty names and malformed lines (no `=`).
 */
export function parseEnvNullSeparated(buf: string | Buffer): Record<string, string> {
  const text = typeof buf === "string" ? buf : buf.toString("utf8")
  const out: Record<string, string> = {}
  for (const entry of text.split("\0")) {
    if (!entry) continue
    const eq = entry.indexOf("=")
    if (eq <= 0) continue
    const key = entry.slice(0, eq)
    // Refuse empty key / keys with NUL (shouldn't appear)
    if (!key || key.includes("\0")) continue
    out[key] = entry.slice(eq + 1)
  }
  return out
}

/**
 * Best-effort login + interactive shell env (loads .zprofile + .zshrc / bash rc).
 * Cached for process lifetime. Never throws; returns {} on failure / skip.
 *
 * Security: values are never logged. Used only for coding-agent spawn parity.
 */
export function getLoginShellEnv(opts?: {
  force?: boolean
  shell?: string
  execFile?: typeof execFileSync
  timeoutMs?: number
}): Record<string, string> {
  if (process.env.CMSPARK_SKIP_LOGIN_ENV === "1" && !opts?.force) {
    return loginShellEnvCache || {}
  }
  if (loginShellEnvProbed && !opts?.force) {
    return loginShellEnvCache || {}
  }
  loginShellEnvProbed = true

  if (process.platform === "win32") {
    // Windows interactive profile is a different story; inherit process.env only.
    loginShellEnvCache = {}
    return loginShellEnvCache
  }

  const shell =
    opts?.shell ||
    process.env.SHELL ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  const execFile = opts?.execFile || execFileSync
  const timeout = opts?.timeoutMs ?? 5_000

  try {
    // -l login, -i interactive so typical user API key exports load.
    // env -0 is safe for values containing newlines (rare) / spaces.
    const stdout = execFile(
      shell,
      ["-lic", "env -0"],
      {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "buffer",
        env: {
          // Minimal seed so the login shell still finds basics; user profile fills the rest.
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME,
          TMPDIR: process.env.TMPDIR,
          TERM: "dumb",
          PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
        },
      },
    ) as Buffer
    loginShellEnvCache = parseEnvNullSeparated(stdout)
    logger.info("acp.login_shell_env", {
      keys: Object.keys(loginShellEnvCache).length,
      shell,
    })
  } catch (e: any) {
    loginShellEnvCache = {}
    logger.warn("acp.login_shell_env_failed", {
      err: e?.message || String(e),
      shell,
    })
  }
  return loginShellEnvCache
}

/**
 * Build env for ACP / CLI-bridge coding agent child.
 *
 * Merge order (later wins):
 *   1. process.env          — Companion process (tray may already be rich)
 *   2. login-shell env      — terminal parity for GUI-launched Companion
 *   3. user-env.json        — Settings → 环境变量（Secrets）ADR-019
 *   4. server.env           — per-agent config overrides
 *   5. CMSPARK_ACP_*        — session markers (always win)
 *
 * PATH is hardened after merge (GUI ENOTDIR recovery).
 */
export function buildAcpAgentEnv(opts: BuildAcpAgentEnvOpts): NodeJS.ProcessEnv {
  const processEnv = opts.processEnv ?? process.env
  const userEnv = opts.userEnv ?? getUserEnvVars()
  const loginEnv =
    opts.loginShellEnv ??
    (opts.skipLoginShell || processEnv.CMSPARK_SKIP_LOGIN_ENV === "1"
      ? {}
      : getLoginShellEnv())

  const merged: NodeJS.ProcessEnv = {
    ...processEnv,
    ...loginEnv,
    ...userEnv,
    ...(opts.serverEnv || {}),
    CMSPARK_ACP_SESSION: opts.sessionId,
    CMSPARK_ACP_MODE: opts.mode,
  }

  // Drop undefined so spawn doesn't see sparse env
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k]
  }

  merged.PATH = hardenPath({ pathEnv: merged.PATH })
  return merged
}
