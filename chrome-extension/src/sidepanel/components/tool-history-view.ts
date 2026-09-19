/**
 * #502 slice A — tool history folding (pure view model).
 * One assistant turn's tool cards: while the turn is live only the current
 * step stays expanded; after the turn ends the whole history collapses into
 * one audit chip. Fold state is view-local — never persisted onto the thread
 * (same discipline as #256 pin 4).
 */

export type HistoryTool = {
  id?: string
  tool_name?: string
  status?: string // "running" | "success" | "error" | …
  result?: unknown
  error?: unknown
}

export type HistoryView =
  | { kind: "empty" }
  | {
      kind: "live"
      completed: HistoryTool[]
      current: HistoryTool
      failed: number
      expandedCompleted: boolean
    }
  | {
      kind: "done"
      tools: HistoryTool[]
      failed: number
      expanded: boolean
    }

export type ToolHistoryOptions = {
  /** Only true for the LAST row of the active turn — history rows are always "done". */
  threadBusy?: boolean
  /** L2-confirming tool ids — those must stay visible as `current`, never folded. */
  pendingConfirmIds?: ReadonlySet<string>
}

function isFailed(tool: HistoryTool): boolean {
  return tool.status === "error" || tool.error != null
}

function countFailed(tools: HistoryTool[]): number {
  let n = 0
  for (const t of tools) if (isFailed(t)) n += 1
  return n
}

function isLiveTool(tool: HistoryTool, pendingConfirmIds: ReadonlySet<string>): boolean {
  if (tool.status === "running") return true
  return typeof tool.id === "string" && tool.id.length > 0 && pendingConfirmIds.has(tool.id)
}

/** Frame/store fields used to decide which thread an L2 confirm belongs to. */
export type ConfirmThreadContext = {
  tool_name?: string | null
  thread_id?: string | null
  worker_id?: string | null
}

/**
 * Owner thread of an L2 confirm. Worker frames stamp `worker_id` (the worker
 * thread); main-thread frames may stamp `thread_id`. Untagged → null.
 */
export function confirmationOwnerThreadId(
  c: ConfirmThreadContext | null | undefined,
): string | null {
  if (!c) return null
  if (typeof c.worker_id === "string" && c.worker_id) return c.worker_id
  if (typeof c.thread_id === "string" && c.thread_id) return c.thread_id
  return null
}

/**
 * #507: a pending confirm only flips tools on ITS thread. Untagged (legacy)
 * confirms still match the viewed thread — the itemIsLast gate stops them
 * from flipping historical turns.
 */
export function confirmationMatchesActiveThread(
  c: ConfirmThreadContext | null | undefined,
  activeThreadId: string | null | undefined,
): boolean {
  if (!activeThreadId) return false
  const owner = confirmationOwnerThreadId(c)
  if (owner) return owner === activeThreadId
  return true
}

/** Tool names of L2 confirms that belong to `activeThreadId`. */
export function pendingConfirmToolNamesForThread(
  confirms: readonly ConfirmThreadContext[] | null | undefined,
  activeThreadId: string | null | undefined,
): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(confirms)) return names
  for (const c of confirms) {
    if (!confirmationMatchesActiveThread(c, activeThreadId)) continue
    const n = typeof c?.tool_name === "string" ? c.tool_name.trim() : ""
    if (n) names.add(n)
  }
  return names
}

/**
 * #508 (a): name → tool-call id. SecurityConfirmationRequest has no
 * tool_call_id on the wire, so the live card is correlated by tool_name.
 * Empty names → empty ids (the mutation that previously stayed green).
 */
export function pendingConfirmIdsFromTools(
  tools: HistoryTool[] | null | undefined,
  pendingConfirmToolNames: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>()
  if (!pendingConfirmToolNames || pendingConfirmToolNames.size === 0) return ids
  const list = Array.isArray(tools) ? tools : []
  for (const t of list) {
    if (
      typeof t?.id === "string" &&
      t.id.length > 0 &&
      typeof t?.tool_name === "string" &&
      pendingConfirmToolNames.has(t.tool_name)
    ) {
      ids.add(t.id)
    }
  }
  return ids
}

export function viewToolHistory(
  tools: HistoryTool[] | null | undefined,
  options: ToolHistoryOptions = {},
): HistoryView {
  const list = Array.isArray(tools) ? tools : []
  if (list.length === 0) return { kind: "empty" }
  const pendingConfirmIds = options.pendingConfirmIds ?? new Set<string>()

  // Rule 2: last running / confirming tool owns the live slot; the REST (not
  // just the prefix — never silently drop a later failed step) folds.
  let currentIdx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (isLiveTool(list[i], pendingConfirmIds)) {
      currentIdx = i
      break
    }
  }
  if (currentIdx >= 0) {
    const completed = list.filter((_, i) => i !== currentIdx)
    return {
      kind: "live",
      completed,
      current: list[currentIdx],
      failed: countFailed(completed),
      expandedCompleted: false,
    }
  }

  // Rule 3: busy turn whose last tool has not produced a result yet.
  const last = list[list.length - 1]
  if (options.threadBusy === true && last.result == null) {
    const completed = list.slice(0, -1)
    return {
      kind: "live",
      completed,
      current: last,
      failed: countFailed(completed),
      expandedCompleted: false,
    }
  }

  // Rule 7: even a single successful step folds — answer-first transcript.
  return { kind: "done", tools: list, failed: countFailed(list), expanded: false }
}

/** Live chip: `已完成 N 步 · K 失败 · 展开` */
export function liveChipLabel(completed: number, failed: number): string {
  return `已完成 ${completed} 步${failed > 0 ? ` · ${failed} 失败` : ""} · 展开`
}

/** Done chip: `N 步浏览器操作 · K 失败 · 展开审计` */
export function doneChipLabel(steps: number, failed: number): string {
  return `${steps} 步浏览器操作 · ${failed} 失败 · 展开审计`
}

export type ToolTurnItem<T> =
  | { kind: "row"; msg: T }
  | { kind: "tools"; msgs: T[] }

/**
 * #502 A hydrate guard: which rows may still render inline ToolCallCards?
 *  - role=tool rows are consumed by the per-turn block (groupToolTurnRows)
 *  - assistant rows carrying OpenAI FUNCTION shape ({function:{name}}) are
 *    covered by their role=tool rows (modern shape) or converted into a
 *    block (prehistoric shape) — never rendered inline again
 *  - only a FLAT tool_name shape that no block swallowed renders inline
 */
export function shouldRenderInlineToolCards(msg: {
  role?: unknown
  tool_calls?: unknown
} | null | undefined): boolean {
  if (msg == null) return false
  if ((msg as { role?: unknown }).role === "tool") return false
  const calls = (msg as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(calls) || calls.length === 0) return false
  const anyFunctionShape = calls.some((tc) => {
    if (tc == null || typeof tc !== "object") return true
    const t = tc as { tool_name?: unknown; function?: unknown }
    if (t.function != null) return true
    const name = t.tool_name
    return typeof name !== "string" || name.length === 0
  })
  return !anyFunctionShape
}

/**
 * Group the transcript for slice A rendering: consecutive role=tool rows
 * (one per tool — the live tool.start and hydrated persistence shapes both
 * use single-entry tool_calls rows) collapse into ONE block per turn, so a
 * turn renders one audit chip instead of N cards. Any non-tool row (user /
 * assistant text) starts a new block — never merge separate turns.
 *
 * Kimi MAJOR-1 hydrate guard: prehistoric threads carry ONLY assistant rows
 * with function-shape tool_calls and no role=tool rows. Inline cards are
 * suppressed for function shape, so an UNCOVERED assistant like that (its
 * next row is not a tool row) is converted into a tools block — with its
 * text kept as a plain row ahead of it — or the audit chip would be lost.
 */
export function groupToolTurnRows<T extends { role?: unknown; tool_calls?: unknown }>(
  messages: T[] | null | undefined,
): ToolTurnItem<T>[] {
  const list = Array.isArray(messages) ? messages : []
  const out: ToolTurnItem<T>[] = []
  let buf: T[] = []
  const flush = () => {
    if (buf.length > 0) {
      out.push({ kind: "tools", msgs: buf })
      buf = []
    }
  }
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (isToolRowType(m)) {
      buf.push(m)
      continue
    }
    flush()
    if (isUncoveredFunctionAssistant(m, list[i + 1])) {
      const record = m as {
        id?: unknown
        content?: unknown
        reasoning_content?: unknown
        tool_calls: unknown[]
      }
      const hasText =
        (typeof record.content === "string" && record.content.length > 0) ||
        (typeof record.reasoning_content === "string" && record.reasoning_content.length > 0)
      if (hasText) out.push({ kind: "row", msg: m })
      out.push({
        kind: "tools",
        msgs: [
          {
            id: typeof record.id === "string" ? record.id : undefined,
            role: "tool",
            tool_calls: record.tool_calls.map((tc) => {
              const call = tc as { tool_name?: unknown; function?: { name?: unknown } }
              return {
                ...call,
                tool_name:
                  typeof call.tool_name === "string" && call.tool_name.length > 0
                    ? call.tool_name
                    : typeof call.function?.name === "string"
                      ? call.function.name
                      : "",
              }
            }),
          } as unknown as T,
        ],
      })
      continue
    }
    out.push({ kind: "row", msg: m })
  }
  flush()
  return out
}

function isUncoveredFunctionAssistant<T extends { role?: unknown; tool_calls?: unknown }>(
  m: T | null | undefined,
  next: T | null | undefined,
): m is T & { tool_calls: unknown[] } {
  if (m == null || (m as { role?: unknown }).role !== "assistant") return false
  const calls = (m as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(calls) || calls.length === 0) return false
  const allFunctionShape = calls.every(
    (tc) =>
      tc != null &&
      typeof tc === "object" &&
      (tc as { function?: unknown }).function != null,
  )
  return allFunctionShape && !isToolRowType(next)
}

function isToolRowType<T extends { role?: unknown; tool_calls?: unknown }>(
  m: T | null | undefined,
): boolean {
  return (
    m != null &&
    (m as { role?: unknown }).role === "tool" &&
    Array.isArray((m as { tool_calls?: unknown }).tool_calls) &&
    ((m as { tool_calls: unknown[] }).tool_calls.length ?? 0) > 0
  )
}
