/**
 * Loopback HTTP surface for outbound MCP → Companion tool executor (P0c M4).
 *
 * Bound only via companion's existing 127.0.0.1 HTTP server.
 * Auth: Authorization: Bearer <ws_secret> (same pairing secret as Extension).
 *
 * Disclosure sessions for this path live in-process on Companion (source of
 * truth for execute). The stdio mcp-outbound process dual-writes accept.
 */

import type { IncomingMessage, ServerResponse } from "http"
import { timingSafeEqual } from "crypto"
import {
  acceptOutboundDisclosure,
  hasOutboundDisclosure,
  clearAllOutboundDisclosureSessions,
} from "./disclosure-session"
import {
  gateOutboundCall,
  type OutboundCallRequest,
  type OutboundCallResult,
} from "./facade"
import { OUTBOUND_MCP_EXFIL_CLASS, outboundToInternalName } from "./profile"
import { makeOutboundMcpOrigin } from "./origin"
import { appendOutboundMcpAudit } from "./audit"
import {
  gateOutboundTabLease,
  OUTBOUND_MCP_PARAM,
  OUTBOUND_CALLER_PARAM,
  outboundHolderThreadId,
} from "./dual-entry"

export const OUTBOUND_HTTP_PREFIX = "/outbound-mcp/v1"
export const OUTBOUND_INVOKE_PATH = `${OUTBOUND_HTTP_PREFIX}/invoke`
export const OUTBOUND_DISCLOSURE_PATH = `${OUTBOUND_HTTP_PREFIX}/disclosure`
export const OUTBOUND_HEALTH_PATH = `${OUTBOUND_HTTP_PREFIX}/health`

export type OutboundToolRunner = (
  toolCallId: string,
  internalTool: string,
  params: Record<string, unknown>,
) => Promise<{ success: boolean; data?: unknown; error?: string }>

let toolRunner: OutboundToolRunner | null = null
/** Called before each invoke to re-bind extension WS if needed (set from server.ts). */
let refreshRunner: (() => void) | null = null

/** Wire production runner (createToolExecutor bound to an extension WS). */
export function setOutboundToolRunner(runner: OutboundToolRunner | null): void {
  toolRunner = runner
}

export function getOutboundToolRunner(): OutboundToolRunner | null {
  return toolRunner
}

export function setOutboundRunnerRefresh(fn: (() => void) | null): void {
  refreshRunner = fn
}

/** Test helper */
export function resetOutboundCompanionHttpForTests(): void {
  toolRunner = null
  refreshRunner = null
  clearAllOutboundDisclosureSessions()
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  try {
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

/** Extract Bearer token from Authorization header. */
export function extractBearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== "string") return null
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}

export function authorizeOutboundHttp(
  req: IncomingMessage,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) return false
  const token = extractBearerToken(req)
  if (!token) return false
  return safeEqualStr(token, expectedSecret)
}

function readJsonBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error("body_too_large"))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        if (!raw.trim()) {
          resolve({})
          return
        }
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on("error", reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(s),
  })
  res.end(s)
}

export type CompanionInvokeBody = {
  caller_id?: string
  tool?: string
  args?: Record<string, unknown>
  domain?: string
}

/**
 * Pure invoke logic (no HTTP). Used by HTTP handler and unit tests.
 */
export async function companionInvokeOutbound(
  body: CompanionInvokeBody,
): Promise<OutboundCallResult & { data?: unknown; origin?: ReturnType<typeof makeOutboundMcpOrigin> }> {
  const caller_id = (body.caller_id || "http-unknown").trim() || "http-unknown"
  const tool = (body.tool || "").trim()
  const req: OutboundCallRequest = {
    caller_id,
    tool,
    args: body.args || {},
    domain: body.domain,
  }

  const gate = gateOutboundCall(req)
  if (!gate.ok) {
    return gate
  }

  // Defense in depth for exfil (session is companion-process truth)
  if (OUTBOUND_MCP_EXFIL_CLASS.has(tool) && !hasOutboundDisclosure(caller_id)) {
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: "DISCLOSURE_REQUIRED",
    })
    return {
      ok: false,
      error: "disclosure_required",
      error_code: "DISCLOSURE_REQUIRED",
      disclosure_required: true,
    }
  }

  const internal = gate.internal_tool || outboundToInternalName(tool)
  if (!internal) {
    return { ok: false, error: "internal tool name missing", error_code: "INTERNAL_NAME_MISSING" }
  }

  const origin = makeOutboundMcpOrigin(caller_id)
  try {
    refreshRunner?.()
  } catch {
    /* best-effort rebind */
  }
  const runner = toolRunner
  if (!runner) {
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: "EXTENSION_UNAVAILABLE",
    })
    return {
      ok: false,
      error:
        "no authenticated Extension connected — open CMspark Side Panel / ensure companion+extension paired",
      error_code: "EXTENSION_UNAVAILABLE",
      internal_tool: internal,
      origin,
    }
  }

  // L9: dual-entry tab lease before CDP
  const args = { ...(body.args || {}) }
  const leaseGate = gateOutboundTabLease(internal, args, caller_id)
  if (!leaseGate.ok) {
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: leaseGate.error_code,
    })
    return {
      ok: false,
      error: leaseGate.error,
      error_code: leaseGate.error_code,
      internal_tool: internal,
      origin,
      data: {
        error_code: leaseGate.error_code,
        tab_id: leaseGate.tab_id,
        holder_thread_id: leaseGate.holder_thread_id,
        side_panel_wins: leaseGate.side_panel_wins === true,
        queue_disclosure_zh: leaseGate.queue_disclosure_zh,
      },
    }
  }

  // L8/L9: tag params so createToolExecutor fans out confirms + treats holder
  const taggedArgs: Record<string, unknown> = {
    ...args,
    [OUTBOUND_MCP_PARAM]: true,
    [OUTBOUND_CALLER_PARAM]: caller_id,
    __thread_id: outboundHolderThreadId(caller_id),
  }

  const toolCallId = `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  try {
    const result = await runner(toolCallId, internal, taggedArgs)
    // Map confirm-timeout into actionable MCP error (L8 fail-closed messaging)
    let error = result.success ? undefined : result.error || "dispatch failed"
    let error_code = result.success ? undefined : "DISPATCH_FAILED"
    if (!result.success && error && /timeout|denied|confirmation/i.test(error)) {
      error_code = "OUTBOUND_CONFIRM_REQUIRED"
      error =
        `${error} — L8: approve via system tray dialog and/or any open CMspark Side Panel; ` +
        `do not rely on IDE focus alone. If no tray, open Side Panel or enable CMspark tray.`
    }
    appendOutboundMcpAudit({
      caller_id,
      tool,
      domain: body.domain,
      ok: result.success,
      error_code,
      confirm_outcome: result.success ? "n/a" : "denied",
    })
    return {
      ok: result.success,
      error,
      error_code,
      internal_tool: internal,
      data: result.data,
      origin,
    }
  } catch (e: any) {
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: "DISPATCH_THREW",
    })
    return {
      ok: false,
      error: e?.message || String(e),
      error_code: "DISPATCH_THREW",
      internal_tool: internal,
      origin,
    }
  }
}

export async function companionAcceptDisclosure(caller_id: string): Promise<{
  ok: boolean
  caller_id: string
  accepted_at: number
}> {
  const sess = acceptOutboundDisclosure(caller_id)
  return { ok: true, caller_id: sess.caller_id, accepted_at: sess.accepted_at }
}

/**
 * Route outbound-mcp HTTP. Returns true if handled.
 * expectedSecret from getOrCreateSharedSecret().
 */
export async function handleOutboundMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  expectedSecret: string,
): Promise<boolean> {
  const pathOnly = req.url ? req.url.split("?")[0] : ""
  if (!pathOnly.startsWith(OUTBOUND_HTTP_PREFIX)) {
    return false
  }

  if (req.method === "GET" && pathOnly === OUTBOUND_HEALTH_PATH) {
    // Health is unauthenticated but only on loopback (server bind); reports no secrets
    json(res, 200, {
      status: "ok",
      runner: toolRunner ? "wired" : "none",
      service: "outbound-mcp",
    })
    return true
  }

  if (!authorizeOutboundHttp(req, expectedSecret)) {
    json(res, 401, { ok: false, error_code: "UNAUTHORIZED", error: "missing or invalid bearer token" })
    return true
  }

  if (req.method === "POST" && pathOnly === OUTBOUND_DISCLOSURE_PATH) {
    try {
      const body = (await readJsonBody(req)) as { caller_id?: string; acknowledge?: boolean }
      if (body.acknowledge !== true) {
        json(res, 400, { ok: false, error_code: "ACK_REQUIRED" })
        return true
      }
      const caller_id = (body.caller_id || "http-unknown").trim() || "http-unknown"
      const out = await companionAcceptDisclosure(caller_id)
      json(res, 200, out)
    } catch (e: any) {
      json(res, 400, { ok: false, error_code: "BAD_BODY", error: e?.message || String(e) })
    }
    return true
  }

  if (req.method === "POST" && pathOnly === OUTBOUND_INVOKE_PATH) {
    try {
      const body = (await readJsonBody(req)) as CompanionInvokeBody
      const out = await companionInvokeOutbound(body)
      json(res, out.ok ? 200 : 422, out)
    } catch (e: any) {
      json(res, 400, { ok: false, error_code: "BAD_BODY", error: e?.message || String(e) })
    }
    return true
  }

  json(res, 404, { ok: false, error_code: "NOT_FOUND" })
  return true
}
