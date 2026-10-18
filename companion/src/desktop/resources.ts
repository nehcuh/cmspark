/** One native socket, one edit snapshot and one write. No public tool authority. */
import { createHash } from "node:crypto"
import type { WebSocket } from "ws"
import { cleanTitle } from "../skills/doc-identity"
import { normalizeTags } from "../threads/digest"
import { redactSecrets } from "../threads/distill"
import type { DesktopResourceStore, ResourceKind, ResourceSnapshot } from "../skills/desktop-resource-store"
import { SecurityConfirmationManager, DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from "../security-confirmation"
import { acquireL2Admission, releaseL2Admission } from "../orchestrator/l2-admission"

export const DESKTOP_RESOURCE_METHODS = Object.freeze(["desktop.resource.read", "desktop.resource.import", "desktop.resource.update", "desktop.resource.remove"] as const)
type Frame = Record<string, unknown>
function exact(v: Frame, keys: string[]) { return Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)) }
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/
/** Decode only this closed payload. Check decoded duplicate keys before JSON.parse can collapse them. */
export function parseResourcePayload(raw: unknown, importing: boolean): Frame | null {
  if (typeof raw !== "string") return null
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    const allowed = importing ? ["text"] : ["title", "description", "tags", "body"]
    if (!Object.keys(v).length || Object.keys(v).some(k => !allowed.includes(k))) return null
    let depth = 0; const seen = new Set<string>()
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') {
        const begin = i++
        while (i < raw.length) { if (raw[i] === "\\") { i += 2; continue }; if (raw[i] === '"') break; i++ }
        let next = i + 1; while (next < raw.length && /\s/.test(raw[next])) next++
        if (depth === 1 && raw[next] === ":") { const key = JSON.parse(raw.slice(begin, i + 1)); if (seen.has(key)) return null; seen.add(key) }
      } else if (raw[i] === "{" || raw[i] === "[") depth++
      else if (raw[i] === "}" || raw[i] === "]") depth--
    }
    for (const [key, value] of Object.entries(v)) {
      if (key === "tags") { if (!Array.isArray(value) || value.some(t => typeof t !== "string")) return null }
      else if (typeof value !== "string") return null
    }
    if (Object.values(v).flat().some(value => redactSecrets(value as string).hits > 0)) return null
    for (const key of ["text", "body"]) if (typeof v[key] === "string" && Buffer.byteLength(v[key], "utf8") > 524288) return null
    if (importing) return typeof v.text === "string" && v.text.length > 0 ? v : null
    return { ...(v.title === undefined ? {} : { title: cleanTitle(v.title) }), ...(v.description === undefined ? {} : { description: v.description.slice(0, 500) }), ...(v.tags === undefined ? {} : { tags: normalizeTags(v.tags) }), ...(v.body === undefined ? {} : { body: v.body }) }
  } catch { return null }
}
export function createDesktopResources(opts: { store: DesktopResourceStore; ws: WebSocket; current(): boolean; manager: SecurityConfirmationManager; send(frame: unknown): void | boolean }) {
  let edit: ResourceSnapshot | undefined
  let operation: AbortController | undefined
  let pending: { id: string; digest: string; deadline: number; approved: boolean; controller: AbortController } | undefined
  const live = (controller: AbortController) => !controller.signal.aborted && opts.current()
  const send = (value: unknown) => { try { return opts.current() && opts.send(value) !== false } catch { return false /* A lost notification must not alter manager settlement. */ } }
  function cancel() { operation?.abort(); pending = undefined; edit?.release(); edit = undefined }
  async function handle(frame: Frame): Promise<Frame> {
    const type = String(frame.type), id = frame.id, kind = frame.kind as ResourceKind
    const fail = (code: string, outcome = "unavailable"): Frame => ({ type: type + ".result", id, kind, ok: false, outcome, error_code: code })
    const keys = type === DESKTOP_RESOURCE_METHODS[0] ? ["type", "id", "kind", "resource_id"] : type === DESKTOP_RESOURCE_METHODS[1] ? ["type", "id", "kind", "payload_json"] : type === DESKTOP_RESOURCE_METHODS[2] ? ["type", "id", "kind", "resource_id", "revision", "payload_json"] : ["type", "id", "kind", "resource_id", "revision"]
    if (!(DESKTOP_RESOURCE_METHODS as readonly string[]).includes(type) || !exact(frame, keys) || typeof id !== "string" || !idPattern.test(id) || !["skill", "knowledge"].includes(kind) || (type !== DESKTOP_RESOURCE_METHODS[1] && (typeof frame.resource_id !== "string" || !frame.resource_id)) || (type === DESKTOP_RESOURCE_METHODS[2] && kind !== "knowledge")) return fail("DESKTOP_RESOURCE_INPUT_INVALID")
    if (!opts.current()) return fail("DESKTOP_RESOURCE_STALE")
    if (type === DESKTOP_RESOURCE_METHODS[0]) {
      cancel()
      try { edit = opts.store.snapshot(kind, frame.resource_id as string); return { type: type + ".result", id, ok: true, doc: edit.doc } }
      catch { return fail("DESKTOP_RESOURCE_UNAVAILABLE") }
    }
    if (operation) return fail("DESKTOP_RESOURCE_BUSY")
    const payload = type === DESKTOP_RESOURCE_METHODS[3] ? {} : parseResourcePayload(frame.payload_json, type === DESKTOP_RESOURCE_METHODS[1])
    if (!payload) return fail("DESKTOP_RESOURCE_INPUT_INVALID")
    const snapshot = edit
    if (type !== DESKTOP_RESOURCE_METHODS[1] && (!snapshot || snapshot.doc.kind !== kind || snapshot.doc.resource_id !== frame.resource_id || !snapshot.doc.writable || snapshot.revision !== frame.revision)) return fail("DESKTOP_RESOURCE_CONFLICT", "conflict")
    let plan: ReturnType<DesktopResourceStore["prepareImport"]> | undefined
    try { if (type === DESKTOP_RESOURCE_METHODS[1]) plan = opts.store.prepareImport(kind, payload.text as string); else opts.store.validate(snapshot!) }
    catch (error) { return fail(error instanceof Error && error.message === "DESKTOP_RESOURCE_INPUT_INVALID" ? error.message : "DESKTOP_RESOURCE_CONFLICT", "conflict") }
    const controller = new AbortController(); operation = controller
    let admission: string | undefined, commitStarted = false
    try {
      const slot = await acquireL2Admission({ threadId: null })
      if (!slot.ok) return fail("DESKTOP_RESOURCE_ADMISSION_TIMEOUT")
      admission = slot.key
      if (!live(controller)) return fail("DESKTOP_RESOURCE_STALE")
      if (snapshot && !plan) opts.store.validate(snapshot)
      const action = { purpose: "resource", op: type.slice("desktop.resource.".length), kind, resource_id: plan?.id || frame.resource_id, revision: plan ? null : snapshot!.revision, payload: plan ? { text: plan.raw } : payload, thread_id: null }
      const actionJSON = JSON.stringify(action), digest = createHash("sha256").update(actionJSON).digest("hex"), deadline = Date.now() + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS
      let receipt: typeof pending, deliveryFailed = false
      const decision = await opts.manager.request(data => {
        if (data.type === "security.confirmation.request") {
          receipt = pending = { id: data.confirmation_id, digest, deadline, approved: false, controller }
          if (!send({ type: "desktop.confirmation.request", purpose: "resource", request_method: type, request_id: id, confirmation_id: data.confirmation_id, thread_id: null, action_digest: digest, action_json: actionJSON, deadline_ms: deadline, timeout_ms: data.timeout_ms })) deliveryFailed = true
        } else if (data.type === "security.confirmation.resolved" || data.type === "security.confirmation.expired") {
          if (pending === receipt) pending = undefined
          if (receipt) send({ type: "desktop.confirmation.resolved", confirmation_id: receipt.id, approved: data.approved === true })
        }
      }, { toolName: "desktop.resource." + action.op, dangerousApis: ["resource.write"], criticalApis: ["resource.write"], code: "全局技能／知识变更，可能影响后续对话读取；管理许可不授权执行内容。", autoConfirmEligible: false, riskLevel: "high" }, { originWs: opts.ws, signal: controller.signal })
      if (deliveryFailed) return fail("DESKTOP_RESOURCE_UNAVAILABLE")
      if (!decision.approved || !receipt?.approved) return fail("DESKTOP_RESOURCE_DENIED", "denied")
      if (!live(controller) || Date.now() >= deadline) return fail("DESKTOP_RESOURCE_STALE")
      // No await between this last live/OCC check and the synchronous canonical commit.
      if (!plan) opts.store.validate(snapshot!)
      commitStarted = true
      const current = () => live(controller) && Date.now() < deadline
      const resourceId = plan ? opts.store.commitImport(plan, current) : (type === DESKTOP_RESOURCE_METHODS[2] ? (opts.store.update(snapshot!, payload, current), snapshot!.doc.resource_id) : (opts.store.remove(snapshot!, current), snapshot!.doc.resource_id))
      return { type: type + ".result", id, kind, ok: true, outcome: "committed", resource_id: resourceId }
    } catch (error) {
      const conflict = error instanceof Error && error.message === "DESKTOP_RESOURCE_CONFLICT"
      return fail(conflict ? "DESKTOP_RESOURCE_CONFLICT" : "DESKTOP_RESOURCE_UNAVAILABLE", conflict ? "conflict" : commitStarted ? "unknown" : "unavailable")
    } finally {
      if (admission) releaseL2Admission(admission)
      if (pending?.controller === controller) pending = undefined
      if (operation === controller) operation = undefined
      if (edit === snapshot) { edit?.release(); edit = undefined }
    }
  }
  function decide(frame: Frame) {
    const p = pending
    if (!p || !exact(frame, ["type", "purpose", "confirmation_id", "thread_id", "action_digest", "approved"]) || frame.purpose !== "resource" || frame.thread_id !== null || frame.confirmation_id !== p.id || frame.action_digest !== p.digest || typeof frame.approved !== "boolean" || !live(p.controller) || Date.now() >= p.deadline) return false
    p.approved = frame.approved
    const resolved = opts.manager.respondFrom(p.id, frame.approved, opts.ws).outcome === "resolved"
    if (!resolved) p.approved = false
    return resolved
  }
  return { handle, decide, cancel }
}
