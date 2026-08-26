/**
 * Outbound MCP 租手钥匙 CLI (argv only — no HTTP server).
 *
 * cmspark-agent outbound-grant issue|revoke|list
 * Profile is hard-wired outbound_l1_default. Token prints once on stdout.
 */

import { getPlatform, type PlatformName } from "../platform"
import {
  issueOutboundGrant,
  revokeOutboundGrant,
  listOutboundGrants,
} from "./outbound-grants"

export type GrantCliIo = {
  stdout: { write: (chunk: string) => unknown }
  stderr: { write: (chunk: string) => unknown }
}

export type OutboundMcpLaunchSpec = {
  command: string
  args: string[]
}

const DEFAULT_IO: GrantCliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
}

const USAGE = `cmspark-agent outbound-grant issue --caller-id <id> [--label <name>] [--allow-page-export] [--ttl-ms N]
cmspark-agent outbound-grant revoke --grant-id <id>
cmspark-agent outbound-grant list`

function writeln(stream: { write: (chunk: string) => unknown }, line = ""): void {
  stream.write(line + "\n")
}

function flagString(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key)
  if (v === undefined || v === true) return undefined
  const s = String(v).trim()
  return s || undefined
}

/** Bare `--flag` or value true/1/yes (case-insensitive). false/0/no and unknown values are off. */
function flagEnabled(flags: Map<string, string | true>, key: string): boolean {
  if (!flags.has(key)) return false
  const v = flags.get(key)
  if (v === true) return true
  const s = String(v).trim().toLowerCase()
  return s === "true" || s === "1" || s === "yes"
}

function parseArgv(argv: string[]): {
  sub: string | undefined
  flags: Map<string, string | true>
} {
  const [sub, ...rest] = argv
  const flags = new Map<string, string | true>()
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith("--")) continue
    const eq = a.indexOf("=")
    if (eq !== -1) {
      flags.set(a.slice(2, eq), a.slice(eq + 1))
      continue
    }
    const key = a.slice(2)
    const next = rest[i + 1]
    if (next && !next.startsWith("--")) {
      flags.set(key, next)
      i++
    } else {
      flags.set(key, true)
    }
  }
  return { sub, flags }
}

/** Platform-honest mcp-outbound launch command/args for IDE snippets. */
export function outboundMcpLaunchSpec(
  platform: PlatformName = getPlatform(),
): OutboundMcpLaunchSpec {
  if (platform === "darwin") {
    return {
      command: "/Applications/CMspark.app/Contents/Resources/cmspark-agent",
      args: ["mcp-outbound"],
    }
  }
  if (platform === "win32") {
    // MCP hosts spawn with client cwd and often do not expand env. Prefer a
    // real LOCALAPPDATA path when we are actually on Windows; otherwise keep
    // the documented %LOCALAPPDATA% template (never a bare cmspark-agent.js).
    const envLocal = (process.env.LOCALAPPDATA || "").trim()
    const localAppData = getPlatform() === "win32" && envLocal ? envLocal : "%LOCALAPPDATA%"
    const dir = `${localAppData}\\CMspark`
    return {
      command: `${dir}\\node.exe`,
      args: [`${dir}\\cmspark-agent.js`, "mcp-outbound"],
    }
  }
  // linux / unknown: PATH binary — never a fake Mac DMG path
  return {
    command: "cmspark-agent",
    args: ["mcp-outbound"],
  }
}

function printIssue(
  io: GrantCliIo,
  issued: {
    id: string
    token: string
    caller_id: string
    label: string
    expires_at: string | null
  },
  allowPageExport: boolean,
): void {
  const launch = outboundMcpLaunchSpec()
  writeln(io.stdout, "租手钥匙")
  writeln(io.stdout, "这把钥匙只出现一次。它不是扩展配对码。")
  writeln(io.stdout)
  writeln(io.stdout, issued.token)
  writeln(io.stdout)
  writeln(io.stdout, `grant_id: ${issued.id}`)
  writeln(io.stdout, `caller_id: ${issued.caller_id}`)
  writeln(io.stdout, `label: ${issued.label}`)
  writeln(io.stdout, `expires_at: ${issued.expires_at ?? "(none)"}`)
  writeln(io.stdout)
  if (allowPageExport) {
    writeln(
      io.stdout,
      `已允许 ${issued.caller_id} 把页文/截图发给其云模型（可在设置里撤销这把钥匙）。首次外泄仍须在确认台批准；Windows/Linux 请打开 Chrome 确认台。`,
    )
  } else {
    writeln(
      io.stdout,
      "未允许页文/截图外泄。编程助手读取页面或截图会被拒绝（不会弹出确认台）。需要外泄请加 --allow-page-export。",
    )
  }
  writeln(io.stdout)
  writeln(io.stdout, "把它贴进编程助手的 MCP 配置（env）：")
  writeln(io.stdout, "  CMSPARK_OUTBOUND_GRANT=<把上面那把钥匙贴在这里>")
  writeln(io.stdout, `  CMSPARK_OUTBOUND_CALLER_ID=${issued.caller_id}`)
  writeln(io.stdout, "  CMSPARK_OUTBOUND_PORT=23401")
  writeln(io.stdout)
  writeln(io.stdout, "command / args（本机）：")
  writeln(io.stdout, `  command: ${launch.command}`)
  writeln(io.stdout, `  args: ${JSON.stringify(launch.args)}`)
}

function issue(flags: Map<string, string | true>, io: GrantCliIo): number {
  const callerId = flagString(flags, "caller-id")
  if (!callerId) {
    writeln(io.stderr, "缺少 --caller-id")
    writeln(io.stderr, USAGE)
    return 1
  }
  const label = flagString(flags, "label")
  const ttlRaw = flagString(flags, "ttl-ms")
  let ttl_ms: number | undefined
  if (ttlRaw !== undefined) {
    const n = Number(ttlRaw)
    if (!Number.isFinite(n) || n < 0) {
      writeln(io.stderr, "--ttl-ms 必须是 ≥0 的数字")
      return 1
    }
    ttl_ms = n
  }
  const allowPageExport = flagEnabled(flags, "allow-page-export")
  const issued = issueOutboundGrant({
    caller_id: callerId,
    label: label || callerId,
    ttl_ms,
    allow_page_export: allowPageExport,
  })
  printIssue(io, issued, allowPageExport)
  return 0
}

function revoke(flags: Map<string, string | true>, io: GrantCliIo): number {
  const grantId = flagString(flags, "grant-id")
  if (!grantId) {
    writeln(io.stderr, "缺少 --grant-id")
    writeln(io.stderr, USAGE)
    return 1
  }
  const ok = revokeOutboundGrant(grantId)
  if (!ok) {
    writeln(io.stderr, `未找到租手钥匙 --grant-id ${grantId}`)
    return 1
  }
  writeln(io.stdout, `已撤销租手钥匙 ${grantId}`)
  return 0
}

function list(io: GrantCliIo): number {
  const grants = listOutboundGrants()
  if (grants.length === 0) {
    writeln(io.stdout, "（没有租手钥匙）")
    return 0
  }
  writeln(io.stdout, "租手钥匙（不含 token）")
  for (const g of grants) {
    const status = g.revoked_at ? `revoked ${g.revoked_at}` : "live"
    writeln(
      io.stdout,
      [
        `id=${g.id}`,
        `caller_id=${g.caller_id}`,
        `label=${g.label}`,
        `allow_page_export=${g.allow_page_export}`,
        `expires_at=${g.expires_at ?? "(none)"}`,
        `status=${status}`,
      ].join("  "),
    )
  }
  return 0
}

/**
 * Handle `outbound-grant` argv (already sliced past the command name).
 * Returns a process exit code. Does not call process.exit.
 */
export async function handleOutboundGrantCli(
  argv: string[],
  io: GrantCliIo = DEFAULT_IO,
): Promise<number> {
  const { sub, flags } = parseArgv(argv)
  if (!sub || sub === "-h" || sub === "--help") {
    writeln(sub ? io.stdout : io.stderr, USAGE)
    return sub ? 0 : 1
  }
  try {
    switch (sub) {
      case "issue":
        return issue(flags, io)
      case "revoke":
        return revoke(flags, io)
      case "list":
        return list(io)
      default:
        writeln(io.stderr, `未知子命令: ${sub}`)
        writeln(io.stderr, USAGE)
        return 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    writeln(io.stderr, msg)
    return 1
  }
}
