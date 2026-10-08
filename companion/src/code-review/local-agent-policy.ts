import { getConfig } from "../config"
import { canonicalRequest, evidenceDigest } from "../business-evidence/content"

/** Trusted operator configuration, never page/model input. Local process does
 * not imply local inference. External source transfer requires an explicit
 * operator authorization for the configured service, plus per-job L2 consent.
 * Defaults deny both; these assertions are not an OS/network sandbox. */
export function reviewAgentPolicy(agentId: string) {
  const config = getConfig(), server = config.acp?.servers?.[agentId]
  if (!config.acp?.enabled || !server?.enabled || !server.command || server.protocol !== "acp"
    || !(server.offline_review === true || server.review_external_authorized === true)) {
    throw new Error("LOCAL_REVIEW_AUTHORIZED_ACP_AGENT_REQUIRED")
  }
  const destination = server.offline_review === true ? "operator_configured_offline" : "operator_authorized_external_service"
  const digest = evidenceDigest(canonicalRequest({ command: server.command, args: server.args || [],
    env: server.env || {}, policy: server.policy || {}, destination }))
  return { digest, destination, display_name: server.display_name, command: server.command, args: server.args || [] }
}
