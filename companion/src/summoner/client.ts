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
  encodeSummonerDictate,
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

/** v2 empty-state: `#` prefix is title search; anything else is talk. */
export function isSummonerSearchQuery(text: string): boolean {
  return text.trim().startsWith("#")
}

/** Needle after a leading `#`. Empty when the text is not a search query. */
export function summonerSearchNeedle(text: string): string {
  const t = text.trim()
  if (!t.startsWith("#")) return ""
  return t.slice(1).trim()
}

/**
 * Resolve chat.create thread_id. Non-empty requestedId wins (caller already
 * picked a hit). Empty → newest thread id, or null so the agent can create.
 */
export function resolveSubmitThread(args: {
  requestedId: string
  threads: ThreadTitleRecord[]
}): string | null {
  const requested = args.requestedId.trim()
  if (requested) return requested
  return sortRecentFirst(args.threads)[0]?.id ?? null
}

export type SubmitSummonerTalkDeps = {
  listThreads: () => Promise<ThreadTitleRecord[]>
  createThread: () => Promise<{ id: string } | null>
  claimLease: (threadId: string) => Promise<void>
  sendChatCreate: (args: { thread_id: string; message: string }) => boolean
  selectMessages?: (threadId: string) => Promise<unknown[]>
  hydrate?: (args: { thread_id: string; messages: unknown[] }) => void
}

export type SubmitSummonerTalkResult = {
  ok: boolean
  threadId: string | null
}

/**
 * Empty overlay talk: last thread, or create, then overlay lease + chat.create.
 * Hydrate is optional (agent supplies stdin after resolve).
 */
export async function submitSummonerTalk(
  requestedId: string,
  text: string,
  deps: SubmitSummonerTalkDeps,
): Promise<SubmitSummonerTalkResult> {
  const message = text.trim()
  if (!message) return { ok: false, threadId: null }

  const threads = await deps.listThreads()
  let id = resolveSubmitThread({ requestedId, threads })
  if (!id) {
    const created = await deps.createThread()
    id = created?.id ?? null
  }
  if (!id) return { ok: false, threadId: null }

  await deps.claimLease(id)
  const ok = deps.sendChatCreate({ thread_id: id, message })
  if (deps.hydrate) {
    const messages = (await deps.selectMessages?.(id)) ?? []
    deps.hydrate({ thread_id: id, messages })
  }
  return { ok, threadId: id }
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

export type SummonerSttModelId = "small" | "medium" | "large-v3-turbo"

export type VoiceSttStartFrame = {
  type: "voice.stt.start"
  v: 1
  sessionId: string
  modelId: SummonerSttModelId
  format: "wav" | "pcm_s16le"
  sampleRate: 16000
  channels: 1
  privacy_ack_v2: true
}

export type VoiceSttChunkFrame = {
  type: "voice.stt.chunk"
  v: 1
  sessionId: string
  seq: number
  data: string
}

export type VoiceSttEndFrame = {
  type: "voice.stt.end"
  v: 1
  sessionId: string
  totalSeq: number
}

export type VoiceSttFrame = VoiceSttStartFrame | VoiceSttChunkFrame | VoiceSttEndFrame

/** Overlay mic gesture = privacy ack. One-shot wav → start/chunk/end. */
export function micWavToSttFrames(args: {
  sessionId: string
  modelId: SummonerSttModelId
  data: string
}): VoiceSttFrame[] {
  return [
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: args.sessionId,
      modelId: args.modelId,
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    {
      type: "voice.stt.chunk",
      v: 1,
      sessionId: args.sessionId,
      seq: 0,
      data: args.data,
    },
    {
      type: "voice.stt.end",
      v: 1,
      sessionId: args.sessionId,
      totalSeq: 1,
    },
  ]
}

export function micPcmStartFrame(args: {
  sessionId: string
  modelId: SummonerSttModelId
}): VoiceSttStartFrame {
  return {
    type: "voice.stt.start",
    v: 1,
    sessionId: args.sessionId,
    modelId: args.modelId,
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
    privacy_ack_v2: true,
  }
}

/** voice.stt.result → fill overlay composer. Prefer dictate over auto-submit. */
export function mapVoiceSttToSummonerCmd(msg: unknown): SummonerOutboundCmd | null {
  const m = asRecord(msg)
  if (!m) return null
  if (m.type === "voice.stt.result") {
    const text = typeof m.text === "string" ? m.text : ""
    return encodeSummonerDictate({ text })
  }
  if (m.type === "voice.stt.error") {
    const message =
      typeof m.message === "string"
        ? m.message
        : typeof m.code === "string"
          ? m.code
          : "听写失败"
    const error_code = typeof m.code === "string" ? m.code : undefined
    return encodeSummonerError(error_code !== undefined ? { message, error_code } : { message })
  }
  return null
}
