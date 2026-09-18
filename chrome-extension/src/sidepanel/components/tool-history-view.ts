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
 * Group the transcript for slice A rendering: consecutive role=tool rows
 * (one per tool — the live tool.start and hydrated persistence shapes both
 * use single-entry tool_calls rows) collapse into ONE block per turn, so a
 * turn renders one audit chip instead of N cards. Any non-tool row (user /
 * assistant text) starts a new block — never merge separate turns.
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
  for (const m of list) {
    const isToolRow =
      m != null &&
      (m as { role?: unknown }).role === "tool" &&
      Array.isArray((m as { tool_calls?: unknown }).tool_calls) &&
      ((m as { tool_calls: unknown[] }).tool_calls.length ?? 0) > 0
    if (isToolRow) {
      buf.push(m)
    } else {
      flush()
      out.push({ kind: "row", msg: m })
    }
  }
  flush()
  return out
}
