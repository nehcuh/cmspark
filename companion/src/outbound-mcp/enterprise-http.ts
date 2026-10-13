import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfigDir } from "../config"
import { verifyOutboundGrantToken } from "./outbound-grants"
import { EnterpriseBrowserService } from "./enterprise-service"
import { EnterpriseError, deny, identifier, object } from "./enterprise-policy"

export const ENTERPRISE_HTTP_PREFIX = "/outbound-mcp/v1/enterprise"
let singleton: EnterpriseBrowserService | undefined
let singletonDir: string | undefined
let shuttingDown = false
function service(): EnterpriseBrowserService {
  if (shuttingDown) deny("SERVICE_SHUTTING_DOWN", 503)
  if (!singleton || singletonDir !== getConfigDir()) {
    singleton?.close(); singletonDir = getConfigDir()
    singleton = new EnterpriseBrowserService({
      peer: () => (require("../ws/lifecycle") as typeof import("../ws/lifecycle")).getEnterprisePeer(),
      runner: () => {
        const lifecycle = require("../ws/lifecycle") as typeof import("../ws/lifecycle")
        lifecycle.ensureOutboundToolRunnerWired()
        return (require("./companion-http") as typeof import("./companion-http")).getOutboundToolRunner()
      },
    })
  }
  return singleton
}
/** Fence admission before asynchronous process teardown. Never instantiate
 * the lazy service just to stop it, and never reopen it during shutdown. */
export function closeEnterpriseHttp(): void { shuttingDown = true; singleton?.close() }
export function resetEnterpriseHttpForTests(): void { singleton?.close(); singleton = undefined; singletonDir = undefined; shuttingDown = false }
function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) deny("JSON_REQUIRED", 415)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) deny("BODY_TOO_LARGE", 413)
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { return deny("BAD_JSON", 400) }
}
/** Grant-only. The pairing secret is deliberately not an argument. */
export async function handleEnterpriseHttp(req: IncomingMessage, res: ServerResponse, injected?: EnterpriseBrowserService): Promise<boolean> {
  const url = new URL(req.url || "/", "http://loopback.invalid")
  if (url.pathname !== ENTERPRISE_HTTP_PREFIX && !url.pathname.startsWith(ENTERPRISE_HTTP_PREFIX + "/")) return false
  try {
    if (shuttingDown) deny("SERVICE_SHUTTING_DOWN", 503)
    const authorization = /^Bearer (cmg_[A-Za-z0-9]+)$/.exec(req.headers.authorization || "")
    const auth = verifyOutboundGrantToken(authorization?.[1])
    if (!auth.ok) { json(res, auth.http_status, { ok: false, error_code: auth.error_code }); return true }
    const api = injected || service(), path = url.pathname.slice(ENTERPRISE_HTTP_PREFIX.length)
    const querySubject = () => {
      if ([...url.searchParams.keys()].some(key => key !== "subject") || url.searchParams.getAll("subject").length !== 1) deny("INVALID_INPUT", 400)
      return identifier(url.searchParams.get("subject"))
    }
    if (req.method === "GET" && path === "/capabilities") { json(res, 200, { ok: true, data: api.capabilities(auth.grant_id, querySubject()) }); return true }
    if (req.method === "POST" && path === "/sessions") { json(res, 202, { ok: true, data: await api.open(auth.grant_id, await body(req)) }); return true }
    if (req.method === "POST" && path === "/operations") { json(res, 200, { ok: true, data: await api.prepare(auth.grant_id, await body(req)) }); return true }
    const session = /^\/sessions\/([a-zA-Z0-9-]+)(\/login-snapshot)?$/.exec(path)
    if (session && req.method === "GET" && !session[2]) { json(res, 200, { ok: true, data: await api.status(auth.grant_id, querySubject(), identifier(session[1])) }); return true }
    if (session && req.method === "POST" && session[2]) {
      const raw = object(await body(req), ["subject", "presentation_proof"])
      json(res, 200, { ok: true, data: await api.loginSnapshot(auth.grant_id, { ...raw, session_handle: session[1] }) }); return true
    }
    const operation = /^\/operations\/([a-zA-Z0-9-]+)(\/(execute|cancel))?$/.exec(path)
    if (operation && req.method === "GET" && !operation[2]) { json(res, 200, { ok: true, data: api.operationStatus(auth.grant_id, querySubject(), identifier(operation[1])) }); return true }
    if (operation && req.method === "POST" && operation[2]) {
      const raw = object(await body(req), operation[3] === "execute" ? ["subject", "human_proof"] : ["subject"])
      const subject = identifier(raw.subject), handle = identifier(operation[1])
      if (operation[3] === "cancel") { json(res, 200, { ok: true, data: api.cancel(auth.grant_id, subject, handle) }); return true }
      // A successfully completed 202 response transfers work to the service;
      // ending a poll is not cancellation. An abnormal send is cancellation.
      res.once("close", () => { if (!res.writableEnded) { try { api.cancel(auth.grant_id, subject, handle) } catch { /* already denied */ } } })
      const result = api.execute(auth.grant_id, { ...raw, operation_handle: handle })
      json(res, 202, { ok: true, data: result }); return true
    }
    json(res, 404, { ok: false, error_code: "ENTERPRISE_ROUTE_NOT_FOUND" })
  } catch (error) {
    const code = error instanceof EnterpriseError ? error.code : "ENTERPRISE_UNAVAILABLE"
    json(res, error instanceof EnterpriseError ? error.status : 503, { ok: false, error_code: code })
  }
  return true
}
