// L0 RunProgress — chat-column checklist.
// Seed = companion-written tickable (H1 handoff.open_todos or run_progress_propose).
// Spec: docs/superpowers/plans/2026-08-31-runprogress-live-plan.md (#265)
// v1 seed-only-from-H1 amended by #265. Evidence ticks bind to exact item.tool,
// never model_draft, never text.substring. User toggle is Side Panel only
// (not SUMMONER_ALLOW).

import { TAB_LEASE_TOOLS } from "../orchestrator/constants"

/** Lockstep with HANDOFF_CAPS.open_todos (H1). */
export const RUN_PROGRESS_CAPS = { max: 8, len: 120 } as const

export const RUN_PROGRESS_PROPOSE_TOOL = "run_progress_propose" as const

/** Page tools that require a successful propose this request (sticky null exempt). */
export const RUN_PROGRESS_PAGE_TOOLS = new Set<string>([
  ...TAB_LEASE_TOOLS,
  "create_tab",
  "osascript_eval",
  "host_computer",
])

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
  const t = raw.replace(/[\x00-\x1F\x7F]/g, "").trim()
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(t)) return undefined
  return t
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
 * Map model propose payload into tickable seed rows.
 * Forces id live:{i}, source seed, done false; drops writer tool name.
 * Not a sanitize(raw) success path — model done/source/id are discarded.
 */
export function mapProposeItems(raw: unknown): RunProgressItem[] {
  if (!Array.isArray(raw)) return []
  const rows: RunProgressItem[] = []
  for (let i = 0; i < raw.length && rows.length < RUN_PROGRESS_CAPS.max; i++) {
    const row = raw[i]
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    const o = row as Record<string, unknown>
    const text = scrubText(o.text, RUN_PROGRESS_CAPS.len)
    if (!text) continue
    let tool = scrubTool(o.tool)
    if (tool === RUN_PROGRESS_PROPOSE_TOOL) tool = undefined
    const item: RunProgressItem = { id: `live:${rows.length}`, text, done: false, source: "seed" }
    if (tool) item.tool = tool
    rows.push(item)
  }
  return rows
}

/**
 * Pure ingest for run_progress_propose.
 * sticky null === null → CLEARED; mapped empty → EMPTY_ITEMS;
 * leftover undone seed|user && !replaceOk → ALREADY_HAS_STEPS.
 */
export function proposeRunProgress(
  thread: { run_progress?: RunProgress | null },
  items: unknown,
  opts: { replaceOk: boolean },
): { ok: true; progress: RunProgress } | { ok: false; error_code: string } {
  if (thread.run_progress === null) return { ok: false, error_code: "CLEARED" }
  const mapped = mapProposeItems(items)
  if (mapped.length === 0) return { ok: false, error_code: "EMPTY_ITEMS" }
  const cur = thread.run_progress
  const hasUndone =
    cur != null &&
    cur.items.some((it) => it.source !== "model_draft" && it.done !== true)
  if (hasUndone && opts.replaceOk !== true) return { ok: false, error_code: "ALREADY_HAS_STEPS" }
  return { ok: true, progress: { items: mapped } }
}

/** Adapter gate: block page tools until this request has proposed (worker / sticky null exempt). */
export function shouldBlockPageTool(p: {
  toolName: string
  proposedThisRequest: boolean
  agentRole?: string
  runProgress: RunProgress | null | undefined
}): boolean {
  if (p.proposedThisRequest) return false
  if (p.agentRole === "worker") return false
  if (p.runProgress === null) return false
  return RUN_PROGRESS_PAGE_TOOLS.has(p.toolName)
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
    items: todos.map((t, i) => {
      if (t && typeof t === "object" && !Array.isArray(t)) {
        const o = t as Record<string, unknown>
        return {
          id: `seed:${i}`,
          text: o.text ?? "",
          done: false,
          source: "seed" as const,
          tool: o.tool,
        }
      }
      return {
        id: `seed:${i}`,
        text: t,
        done: false,
        source: "seed" as const,
      }
    }),
  })
}

/**
 * Adapter tick after a confirmed successful tool_result.
 * Call only on success (adapter already gates `toolResult.success`).
 *
 * `undefined` return = do not write.
 * `run_progress === null` is sticky clear — never seed.
 * Caller-set `{ items: [] }` still reseeds on this path (pre-existing adapter
 * behavior; TM itself does not reseed empty objects).
 */
export function nextRunProgressAfterToolSuccess(
  thread: {
    run_progress?: RunProgress | null
    runtime_context_budget?: {
      handoff?: { open_todos?: unknown } | null
    } | null
  },
  toolName: string,
): RunProgress | undefined {
  if (thread.run_progress === null) return undefined
  const current =
    thread.run_progress != null && thread.run_progress.items.length > 0
      ? thread.run_progress
      : seedRunProgress(thread)
  const next = applyToolResult(current, { tool: toolName, success: true })
  if (next !== current) return next
  if (thread.run_progress === undefined && next.items.length > 0) return next
  return undefined
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

/**
 * Side Panel user gesture: flip done on seed|user by exact id.
 * Never ticks model_draft (sanitize would force done=false anyway).
 * Missing id → same object.
 */
export function userToggle(progress: RunProgress, itemId: string): RunProgress {
  const id = typeof itemId === "string" ? itemId : ""
  if (!id) return progress
  const items = progress?.items
  if (!Array.isArray(items) || items.length === 0) return progress
  const idx = items.findIndex((it) => it && it.id === id)
  if (idx < 0) return progress
  const cur = items[idx]!
  if (cur.source === "model_draft") return progress
  const next = items.slice()
  next[idx] = { ...cur, done: !cur.done }
  return { items: next }
}
