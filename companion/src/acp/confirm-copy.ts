// Pure confirm-dialog code strings for ACP start / apply (unit-testable).

export function formatAcpStartConfirmCode(opts: {
  agentLabel: string
  mode: "review_readonly" | "propose_diff" | string
  workspaceRoot: string
  goal: string
  sessionId: string
  /** Mode C: also open host Terminal with interactive agent */
  openLocalTerminal?: boolean
}): string {
  const modeLabel = opts.mode === "propose_diff" ? "起草修改" : "审查"
  const goal = String(opts.goal || "").slice(0, 200)
  const lines = [
    `启动编程助手「${opts.agentLabel}」· 模式=${modeLabel}`,
    `仓库: ${opts.workspaceRoot}`,
    `任务: ${goal}`,
    `session=${opts.sessionId}`,
    "注意: 代码/页面摘要可能发送到该 Agent 的云模型",
  ]
  if (opts.openLocalTerminal) {
    lines.push(
      "模式 C: 将额外打开本机终端运行交互式 Agent（完整 TUI/权限在此）",
      "侧栏同时保留监视桥（stdout/时间线）—— 两进程，v1 不是同一会话",
    )
  }
  return lines.join("\n")
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
