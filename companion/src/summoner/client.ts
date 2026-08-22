/**
 * Tray-side summoner helpers (Node, no Swift UI).
 *
 * Pure functions so tests don't boot menu-bar. Streaming `chat.create` lives
 * on CompanionClient.sendChatCreate (fire-and-forget, not 5s RPC).
 *
 * Plan: docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md Task 8
 */

import {
  SUMMONER_SEARCH_HINT,
  encodeSummonerToken,
  encodeSummonerDone,
  encodeSummonerError,
  type SummonerOutboundCmd,
  type SummonerSearchHint,
} from "./protocol"

/** Continue CTA: new user message, never a server-side L1 replay. */
export const CONTINUE_MESSAGE =
  "浏览器已连接。请等待我的下一条指令；不要重试刚才失败的网页操作。" as const

/** Attach CTA: open Chrome only. Must include this phrase (S8 / UI lock). */
export const ATTACH_NOTIFY_COPY =
  "已激活 Google Chrome。我们不能替你打开侧栏。" as const

export type ThreadTitleRecord = {
  id: string
  title?: string
  alias?: string
  updated_at?: string
  created_at?: string
}

export type TitleSearchResult = {
  matches: ThreadTitleRecord[]
  /** Empty-state / capability copy — P0 never searches message body. */
  searchHint: SummonerSearchHint
}

function threadStamp(t: ThreadTitleRecord): string {
  return t.updated_at || t.created_at || ""
}

function sortRecentFirst(threads: ThreadTitleRecord[]): ThreadTitleRecord[] {
  return [...threads].sort((a, b) => threadStamp(b).localeCompare(threadStamp(a)))
}

/**
 * Title/alias search over `thread.list`. Empty query → most recent thread.
 * Never searches message body (hint is always `P0 不搜正文`).
 */
export function filterThreadsByTitle(
  threads: ThreadTitleRecord[],
  query: string,
): TitleSearchResult {
  const searchHint = SUMMONER_SEARCH_HINT
  const sorted = sortRecentFirst(threads)
  const q = query.trim()
  if (!q) {
    return { matches: sorted.slice(0, 1), searchHint }
  }
  const matches = sorted.filter((t) => {
    const title = t.title ?? ""
    const alias = t.alias ?? ""
    return title.includes(q) || alias.includes(q)
  })
  return { matches, searchHint }
}

export function buildContinueChatCreate(thread_id: string): {
  thread_id: string
  message: typeof CONTINUE_MESSAGE
} {
  return { thread_id, message: CONTINUE_MESSAGE }
}

/**
 * Honest attach: activate Chrome. Never openSidePanel (that copy lies).
 */
export function attachChromeOnly(opener: { openChrome: () => void }): string {
  opener.openChrome()
  return ATTACH_NOTIFY_COPY
}

function asRecord(msg: unknown): Record<string, unknown> | null {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null
  return msg as Record<string, unknown>
}

/**
 * Map companion WS stream frames → summoner stdin cmds.
 * chat.create itself stays on the summoner WS.
 */
export function mapChatMessageToSummonerCmd(msg: unknown): SummonerOutboundCmd | null {
  const m = asRecord(msg)
  if (!m) return null
  const type = m.type
  if (type === "chat.token") {
    const text =
      typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : ""
    return encodeSummonerToken({ text })
  }
  if (type === "chat.done") {
    return encodeSummonerDone()
  }
  if (type === "chat.error") {
    const message =
      typeof m.error === "string"
        ? m.error
        : typeof m.message === "string"
          ? m.message
          : "出错了"
    const data = asRecord(m.data)
    const error_code =
      typeof m.error_code === "string"
        ? m.error_code
        : typeof data?.error_code === "string"
          ? data.error_code
          : undefined
    return encodeSummonerError(error_code !== undefined ? { message, error_code } : { message })
  }
  return null
}
