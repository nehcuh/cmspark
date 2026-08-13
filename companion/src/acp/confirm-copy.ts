// Pure confirm-dialog code strings for ACP start / apply (unit-testable).

export function formatAcpStartConfirmCode(opts: {
  agentLabel: string
  mode: "review_readonly" | "propose_diff" | string
  workspaceRoot: string
  goal: string
  sessionId: string
}): string {
  const modeLabel = opts.mode === "propose_diff" ? "起草修改" : "审查"
  const goal = String(opts.goal || "").slice(0, 200)
  return [
    `启动编程助手「${opts.agentLabel}」· 模式=${modeLabel}`,
    `仓库: ${opts.workspaceRoot}`,
    `任务: ${goal}`,
    `session=${opts.sessionId}`,
    "注意: 代码/页面摘要可能发送到该 Agent 的云模型",
  ].join("\n")
}

export function formatAcpApplyConfirmCode(opts: {
  sessionId: string
  workspaceRoot: string
  files: string
  allowDelete: boolean
}): string {
  return [
    "应用编程接力 diff 到工作区",
    `session=${opts.sessionId}`,
    `仓库: ${opts.workspaceRoot}`,
    `files=${opts.files}`,
    `allow_delete=${opts.allowDelete ? "yes" : "no"}`,
  ].join("\n")
}
