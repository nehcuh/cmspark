import { BusinessEvidenceService } from "./service"
import type { EvidenceScope } from "./content"
import { criterionIdentity } from "./content"
import { DRAFT_SCHEMAS } from "./schema"

export const DRAFT_TOOLS: ReadonlySet<string> = new Set(["draft_create", "draft_update", "draft_read", "draft_render"])

/** Called after existing Pack/stop gates. No scope can be supplied by a model. */
export function executeDraftTool(dataDir: string, scope: EvidenceScope | undefined, tool: string, params: unknown) {
  if (!scope || scope.kind !== "chat") return { success: false, error: "DRAFT_CHAT_SCOPE_REQUIRED" }
  const service = new BusinessEvidenceService(dataDir, scope)
  // Adapter-owned execution metadata is not part of the strict business API.
  const { __thread_id: _thread, tabId: _tab, ...input } = params as Record<string, unknown>
  try {
    const data = tool === "draft_create" ? service.create(input) : tool === "draft_update" ? service.update(input)
      : tool === "draft_read" ? service.read(input) : tool === "draft_render" ? service.render(input) : undefined
    if (tool === "draft_read" && data && "draft" in data) {
      const requirementId = data.draft.fields["requirement.id"]?.value
      const criteria = data.draft.fields["requirement.acceptance_criteria"]?.value
      const criteria_catalog = typeof requirementId === "string" && Array.isArray(criteria)
        && data.fields["requirement.id"]?.state === "supported" && data.fields["requirement.acceptance_criteria"]?.state === "supported"
        ? criteria.map(text => ({ criterion_id: criterionIdentity(requirementId, text), text, derived: true })) : []
      return { success: true, data: { ...data, schema: DRAFT_SCHEMAS[data.draft.kind], criteria_catalog } }
    }
    return data === undefined ? { success: false, error: "UNKNOWN_DRAFT_TOOL" } : { success: true, data }
  } catch (error) {
    // Never reflect arbitrary stored/page content from parser errors.
    const code = (error as Error).message
    return { success: false, error: /^[A-Z][A-Z0-9_]+$/.test(code) ? code : "INVALID_DRAFT_REQUEST_OR_STORE" }
  }
}

type BrowserResult = { success: boolean; data?: any; error?: string }
/** The caller invokes only on the authenticated local extension-forward path,
 * after its pending call resolves, before delivering the result to the model.
 * External MCP outputs and caller-authored reports never enter this function. */
export function captureLocalPageResult(dataDir: string, scope: EvidenceScope | undefined, toolCallId: string, tool: string, result: BrowserResult, signal?: AbortSignal, writesAllowed = true): BrowserResult {
  if (!["get_page_text", "get_page_html"].includes(tool) || !result.success) return result
  const { observation_id: _untrustedId, evidence_capture: _untrustedCapture, ...pageData } = result.data || {}
  if (!scope) return { ...result, data: pageData }
  let captured: { capture_status: string; observation_id?: string; reason?: string }
  if (signal?.aborted || !writesAllowed) captured = { capture_status: "skipped", reason: signal?.aborted ? "INTERRUPTED" : "PLAN_READONLY" }
  // DOM fallback returns useful ordinary HTML but has a multi-call content/URL
  // race. Do not promote it to durable business evidence at this boundary.
  else if (result.data?.provenance?.channel === "dom") captured = { capture_status: "skipped", reason: "NON_ATOMIC_DOM_READ" }
  else {
    try { captured = new BusinessEvidenceService(dataDir, scope).store.capture(toolCallId, tool, result) }
    catch { captured = { capture_status: "skipped", reason: "EVIDENCE_STORE_ERROR" } }
  }
  return { ...result, data: { ...pageData, evidence_capture: captured,
    ...(captured.observation_id ? { observation_id: captured.observation_id } : {}) } }
}
