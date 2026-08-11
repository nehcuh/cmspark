// User-facing copy for capability / scene / security gates that god-mode does NOT bypass.
// Keep English machine tokens in the string so classifyError() still matches recoverability.

/**
 * Legacy / edge gate when an explicit bind is still required by a caller.
 * Happy path: workspace_* uses default sandbox ~/CMspark-projects without pick.
 * Keep English machine tokens for classifyError recoverability.
 */
export const WORKSPACE_ROOT_NOT_SET_ERROR =
  "未绑定真实项目目录时，本机读写默认使用沙箱 ~/CMspark-projects。\n" +
  "若需真实仓库：打开侧栏「场景」→「选择工作区」绑定后重试。\n" +
  "（God-mode / 自动批准与场地绑定无关。）\n" +
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

  if (/default_sandbox_unavailable|cannot create default sandbox/i.test(body)) {
    return (
      "默认工作区沙箱不可用\n" +
      "请检查本机 ~/CMspark-projects 是否可创建；或打开侧栏「场景」→「选择工作区」绑定明确目录后重试。\n" +
      "说明：未绑定时会回落到 ~/CMspark-projects，不会自动写入线程 workspace_root。"
    )
  }

  // Soft path: happy path no longer requires pick; only create-fail / module_disabled hard-gate.
  if (/workspace_root not set|pick a folder first|需要先绑定工作区|默认使用沙箱/i.test(body)) {
    return (
      "本机读写可用默认沙箱 ~/CMspark-projects\n" +
      "一般无需选择文件夹；若要真实项目目录，打开侧栏「场景」→「选择工作区」后说「继续」。\n" +
      "说明：God-mode / 自动批准与场地绑定无关。"
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
    /需要先绑定工作区|默认使用沙箱|本机读写可用默认沙箱|默认工作区沙箱不可用|当前场景限制|本机能力未开启|网络扫描范围未授权/.test(
      human,
    )
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
