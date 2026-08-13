// Session timeline items for Coding Session Shell (browser ACP Client UX).

export type TimelineKind =
  | "status"
  | "agent_message"
  | "user_message"
  | "tool"
  | "plan"
  | "diff"
  | "permission"
  | "error"

export type TimelineItem = {
  id: string
  kind: TimelineKind
  label: string
  detail?: string
  path?: string
  status?: "pending" | "running" | "done" | "error"
  at: string
}

let seq = 0
export function timelineItem(
  kind: TimelineKind,
  label: string,
  extra: Partial<TimelineItem> = {},
): TimelineItem {
  seq += 1
  return {
    id: `tl_${Date.now().toString(36)}_${seq}`,
    kind,
    label: label.slice(0, 500),
    detail: extra.detail?.slice(0, 2000),
    path: extra.path,
    status: extra.status,
    at: new Date().toISOString(),
  }
}

export function capTimeline(items: TimelineItem[], max = 80): TimelineItem[] {
  if (items.length <= max) return items
  return items.slice(-max)
}

/** Map ACP session/update notification params → timeline (+ text append). */
export function parseSessionUpdate(params: unknown): {
  items: TimelineItem[]
  textAppend?: string
  progress?: string
} {
  const items: TimelineItem[] = []
  if (!params || typeof params !== "object") return { items }
  const p = params as Record<string, unknown>
  const update = (p.update || p.sessionUpdate || p) as Record<string, unknown>

  // Common shapes: { sessionUpdate: { sessionUpdate: "agent_message_chunk", content: ... } }
  const kind =
    (typeof update.sessionUpdate === "string" && update.sessionUpdate) ||
    (typeof update.type === "string" && update.type) ||
    (typeof p.sessionUpdate === "string" && p.sessionUpdate) ||
    ""

  const content = update.content ?? update.text ?? update.message
  const text =
    typeof content === "string"
      ? content
      : content && typeof content === "object" && typeof (content as any).text === "string"
        ? String((content as any).text)
        : ""

  if (/agent_message|message_chunk|assistant/i.test(kind) && text) {
    items.push(timelineItem("agent_message", text.slice(0, 200), { detail: text }))
    return { items, textAppend: text, progress: text.slice(-200) }
  }
  if (/thought|reasoning/i.test(kind) && text) {
    items.push(timelineItem("agent_message", `💭 ${text.slice(0, 120)}`, { detail: text }))
    return { items, textAppend: text, progress: text.slice(-200) }
  }
  if (/tool_call|tool/i.test(kind)) {
    const title =
      (typeof update.title === "string" && update.title) ||
      (typeof update.name === "string" && update.name) ||
      (typeof update.toolName === "string" && update.toolName) ||
      "tool"
    const path =
      typeof update.path === "string"
        ? update.path
        : typeof (update.locations as any)?.[0]?.path === "string"
          ? (update.locations as any)[0].path
          : undefined
    const st =
      update.status === "completed" || update.status === "done"
        ? "done"
        : update.status === "failed" || update.status === "error"
          ? "error"
          : "running"
    items.push(
      timelineItem("tool", String(title).slice(0, 200), {
        path,
        status: st,
        detail: text || undefined,
      }),
    )
    return { items, progress: `tool: ${title}` }
  }
  if (/plan/i.test(kind)) {
    const entries = Array.isArray(update.entries)
      ? update.entries
      : Array.isArray(update.plan)
        ? update.plan
        : []
    const label =
      entries.length > 0
        ? entries
            .slice(0, 5)
            .map((e: any) => String(e?.content || e?.title || e).slice(0, 80))
            .join(" · ")
        : text || "plan"
    items.push(timelineItem("plan", label.slice(0, 300), { detail: text }))
    return { items, progress: "plan updated" }
  }
  if (/diff|file_edit|edit/i.test(kind)) {
    const path =
      typeof update.path === "string"
        ? update.path
        : typeof update.file === "string"
          ? update.file
          : "file"
    items.push(
      timelineItem("diff", `diff ${path}`, {
        path: String(path),
        status: "done",
        detail: text || (typeof update.diff === "string" ? update.diff : undefined),
      }),
    )
    return { items, progress: `diff ${path}` }
  }

  if (text) {
    items.push(timelineItem("status", text.slice(0, 200), { detail: text }))
    return { items, textAppend: text, progress: text.slice(-200) }
  }
  return { items }
}
