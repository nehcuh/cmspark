/** Overlay hydrate: last N role-prefixed plaintext messages.
 *  Preserve newlines. Never wrap HTML or chat bubbles.
 */

const HYDRATE_CAP = 20
const HYDRATE_CHARS = 4000

export function hydratePlaintext(
  messages: Array<{ role: string; content?: string; tool_calls?: Array<{ function?: { name?: string } }> }>,
  cap = HYDRATE_CAP,
): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      const name = m.tool_calls?.[0]?.function?.name
      lines.push(name ? `[工具] ${name}` : "[工具]")
      continue
    }
    const text = String(m.content || "").replace(/\r\n/g, "\n").trim()
    if (!text) continue
    const who = m.role === "user" ? "你" : m.role === "assistant" ? "助手" : m.role
    lines.push(`${who}: ${text.slice(0, HYDRATE_CHARS)}`)
  }
  return lines.slice(-cap)
}
