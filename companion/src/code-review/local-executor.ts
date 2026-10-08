import { z } from "zod"
import type { EvidenceScope } from "../business-evidence/content"
import { securityPolicy } from "../security-policy"
import { localRunInput } from "./local-contract"
import { getLocalReviewJobs } from "./local-jobs"
import { renderLocalRisk } from "./local-risk"

export function executeLocalReviewTool(dataDir: string, scope: EvidenceScope | undefined, tool: string, params: Record<string, unknown>, signal?: AbortSignal) {
  if (!scope || scope.kind !== "chat") return { success: false, error: "CODE_REVIEW_CHAT_SCOPE_REQUIRED" }
  try {
    const { __thread_id: _thread, __local_review_agent_digest: _digest, tabId: _tab, security_token: _token, ...input } = params
    const jobs = getLocalReviewJobs(dataDir)
    let data: unknown
    if (tool === "code_review_run") {
      // Scope is supplied by the server. A page/model cannot use a token
      // approved for a different thread or substitute any archive/hash.
      const boundParams = { ...params, __thread_id: scope.threadId }
      if (!securityPolicy.validateTokenFor(String(params.security_token || ""), tool, boundParams)) {
        return { success: false, error: "LOCAL_REVIEW_CONFIRMATION_REQUIRED" }
      }
      signal?.throwIfAborted()
      data = jobs.submit(scope, localRunInput(boundParams))
    } else if (tool === "code_review_status") {
      const query = z.object({ job_id: z.string().uuid().optional() }).strict().parse(input)
      data = query.job_id ? jobs.read(scope, query) : jobs.list(scope)
    } else if (tool === "code_review_cancel") data = jobs.cancel(scope, input)
    else if (tool === "code_review_risk_report") data = renderLocalRisk(dataDir, scope, input, jobs)
    else return { success: false, error: "UNKNOWN_CODE_REVIEW_TOOL" }
    return { success: true, data }
  } catch (error: any) {
    return { success: false, error: /^[A-Z][A-Z0-9_]+$/.test(error?.message || "") ? error.message : "INVALID_LOCAL_REVIEW_REQUEST" }
  }
}
