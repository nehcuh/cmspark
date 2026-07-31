/**
 * Humanize capability/scene gate errors for Side Panel chat bubbles.
 * Mirrors companion/src/capability/user-gate-copy.ts (keep in lockstep for key phrases).
 */

export function humanizeSidepanelGateError(raw: string): string {
  const e = (raw || "").trim()
  if (!e) return "⚠️ 出错了，请重试。"

  const body = e
    .replace(/^安全阻断:\s*/i, "")
    .replace(/^不可恢复错误:\s*/i, "")
    .replace(/^操作未通过安全确认：\s*/i, "")
    .replace(/^无法继续：\s*/i, "")
    .replace(/^❌\s*/u, "")
    .trim()

  if (/workspace_root not set|pick a folder first|需要先绑定工作区/i.test(body + e)) {
    return (
      "📁 **需要先绑定工作区**\n\n" +
      "1. 打开侧栏 **「场景」**\n" +
      "2. 点 **「选择工作区」**，选中本机文件夹\n" +
      "3. 回对话说「继续」\n\n" +
      "_说明：God-mode / 自动批准不会跳过工作区绑定。_"
    )
  }

  if (/tool_not_allowed|当前场景不允许|not in thread tool_whitelist|可退出场景|当前场景限制/i.test(body + e)) {
    return (
      "🎭 **当前场景限制了这个工具**\n\n" +
      "打开侧栏 **「场景」** → **「退出场景，回到通用助手」**，再重试。\n\n" +
      "_说明：God-mode 不会放开场景工具白名单。_"
    )
  }

  if (/module_disabled|module_unavailable|enterprise_profile|本机能力未开启/i.test(body + e)) {
    return (
      "🔌 **本机能力未开启**\n\n" +
      "侧栏 **「场景」** → **本机能力** 开启对应电源；企业能力还需 enterprise 配置。"
    )
  }

  if (/NETSEC_SCOPE|allowlist|任务授权|网络扫描范围/i.test(body + e)) {
    return (
      "📡 **网络扫描未授权**\n\n" +
      "**设置 → 网络扫描**：配置允许的目标，并授权本对话后再试。"
    )
  }

  // Soften residual scary prefixes
  if (/安全阻断/i.test(e) && !/已拒绝|user denied|blocked by user/i.test(e)) {
    return `⚠️ ${body}`
  }
  if (/不可恢复/i.test(e)) {
    return `⚠️ ${body}`
  }

  return body.startsWith("📁") || body.startsWith("🎭") || body.startsWith("⚠️")
    ? body
    : `⚠️ ${body}`
}
