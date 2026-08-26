/**
 * Loopback HTTP surface for outbound MCP → Companion tool executor (P0c M4).
 *
 * Bound only via companion's existing 127.0.0.1 HTTP server.
 * Auth:
 *   - P0 default: Bearer ws_secret (Extension pairing) OR cmg_ grant token
 *   - P1 require_grant=true: grant only (never fall back to ws_secret) — L4+ lock
 *
 * Disclosure sessions for this path live in-process on Companion (operator HITL
 * via acceptOutboundDisclosure). HTTP POST /disclosure caller ack is NOT consent
 * and must not arm the Map that gateOutboundCall reads.
 */

import type { IncomingMessage, ServerResponse } from "http"
import { timingSafeEqual } from "crypto"
import { WebSocket } from "ws"
import { getConfig } from "../config"
import {
  acceptOutboundDisclosure,
  clearAllOutboundDisclosureSessions,
} from "./disclosure-session"
import type { SecurityConfirmationManager } from "../security-confirmation"
import {
  fanOutConfirmRequest,
  pickExtensionWsFromAuth,
  resolveConfirmBinding,
  type ConfirmPeerAuth,
} from "../mcp/confirm-fanout"
import { logger } from "../logger"
import {
  gateOutboundCall,
  denyOutboundExfilIfNeeded,
  type OutboundCallRequest,
  type OutboundCallResult,
} from "./facade"
import { outboundToInternalName, OUTBOUND_DISCLOSURE_ZH } from "./profile"
import { makeOutboundMcpOrigin } from "./origin"
import { appendOutboundMcpAudit } from "./audit"
import {
  gateOutboundTabLease,
  OUTBOUND_MCP_PARAM,
  OUTBOUND_CALLER_PARAM,
  outboundHolderThreadId,
} from "./dual-entry"
import {
  isOutboundGrantTokenShape,
  verifyOutboundGrantToken,
} from "./outbound-grants"

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

/**
 * Operator HITL confirmer for first-exfil (Task 10). Injected from server.ts /
 * startServer — same pattern as setOutboundToolRunner. Absent in unit tests so
 * gateOutboundCall's DISCLOSURE_HITL_REQUIRED still surfaces immediately.
 */
export type OutboundExfilConfirmDeps = {
  securityConfirmations: SecurityConfirmationManager
  getClients: () => Iterable<WebSocket>
  wsAuthGet: (ws: WebSocket) => ConfirmPeerAuth | undefined
  getOriginatingWs?: () => WebSocket | null | undefined
}

let exfilConfirmer: OutboundExfilConfirmDeps | null = null

export function setOutboundExfilConfirmer(deps: OutboundExfilConfirmDeps | null): void {
  exfilConfirmer = deps
}

export function getOutboundExfilConfirmer(): OutboundExfilConfirmDeps | null {
  return exfilConfirmer
}

/** Closed stub so fan-out originatingWs is never overlay / never undefined. */
const NOOP_ORIGIN_WS = {
  readyState: WebSocket.CLOSED,
  send() {
    /* no-op */
  },
} as unknown as WebSocket

function outboundConfirmTrayHint(): string {
  return process.platform === "darwin"
    ? "approve via macOS tray dialog (if CMspark tray is Swift) and/or any open Side Panel"
    : "open CMspark Side Panel and approve (Windows/Linux tray has no native confirm dialog)"
}

/**
 * First-exfil operator HITL (Task 10). Fans out like L8: unbound origin (or
 * extension), never overlay. Approve arms the in-process disclosure Map only —
 * does not persist the grant page-export flag.
 */
async function waitFirstExfilOperatorConfirm(
  caller_id: string,
  tool: string,
  grant_id?: string,
): Promise<OutboundCallResult> {
  const deps = exfilConfirmer
  if (!deps) {
    return {
      ok: false,
      error: "operator HITL required for page export",
      error_code: "DISCLOSURE_HITL_REQUIRED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }

  const clients = deps.getClients()
  const extensionWs = pickExtensionWsFromAuth(clients, deps.wsAuthGet)
  const originatingWs = deps.getOriginatingWs?.() || extensionWs || NOOP_ORIGIN_WS
  const originatingSurface = deps.wsAuthGet(originatingWs)?.surface
  const confirmBinding = resolveConfirmBinding({
    originatingWs,
    originatingSurface,
    isOutboundMcpCall: true,
    extensionWs,
  })
  const confirmOriginOpts = confirmBinding.originWs
    ? { originWs: confirmBinding.originWs }
    : {}

  const sendConfirm = (data: unknown) => {
    fanOutConfirmRequest({
      data,
      originatingWs,
      originatingSurface,
      isOutboundMcpCall: true,
      overlayNotice: confirmBinding.overlayNotice,
      clients,
      wsAuthGet: deps.wsAuthGet,
    })
  }

  const internal = outboundToInternalName(tool) || tool
  logger.info("outbound_mcp.confirm_fanout", {
    tool_name: internal,
    caller: caller_id,
    first_exfil: true,
  })

  let decision: Awaited<ReturnType<SecurityConfirmationManager["request"]>>
  try {
    decision = await deps.securityConfirmations.request(
      sendConfirm,
      {
        toolName: `[Outbound] ${internal}`,
        dangerousApis: [],
        code: OUTBOUND_DISCLOSURE_ZH,
        riskLevel: "high",
        autoConfirmEligible: false,
      },
      confirmOriginOpts,
    )
  } catch (e: any) {
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: "OUTBOUND_CONFIRM_REQUIRED",
      confirm_outcome: "denied",
      grant_id,
    })
    return {
      ok: false,
      error: `${e?.message || String(e)} — L8: ${outboundConfirmTrayHint()}`,
      error_code: "OUTBOUND_CONFIRM_REQUIRED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }

  if (!decision.approved) {
    const outcome =
      decision.reason === "timeout" ? ("timeout" as const) : ("denied" as const)
    appendOutboundMcpAudit({
      caller_id,
      tool,
      ok: false,
      error_code: "OUTBOUND_CONFIRM_REQUIRED",
      confirm_outcome: outcome,
      grant_id,
    })
    return {
      ok: false,
      error: `operator HITL ${decision.reason} for page export — L8: ${outboundConfirmTrayHint()}`,
      error_code: "OUTBOUND_CONFIRM_REQUIRED",
      disclosure_required: true,
      disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
    }
  }

  // Session Map only — never persist the grant page-export flag (session ≠ 30d consent).
  acceptOutboundDisclosure(caller_id)
  appendOutboundMcpAudit({
    caller_id,
    tool,
    ok: true,
    confirm_outcome: "approved",
    grant_id,
  })
  return { ok: true }
}

/** Test helper */
export function resetOutboundCompanionHttpForTests(): void {
  toolRunner = null
  refreshRunner = null
  exfilConfirmer = null
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

/**
 * Legacy: true only when Bearer equals Extension ws_secret.
 * Prefer authorizeOutboundRequest for full grant/legacy matrix.
 */
export function authorizeOutboundHttp(
  req: IncomingMessage,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) return false
  const token = extractBearerToken(req)
  if (!token) return false
  return safeEqualStr(token, expectedSecret)
}

export type OutboundHttpAuthOk = {
  ok: true
  mode: "ws_secret" | "grant"
  grant_id?: string
  /** When mode=grant, body caller_id must match this (or be filled from it). */
  bound_caller_id?: string
}

export type OutboundHttpAuthFail = {
  ok: false
  error_code: string
  error: string
  http_status: number
}

export type OutboundHttpAuthResult = OutboundHttpAuthOk | OutboundHttpAuthFail

/**
 * L4+ auth matrix (dual-review lock).
 * @param bodyCallerId optional body caller for grant binding check
 */
export function authorizeOutboundRequest(
  req: IncomingMessage,
  expectedWsSecret: string,
  opts?: { requireGrant?: boolean; bodyCallerId?: string | null },
): OutboundHttpAuthResult {
  // Explicit opts.requireGrant wins (false must force legacy mode for tests / debug).
  // When omitted, default from config (now true per MCPO-01).
  const requireGrant =
    opts?.requireGrant !== undefined
      ? opts.requireGrant === true
      : getConfig().outbound_mcp?.require_grant === true
  const token = extractBearerToken(req)
  if (!token) {
    return {
      ok: false,
      error_code: requireGrant ? "GRANT_REQUIRED" : "UNAUTHORIZED",
      error: requireGrant
        ? "missing outbound grant bearer (CMSPARK_OUTBOUND_GRANT / cmg_…)"
        : "missing or invalid bearer token",
      http_status: 401,
    }
  }

  const looksGrant = isOutboundGrantTokenShape(token)
  const looksWs =
    Boolean(expectedWsSecret) && safeEqualStr(token, expectedWsSecret)

  if (requireGrant) {
    // Grant only — never accept ws_secret (even if equal by accident)
    if (looksWs && !looksGrant) {
      return {
        ok: false,
        error_code: "GRANT_REQUIRED",
        error:
          "outbound.require_grant=true: Extension ws_secret is not accepted on /outbound-mcp; use CMSPARK_OUTBOUND_GRANT",
        http_status: 401,
      }
    }
    const v = verifyOutboundGrantToken(token, opts?.bodyCallerId)
    if (!v.ok) {
      return {
        ok: false,
        error_code: v.error_code,
        error: v.error,
        http_status: v.http_status,
      }
    }
    return {
      ok: true,
      mode: "grant",
      grant_id: v.grant_id,
      bound_caller_id: v.caller_id,
    }
  }

  // P0 dual-mode: grant preferred when cmg_ shape; else ws_secret
  if (looksGrant) {
    const v = verifyOutboundGrantToken(token, opts?.bodyCallerId)
    if (!v.ok) {
      return {
        ok: false,
        error_code: v.error_code,
        error: v.error,
        http_status: v.http_status,
      }
    }
    return {
      ok: true,
      mode: "grant",
      grant_id: v.grant_id,
      bound_caller_id: v.caller_id,
    }
  }

  if (looksWs) {
    return { ok: true, mode: "ws_secret" }
  }

  return {
    ok: false,
    error_code: "UNAUTHORIZED",
    error: "missing or invalid bearer token",
    http_status: 401,
  }
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
 * @param opts.grant_id — set only by authenticated HTTP path (never trust body)
 */
export async function companionInvokeOutbound(
  body: CompanionInvokeBody,
  opts?: { grant_id?: string },
): Promise<OutboundCallResult & { data?: unknown; origin?: ReturnType<typeof makeOutboundMcpOrigin> }> {
  const caller_id = (body.caller_id || "http-unknown").trim() || "http-unknown"
  const tool = (body.tool || "").trim()
  const grant_id = opts?.grant_id
  const req: OutboundCallRequest = {
    caller_id,
    tool,
    args: body.args || {},
    domain: body.domain,
  }

  let gate = gateOutboundCall(req)
  if (!gate.ok) {
    // HTTP invoke waits on first-exfil HITL when a confirmer is injected.
    // Facade unit tests without a manager still see DISCLOSURE_HITL_REQUIRED.
    if (gate.error_code === "DISCLOSURE_HITL_REQUIRED" && exfilConfirmer) {
      const hitl = await waitFirstExfilOperatorConfirm(caller_id, tool, grant_id)
      if (!hitl.ok) return hitl
      gate = gateOutboundCall(req)
      if (!gate.ok) return gate
    } else {
      return gate
    }
  }

  // Defense in depth for exfil (grant flag ∧ operator HITL; HTTP ack is not consent)
  const exfilDeny = denyOutboundExfilIfNeeded(caller_id, tool, { grant_id })
  if (exfilDeny) return exfilDeny

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
      grant_id,
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
      grant_id,
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
    // L8: only map *confirmation* failures (not generic CDP "timeout") — adversary N1
    let error = result.success ? undefined : result.error || "dispatch failed"
    let error_code = result.success ? undefined : "DISPATCH_FAILED"
    if (
      !result.success &&
      error &&
      /security confirmation|confirmation (timeout|denied|expired)|denied by user|high.?risk.*denied|OUTBOUND_CONFIRM/i.test(
        error,
      )
    ) {
      error_code = "OUTBOUND_CONFIRM_REQUIRED"
      // S42 P1: platform-honest L8 copy — Swift tray has native confirm; win32/linux
      // systray2 does not (Side Panel fan-out only).
      const trayHint =
        process.platform === "darwin"
          ? "approve via macOS tray dialog (if CMspark tray is Swift) and/or any open Side Panel"
          : "open CMspark Side Panel and approve (Windows/Linux tray has no native confirm dialog)"
      error =
        `${error} — L8: ${trayHint}; do not rely on IDE focus alone.`
    }
    appendOutboundMcpAudit({
      caller_id,
      tool,
      domain: body.domain,
      ok: result.success,
      error_code,
      confirm_outcome: result.success ? "n/a" : "denied",
      grant_id,
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
      grant_id,
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
 * expectedSecret = Extension ws_secret (used only when require_grant is false).
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
    const requireGrant = getConfig().outbound_mcp?.require_grant === true
    json(res, 200, {
      status: "ok",
      runner: toolRunner ? "wired" : "none",
      service: "outbound-mcp",
      require_grant: requireGrant,
    })
    return true
  }

  if (req.method === "POST" && pathOnly === OUTBOUND_DISCLOSURE_PATH) {
    try {
      const body = (await readJsonBody(req)) as { caller_id?: string; acknowledge?: boolean }
      if (body.acknowledge !== true) {
        json(res, 400, { ok: false, error_code: "ACK_REQUIRED" })
        return true
      }
      const bodyCaller = (body.caller_id || "http-unknown").trim() || "http-unknown"
      const auth = authorizeOutboundRequest(req, expectedSecret, {
        bodyCallerId: body.caller_id,
      })
      if (!auth.ok) {
        json(res, auth.http_status, {
          ok: false,
          error_code: auth.error_code,
          error: auth.error,
        })
        return true
      }
      const caller_id =
        auth.mode === "grant" && auth.bound_caller_id
          ? auth.bound_caller_id
          : bodyCaller
      if (
        auth.mode === "grant" &&
        auth.bound_caller_id &&
        body.caller_id &&
        String(body.caller_id).trim() &&
        String(body.caller_id).trim() !== auth.bound_caller_id
      ) {
        json(res, 403, {
          ok: false,
          error_code: "GRANT_CALLER_MISMATCH",
          error: "caller_id does not match grant binding",
        })
        return true
      }
      // Caller acknowledge is not operator HITL (Task 10 Confirm Center).
      // Must not arm the disclosure Map that gateOutboundCall reads.
      json(res, 403, {
        ok: false,
        error_code: "ACK_NOT_OPERATOR",
        error: "caller acknowledge is not operator consent",
        auth_mode: auth.mode,
        grant_id: auth.grant_id,
      })
    } catch (e: any) {
      json(res, 400, { ok: false, error_code: "BAD_BODY", error: e?.message || String(e) })
    }
    return true
  }

  if (req.method === "POST" && pathOnly === OUTBOUND_INVOKE_PATH) {
    try {
      const body = (await readJsonBody(req)) as CompanionInvokeBody
      const auth = authorizeOutboundRequest(req, expectedSecret, {
        bodyCallerId: body.caller_id,
      })
      if (!auth.ok) {
        json(res, auth.http_status, {
          ok: false,
          error_code: auth.error_code,
          error: auth.error,
        })
        return true
      }
      // Grant binds caller identity
      if (auth.mode === "grant" && auth.bound_caller_id) {
        const bodyCaller = (body.caller_id || "").trim()
        if (bodyCaller && bodyCaller !== auth.bound_caller_id) {
          json(res, 403, {
            ok: false,
            error_code: "GRANT_CALLER_MISMATCH",
            error: "caller_id does not match grant binding",
          })
          return true
        }
        body.caller_id = auth.bound_caller_id
      }
      // N1 dual-review: pass auth grant_id into tool audit (never from client body)
      const out = await companionInvokeOutbound(body, {
        grant_id: auth.mode === "grant" ? auth.grant_id : undefined,
      })
      json(res, out.ok ? 200 : 422, {
        ...out,
        auth_mode: auth.mode,
        grant_id: auth.grant_id,
      })
    } catch (e: any) {
      json(res, 400, { ok: false, error_code: "BAD_BODY", error: e?.message || String(e) })
    }
    return true
  }

  // Unknown path under prefix — 404 without auth oracle (N3: removed dead auth probe block)
  json(res, 404, { ok: false, error_code: "NOT_FOUND" })
  return true
}
