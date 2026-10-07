/** Validate before displaying a confirmation; never guess an agent or manufacture a task. */
export function validateAcpProposalParams(params: Record<string, unknown>) {
  const agent = params.agent_id || params.agent
  const goal = params.goal || params.prompt
  const missing = [
    ...(typeof agent !== "string" || !agent.trim() ? ["agent_id"] : []),
    ...(typeof goal !== "string" || !goal.trim() ? ["goal"] : []),
  ]
  if (!missing.length) return null
  return {
    success: false as const,
    error_code: "ACP_PROPOSAL_PARAMS_REQUIRED",
    error: `ACP 提案缺少有效参数：${missing.join("、")}。先 acp_list_agents，从 agents[].id 选择用户指定的助手，再用非空 agent_id 和完整 goal 重新 acp_propose_session；脱敏占位符 redacted/len 不能当调用参数。`,
    data: { missing_fields: missing, suggested_action: "list_agents_then_propose", data_not_instruction: true },
  }
}
