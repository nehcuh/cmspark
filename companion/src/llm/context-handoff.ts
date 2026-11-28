// Structured working memory shared by thread persistence, compaction and H1 generation.

export const HANDOFF_CAPS = {
  goals: { max: 5, len: 120 },
  decisions: { max: 8, len: 160 },
  constraints: { max: 8, len: 120 },
  open_todos: { max: 8, len: 120 },
  artifacts: { max: 8, len: 80 },
} as const

export type HandoffField = keyof typeof HANDOFF_CAPS

/** Optional exact internal tool name on a H1 todo (lowercase [a-z][a-z0-9_]*). */
export type HandoffTodo = { text: string; tool?: string }

/** Session-end style hot core (runtime request path only). */
export interface ThreadHandoff {
  updated_at: string
  goals: string[]
  decisions: string[]
  constraints: string[]
  open_todos: HandoffTodo[]
  artifacts: string[]
}

/** UI / format labels (zh). */
export const HANDOFF_LABELS_ZH: Record<HandoffField, string> = {
  goals: "目标",
  decisions: "决策",
  constraints: "约束",
  open_todos: "待办",
  artifacts: "产物",
}

/** Format priority when fitting ≤ maxChars (drop later sections first). */
const FORMAT_ORDER: HandoffField[] = [
  "goals",
  "constraints",
  "decisions",
  "open_todos",
  "artifacts",
]

const SECRET_LINE_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i

const MAX_NOTICE_CHARS = 2000

function scrubLine(s: string): string | null {
  let t = String(s || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return null
  if (SECRET_LINE_RE.test(t)) return "[redacted]"
  return t
}

function capList(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const line = scrubLine(String(item ?? ""))
    if (!line) continue
    out.push(line.slice(0, len))
    if (out.length >= max) break
  }
  return out
}

function scrubToolName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.trim()
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(t)) return undefined
  return t
}

function capTodos(raw: unknown, max: number, len: number): HandoffTodo[] {
  if (!Array.isArray(raw)) return []
  const out: HandoffTodo[] = []
  for (const item of raw) {
    let text: string | null = null
    let tool: string | undefined
    if (typeof item === "string" || typeof item === "number") {
      text = scrubLine(String(item))
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>
      if (typeof o.text !== "string") continue
      text = scrubLine(o.text)
      tool = scrubToolName(o.tool)
    }
    if (!text) continue
    const row: HandoffTodo = { text: text.slice(0, len) }
    if (tool) row.tool = tool
    out.push(row)
    if (out.length >= max) break
  }
  return out
}

function linesFor(field: HandoffField, handoff: ThreadHandoff): string[] {
  if (field === "open_todos") return handoff.open_todos.map((t) => t.text)
  return handoff[field] as string[]
}

/** Sanitize / normalize handoff; null if empty of all lists. */
export function sanitizeThreadHandoff(raw: unknown): ThreadHandoff | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const handoff: ThreadHandoff = {
    updated_at:
      typeof o.updated_at === "string" && o.updated_at.trim()
        ? o.updated_at.trim()
        : new Date().toISOString(),
    goals: capList(o.goals, HANDOFF_CAPS.goals.max, HANDOFF_CAPS.goals.len),
    decisions: capList(o.decisions, HANDOFF_CAPS.decisions.max, HANDOFF_CAPS.decisions.len),
    constraints: capList(
      o.constraints,
      HANDOFF_CAPS.constraints.max,
      HANDOFF_CAPS.constraints.len,
    ),
    open_todos: capTodos(o.open_todos, HANDOFF_CAPS.open_todos.max, HANDOFF_CAPS.open_todos.len),
    artifacts: capList(o.artifacts, HANDOFF_CAPS.artifacts.max, HANDOFF_CAPS.artifacts.len),
  }
  const total =
    handoff.goals.length +
    handoff.decisions.length +
    handoff.constraints.length +
    handoff.open_todos.length +
    handoff.artifacts.length
  if (total === 0) return null
  return handoff
}

/**
 * Labeled bullets for notice / chip.
 * Overflow policy (plan N1): keep FORMAT_ORDER priority; drop later sections to fit maxChars.
 */
export function formatHandoffForNotice(
  handoff: ThreadHandoff,
  maxChars: number = MAX_NOTICE_CHARS,
): string {
  const sections: string[] = []
  for (const field of FORMAT_ORDER) {
    const items = linesFor(field, handoff)
    if (!items.length) continue
    const label = HANDOFF_LABELS_ZH[field]
    const block = [`【${label}】`, ...items.map((x) => `- ${x}`)].join("\n")
    const trial = sections.length ? sections.join("\n") + "\n" + block : block
    if (trial.length > maxChars) {
      if (sections.length === 0) {
        // First section alone too long — hard slice
        return block.slice(0, maxChars)
      }
      break
    }
    sections.push(block)
  }
  return sections.join("\n").slice(0, maxChars)
}

export function serializeHandoffForHash(handoff: ThreadHandoff): string {
  return JSON.stringify({
    goals: handoff.goals,
    decisions: handoff.decisions,
    constraints: handoff.constraints,
    open_todos: handoff.open_todos,
    artifacts: handoff.artifacts,
  })
}

/** Pure parse path (exported for unit tests / dual nit). */
export function parseHandoffJson(raw: string): ThreadHandoff | null {
  let text = (raw || "").trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1))
    return sanitizeThreadHandoff({
      ...obj,
      updated_at: new Date().toISOString(),
    })
  } catch {
    return null
  }
}
