import type { EvidenceScope } from "../business-evidence/content"
import { CodeReviewService } from "./service"
import { renderReviewMaterial } from "./material"

export function executeCodeReviewTool(dataDir: string, scope: EvidenceScope | undefined, tool: string, params: unknown) {
  if (!scope || scope.kind !== "chat") return { success: false, error: "CODE_REVIEW_CHAT_SCOPE_REQUIRED" }
  try {
    const { __thread_id: _thread, tabId: _tab, ...input } = params as Record<string, unknown>
    const service = new CodeReviewService(dataDir, scope)
    const data = tool === "code_review_create" ? service.create(input) : tool === "code_review_read" ? service.read(input)
      : tool === "code_review_assess" ? service.assess(input) : tool === "code_review_render" ? renderReviewMaterial(dataDir, scope, input) : undefined
    return data === undefined ? { success: false, error: "UNKNOWN_CODE_REVIEW_TOOL" } : { success: true, data }
  } catch (error) {
    const code = (error as Error).message
    return { success: false, error: /^[A-Z][A-Z0-9_]+$/.test(code) ? code : "INVALID_CODE_REVIEW_REQUEST_OR_STORE" }
  }
}
