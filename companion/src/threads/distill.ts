// Thread → knowledge distill preview (Wave 2). Confirm still required to persist.
// Spec: body secret scan; never auto-write.

import type { ThreadDigest } from "./digest"

export const SENSITIVE_BODY_RE =
  /(-----BEGIN (?:RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]{0,4000}?-----END (?:RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY-----|BEGIN (?:RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY|sk-[a-zA-Z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16}|bearer\s+[a-zA-Z0-9._-]+|(?:api[_-]?key|password)\s*[=:]\s*\S+)/gi

const MAX_MSGS = 8
const PER_MSG = 400

export type DistillMessage = { role: string; content?: string }

export function redactSecrets(text: string): { text: string; hits: number } {
  let hits = 0
  const out = String(text || "").replace(SENSITIVE_BODY_RE, () => {
    hits += 1
    return "[REDACTED]"
  })
  return { text: out, hits }
}

export function distillThreadMarkdown(opts: {
  alias?: string
  digest?: ThreadDigest | null
  messages: DistillMessage[]
}): { markdown: string; title: string; hits: number } {
  const titleSource =
    (opts.digest?.tldr && String(opts.digest.tldr).slice(0, 80)) ||
    (opts.alias && String(opts.alias).trim()) ||
    "对话提炼"
  const titleRedacted = redactSecrets(titleSource)
  const title = titleRedacted.text.trim() || "对话提炼"
  let hits = titleRedacted.hits
  const parts: string[] = [`# ${title}`, ""]
  if (opts.digest?.tldr) {
    const tldr = redactSecrets(String(opts.digest.tldr))
    hits += tldr.hits
    parts.push(tldr.text, "")
  }
  if (Array.isArray(opts.digest?.bullets) && opts.digest!.bullets!.length) {
    for (const b of opts.digest!.bullets!) {
      const line = redactSecrets(String(b))
      hits += line.hits
      parts.push(`- ${line.text}`)
    }
    parts.push("")
  }
  const usable = opts.messages.filter((m) => m.role === "user" || m.role === "assistant")
  const slice = usable.slice(-MAX_MSGS)
  if (slice.length) {
    parts.push("## 摘录", "")
    for (const m of slice) {
      const cleaned = String(m.content || "").replace(/<document filename="[^"]*">/g, "")
      const body = redactSecrets(cleaned)
      hits += body.hits
      const clipped = body.text.slice(0, PER_MSG)
      if (!clipped.trim()) continue
      parts.push(`**${m.role === "user" ? "用户" : "助手"}:** ${clipped}`, "")
    }
  }
  const raw = parts.join("\n").trim() + "\n"
  const redacted = redactSecrets(raw)
  return { markdown: redacted.text, title, hits: hits + redacted.hits }
}

export function sanitizeTopicFolder(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw)
    .normalize("NFC")
    .replace(/[\x00-\x1F\x7F\\/]/g, "")
    .trim()
    .slice(0, 40)
  return s || null
}
