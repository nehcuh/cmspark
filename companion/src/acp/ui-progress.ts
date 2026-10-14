import type { AcpLiveEvent } from "./manager"
import type { AcpSessionRecord } from "./types"

export const CODING_PROGRESS_MAX_BYTES = 128 * 1024

/** Display projection only. Canonical results/diffs and immutable owner controls stay in manager/storage. */
export function boundCodingProgress(event: AcpLiveEvent): AcpLiveEvent | null {
  let truncated = false
  const text = (value: string | undefined, max: number) => {
    if (value && value.length > max) { truncated = true; return value.slice(0, max) }
    return value
  }
  const path = (value: string | undefined) => {
    if (value && Buffer.byteLength(value, "utf8") > 2048) { truncated = true; return undefined }
    return value
  }
  const allDiffs = event.pending_diffs as Array<{ relPath?: string; isNew?: boolean; isDelete?: boolean; applyable?: boolean }> | undefined
  // The extension consumes applyability, never full newContent/hunks. Preserve an actionable
  // descriptor even if it occurs after the metadata limit; Apply still uses the stored full diff.
  const diffs = allDiffs?.slice(0, 64)
  if (allDiffs && allDiffs.length > 64) {
    truncated = true
    const actionable = allDiffs.find(diff => diff.applyable === true)
    if (actionable && !diffs!.some(diff => diff.applyable === true)) diffs![63] = actionable
  }
  const view: AcpLiveEvent = {
    ...event,
    display_name: text(event.display_name, 300), error: text(event.error, 1000),
    goal: text(event.goal, 500), handback: text(event.handback, 8000),
    progress_tail: text(event.progress_tail, 12000),
    pending_diffs: diffs?.map(diff => ({ relPath: path(diff.relPath), isNew: diff.isNew, isDelete: diff.isDelete, applyable: diff.applyable })),
    timeline: event.timeline?.slice(-60).map(row => ({ ...row, label: text(row.label, 500)!, detail: text(row.detail, 2000), path: path(row.path) })),
  }
  if (event.timeline && event.timeline.length > 60) truncated = true
  const bytes = () => Buffer.byteLength(JSON.stringify({ ...view, output_truncated: true }), "utf8")
  const budget = CODING_PROGRESS_MAX_BYTES - 4096 // room for the handback message envelope
  while (bytes() > budget && (view.timeline?.length || 0) > 1) {
    truncated = true; view.timeline = view.timeline!.slice(1)
  }
  if (bytes() > budget && view.pending_diffs?.length) {
    const actionable = view.pending_diffs.find((diff: any) => diff.applyable === true)
    if (actionable) view.pending_diffs = [actionable, ...view.pending_diffs.filter(diff => diff !== actionable)]
    while (bytes() > budget && view.pending_diffs.length > 1) {
      truncated = true; view.pending_diffs = view.pending_diffs.slice(0, -1)
    }
  }
  // Fixed internal owner IDs, native workspace paths and the separately bounded complete command
  // leave room for the final timeline receipt. Decline bulk previews before any WS serialization.
  if (bytes() > budget) { truncated = true; view.handback = undefined; view.progress_tail = text(view.progress_tail, 1000) }
  // Do not rewrite owner/session identities to meet a display budget. An oversized identity/config
  // frame is withheld; authoritative session/storage and control replies remain untouched.
  if (bytes() > budget) return null
  return { ...view, ...(truncated ? { output_truncated: true } : {}) }
}

/** Save the canonical message first; this is only its bounded live-browser projection. */
export function codingHandbackView<M extends { content: unknown }>(session: AcpSessionRecord, message: M) {
  const view = boundCodingProgress({ type: "acp.session.event", session_id: session.session_id,
    thread_id: session.thread_id, agent_id: session.agent_id, state: session.state,
    handback: typeof message.content === "string" ? message.content : "", pending_diffs: session.pending_diffs,
  })
  if (!view) return null
  return { type: "acp.handback.message", thread_id: session.thread_id, session_id: session.session_id,
    message: { ...message, content: (view.handback || "") + (view.output_truncated
      ? "\n\n_此处仅显示部分输出；请返回所属主对话查看已保存的结果。_" : "") },
    pending_diffs: (view.pending_diffs || []).map((diff: any) => ({ path: diff.relPath, isNew: diff.isNew, isDelete: diff.isDelete, applyable: diff.applyable })),
    mode: session.mode, ...(view.output_truncated ? { output_truncated: true } : {}),
  }
}
