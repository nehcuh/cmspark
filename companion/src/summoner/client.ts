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
  encodeSummonerTool,
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

export const ATTACH_SILENT_COPY =
  "已在后台启动 Google Chrome。要看窗口时点「激活 Google Chrome」。我们不能替你打开侧栏。" as const

export const DEFAULT_RESUME_IDLE_MINUTES = 10

export function normalizeResumeIdleMinutes(value: unknown): number {
  if (value === -1 || value === 0 || value === 5 || value === 10 || value === 30) return value
  return DEFAULT_RESUME_IDLE_MINUTES
}

/** After idle timeout, the next overlay open starts a new thread. 0=always new, -1=always resume. */
export function shouldStartNewSummonerThread(args: {
  now: number
  lastActivityAt?: number | null
  resumeIdleMinutes: number
}): boolean {
  if (args.resumeIdleMinutes === 0) return true
  if (args.resumeIdleMinutes < 0) return false
  if (args.lastActivityAt == null || !Number.isFinite(args.lastActivityAt)) return true
  return args.now - args.lastActivityAt > args.resumeIdleMinutes * 60_000
}

/**
 * Honest attach: never openSidePanel. Default is silent launch (no focus steal).
 */
export function attachChromeOnly(
  opener: { openChrome: () => void; openChromeSilent?: () => void },
  opts?: { foreground?: boolean },
): string {
  const foreground = opts?.foreground === true
  if (foreground) opener.openChrome()
  else if (opener.openChromeSilent) opener.openChromeSilent()
  else opener.openChrome()
  return foreground ? ATTACH_NOTIFY_COPY : ATTACH_SILENT_COPY
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
  if (type === "tool.start") {
    const name = typeof m.tool_name === "string" && m.tool_name ? m.tool_name : "工具"
    return encodeSummonerTool({ name })
  }
  if (type === "mcp.confirm.pending") {
    const message =
      typeof m.message === "string" && m.message
        ? m.message
        : "MCP 工具需在 Chrome 侧栏批准"
    return encodeSummonerError({ message, error_code: "MCP_CONFIRM_PENDING" })
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

export const SUMMONER_STT_MODEL_FALLBACK: SummonerSttModelId[] = [
  "medium",
  "small",
  "large-v3-turbo",
]

/** Prefer configured id when present on disk; else first ready fallback. */
export function resolveSummonerSttModelId(
  preferred: string | undefined,
  ready: readonly string[],
): SummonerSttModelId | null {
  const readySet = new Set(ready)
  if (preferred === "small" || preferred === "medium" || preferred === "large-v3-turbo") {
    if (readySet.has(preferred)) return preferred
  }
  for (const id of SUMMONER_STT_MODEL_FALLBACK) {
    if (readySet.has(id)) return id
  }
  return null
}

/** 16-bit mono 16 kHz: 0.3s of PCM plus the 44-byte WAV header. */
const MIC_WAV_HEADER_BYTES = 44
const MIC_WAV_MIN_PCM_BYTES = 16000 * 2 * 0.3

export function decodedBase64Bytes(data: string): number {
  if (typeof data !== "string" || data.length === 0) return 0
  try {
    return Buffer.from(data, "base64").length
  } catch {
    return 0
  }
}

export function micWavTooShort(data: string): boolean {
  return decodedBase64Bytes(data) < MIC_WAV_HEADER_BYTES + MIC_WAV_MIN_PCM_BYTES
}

export type SttStartResult = { ok: true } | { ok: false; code?: string; message: string }

export type MicWavSttTransport = {
  start: (frame: VoiceSttStartFrame) => Promise<SttStartResult>
  chunk: (frame: VoiceSttChunkFrame) => void
  end: (frame: VoiceSttEndFrame) => void
}

const STT_ERROR_COPY: Record<string, string> = {
  session_unknown: "听写会话未建立，请再试一次",
  model_missing: "本机 Whisper 模型未就绪。请到 Side Panel → 设置下载 medium。",
  engine_not_local: "请先在设置里把听写引擎切到「本机 Whisper」",
  empty_result: "没听清，请再试一次",
  too_short: "点一下太短。请按住说话，或点麦后再说、再点结束。",
  origin_denied: "听写通道未授权（召唤器会话未就绪）",
  need_privacy_ack: "需要先确认本机听写隐私协议",
}

export function summonerSttErrorCopy(code?: string, fallback?: string): string {
  if (code && STT_ERROR_COPY[code]) return STT_ERROR_COPY[code]
  if (fallback === "no matching session") return STT_ERROR_COPY.session_unknown
  if (typeof fallback === "string" && fallback.trim()) return fallback
  return "听写失败"
}

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

/** Await start.ok before chunk/end so a failed bind is not overwritten by session_unknown. */
export async function sendMicWavToStt(args: {
  sessionId: string
  modelId: SummonerSttModelId
  data: string
  transport: MicWavSttTransport
}): Promise<SttStartResult> {
  if (micWavTooShort(args.data)) {
    return { ok: false, code: "too_short", message: STT_ERROR_COPY.too_short }
  }
  const frames = micWavToSttFrames({
    sessionId: args.sessionId,
    modelId: args.modelId,
    data: args.data,
  })
  const start = frames[0] as VoiceSttStartFrame
  const chunk = frames[1] as VoiceSttChunkFrame
  const end = frames[2] as VoiceSttEndFrame
  const started = await args.transport.start(start)
  if (!started.ok) {
    return {
      ok: false,
      code: started.code,
      message: summonerSttErrorCopy(started.code, started.message),
    }
  }
  args.transport.chunk(chunk)
  args.transport.end(end)
  return { ok: true }
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
    const error_code = typeof m.code === "string" ? m.code : undefined
    const raw = typeof m.message === "string" ? m.message : error_code
    const message = summonerSttErrorCopy(error_code, raw)
    return encodeSummonerError(error_code !== undefined ? { message, error_code } : { message })
  }
  return null
}
