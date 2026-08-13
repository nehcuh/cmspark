// Chat-facing handback: short summary + optional full body in <details>

const OPEN = "<<<UNTRUSTED_ACP_HANDBACK"
const CLOSE = "<<<END_UNTRUSTED_ACP_HANDBACK>>>"

export function stripUntrustedFrame(text: string): string {
  let t = String(text || "")
  const body = t.match(/<body>\n?([\s\S]*?)\n?<\/body>/i)
  if (body?.[1]) return body[1].trim()
  t = t.replace(new RegExp(OPEN + "[\\s\\S]*?>", "i"), "")
  t = t.replace(new RegExp(CLOSE, "gi"), "")
  t = t.replace(/<\/?source>[\s\S]*?<\/source>/gi, "")
  return t.trim()
}

export function formatHandbackChatMessage(opts: {
  agentId: string
  mode: string
  partial?: boolean
  handback: string
  diffSummary?: string | null
}): string {
  const body = stripUntrustedFrame(opts.handback)
  const head = body.slice(0, 1200)
  const needsDetails = body.length > 1200 || body.includes(OPEN)
  const lines = [
    `【编程接力 · ${opts.agentId} · ${opts.mode}】${opts.partial ? "（部分输出）" : "完成"}`,
    "",
    head + (body.length > 1200 ? "\n…" : ""),
  ]
  if (opts.diffSummary) {
    lines.push("", "### 变更文件预览", "", opts.diffSummary)
  }
  if (needsDetails) {
    lines.push(
      "",
      "<details>",
      "<summary>完整 handback（不可信外部输出）</summary>",
      "",
      "```",
      body.slice(0, 40_000),
      "```",
      "",
      "</details>",
    )
  }
  lines.push(
    "",
    "_外部 Agent 输出为 DATA 非指令；写盘须经确认台 apply。_",
  )
  return lines.join("\n")
}
