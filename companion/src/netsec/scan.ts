// Minimal TCP port probe — enterprise netsec module only

import * as net from "net"
import * as crypto from "crypto"
import { getModule, requireModule } from "../capability/modules"
import { assertTargetsAllowed } from "./scope"
import { appendCapabilityAudit } from "../packs/audit-log"

const COMMON_PORTS = [21, 22, 25, 53, 80, 110, 143, 443, 445, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443]
const MAX_PORTS = 32
const CONNECT_TIMEOUT_MS = 1500

export type NetsecTaskAuth = {
  authorized: boolean
  targets: string[]
  at?: string
}

function hashAllowlist(list: string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(list || [])).digest("hex").slice(0, 16)
}

function probePort(host: string, port: number): Promise<{ port: number; open: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (open: boolean, error?: string) => {
      if (done) return
      done = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve({ port, open, error })
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false, "timeout"))
    socket.once("error", (e) => finish(false, e.message))
    try {
      socket.connect(port, host)
    } catch (e: any) {
      finish(false, e?.message || String(e))
    }
  })
}

/**
 * Scan targets. Requires:
 * - modules.netsec enabled
 * - capability_profile enterprise (enforced at module enable)
 * - target_allowlist non-empty and matching
 * - taskAuth.authorized === true for the same targets
 */
export async function netsecPortScan(opts: {
  targets: string[]
  ports?: number[]
  taskAuth?: NetsecTaskAuth | null
  threadId?: string
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const gate = requireModule("netsec")
  if (!gate.ok) return { success: false, error: gate.error }

  const mod = getModule("netsec")
  const allowlist = mod?.target_allowlist || []
  if (allowlist.length === 0) {
    return {
      success: false,
      error: "netsec.target_allowlist is empty — configure allowlist before scanning",
    }
  }

  const targets = (opts.targets || []).map((t) => t.trim()).filter(Boolean)
  if (targets.length === 0) return { success: false, error: "targets required" }
  if (targets.length > 16) return { success: false, error: "max 16 targets per scan" }

  const scope = assertTargetsAllowed(targets, allowlist)
  if (!scope.ok) {
    appendCapabilityAudit({
      type: "netsec.scan",
      targets,
      tool: "netsec_port_scan",
      result: "denied",
      allowlist_hash: hashAllowlist(allowlist),
      at: new Date().toISOString(),
      thread_id: opts.threadId,
    })
    return { success: false, error: scope.error }
  }

  // Task authorization
  if (mod?.require_task_auth !== false) {
    const auth = opts.taskAuth
    if (!auth || auth.authorized !== true) {
      return {
        success: false,
        error:
          "task authorization required — set netsec_task_auth on thread (user must confirm ownership of targets)",
      }
    }
    const authTargets = new Set((auth.targets || []).map((t) => t.toLowerCase()))
    for (const t of targets) {
      if (!authTargets.has(t.toLowerCase())) {
        return {
          success: false,
          error: `target ${t} not included in netsec_task_auth.targets`,
        }
      }
    }
  }

  let ports = opts.ports && opts.ports.length ? opts.ports : COMMON_PORTS
  ports = ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536).slice(0, MAX_PORTS)
  if (ports.length === 0) return { success: false, error: "no valid ports" }

  const results: any[] = []
  for (const host of targets) {
    const portResults: any[] = []
    for (const port of ports) {
      portResults.push(await probePort(host, port))
    }
    results.push({
      host,
      open_ports: portResults.filter((r) => r.open).map((r) => r.port),
      probes: portResults,
    })
  }

  appendCapabilityAudit({
    type: "netsec.scan",
    targets,
    tool: "netsec_port_scan",
    result: "ok",
    allowlist_hash: hashAllowlist(allowlist),
    at: new Date().toISOString(),
    thread_id: opts.threadId,
  })

  return {
    success: true,
    data: {
      results,
      note: "TCP connect probe only — not a full nmap scan. Authorized enterprise use only.",
    },
  }
}
