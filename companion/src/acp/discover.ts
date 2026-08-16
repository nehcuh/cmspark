// Best-effort discovery of local coding-agent CLIs on PATH / common install dirs.
// Does not spawn agents; does not write config.json (runtime merge only).

import { execFileSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { hardenPath } from "../process-path"
import {
  pickWindowsWhereHit,
  findWindowsSiblingShim,
  resolveWindowsAgentCommand,
} from "./win-spawn"

export type DiscoveredAgent = {
  id: string
  display_name: string
  command: string
  source: "path" | "common"
}

type ProbeDef = {
  id: string
  display_name: string
  /** PATH basenames to try with `which` / `where` */
  basenames: string[]
  /** Absolute candidates if PATH miss */
  commonPaths: string[]
}

const PROBES: ProbeDef[] = [
  {
    id: "claude",
    display_name: "Claude Code",
    basenames: ["claude"],
    commonPaths: [
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      path.join(os.homedir(), ".local", "bin", "claude"),
      path.join(os.homedir(), ".claude", "local", "claude"),
      ...windowsCommonAgentPaths("claude"),
      // Homebrew Caskroom (GUI-launched Companion often lacks brew in PATH)
      ...(() => {
        try {
          const base = "/opt/homebrew/Caskroom/claude-code"
          if (!fs.existsSync(base)) return [] as string[]
          return fs
            .readdirSync(base)
            .sort()
            .reverse()
            .slice(0, 3)
            .map((v) => path.join(base, v, "claude"))
        } catch {
          return [] as string[]
        }
      })(),
    ],
  },
  {
    id: "gemini",
    display_name: "Gemini CLI",
    basenames: ["gemini"],
    commonPaths: [
      "/opt/homebrew/bin/gemini",
      "/usr/local/bin/gemini",
      path.join(os.homedir(), ".local", "bin", "gemini"),
      ...windowsCommonAgentPaths("gemini"),
    ],
  },
  {
    id: "codex",
    display_name: "Codex CLI",
    basenames: ["codex"],
    commonPaths: [
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(os.homedir(), ".local", "bin", "codex"),
      ...windowsCommonAgentPaths("codex"),
    ],
  },
  {
    id: "pi",
    display_name: "Pi Agent",
    basenames: ["pi"],
    commonPaths: [
      "/opt/homebrew/bin/pi",
      "/usr/local/bin/pi",
      // nvm: prefer latest installed node bin if present
      ...(() => {
        try {
          const nvm = path.join(os.homedir(), ".nvm", "versions", "node")
          if (!fs.existsSync(nvm)) return [] as string[]
          const vers = fs.readdirSync(nvm).sort().reverse()
          return vers.slice(0, 3).map((v) => path.join(nvm, v, "bin", "pi"))
        } catch {
          return [] as string[]
        }
      })(),
      ...windowsCommonAgentPaths("pi"),
    ],
  },
]

function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return false
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** npm / nvm-windows / node-sibling shims (GUI-launched Companion often lacks these on PATH). */
export function windowsCommonAgentPaths(basename: string): string[] {
  if (process.platform !== "win32") return []
  const home = os.homedir()
  const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming")
  const out: string[] = []
  const push = (p: string) => {
    if (p) out.push(p)
  }
  push(path.join(appdata, "npm", `${basename}.cmd`))
  push(path.join(appdata, "npm", `${basename}.exe`))
  try {
    const nodeDir = path.dirname(process.execPath)
    push(path.join(nodeDir, `${basename}.cmd`))
    push(path.join(nodeDir, `${basename}.exe`))
  } catch {
    /* */
  }
  const nvmSymlink = process.env.NVM_SYMLINK
  if (nvmSymlink) {
    push(path.join(nvmSymlink, `${basename}.cmd`))
    push(path.join(nvmSymlink, `${basename}.exe`))
  }
  const nvmHome = process.env.NVM_HOME
  if (nvmHome) {
    push(path.join(nvmHome, `${basename}.cmd`))
  }
  return out
}

function whereBinary(): string {
  if (process.platform !== "win32") return "which"
  const root = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
  return path.join(root, "System32", "where.exe")
}

function whichOnPath(basename: string): string | undefined {
  try {
    const cmd = whereBinary()
    const env =
      process.platform === "win32"
        ? { ...process.env, PATH: hardenPath() }
        : process.env
    const out = execFileSync(cmd, [basename], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    })
    const lines = String(out)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (process.platform === "win32") {
      const picked = pickWindowsWhereHit(lines)
      if (picked) return resolveWindowsAgentCommand(picked)
      for (const line of lines) {
        const sib = findWindowsSiblingShim(line)
        if (sib) return sib
      }
      return undefined
    }
    const first = lines.find(Boolean)
    if (first && isExecutableFile(first)) return first
  } catch {
    /* not found */
  }
  return undefined
}

/**
 * Probe PATH + common install locations. Pure-ish (reads FS); safe to call on acp.list.
 * Cached for a short TTL to avoid hammering which(1).
 */
let cache: { at: number; agents: DiscoveredAgent[] } | null = null
const CACHE_MS = 30_000

export function discoverCodingAgents(force = false): DiscoveredAgent[] {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.agents
  }
  const out: DiscoveredAgent[] = []
  const seenCmd = new Set<string>()

  for (const def of PROBES) {
    let found: string | undefined
    let source: "path" | "common" = "path"
    for (const b of def.basenames) {
      found = whichOnPath(b)
      if (found) break
    }
    if (!found) {
      source = "common"
      for (const p of def.commonPaths) {
        if (isExecutableFile(p)) {
          found = p
          break
        }
      }
    }
    if (!found) continue
    try {
      found = fs.realpathSync(found)
    } catch {
      /* keep */
    }
    if (process.platform === "win32") {
      found = resolveWindowsAgentCommand(found)
    }
    if (seenCmd.has(found)) continue
    seenCmd.add(found)
    out.push({
      id: def.id,
      display_name: def.display_name,
      command: found,
      source,
    })
  }

  cache = { at: Date.now(), agents: out }
  return out
}

/** Test helper */
export function _resetDiscoverCache(): void {
  cache = null
}
