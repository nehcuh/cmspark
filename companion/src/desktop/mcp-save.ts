/** #476 native MCP edit/save. This object belongs to one authenticated native
 * socket; it is never a legacy WS session or a renderer-provided authority. */
import { createHash } from "node:crypto"
import type { WebSocket } from "ws"
import { getConfig } from "../config"
import { handleMcpFamily, type DesktopMcpSaveAction } from "../message-router/handlers/mcp"
import { SecurityConfirmationManager, DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from "../security-confirmation"
import { acquireL2Admission, releaseL2Admission } from "../orchestrator/l2-admission"
import type { DesktopReadServices } from "./read"

type Frame = Record<string, unknown>
type Pending = { confirmationId: string; digest: string; thread: string | null; deadline: number; controllerApproved: boolean }
const fields = ["command", "args", "cwd", "enabled"]
const namePattern = /^[a-zA-Z0-9_-]+$/
/** Only this fixed payload schema accepts a JSON string. No generic object/RPC tunnel. */
export function parseDesktopMcpPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null
  let value: any
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) return null
  if (typeof value.command !== "string" || !value.command.trim() || !Array.isArray(value.args) || value.args.some((v: unknown) => typeof v !== "string") || typeof value.enabled !== "boolean" || (value.cwd !== undefined && typeof value.cwd !== "string")) return null
  // JSON.parse collapses duplicate names. Inspect decoded top-level key tokens,
  // ignoring strings inside args; parsed schema has already excluded nested objects.
  let depth = 0, arrays = 0
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      const start = i++
      while (i < raw.length) { if (raw[i] === "\\") { i += 2; continue }; if (raw[i] === '"') break; i++ }
      let next = i + 1; while (/\s/.test(raw[next] || "") && next < raw.length) next++
      if (depth === 1 && arrays === 0 && raw[next] === ":") {
        const key: string = JSON.parse(raw.slice(start, i + 1))
        if (seen.has(key)) return null
        seen.add(key)
      }
    } else if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === "[") arrays++
    else if (ch === "]") arrays--
  }
  return value
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  return "{" + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}"
}
function exact(frame: Frame, keys: string[]): boolean { return Object.keys(frame).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(frame, k)) }

export function createDesktopMcpSave(opts: {
  ws: WebSocket; current: () => boolean; services: DesktopReadServices;
  manager: SecurityConfirmationManager; send: (frame: unknown) => void;
}) {
  let operation: AbortController | undefined
  let pending: Pending | undefined
  const currentThread = (thread: unknown): thread is string | null => thread === null || (typeof thread === "string" && !!thread.trim() && !!opts.services.threads.get(thread))
  const live = (thread: string | null, controller: AbortController) => !controller.signal.aborted && opts.current() && currentThread(thread)
  const send = (frame: unknown) => { try { if (opts.current()) opts.send(frame) } catch { /* Closed notification must not prevent manager settlement. */ } }
  function cancel() { operation?.abort(); pending = undefined }
  async function handle(frame: Frame): Promise<Record<string, unknown>> {
    const id = frame.id
    const fail = (error_code: string) => ({ type: frame.type + ".result", ok: false, error_code, id })
    if (!exact(frame, frame.type === "desktop.mcp.edit" ? ["type", "id", "name", "thread_id"] : ["type", "id", "name", "thread_id", "action", "payload_json"]) || typeof id !== "string" || id.length > 200 || typeof frame.name !== "string" || !namePattern.test(frame.name) || !currentThread(frame.thread_id)) return fail("DESKTOP_MCP_INPUT_INVALID")
    const name = frame.name, thread = frame.thread_id
    if (!opts.current()) return fail("DESKTOP_MCP_STALE")
    if (frame.type === "desktop.mcp.edit") {
      const cfg = getConfig().mcp?.servers?.[name]
      if (!cfg || cfg.transport !== "stdio") return fail("DESKTOP_MCP_STDIO_REQUIRED")
      return { type: "desktop.mcp.edit.result", id, name, config: { command: cfg.command, args: cfg.args || [], cwd: cfg.cwd || "", enabled: cfg.enabled }, trust_level: cfg.trust_level }
    }
    if (operation) return fail("DESKTOP_MCP_BUSY")
    const payload = parseDesktopMcpPayload(frame.payload_json)
    if (!payload || (frame.action !== "add" && frame.action !== "update")) return fail("DESKTOP_MCP_INPUT_INVALID")
    const existing = getConfig().mcp?.servers?.[name]
    if (frame.action === "update" && existing?.transport !== "stdio") return fail("DESKTOP_MCP_STDIO_REQUIRED")
    const controller = new AbortController(); operation = controller
    let admissionKey: string | undefined
    try {
      const admission = await acquireL2Admission({ threadId: thread })
      if (!admission.ok) return fail("DESKTOP_MCP_ADMISSION_TIMEOUT")
      admissionKey = admission.key
      if (!live(thread, controller)) return fail("DESKTOP_MCP_STALE")
      const confirm = async (action: DesktopMcpSaveAction) => {
        if (!live(thread, controller)) return false
        const actionJSON = canonical({ ...structuredClone(action), thread_id: thread })
        const digest = createHash("sha256").update(actionJSON).digest("hex")
        // Start the original manager timeout now, never on receive/retry/full-view.
        const deadline = Date.now() + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS
        let receipt: Pending | undefined
        const decision = await opts.manager.request(data => {
          if (data.type === "security.confirmation.request") {
            receipt = { confirmationId: data.confirmation_id, digest, thread, deadline, controllerApproved: false }; pending = receipt
            send({ type: "desktop.confirmation.request", request_id: id, confirmation_id: data.confirmation_id, thread_id: thread, action_digest: digest, action_json: actionJSON, deadline_ms: deadline, timeout_ms: data.timeout_ms })
          } else if (data.type === "security.confirmation.resolved" || data.type === "security.confirmation.expired") {
            const old = pending; pending = undefined
            if (old) send({ type: "desktop.confirmation.resolved", confirmation_id: old.confirmationId, approved: data.approved === true })
          }
        }, { toolName: `mcp.${action.action}_stdio`, dangerousApis: ["mcp.stdio", "child_process.spawn"], criticalApis: ["mcp.stdio.spawn"], code: `MCP ${action.action} stdio settings`, autoConfirmEligible: false, riskLevel: "high" }, { originWs: opts.ws, signal: controller.signal })
        return decision.approved && receipt?.controllerApproved === true && Date.now() < deadline && live(thread, controller)
      }
      const server = { transport: "stdio", ...payload, trust_level: "manual" }
      const result = await handleMcpFamily("mcp." + frame.action, frame.action === "add" ? { name, server } : { name, patch: payload }, {
        desktopSave: { confirm, current: () => live(thread, controller), stale: () => controller.abort() },
      }, { get: () => undefined, update: () => undefined })
      if (!result || result.type !== "mcp.servers.updated") return fail(controller.signal.aborted ? "DESKTOP_MCP_STALE" : "DESKTOP_MCP_NOT_SAVED")
      // Store may have emitted callbacks that closed the socket after its atomic write.
      // A stale socket never receives an ACK; connection status is read separately.
      return { type: "desktop.mcp.save.result", id, name, ok: true, saved: true }
    } catch { return fail("DESKTOP_MCP_SAVE_FAILED") }
    finally { if (admissionKey) releaseL2Admission(admissionKey); pending = undefined; operation = undefined }
  }
  function decide(frame: Frame): boolean {
    const p = pending, controller = operation
    if (!p || !controller || !exact(frame, ["type", "confirmation_id", "thread_id", "action_digest", "approved"]) || frame.confirmation_id !== p.confirmationId || frame.thread_id !== p.thread || frame.action_digest !== p.digest || typeof frame.approved !== "boolean" || !live(p.thread, controller)) return false
    if (Date.now() >= p.deadline) { cancel(); return false }
    p.controllerApproved = frame.approved
    const resolved = opts.manager.respondFrom(p.confirmationId, frame.approved, opts.ws).outcome === "resolved"
    if (!resolved) p.controllerApproved = false
    return resolved
  }
  return { handle, decide, cancel }
}
