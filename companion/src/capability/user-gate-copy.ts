// User-facing copy for capability / scene / security gates that god-mode does NOT bypass.
// Keep English machine tokens in the string so classifyError() still matches recoverability.

/** Workspace not bound — DevSec workspace_* tools. */
export const WORKSPACE_ROOT_NOT_SET_ERROR =
  "需要先绑定工作区，才能读写本机文件夹。\n" +
  "下一步：打开侧栏「场景」→ 点「选择工作区」→ 选中文件夹 → 让助手重试。\n" +
  "（这与 God-mode / 自动批准无关：工作区是场地绑定，不是确认弹窗。）\n" +
  "[workspace_root not set — pick a folder first]"

/** Scene tool whitelist — Mission Pack surface. */
export function sceneToolNotAllowedError(toolLabelZh: string, packId: string | null): string {
  if (packId) {
    return (
      `当前场景不允许使用「${toolLabelZh}」。\n` +
      `下一步：侧栏「场景」→「退出场景，回到通用助手」，或改用场景说明里列出的工具。\n` +
      `（God-mode 不会放开场景白名单。）\n` +
      `[tool_not_allowed / 当前场景不允许 / 可退出场景后重试]`
    )
  }
  return (
    `当前对话不允许使用「${toolLabelZh}」（工具白名单）。\n` +
    `下一步：检查线程工具策略，或新建对话。\n` +
    `[tool_not_allowed / not in thread tool_whitelist]`
  )
}

/**
 * Soften chat.error prefixes for user-actionable gates.
 * Input may already be Chinese + machine token lines.
 */
export function humanizeChatErrorForUser(raw: string): string {
  const e = (raw || "").trim()
  if (!e) return "出错了，请重试。"

  // Strip scary prefixes then re-classify
  const body = e
    .replace(/^安全阻断:\s*/i, "")
    .replace(/^不可恢复错误:\s*/i, "")
    .replace(/^❌\s*/u, "")
    .trim()

  if (/workspace_root not set|pick a folder first|需要先绑定工作区/i.test(body)) {
    return (
      "需要先绑定工作区\n" +
      "请打开侧栏「场景」→「选择工作区」选中本机文件夹，然后说「继续」让助手重试。\n" +
      "说明：God-mode / 自动批准不会跳过这一步。"
    )
  }

  if (/tool_not_allowed|当前场景不允许|not in thread tool_whitelist|可退出场景/i.test(body)) {
    return (
      "当前场景限制了这个工具\n" +
      "请打开侧栏「场景」→「退出场景，回到通用助手」，再重试。\n" +
      "说明：God-mode 不会放开场景工具白名单。"
    )
  }

  if (/module_disabled|module_unavailable|enterprise_profile/i.test(body)) {
    return (
      "本机能力未开启或当前安装通道不足\n" +
      "请到侧栏「场景」→「本机能力」开启对应电源；企业能力还需 enterprise 配置。\n" +
      "说明：这与确认弹窗 / God-mode 不是同一道门。"
    )
  }

  if (/NETSEC_SCOPE|allowlist|任务授权|authorize/i.test(body)) {
    return (
      "网络扫描范围未授权\n" +
      "请到「设置 → 网络扫描」配置允许的目标，并授权本对话后再试。"
    )
  }

  // Keep original for true security / unknown, but avoid double "安全阻断"
  if (/^安全阻断/i.test(e) || /^不可恢复/.test(e)) return e
  return body
}

/** Map error_level + raw message → chat.error string shown in Side Panel. */
export function formatChatErrorLine(
  errorLevel: "recoverable" | "non_recoverable" | "security",
  rawError: string,
): string {
  const human = humanizeChatErrorForUser(rawError)
  // Setup gates: never brand as 安全阻断 / 不可恢复
  if (
    /需要先绑定工作区|当前场景限制|本机能力未开启|网络扫描范围未授权/.test(human)
  ) {
    return human
  }
  if (errorLevel === "security") {
    return `操作未通过安全确认：${human}\n若你已拒绝弹窗，可重新发起并选择批准；企业 shell/netsec 可能仍需单独确认。`
  }
  if (errorLevel === "non_recoverable") {
    return `无法继续：${human}`
  }
  return human
}
