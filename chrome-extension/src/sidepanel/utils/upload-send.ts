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
  if (swErr || !(response as { ok?: unknown } | null | undefined)?.ok) return "error"
  return "ok"
}
