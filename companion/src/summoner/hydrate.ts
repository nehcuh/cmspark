/** Overlay hydrate: last ≤20 plaintext lines for the dashed-box transcript.
 *  UI lock: these lines are the wireframe dashed box, NOT chat bubbles.
 */

export function hydratePlaintext(
  messages: Array<{ role: string; content?: string; tool_calls?: Array<{ function?: { name?: string } }> }>,
  cap = 20,
): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      const name = m.tool_calls?.[0]?.function?.name
      lines.push(name ? `[工具] ${name}` : "[工具]")
      continue
    }
    const text = String(m.content || "").replace(/\s+/g, " ").trim()
    if (!text) continue
    const who = m.role === "user" ? "你" : m.role === "assistant" ? "助手" : m.role
    lines.push(`${who}: ${text.slice(0, 240)}`)
  }
  return lines.slice(-cap)
}
