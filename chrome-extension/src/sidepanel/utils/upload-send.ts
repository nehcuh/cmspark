// file.upload send-path pure helpers: F2 optimistic bubble construction and
// the F6 error-bubble decision. Pure functions — node:test, no React.

import type { Message } from "../types"
import { isFrameBudgetRefusal } from "../../background/ws-frame-budget"
import { newTempUserMessageId } from "../../utils/temp-message-id"

/**
 * Optimistic upload bubble (F2). The bubble id IS the clientMessageId sent on
 * file.upload: a new companion's chat.user echo adopts the bubble by exact id;
 * an old companion (no echo) simply keeps it — the upload turn never vanishes
 * from the transcript.
 */
export function buildOptimisticUploadBubble(opts: {
  threadId: string
  userMessage: string
  fileNames: string[]
}): { clientMessageId: string; message: Message } {
  const clientMessageId = newTempUserMessageId(opts.threadId)
  return {
    clientMessageId,
    message: {
      id: clientMessageId,
      thread_id: opts.threadId,
      role: "user",
      content: `${opts.userMessage}\n📎 ${opts.fileNames.join(", ")}`,
      created_at: new Date().toISOString(),
    },
  }
}

/**
 * Panel decision for a file.upload sendResponse (F6). "refused": SW rejected
 * the oversized frame and already broadcast file.upload_error with the correct
 * banner — the panel must not stack a second, misleading 「Companion 未连接」
 * bubble on top. "error": post the generic fallback bubble.
 */
export function uploadSendOutcome(
  swErr: string | null | undefined,
  response: unknown,
): "ok" | "refused" | "error" {
  if (isFrameBudgetRefusal(response)) return "refused"
  const ok = !!(response as { ok?: unknown } | null | undefined)?.ok
  // SW answered ok — lastError after a delivered sendResponse must not retract
  // a turn companion already accepted.
  if (ok) return "ok"
  // SW answered failure (offline / frame-budget / etc.) — it already
  // broadcast file.upload_error. Treat like refused so the panel does not
  // stack a second 「Companion 未连接」 bubble (F6 for the common drop).
  if (response && typeof response === "object") return "refused"
  return "error"
}

/** Restore caption only when the composer is still empty. */
export function nextComposerText(prev: string, restore: string): string {
  return prev.trim() ? prev : restore
}

/**
 * Panel ops after a failed file.upload send (post-#197 F2).
 * Always retract the optimistic user bubble — keep it only on sendOutcome === "ok".
 * "refused" still retracts but must not stack a second 「Companion 未连接」 bubble (F6).
 * Thread-switch: retract + mapBusy-off still apply; do not unlock the new thread.
 */
export type UploadSendFailureOp =
  | { op: "retract"; id: string }
  | { op: "busy_off"; threadId: string }
  | { op: "unlock_panel" }
  | { op: "restore_composer"; text: string }
  | { op: "error_bubble"; content: string }

export function uploadSendFailureOps(opts: {
  clientMessageId: string
  uploadThreadId: string
  sendOutcome: "refused" | "error"
  swErr?: string | null
  applyToActivePanel: boolean
  composerText?: string
}): UploadSendFailureOp[] {
  const ops: UploadSendFailureOp[] = [{ op: "retract", id: opts.clientMessageId }]
  if (opts.uploadThreadId) ops.push({ op: "busy_off", threadId: opts.uploadThreadId })
  if (!opts.applyToActivePanel) return ops
  ops.push({ op: "unlock_panel" })
  if (opts.composerText) ops.push({ op: "restore_composer", text: opts.composerText })
  if (opts.sendOutcome === "refused") return ops
  ops.push({
    op: "error_bubble",
    content: `\u274c ${opts.swErr || "Companion 未连接，无法上传文件"}`,
  })
  return ops
}
