// L0 RunProgress — chat-column checklist seeded from H1 handoff.open_todos.
// Spec: docs/superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md Task 4
// v1 ingest = seed-only. Evidence ticks bind to exact item.tool, never model_draft,
// never text.substring. Overlay write verbs live in Task 5.

/** Lockstep with HANDOFF_CAPS.open_todos (H1). */
export const RUN_PROGRESS_CAPS = { max: 8, len: 120 } as const

export type RunProgressItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
  /** Exact internal tool name for evidence ticks. Omit on drafts. */
  tool?: string
}

export type RunProgress = { items: RunProgressItem[] }

const SOURCES = new Set<RunProgressItem["source"]>(["seed", "model_draft", "user"])

function scrubText(raw: unknown, len: number): string {
  return String(raw ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, len)
}

function scrubId(raw: unknown, fallback: string): string {
  const id = String(raw ?? "")
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 64)
  return id || fallback
}

function scrubTool(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 80)
  return t || undefined
}

/** Cap 8×120; force model_draft done=false; drop junk sources. */
export function sanitizeRunProgress(raw: unknown): RunProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { items: [] }
  const list = (raw as { items?: unknown }).items
  if (!Array.isArray(list)) return { items: [] }
  const items: RunProgressItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < list.length && items.length < RUN_PROGRESS_CAPS.max; i++) {
    const row = list[i]
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    const o = row as Record<string, unknown>
    const source = SOURCES.has(o.source as RunProgressItem["source"])
      ? (o.source as RunProgressItem["source"])
      : null
    if (!source) continue
    const text = scrubText(o.text, RUN_PROGRESS_CAPS.len)
    if (!text) continue
    let id = scrubId(o.id, `rp:${i}`)
    if (seen.has(id)) id = `${id}:${i}`
    seen.add(id)
    const tool = scrubTool(o.tool)
    const done = source === "model_draft" ? false : o.done === true
    const item: RunProgressItem = { id, text, done, source }
    if (tool) item.tool = tool
    items.push(item)
  }
  return { items }
}

/**
 * Seed from thread.runtime_context_budget.handoff.open_todos only.
 * Missing handoff → empty. Never reads thread.open_todos.
 */
export function seedRunProgress(thread: {
  runtime_context_budget?: {
    handoff?: { open_todos?: unknown } | null
  } | null
} | null | undefined): RunProgress {
  const todos = thread?.runtime_context_budget?.handoff?.open_todos
  if (!Array.isArray(todos)) return { items: [] }
  return sanitizeRunProgress({
    items: todos.map((t, i) => ({
      id: `seed:${i}`,
      text: t,
      done: false,
      source: "seed" as const,
    })),
  })
}

/**
 * Tick at most one oldest undone seed|user row whose item.tool === tool (exact).
 * success===true only. Never ticks model_draft. Never matches text.
 */
export function applyToolResult(
  progress: RunProgress,
  ev: { tool: string; success: boolean },
): RunProgress {
  if (ev.success !== true) return progress
  const tool = typeof ev.tool === "string" ? ev.tool : ""
  if (!tool) return progress
  const items = progress?.items
  if (!Array.isArray(items) || items.length === 0) return progress
  const idx = items.findIndex(
    (it) =>
      it &&
      it.done !== true &&
      (it.source === "seed" || it.source === "user") &&
      it.tool === tool,
  )
  if (idx < 0) return progress
  const next = items.slice()
  next[idx] = { ...next[idx]!, done: true }
  return { items: next }
}
