// B-lite git one-line status for Coding Agent Panel context bar (S1 dual-synthesis).
// Fixed argv only — no shell string. cwd = realpath(workspace_root); timeout ~3s.
// Never throws: soft-fail shape for UI.

import { spawn } from "child_process"
import { resolveAcpWorkspaceRoot } from "./workspace-bind"

/** Wall-clock budget for each git invocation (UX: must not block start). */
export const GIT_STATUS_TIMEOUT_MS = 3000

export type WorkspaceGitStatus = {
  branch: string | null
  dirty_count: number
  is_repo: boolean
  /** realpath cwd used when resolve succeeded */
  workspace_root?: string
  error?: string
}

type GitRunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Spawn `git` with fixed argv (shell:false). Never passes a shell string.
 */
function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs = GIT_STATUS_TIMEOUT_MS,
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    let child: ReturnType<typeof spawn>
    try {
      child = spawn("git", args as string[], {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          LANG: process.env.LANG || "C",
          // Non-interactive: never hang on credential prompts
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {
      resolve({ code: null, stdout: "", stderr: "spawn failed", timedOut: false })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    child.stdout?.on("data", (d: Buffer | string) => {
      stdout += String(d)
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000)
    })
    child.stderr?.on("data", (d: Buffer | string) => {
      stderr += String(d)
      if (stderr.length > 20_000) stderr = stderr.slice(0, 20_000)
    })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }

    child.on("error", () => finish(null))
    child.on("close", (code) => finish(code))
  })
}

function notARepo(res: GitRunResult): boolean {
  // Do NOT treat bare exit 128 as "not a repo" — git uses 128 for dubious
  // ownership, bad config, etc. Key on stderr content only.
  const blob = `${res.stderr}\n${res.stdout}`
  return /not a git repository/i.test(blob)
}

/**
 * Read branch + dirty file count for a bound workspace root.
 * Path is resolved via resolveAcpWorkspaceRoot (realpath + data-dir deny).
 */
export async function getWorkspaceGitStatus(
  workspaceRoot: string | null | undefined,
): Promise<WorkspaceGitStatus> {
  const bound = resolveAcpWorkspaceRoot(workspaceRoot)
  if (!bound.ok) {
    return {
      branch: null,
      dirty_count: 0,
      is_repo: false,
      error: bound.error,
    }
  }
  const cwd = bound.root

  // Fixed argv only (dual-synthesis B-lite / S1):
  //   git rev-parse --abbrev-ref HEAD
  //   git status --porcelain=v1 -b
  const [branchRes, statusRes] = await Promise.all([
    runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(cwd, ["status", "--porcelain=v1", "-b"]),
  ])

  if (branchRes.timedOut || statusRes.timedOut) {
    return {
      branch: null,
      dirty_count: 0,
      is_repo: false,
      workspace_root: cwd,
      error: "git timeout",
    }
  }

  // git missing / spawn ENOENT
  if (branchRes.code === null && statusRes.code === null) {
    return {
      branch: null,
      dirty_count: 0,
      is_repo: false,
      workspace_root: cwd,
      error: "git unavailable",
    }
  }

  if (notARepo(branchRes) || notARepo(statusRes)) {
    return {
      branch: null,
      dirty_count: 0,
      is_repo: false,
      workspace_root: cwd,
    }
  }

  // Prefer porcelain -b header for branch when rev-parse failed (detached edge)
  let branch: string | null = null
  if (branchRes.code === 0) {
    const b = branchRes.stdout.trim()
    branch = b || null
  } else {
    const first = (statusRes.stdout.split(/\r?\n/)[0] || "").trim()
    const m = first.match(/^##\s+(\S+)/)
    if (m) {
      branch = m[1].split("...")[0] || null
    }
  }

  // Dirty = non-empty porcelain body lines (exclude ## branch header)
  const dirty_count = statusRes.stdout
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith("##")).length

  // status non-zero without "not a repo" → soft error but still report what we have
  if (statusRes.code !== 0 && statusRes.code !== null) {
    return {
      branch,
      dirty_count,
      is_repo: branch != null || dirty_count > 0,
      workspace_root: cwd,
      error: "git status failed",
    }
  }

  return {
    branch,
    dirty_count,
    is_repo: true,
    workspace_root: cwd,
  }
}
