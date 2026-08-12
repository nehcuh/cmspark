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

  // Create-fail hard-gate (default sandbox mkdir failed)
  if (/default_sandbox_unavailable|cannot create default sandbox|默认工作区沙箱不可用/i.test(body + e)) {
    return (
      "📁 **默认沙箱不可用**\n\n" +
      "请检查本机 **~/CMspark-projects** 是否可创建；或侧栏 **「场景」** → **「选择工作区」** 绑定明确目录后重试。\n\n" +
      "_说明：未绑定时会回落到默认沙箱，不会自动写入线程 workspace_root。_"
    )
  }

  // Soft path: happy path uses default sandbox; pick is optional for real projects.
  if (
    /workspace_root not set|pick a folder first|需要先绑定工作区|默认使用沙箱|本机读写可用默认沙箱/i.test(
      body + e,
    )
  ) {
    return (
      "📁 **可用默认沙箱 ~/CMspark-projects**\n\n" +
      "一般无需选文件夹即可读写沙箱。若要真实项目：侧栏 **「场景」** → **「选择工作区」** → 说「继续」。\n\n" +
      "_说明：协议解锁 / 自动批准与场地绑定无关。_"
    )
  }

  if (
    /tool_not_allowed|当前场景不允许|not in thread tool_whitelist|可退出场景|当前场景限制|工具白名单|工具面已收窄/i.test(
      body + e,
    )
  ) {
    return (
      "🎭 **本对话工具面已收窄**\n\n" +
      "顶栏点 **「恢复全工具」** 或 **「退出场景」**（立即对本对话生效）。**不要新建对话**（容易再次中招）。\n\n" +
      "_说明：三旗全自动巡航会放开普通对话工具面；仅协议解锁/无人值守两旗不够。_"
    )
  }

  if (/image_fetch_file_requires_cruise|不能拉取 file:|file_requires_cruise/i.test(body + e)) {
    return (
      "🖼️ **本地 file: 图片需要三旗巡航**\n\n" +
      "这不是确认被拒：默认禁止拉取 `file://`。**三旗全自动**后放行本地图并跳过图片拉取确认；**云元数据 SSRF 仍硬拦**。或改用 **screenshot**。"
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
