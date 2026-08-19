// WebSocket hook for Side Panel — communicates with background service worker

import { useEffect, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import type { ComputerTaskEventView, LLMConfig, Message, MessageAttachment } from "../types"
import { isAppsErrorMessage } from "../utils/apps-utils"
import { isComputerModelErrorMessage } from "../components/model-switch-logic"
import { isBrowserTool } from "../mode/mode-controller"
import { isUserEnvErrorMessage, mapUserEnvError, normalizeUserEnvPublic } from "../utils/user-env-utils"
import { rememberNativeVisionProbe } from "../components/vision-reuse-logic"
import { normalizeInboundLogEvent } from "../log-event-normalize"
import { humanizeSidepanelGateError } from "../utils/gate-error-copy"
import { newTempUserMessageId } from "../../utils/temp-message-id"

import { normalizeConfig } from "../utils/normalize-config"
export { normalizeConfig }

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function requestInitialSidePanelData(
  sendMessage: (message: object) => void,
  initializedRef: { current: boolean },
): boolean {
  if (initializedRef.current) return false
  initializedRef.current = true
  sendMessage({ type: "thread.list" })
  sendMessage({ type: "skill.list" })
  sendMessage({ type: "knowledge.list" })
  sendMessage({ type: "config.get" })
  sendMessage({ type: "mcp.list" })
  // ADR-019: redacted secrets snapshot (auth required; no plaintext).
  sendMessage({ type: "user_env.list" })
  // ADR-021: hydrate unattended grant for StatusRail chip
  sendMessage({ type: "security.unattended.status" })
  return true
}

/** Module-level timer so multiple status messages replace (not stack) TTL clears. */
let unattendedExpireTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Schedule local UI clear when process grant hard TTL elapses (Correctness F7).
 * Companion is still SoT — we re-fetch status at expiry; do not invent armed:true.
 */
export function scheduleUnattendedExpireClear(
  expiresAt: number | null | undefined,
  armed: boolean,
  dispatch: (action: { type: "SET_UNATTENDED_STATUS"; unattended: {
    armed: boolean
    armedAt: number | null
    expiresAt: number | null
    includeProtocol: boolean
  } }) => void,
  sendMessage: (message: object) => void,
  now: number = Date.now(),
): void {
  if (unattendedExpireTimer != null) {
    clearTimeout(unattendedExpireTimer)
    unattendedExpireTimer = null
  }
  if (!armed || expiresAt == null || !(expiresAt > now)) {
    if (armed && expiresAt != null && expiresAt <= now) {
      dispatch({
        type: "SET_UNATTENDED_STATUS",
        unattended: { armed: false, armedAt: null, expiresAt: null, includeProtocol: false },
      })
      sendMessage({ type: "security.unattended.status" })
    }
    return
  }
  const delay = Math.min(expiresAt - now, 2_147_000_000) // clamp setTimeout 32-bit
  unattendedExpireTimer = setTimeout(() => {
    unattendedExpireTimer = null
    dispatch({
      type: "SET_UNATTENDED_STATUS",
      unattended: { armed: false, armedAt: null, expiresAt: null, includeProtocol: false },
    })
    sendMessage({ type: "security.unattended.status" })
  }, delay)
}

/**
 * Stream/error gate for multi-agent UI isolation (P1 fail-closed).
 * - Missing/empty thread_id → do NOT apply (legacy path polluted active thread).
 * - When set, only apply if it matches the currently active thread.
 * Pure helper for unit tests (stream-thread-gate).
 */
export function shouldApplyStreamEvent(
  msgThreadId: string | undefined | null,
  activeThreadId: string | null | undefined,
): boolean {
  if (msgThreadId == null || msgThreadId === "") return false
  if (activeThreadId == null || activeThreadId === "") return false
  return msgThreadId === activeThreadId
}

/**
 * file.uploaded panel-chrome gate (F3). The composer chip clear is a global UI
 * signal with no thread ownership — the listener dispatches it unconditionally,
 * before this gate, so it fires even when the user switched threads mid-upload
 * (otherwise the sent chips stick and leak into the next send on another
 * thread). Only panel chrome (status/processing) is gated here.
 * Pure helper for unit tests (stream-thread-gate).
 */
export function fileUploadedApplyToPanel(
  msgThreadId: string | undefined | null,
  activeThreadId: string | null | undefined,
): boolean {
  return shouldApplyStreamEvent(msgThreadId, activeThreadId)
}

/** Cap on preview thumbnail base64 (≈300KB binary); same value as companion. */
const MAX_PREVIEW_B64_CHARS = 400_000

/** Sanitize chat.user / history attachment metadata (image thumbs only). */
export function parseChatUserAttachments(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: MessageAttachment[] = []
  for (const a of raw) {
    if (!a || typeof a !== "object") continue
    const rec = a as Record<string, unknown>
    if (rec.kind !== "image") continue
    if (typeof rec.name !== "string" || typeof rec.mime !== "string") continue
    const name = rec.name.trim().slice(0, 200)
    const mime = rec.mime.trim().slice(0, 64)
    if (!name || !mime) continue
    const att: MessageAttachment = { kind: "image", name, mime }
    if (typeof rec.sha256 === "string" && rec.sha256) att.sha256 = rec.sha256.slice(0, 128)
    if (typeof rec.bytes === "number" && Number.isFinite(rec.bytes) && rec.bytes >= 0) {
      att.bytes = rec.bytes
    }
    if (typeof rec.preview_jpeg_b64 === "string" && rec.preview_jpeg_b64) {
      att.preview_jpeg_b64 = rec.preview_jpeg_b64.slice(0, MAX_PREVIEW_B64_CHARS)
    }
    if (typeof rec.dest_host === "string" && rec.dest_host.trim()) {
      att.dest_host = rec.dest_host.replace(/[\n\r]/g, "").trim().slice(0, 200)
    }
    out.push(att)
  }
  return out.length ? out : undefined
}

/**
 * Hydrate path (thread.messages / thread.forked): history arrives wholesale from
 * companion, so run each message's attachments through the same sanitizer as the
 * live chat.user echo (F4). Messages without attachments pass through untouched.
 */
export function sanitizeHydratedMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return []
  return raw.map((m) => {
    if (!m || typeof m !== "object" || (m as Message).attachments == null) {
      return m as Message
    }
    return {
      ...(m as Message),
      attachments: parseChatUserAttachments((m as Message).attachments),
    }
  })
}

export function useWebSocket() {
  const { state, dispatch } = useAgentStore()
  const streamingRef = useRef("")
  const initializedRef = useRef(false)
  const activeThreadRef = useRef<string | null>(null)
  // Tracks an in-flight "auto-create blank thread" request so we don't fire a
  // second one before the first resolves. Reset whenever a non-empty thread.list
  // arrives (so a future empty state — e.g. after user deletes everything —
  // will auto-create again) or when thread.created acknowledges the request.
  const creatingBlankThreadRef = useRef(false)

  // Keep refs in sync (listener is mount-once — never close over render state)
  activeThreadRef.current = state.activeThreadId
  const pendingUploadsRef = useRef(state.pendingUploads)
  pendingUploadsRef.current = state.pendingUploads

  // P0-B: clear accumulated stream buffer on thread switch so late tokens from
  // the previous thread cannot reappear via chat.done → ADD_MESSAGE.
  const reasoningRef = useRef("")
  useEffect(() => {
    streamingRef.current = ""
    reasoningRef.current = ""
  }, [state.activeThreadId])

  useEffect(() => {
    const requestInitialData = () => requestInitialSidePanelData((message) => {
      chrome.runtime.sendMessage(message)
    }, initializedRef)
    // Restore send shortcut preference
    chrome.storage.local.get(
      [
        "sendShortcut",
        "voiceInputEnabled",
        "voice_privacy_ack_v1",
        "voice_privacy_ack_v2",
        "voice_privacy_ack_v3",
        "voiceDictationMode",
        "asrRefinerEnabled",
        "dictationHotkeyEnabled",
        "dictationHotkeyChord",
        "voiceRealtimeStreaming",
        "cmspark.ui.show_reasoning",
        "cmspark.ui.export_include_reasoning",
      ],
      (result) => {
        if (result.sendShortcut) {
          dispatch({ type: "SET_SEND_SHORTCUT", shortcut: result.sendShortcut })
        }
        if (typeof result.voiceInputEnabled === "boolean") {
          dispatch({ type: "SET_VOICE_INPUT_ENABLED", enabled: result.voiceInputEnabled })
        }
        const srm = result["cmspark.ui.show_reasoning"]
        if (srm === "always_collapsed" || srm === "auto_live" || srm === "always_open") {
          dispatch({ type: "SET_SHOW_REASONING_MODE", mode: srm })
        }
        if (typeof result["cmspark.ui.export_include_reasoning"] === "boolean") {
          dispatch({
            type: "SET_EXPORT_INCLUDE_REASONING",
            enabled: result["cmspark.ui.export_include_reasoning"],
          })
        }
        if (result.voice_privacy_ack_v1 === true) {
          dispatch({ type: "SET_VOICE_PRIVACY_ACK_V1", ack: true })
        }
        if (result.voice_privacy_ack_v2 === true) {
          dispatch({ type: "SET_VOICE_PRIVACY_ACK_V2", ack: true })
        }
        if (result.voice_privacy_ack_v3 === true) {
          dispatch({ type: "SET_VOICE_PRIVACY_ACK_V3", ack: true })
        }
        if (result.voiceDictationMode === "continuous" || result.voiceDictationMode === "classic") {
          dispatch({ type: "SET_VOICE_DICTATION_MODE", mode: result.voiceDictationMode })
        }
        if (typeof result.asrRefinerEnabled === "boolean") {
          dispatch({ type: "SET_ASR_REFINER_ENABLED", enabled: result.asrRefinerEnabled })
        }
        if (typeof result.dictationHotkeyEnabled === "boolean") {
          dispatch({ type: "SET_DICTATION_HOTKEY_ENABLED", enabled: result.dictationHotkeyEnabled })
        }
        if (typeof result.dictationHotkeyChord === "string" && result.dictationHotkeyChord.trim()) {
          dispatch({ type: "SET_DICTATION_HOTKEY_CHORD", chord: result.dictationHotkeyChord.trim() })
        }
        if (typeof result.voiceRealtimeStreaming === "boolean") {
          dispatch({
            type: "SET_VOICE_REALTIME_STREAMING",
            enabled: result.voiceRealtimeStreaming,
          })
        }
      },
    )
    // Popup "设置" button sets this flag before opening the side panel + closing
    // itself. Read it once on mount and pop the settings view, then clear so a
    // later sidepanel reopen (without going through popup) doesn't auto-open.
    chrome.storage.local.get("openSettingsOnSpawn", (result) => {
      if (result.openSettingsOnSpawn) {
        chrome.storage.local.remove("openSettingsOnSpawn")
        dispatch({ type: "SET_SETTINGS_OPEN", open: true })
      }
    })

    // Listen for messages from background (broadcast via chrome.runtime.sendMessage).
    // Note: when another extension page (e.g. Cockpit) is open, chrome.runtime.sendMessage
    // from Side Panel also delivers to that page. Only handle inbound companion/SW
    // broadcasts here — never claim the response channel (do not return true).
    const messageListener = (msg: any) => {
      if (!msg || typeof msg.type !== "string") return false
      // Outbound UI→SW commands (armed via Settings etc.) must not be processed here.
      // Background is the sole handler; a throw in this listener can break the response path.
      if (
        msg.type === "security.unattended.arm" ||
        msg.type === "security.unattended.disarm" ||
        msg.type === "security.unattended.status" ||
        msg.type === "config.set" ||
        msg.type === "config.get"
      ) {
        return false
      }
      try {
      switch (msg.type) {
        case "chat.token": {
          // P0-B: ignore stream events for non-active threads
          const tokenTid =
            typeof msg.thread_id === "string" && msg.thread_id ? msg.thread_id : ""
          if (tokenTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: tokenTid, busy: true })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          streamingRef.current = msg.content
          dispatch({ type: "SET_STREAMING", content: msg.content })
          // Answer tokens mean parse/status phase is done
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          break
        }

        case "chat.reasoning": {
          const reasonTid =
            typeof msg.thread_id === "string" && msg.thread_id ? msg.thread_id : ""
          if (reasonTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: reasonTid, busy: true })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          const r =
            typeof msg.content === "string"
              ? msg.content
              : typeof msg.text === "string"
                ? msg.text
                : ""
          reasoningRef.current = r
          dispatch({ type: "SET_STREAMING_REASONING", content: r })
          dispatch({ type: "SET_PROCESSING", isProcessing: true })
          // Live thinking replaces generic / parse status labels
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          break
        }

        case "chat.user": {
          // SW rebroadcast + companion persist echo (message_id + attachments).
          // Optimistic panel bubble uses a temp id; ADD_MESSAGE adopts the
          // persisted id and merges attachments (DoD #13).
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          const content = typeof msg.content === "string" ? msg.content : ""
          const attachments = parseChatUserAttachments(msg.attachments)
          if (!content.trim() && !attachments?.length) break
          const threadId =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          const id =
            (typeof msg.message_id === "string" && msg.message_id) ||
            newTempUserMessageId(threadId)
          // F1: persist echo correlates the optimistic bubble (temp id from the
          // chat.create/file.upload clientMessageId) so the store adopts by
          // exact id instead of last-temp positional guessing.
          const clientMessageId =
            (typeof msg.client_message_id === "string" && msg.client_message_id) || undefined
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id,
              thread_id: threadId,
              role: "user",
              content,
              created_at:
                (typeof msg.created_at === "string" && msg.created_at) ||
                new Date().toISOString(),
              ...(attachments ? { attachments } : {}),
              ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
            },
          })
          if (threadId) {
            dispatch({ type: "SET_THREAD_BUSY", threadId, busy: true })
          }
          dispatch({ type: "SET_PROCESSING", isProcessing: true })
          break
        }

        case "chat.done": {
          const doneThreadId =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current
          if (doneThreadId) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: doneThreadId, busy: false })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          const content = streamingRef.current
          const reasoning =
            (typeof msg.reasoning_content === "string" && msg.reasoning_content) ||
            reasoningRef.current ||
            ""
          streamingRef.current = ""
          reasoningRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_STREAMING_REASONING", content: "" })
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          if (doneThreadId && (content || reasoning)) {
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                // Prefer the companion's persisted message id (echoed in chat.done) so the
                // UI id matches what's stored — anchor-based features (per-message export)
                // then work on the just-received response without a thread reload. Fall back
                // to a client id only if the companion didn't echo one.
                id: msg.message_id || `${doneThreadId}_assistant_${Date.now()}`,
                thread_id: doneThreadId,
                role: "assistant",
                content: content || "",
                ...(reasoning ? { reasoning_content: reasoning } : {}),
                created_at: new Date().toISOString(),
              },
            })
          }
          break
        }

        case "chat.aborted": {
          const abortTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current
          if (abortTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: abortTid, busy: false })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          streamingRef.current = ""
          reasoningRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_STREAMING_REASONING", content: "" })
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `${activeThreadRef.current}_abort_${Date.now()}`,
              thread_id: activeThreadRef.current || "",
              role: "assistant",
              content: "⏹ 已停止生成",
              created_at: new Date().toISOString(),
            },
          })
          break
        }

        case "log.event": {
          // Wire shape is top-level { source, level, event, data } (see
          // buildLogEventPayload). Old code wrongly read msg.data.level → live
          // log showed "unknown" (dual-review log-event-echo-loop-impl nit).
          const entry = normalizeInboundLogEvent(msg)
          if (entry) {
            dispatch({ type: "ADD_LOG", entry })
          }
          break
        }

        case "chat.error": {
          // P0-B: gate on thread_id; clear streamingRef so residual tokens are
          // not later ADD_MESSAGE'd as a completed assistant via chat.done.
          const errTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current
          if (errTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: errTid, busy: false })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          streamingRef.current = ""
          reasoningRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_STREAMING_REASONING", content: "" })
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          {
            // Soften god-mode-orthogonal gates (workspace / scene) — never show
            // raw "安全阻断/不可恢复" for setup steps the user can fix in UI.
            const raw = typeof msg.error === "string" ? msg.error : "出错了"
            const friendly = humanizeSidepanelGateError(raw)
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `${activeThreadRef.current}_error_${Date.now()}`,
                thread_id: activeThreadRef.current || "",
                role: "assistant",
                content: friendly,
                created_at: new Date().toISOString(),
              },
            })
          }
          break
        }

        case "chat.assistant": {
          // Mid-loop assistant committed by companion (before tools run). Must land
          // reasoning/content into the transcript — tool.start alone only adds shell cards.
          const asstTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          if (asstTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: asstTid, busy: true })
          }
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          const asstContent = typeof msg.content === "string" ? msg.content : ""
          const asstReasoning =
            typeof msg.reasoning_content === "string" ? msg.reasoning_content : ""
          // Prefer companion payload; fall back to live stream if echo omitted fields.
          const content = asstContent || streamingRef.current || ""
          const reasoning = asstReasoning || reasoningRef.current || ""
          streamingRef.current = ""
          reasoningRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_STREAMING_REASONING", content: "" })
          if (asstTid && (content || reasoning)) {
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id:
                  (typeof msg.message_id === "string" && msg.message_id) ||
                  `${asstTid}_assistant_mid_${Date.now()}`,
                thread_id: asstTid,
                role: "assistant",
                content,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
                created_at: new Date().toISOString(),
              },
            })
          }
          break
        }

        case "tool.start": {
          const toolTid =
            typeof msg.thread_id === "string" && msg.thread_id
              ? msg.thread_id
              : ""
          // P1 CORR-M05: missing thread_id fail-closed (no legacy active fallback)
          if (!toolTid) break
          dispatch({ type: "SET_THREAD_BUSY", threadId: toolTid, busy: true })
          if (!shouldApplyStreamEvent(toolTid, activeThreadRef.current)) break
          // Intermediate assistant stream ends when tools begin. Commit live
          // reasoning/content into a historical row first — otherwise only the
          // shell/tool card remains after the turn (user report on #h1yi2w).
          // Prefer chat.assistant from companion when present; this is a fallback
          // for older companions or races where tools start before the echo.
          if (streamingRef.current || reasoningRef.current) {
            const midContent = streamingRef.current || ""
            const midReasoning = reasoningRef.current || ""
            streamingRef.current = ""
            reasoningRef.current = ""
            dispatch({ type: "SET_STREAMING", content: "" })
            dispatch({ type: "SET_STREAMING_REASONING", content: "" })
            if (midContent || midReasoning) {
              dispatch({
                type: "ADD_MESSAGE",
                message: {
                  id: `${toolTid}_assistant_mid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  thread_id: toolTid,
                  role: "assistant",
                  content: midContent,
                  ...(midReasoning ? { reasoning_content: midReasoning } : {}),
                  created_at: new Date().toISOString(),
                },
              })
            }
          }
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: msg.tool_call_id,
              thread_id: toolTid,
              role: "tool",
              content: "",
              tool_calls: [{
                id: msg.tool_call_id,
                tool_name: msg.tool_name,
                params: msg.params || {},
                result: null,
                status: "running",
              }],
              created_at: new Date().toISOString(),
            },
          })
          if (typeof msg.tool_name === "string" && isBrowserTool(msg.tool_name)) {
            dispatch({ type: "NOTE_BROWSER_TOOL" })
          }
          break
        }

        case "tool.result": {
          const resTid =
            typeof msg.thread_id === "string" && msg.thread_id ? msg.thread_id : ""
          if (resTid && !shouldApplyStreamEvent(resTid, activeThreadRef.current)) break
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: {
              result: msg.result,
              status: msg.result?.success ? "success" : "error",
            },
          })
          if (typeof msg.tool_name === "string" && isBrowserTool(msg.tool_name)) {
            dispatch({ type: "NOTE_BROWSER_TOOL" })
          }
          break
        }

        case "tool.progress": {
          // #au4dch ST-2: optional live tails; ignore if not for active thread
          if (!shouldApplyStreamEvent(msg.thread_id, activeThreadRef.current)) break
          const id = typeof msg.tool_call_id === "string" ? msg.tool_call_id : ""
          if (!id) break
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: id,
            toolCallId: id,
            updates: {
              progress_elapsed_ms:
                typeof msg.elapsed_ms === "number" ? msg.elapsed_ms : undefined,
              progress_stdout_tail:
                typeof msg.stdout_tail === "string" ? msg.stdout_tail : undefined,
              progress_stderr_tail:
                typeof msg.stderr_tail === "string" ? msg.stderr_tail : undefined,
            },
          })
          // Keep busy only while a matching tool is still running (N1 race after chat.done)
          break
        }

        case "tool.vision_start": {
          const vTid =
            typeof msg.thread_id === "string" && msg.thread_id ? msg.thread_id : ""
          if (vTid && !shouldApplyStreamEvent(vTid, activeThreadRef.current)) break
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: { vision_status: "analyzing" },
          })
          break
        }

        case "tool.vision_done": {
          const vdTid =
            typeof msg.thread_id === "string" && msg.thread_id ? msg.thread_id : ""
          if (vdTid && !shouldApplyStreamEvent(vdTid, activeThreadRef.current)) break
          dispatch({
            type: "UPDATE_TOOL_CALL",
            messageId: msg.tool_call_id,
            toolCallId: msg.tool_call_id,
            updates: {
              vision_status: msg.error ? "error" : (msg.cached ? "cached" : "done"),
              vision_latency_ms: msg.latency_ms,
            },
          })
          break
        }

        case "config.testVisionResult":
          dispatch({
            type: "SET_TEST_VISION_RESULT",
            result: msg.ok
              ? `视觉模型连接成功 ✓ (${msg.model || ""})`
              : `视觉模型连接失败: ${msg.error || "未知错误"}`,
          })
          break

        case "config.testResult":
          dispatch({
            type: "SET_TEST_RESULT",
            result: msg.ok
              ? `连接成功 ✓${
                  msg.native_vision === true
                    // Probe only proves the endpoint accepted an image part
                    // (HTTP 200) — not true multimodal quality (M3-copy).
                    ? " · 端点接受图片输入（截图/附图走主模型）"
                    : msg.native_vision === false
                      ? " · 未探测到看图（截图仍走视觉轨，可在下方强制开启）"
                      : ""
                }`
              : `连接失败: ${msg.error || "未知错误"}`,
          })
          if (typeof msg.native_vision === "boolean") {
            dispatch({ type: "SET_CONFIG", config: { native_vision_detected: msg.native_vision } })
            // Keyed probe cache (M1): only accept the bit when companion echoes
            // the tested {base_url, model_name}; the unkeyed session flag above
            // stays display-only and never feeds resolveNativeVision.
            if (typeof msg.base_url === "string" && typeof msg.model_name === "string") {
              rememberNativeVisionProbe(msg.base_url, msg.model_name, msg.native_vision)
            }
          }
          break

        case "openSettings":
          // Popup "设置" button opened the side panel — land on the settings view.
          dispatch({ type: "SET_SETTINGS_OPEN", open: true })
          break

        case "config.updated":
          dispatch({ type: "SET_CONFIG", config: normalizeConfig(msg.config) })
          if (msg.source === "companion" && msg.config?.llm) {
            dispatch({ type: "SET_COMPANION_CONFIG", config: normalizeConfig(msg.config) as any })
          }
          break

        case "security.confirmation.request":
          dispatch({
            type: "ADD_SECURITY_CONFIRMATION",
            request: {
              confirmation_id: msg.confirmation_id,
              tool_name: msg.tool_name,
              dangerous_apis: Array.isArray(msg.dangerous_apis) ? msg.dangerous_apis : [],
              code_preview: msg.code_preview || "",
              timeout_ms: msg.timeout_ms,
              requested_at: msg.requested_at,
              risk_score: msg.risk_score ?? 0,
              risk_category: msg.risk_category ?? "unknown",
              risk_level: msg.risk_level ?? "high",
              auto_confirm_eligible: msg.auto_confirm_eligible ?? false,
              defense_layer: msg.defense_layer,
              relevant_domains: Array.isArray(msg.relevant_domains) ? msg.relevant_domains : [],
              relevant_apps: Array.isArray(msg.relevant_apps) ? msg.relevant_apps : [],
              nonce_challenge: typeof msg.nonce_challenge === "string" ? msg.nonce_challenge : undefined,
              // 坐标 computer-use(WP4):L2 标注截图 + 三段式 caption + P1 完整预览
              // 文本(绕过 code_preview 的 1200 截断)——全部可选,旧 companion 不下发。
              preview_image: typeof msg.preview_image === "string" ? msg.preview_image : undefined,
              preview_caption: typeof msg.preview_caption === "string" ? msg.preview_caption : undefined,
              full_preview: typeof msg.full_preview === "string" ? msg.full_preview : undefined,
              // ADR-015 multi-agent Confirm Center
              worker_id: typeof msg.worker_id === "string" ? msg.worker_id : undefined,
              parent_thread_id: typeof msg.parent_thread_id === "string" ? msg.parent_thread_id : undefined,
              orchestrator_run_id: typeof msg.orchestrator_run_id === "string" ? msg.orchestrator_run_id : undefined,
              worker_role_label: typeof msg.worker_role_label === "string" ? msg.worker_role_label : undefined,
              tab_id: typeof msg.tab_id === "number" ? msg.tab_id : undefined,
              offer_enterprise_session_trust: msg.offer_enterprise_session_trust === true,
            },
          })
          // Refresh fleet strip when confirms arrive (pending badge + worker map)
          chrome.runtime.sendMessage({ type: "fleet.status" })
          break

        case "security.unattended.status": {
          const armed = msg.armed === true
          const expiresAt =
            typeof msg.expiresAt === "number"
              ? msg.expiresAt
              : typeof msg.expires_at === "number"
                ? msg.expires_at
                : null
          const unattended = {
            armed,
            armedAt: typeof msg.armedAt === "number" ? msg.armedAt : typeof msg.armed_at === "number" ? msg.armed_at : null,
            expiresAt,
            includeProtocol:
              msg.includeProtocol === true || msg.include_protocol === true,
          }
          dispatch({
            type: "SET_UNATTENDED_STATUS",
            unattended,
          })
          scheduleUnattendedExpireClear(expiresAt, armed, dispatch, (message) => {
            chrome.runtime.sendMessage(message)
          })
          break
        }

        case "fleet.status":
        case "fleet.stop_all_result":
        case "tab.force_release_result": {
          const snap = msg.type === "fleet.status" ? msg : msg.fleet
          if (snap && Array.isArray(snap.workers)) {
            dispatch({
              type: "SET_FLEET",
              fleet: {
                at: snap.at,
                workers: snap.workers,
                locks: Array.isArray(snap.locks) ? snap.locks : [],
                worker_count: typeof snap.worker_count === "number" ? snap.worker_count : snap.workers.length,
                lock_count: typeof snap.lock_count === "number" ? snap.lock_count : (snap.locks?.length || 0),
                open_intent_count:
                  typeof snap.open_intent_count === "number" ? snap.open_intent_count : 0,
                open_intents_by_run:
                  snap.open_intents_by_run &&
                  typeof snap.open_intents_by_run === "object" &&
                  !Array.isArray(snap.open_intents_by_run)
                    ? Object.fromEntries(
                        Object.entries(snap.open_intents_by_run as Record<string, unknown>).filter(
                          ([k, v]) => typeof k === "string" && typeof v === "number",
                        ) as Array<[string, number]>,
                      )
                    : undefined,
                worst_status: snap.worst_status || "none",
                orchestrator_runs: Array.isArray(snap.orchestrator_runs) ? snap.orchestrator_runs : [],
                llm_active_thread_ids: Array.isArray(snap.llm_active_thread_ids)
                  ? snap.llm_active_thread_ids.filter((x: unknown) => typeof x === "string")
                  : [],
              },
            })
          }
          break
        }
        case "board.get":
        case "board.add_hint_result":
          // BoardPanel listens via sendMessage callback; no store field required
          break
        case "worker.updated":
          chrome.runtime.sendMessage({ type: "fleet.status" })
          break

        case "security.confirmation.resolved":
        case "security.confirmation.expired":
          dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: msg.confirmation_id })
          break

        case "thread.created": {
          // Upsert: don't duplicate if already added locally
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          // In-flight auto-create blank thread request acknowledged.
          creatingBlankThreadRef.current = false
          // Auto-select when:
          //  - quick action explicitly requests it, OR
          //  - no thread is currently active (fresh load: our new blank thread)
          if ((msg.auto_select || !activeThreadRef.current) && activeThreadRef.current !== msg.thread.id) {
            dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread.id })
            dispatch({ type: "SET_MESSAGES", messages: [] })
          }
          break
        }

        case "thread.updated": {
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          // Sync skill_selection_mode if this is the active thread
          if (msg.thread?.id === activeThreadRef.current && msg.thread?.skill_selection_mode) {
            dispatch({ type: "SET_SKILL_SELECTION_MODE", mode: msg.thread.skill_selection_mode })
          }
          // Sync knowledge_selection_mode if this is the active thread
          if (msg.thread?.id === activeThreadRef.current && msg.thread?.knowledge_selection_mode) {
            dispatch({ type: "SET_KNOWLEDGE_SELECTION_MODE", mode: msg.thread.knowledge_selection_mode })
          }
          break
        }
        case "thread.context_compacted": {
          // Dual-truth: model context was compressed; UI history stays full (F-UX4/F-S6).
          const tid =
            typeof msg.thread_id === "string" && msg.thread_id
              ? msg.thread_id
              : activeThreadRef.current
          if (tid) {
            dispatch({
              type: "SET_CONTEXT_COMPACTED",
              threadId: tid,
              droppedCount: Number(msg.dropped_count) || 0,
              tokensBefore: Number(msg.tokens_before) || 0,
              tokensAfter: Number(msg.tokens_after) || 0,
              mode:
                msg.mode === "h1" ? "h1" : msg.mode === "m2" ? "m2" : "m1",
              rollingSummary:
                typeof msg.rolling_summary === "string" ? msg.rolling_summary : undefined,
              handoff:
                msg.handoff && typeof msg.handoff === "object" ? msg.handoff : undefined,
            })
          }
          break
        }
        case "thread.context_compact_prompt": {
          // prompt mode: over budget but did not drop — surface warning + deep-link affordance
          const tid =
            typeof msg.thread_id === "string" && msg.thread_id
              ? msg.thread_id
              : activeThreadRef.current
          if (tid) {
            dispatch({
              type: "SET_CONTEXT_COMPACTED",
              threadId: tid,
              droppedCount: 0,
              tokensBefore: Number(msg.tokens_before) || 0,
              tokensAfter: Number(msg.tokens_after) || 0,
            })
          }
          break
        }
        case "thread.deleted": {
          dispatch({ type: "REMOVE_THREAD", threadId: msg.thread_id })
          break
        }
        case "thread.trashed": {
          // Soft-delete: remove from active list (server no longer returns it)
          dispatch({ type: "REMOVE_THREAD", threadId: msg.thread_id })
          break
        }
        case "thread.restored": {
          chrome.runtime.sendMessage({ type: "thread.list" })
          break
        }
        case "thread.cleanup_suggestions": {
          // ThreadList listens via custom event for in-panel cleanup UI
          try {
            window.dispatchEvent(
              new CustomEvent("cmspark:cleanup_suggestions", {
                detail: {
                  suggestions: msg.suggestions || [],
                  count: msg.count || 0,
                },
              }),
            )
          } catch {
            /* ignore */
          }
          break
        }
        case "thread.batch_deleted": {
          const okIds: string[] = Array.isArray(msg.ok)
            ? msg.ok
            : Array.isArray(msg.deleted_ids)
              ? msg.deleted_ids
              : []
          if (okIds.length > 0) {
            // Broadcasts already fire thread.deleted per id; this is a
            // belt-and-suspenders state sync + user log.
            dispatch({ type: "REMOVE_THREADS", threadIds: okIds })
          }
          const failed = Array.isArray(msg.failed) ? msg.failed : []
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: failed.length ? "warn" : "info",
              source: "extension",
              event: "batch_delete_threads",
              data: {
                deleted_count: okIds.length,
                failed_count: failed.length,
                failed,
              },
            },
          })
          break
        }
        case "thread.batch_auto_title.completed": {
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: "info",
              source: "extension",
              event: "batch_auto_title",
              data: {
                updated_count: msg.updated_count || 0,
                updated: msg.updated || [],
                skipped: msg.skipped || [],
              },
            },
          })
          // Titles also arrive via thread.updated broadcasts; refresh list for previews.
          chrome.runtime.sendMessage({ type: "thread.list" })
          break
        }
        case "thread.digest_updated": {
          // Progress N/M advances via UPSERT_THREAD → ThreadList threads effect (no window event).
          if (msg.thread) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          } else if (msg.thread_id) {
            // Fallback: full list refresh if companion omitted thread payload
            chrome.runtime.sendMessage({ type: "thread.list" })
          }
          break
        }
        case "thread.related": {
          // Wave C: optional companion related ranking (UI also has local mirror for instant paint)
          try {
            window.dispatchEvent(
              new CustomEvent("cmspark:thread_related", {
                detail: {
                  thread_id: msg.thread_id,
                  related: Array.isArray(msg.related) ? msg.related : [],
                },
              }),
            )
          } catch {
            /* ignore */
          }
          break
        }
        case "thread.extract_digest.completed": {
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: Array.isArray(msg.failed) && msg.failed.length ? "warn" : "info",
              source: "extension",
              event: "extract_digest",
              data: {
                extracted_count: msg.extracted_count || 0,
                ok: msg.ok || [],
                failed: msg.failed || [],
              },
            },
          })
          // Wave A-7: clear batch spinners for ok+failed (S5 — not fixed 60s)
          try {
            window.dispatchEvent(
              new CustomEvent("cmspark:extract_digest_completed", {
                detail: {
                  ok: msg.ok || [],
                  failed: msg.failed || [],
                  extracted_count: msg.extracted_count || 0,
                  batch_id: typeof msg.batch_id === "string" ? msg.batch_id : undefined,
                },
              }),
            )
          } catch {
            /* ignore */
          }
          // Belt: re-pull list so tags survive if a digest_updated was missed
          // (multi-peer / race). Disk is source of truth after extract.
          chrome.runtime.sendMessage({ type: "thread.list" })
          break
        }
        case "thread.cleanup_empty.completed": {
          const count = msg.deleted_count || 0
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: "info",
              source: "extension",
              event: "cleanup_empty_threads",
              data: { deleted_count: count, deleted_ids: msg.deleted_ids || [] },
            },
          })
          // Refresh thread list to stay in sync after bulk deletion.
          chrome.runtime.sendMessage({ type: "thread.list" })
          break
        }
        case "thread.title_generated": {
          if (msg.thread) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          }
          dispatch({
            type: "ADD_LOG",
            entry: {
              ts: new Date().toISOString(),
              level: "info",
              source: "extension",
              event: "thread_title_generated",
              data: { thread_id: msg.thread_id, alias: msg.thread?.alias },
            },
          })
          break
        }
        case "thread.forked": {
          dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread.id })
          dispatch({ type: "SET_MESSAGES", messages: sanitizeHydratedMessages(msg.messages) })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          break
        }

        case "thread.list": {
          // Cockpit + Panel both call useWebSocket. chrome.runtime.sendMessage
          // delivers the *request* `{type:"thread.list"}` to the other page.
          // That payload has no `threads` array — treating it as [] used to
          // auto-create a blank thread (and steal the active conversation)
          // whenever 确认台 opened.
          if (!Array.isArray(msg.threads)) break
          // Dual-review B2: trash-scoped lists must not auto-create blank
          // threads or force-select a different active chat.
          const listScope =
            msg.list_scope ||
            (msg.only_trashed ? "trash" : msg.include_trashed ? "all" : "active")
          const isScopedList = listScope === "trash" || listScope === "all"
          const incoming = msg.threads

          // only_trashed responses: ignore for global store (ThreadList uses
          // include_trashed:true which returns active+trashed together).
          if (listScope === "trash") {
            creatingBlankThreadRef.current = false
            break
          }

          dispatch({
            type: "SET_THREADS",
            threads: incoming,
          })

          if (isScopedList) {
            // include_trashed: update rows only — keep activeThreadId as-is
            // (SET_THREADS preserves active if still present among active rows).
            creatingBlankThreadRef.current = false
            break
          }

          if (incoming.length === 0) {
            // Empty state — auto-create a blank thread. Critically, do the UI
            // update optimistically (ADD_THREAD + SET_ACTIVE_THREAD) BEFORE
            // messaging companion, so the input becomes usable immediately even
            // when WS is still connecting or slow. Without this, the user saw
            // "请先创建或选择一个线程" until the round-trip completed — and if WS
            // was down, indefinitely. The companion will UPSERT the same id when
            // it acks thread.created; the in-flight ref prevents dup creates.
            if (!creatingBlankThreadRef.current) {
              creatingBlankThreadRef.current = true
              const id = generateShortId()
              const now = new Date().toISOString()
              dispatch({
                type: "ADD_THREAD",
                thread: {
                  id,
                  alias: "",
                  created_at: now,
                  updated_at: now,
                  config_override: {} as any,
                  tool_whitelist: null,
                  pinned_tabs: [],
                  active_skill_ids: [],
                },
              })
              dispatch({ type: "SET_ACTIVE_THREAD", threadId: id })
              dispatch({ type: "SET_MESSAGES", messages: [] })
              chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
            }
          } else {
            // Reset so the NEXT time we hit an empty list (after a delete/cleanup),
            // we'll auto-create again.
            creatingBlankThreadRef.current = false
            // Has threads but none active (e.g. fresh load where activeThreadId
            // never got set) — auto-select the most recent one. Without this the
            // input placeholder still says "请先创建或选择一个线程" even though
            // threads exist.
            if (!activeThreadRef.current) {
              const first = incoming[0]
              dispatch({ type: "SET_ACTIVE_THREAD", threadId: first.id })
              dispatch({ type: "SET_MESSAGES", messages: [] })
              chrome.runtime.sendMessage({ type: "thread.select", threadId: first.id })
            }
          }
          break
        }

        case "quickAction.start": {
          const { thread_id, prompt, alias } = msg
          if (!thread_id) break
          // Create thread in UI
          dispatch({
            type: "UPSERT_THREAD",
            thread: {
              id: thread_id,
              alias: alias || "",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              config_override: {} as any,
              tool_whitelist: null,
              pinned_tabs: [],
              active_skill_ids: [],
            },
          })
          dispatch({ type: "SET_ACTIVE_THREAD", threadId: thread_id })
          dispatch({ type: "SET_MESSAGES", messages: [] })
          // Only auto-send message if prompt is non-empty
          if (prompt) {
            dispatch({ type: "SET_PROCESSING", isProcessing: true })
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `${thread_id}_qa_${Date.now()}`,
                thread_id,
                role: "user",
                content: prompt,
                created_at: new Date().toISOString(),
              },
            })
            // Send chat message through background to companion
            chrome.runtime.sendMessage({
              type: "chat.send",
              threadId: thread_id,
              message: prompt,
            })
          }
          break
        }

        case "thread.messages": {
          // P1 CORR-03: never apply history for another thread (stale select race)
          const histTid =
            typeof msg.thread_id === "string" && msg.thread_id
              ? msg.thread_id
              : typeof msg.threadId === "string" && msg.threadId
                ? msg.threadId
                : ""
          if (!shouldApplyStreamEvent(histTid, activeThreadRef.current)) break
          dispatch({ type: "SET_MESSAGES", messages: sanitizeHydratedMessages(msg.messages) })
          break
        }

        case "skill.auto_matched":
          const autoSkills = (msg.skills || []).map((s: any) => s.name).join(", ")
          if (autoSkills) {
            dispatch({
              type: "SET_AUTO_SKILLS",
              names: autoSkills,
            })
          }
          break

        case "skill.list":
          // Same request-echo trap as thread.list — missing array is a command, not a hydrate.
          if (!Array.isArray(msg.skills)) break
          dispatch({
            type: "SET_SKILLS",
            skills: msg.skills,
          })
          break

        case "pack.applied":
        case "pack.unapplied":
        case "workspace.clear_result":
        case "workspace.set_result":
        case "workspace.pick_result":
          // Thread fields updated by companion (mission_pack_id, workspace_root, …)
          // pick_result must be global so /code modal can bind without PacksPanel mounted
          if (msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
            if (msg.type === "workspace.pick_result" && msg.thread.workspace_root) {
              const base = String(msg.thread.workspace_root).split(/[/\\]/).filter(Boolean).pop()
              dispatch({
                type: "SET_PROCESSING_STATUS",
                status: base ? `已绑定工作区 ${base}` : "已绑定工作区",
              })
            } else if (msg.type === "workspace.pick_result" && msg.error) {
              dispatch({
                type: "SET_PROCESSING_STATUS",
                status: `工作区选择失败: ${msg.error}`,
              })
            } else if (msg.type === "workspace.pick_result" && msg.cancelled) {
              dispatch({
                type: "SET_PROCESSING_STATUS",
                status: "未选择工作区",
              })
            }
          } else if (msg.type === "workspace.pick_result") {
            if (msg.error) {
              dispatch({
                type: "SET_PROCESSING_STATUS",
                status: `工作区选择失败: ${msg.error}`,
              })
            } else if (msg.cancelled) {
              dispatch({ type: "SET_PROCESSING_STATUS", status: "未选择工作区" })
            } else {
              chrome.runtime.sendMessage({ type: "thread.list" })
            }
          } else if (msg.type !== "workspace.set_result" && msg.type !== "workspace.clear_result") {
            chrome.runtime.sendMessage({ type: "thread.list" })
          }
          break

        case "modules.updated":
          // PacksPanel listens via chrome.runtime.onMessage; no store field required
          break

        case "netsec.authorized":
          // Per-thread task auth — keep store in sync for PacksPanel badges
          if (msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          }
          break

        case "mcp.list":
        case "mcp.servers.updated":
          if (Array.isArray(msg.servers)) {
            dispatch({ type: "SET_MCP_SERVERS", servers: msg.servers })
          }
          break

        // ADR-019 user-env: list response + set/delete reply + multi-client broadcast
        // all use the same redacted shape. set/delete success is deliberately
        // `user_env.updated` (not a distinct ack) — companion message-router PR-1.
        case "user_env.list":
        case "user_env.updated": {
          if (msg.type === "user_env.list" && !Array.isArray(msg.keys)) break
          const pub = normalizeUserEnvPublic(msg)
          dispatch({ type: "SET_USER_ENV", userEnv: pub })
          if (msg.type === "user_env.updated") {
            dispatch({ type: "SET_USER_ENV_STATUS", status: "已保存" })
          }
          break
        }

        // App tab (WP4) — apps.list response and apps.updated broadcasts
        // (mutations broadcast to all clients; the requester's response also
        // carries warnings/added — update state from both, keep warnings).
        case "apps.list":
          // Same request-echo trap as thread.list — missing array is a command,
          // not a hydrate (echo must not clear entries / flip enabled).
          if (!Array.isArray(msg.entries)) break
          dispatch({
            type: "SET_APPS_STATE",
            enabled: msg.enabled !== false,
            entries: Array.isArray(msg.entries) ? msg.entries : [],
            presets: Array.isArray(msg.presets) ? msg.presets : [],
            // WP6a (Finding 2): companion's process.platform — gates the
            // add/enumerate UI off win32.
            platform: typeof msg.platform === "string" ? msg.platform : undefined,
          })
          break

        case "apps.updated":
          dispatch({
            type: "SET_APPS_STATE",
            enabled: msg.enabled !== false,
            entries: Array.isArray(msg.entries) ? msg.entries : [],
          })
          // Only the apps.add response carries warnings — the broadcast copy
          // doesn't, and must NOT clear the follow-up render area (D8).
          if (Array.isArray(msg.warnings)) {
            dispatch({ type: "SET_APPS_WARNINGS", warnings: msg.warnings })
          }
          break

        case "apps.enumerate.result":
          dispatch({
            type: "SET_APPS_CANDIDATES",
            candidates: Array.isArray(msg.candidates) ? msg.candidates : [],
          })
          break

        // 坐标 computer-use(WP4)— 任务事件折叠(状态机/P4 懒创建在
        // reduceComputerTaskEvent 纯函数里)、急停 ack、全局坐标开关只读镜像。
        case "computer.task.event":
          if (typeof msg.taskId === "string" && typeof msg.event === "string") {
            dispatch({ type: "COMPUTER_TASK_EVENT", event: msg as ComputerTaskEventView })
          }
          break

        case "acp.session.event":
          if (typeof msg.session_id === "string") {
            dispatch({ type: "ACP_SESSION_EVENT", event: msg })
          }
          break

        case "acp.list":
          // Same request-echo trap as thread.list — missing array is a command,
          // not a hydrate (echo must not clear agents / force acpEnabled=false).
          if (!Array.isArray(msg.agents)) break
          dispatch({
            type: "SET_ACP_LIST",
            enabled: msg.enabled === true,
            agents: Array.isArray(msg.agents) ? msg.agents : [],
          })
          break

        // B-lite S1: git one-line for CodingAgentPanel context bar (local listener)
        case "coding.git_status":
        case "acp.workspace_status":
          try {
            window.dispatchEvent(
              new CustomEvent("cmspark:coding.git_status", { detail: msg }),
            )
          } catch {
            /* ignore */
          }
          break

        case "acp.handback.message":
          if (
            msg.message &&
            typeof msg.message === "object" &&
            typeof msg.thread_id === "string" &&
            msg.thread_id === activeThreadRef.current
          ) {
            dispatch({ type: "ADD_MESSAGE", message: msg.message as any })
          }
          if (typeof msg.session_id === "string") {
            dispatch({
              type: "ACP_SESSION_EVENT",
              event: {
                session_id: msg.session_id,
                thread_id: msg.thread_id,
                state: "closed",
                mode: msg.mode,
                pending_diffs: msg.pending_diffs,
                handback: msg.message?.content,
              },
            })
          }
          break

        case "acp.apply_diff.result":
          dispatch({
            type: "SET_PROCESSING_STATUS",
            status: msg.ok
              ? `已应用 ${Array.isArray(msg.applied) ? msg.applied.length : 0} 个文件`
              : `应用 diff 失败: ${msg.error || "unknown"}`,
          })
          break

        case "acp.ui_start.accepted":
          // progress follows acp.session.event — keep status for panel feedback
          dispatch({
            type: "SET_PROCESSING_STATUS",
            status: "编程助手已确认启动…",
          })
          break
        case "acp.ui_start.denied":
          dispatch({
            type: "SET_PROCESSING_STATUS",
            status:
              msg.error === "user_denied"
                ? "编程助手启动已取消"
                : typeof msg.error === "string" && msg.error
                  ? msg.error
                  : "编程助手启动失败",
          })
          break

        case "computer.task.abort.ack":
          dispatch({
            type: "COMPUTER_TASK_ABORT_ACK",
            taskId: typeof msg.task_id === "string" ? msg.task_id : "",
            matched: typeof msg.matched === "number" ? msg.matched : 0,
          })
          break

        case "computer.state":
          dispatch({ type: "SET_COMPUTER_COORDINATE_STATE", enabled: msg.coordinateEnabled === true })
          break

        // WP5-I4 实验层:state/progress/license_required → model 切片(无乐观更新,
        // 字段逐个形状校验;license_required 载荷原文进 store,组件渲染不复制)。
        case "computer.model.state":
          dispatch({
            type: "SET_COMPUTER_MODEL_STATE",
            modelState: {
              modelEnabled: msg.modelEnabled === true,
              licenseAccepted: msg.licenseAccepted === true,
              ...(typeof msg.licenseAcceptedAt === "string" ? { licenseAcceptedAt: msg.licenseAcceptedAt } : {}),
              modelLicenseDeclined: msg.modelLicenseDeclined === true,
              modelStatus: typeof msg.modelStatus === "string" ? msg.modelStatus : "error",
              variant: typeof msg.variant === "string" ? msg.variant : "2b",
              ...(typeof msg.modelFamily === "string" ? { modelFamily: msg.modelFamily } : {}),
              ...(typeof msg.resourceTip === "string" ? { resourceTip: msg.resourceTip } : {}),
              ...(typeof msg.downloadGb === "number" ? { downloadGb: msg.downloadGb } : {}),
              ...(typeof msg.minRamGb === "number" ? { minRamGb: msg.minRamGb } : {}),
              ...(typeof msg.minVramGb === "number" ? { minVramGb: msg.minVramGb } : {}),
              ...(Array.isArray(msg.availableVariants) ? { availableVariants: msg.availableVariants.filter((v: unknown) => typeof v === "string") } : {}),
              ...(typeof msg.downloadSource === "string" ? { downloadSource: msg.downloadSource } : {}),
              ...(typeof msg.downloadSourceResolved === "string" ? { downloadSourceResolved: msg.downloadSourceResolved } : {}),
              ...(typeof msg.downloadSourceReason === "string" ? { downloadSourceReason: msg.downloadSourceReason } : {}),
              ...(typeof msg.recommendedVariant === "string" ? { recommendedVariant: msg.recommendedVariant } : {}),
              ...(typeof msg.readinessSummary === "string" ? { readinessSummary: msg.readinessSummary } : {}),
              ...(Array.isArray(msg.nextSteps) ? { nextSteps: msg.nextSteps.filter((s: unknown) => typeof s === "string") } : {}),
              ...(typeof msg.canDownload === "boolean" ? { canDownload: msg.canDownload } : {}),
              ...(typeof msg.canEnable === "boolean" ? { canEnable: msg.canEnable } : {}),
              ...(typeof msg.downloadBlockReason === "string"
                ? { downloadBlockReason: msg.downloadBlockReason }
                : {}),
              ...(typeof msg.enableBlockReason === "string"
                ? { enableBlockReason: msg.enableBlockReason }
                : {}),
              ...(typeof msg.modelRootDir === "string" ? { modelRootDir: msg.modelRootDir } : {}),
              ...(msg.pythonMode === "isolated" || msg.pythonMode === "system"
                ? { pythonMode: msg.pythonMode }
                : {}),
              ...(typeof msg.pythonPath === "string" ? { pythonPath: msg.pythonPath } : {}),
              ...(typeof msg.uvAvailable === "boolean" ? { uvAvailable: msg.uvAvailable } : {}),
              ...(typeof msg.uvPath === "string" ? { uvPath: msg.uvPath } : {}),
              ...(typeof msg.uvInstallHint === "string"
                ? { uvInstallHint: msg.uvInstallHint }
                : {}),
              ...(typeof msg.pythonInstallHint === "string"
                ? { pythonInstallHint: msg.pythonInstallHint }
                : {}),
              ...(typeof msg.basePythonAvailable === "boolean"
                ? { basePythonAvailable: msg.basePythonAvailable }
                : {}),
              ...(typeof msg.pythonResolution === "string"
                ? { pythonResolution: msg.pythonResolution }
                : {}),
              ...(typeof msg.isolatedEnvExists === "boolean"
                ? { isolatedEnvExists: msg.isolatedEnvExists }
                : {}),
              ...(msg.preflight && typeof msg.preflight === "object" ? { preflight: msg.preflight } : {}),
              ...(typeof msg.sizeBytes === "number" ? { sizeBytes: msg.sizeBytes } : {}),
              ...(typeof msg.error === "string" ? { error: msg.error } : {}),
              faults: typeof msg.faults === "number" ? msg.faults : 0,
            },
          })
          break

        case "computer.model.progress":
          dispatch({
            type: "SET_COMPUTER_MODEL_PROGRESS",
            progress: {
              variant: typeof msg.variant === "string" ? msg.variant : "",
              file: typeof msg.file === "string" ? msg.file : "",
              receivedBytes: typeof msg.receivedBytes === "number" ? msg.receivedBytes : 0,
              totalBytes: typeof msg.totalBytes === "number" ? msg.totalBytes : 0,
            },
          })
          break

        case "computer.model.license_required":
          dispatch({
            type: "SET_COMPUTER_MODEL_LICENSE_DOOR",
            door: {
              licenseText: typeof msg.licenseText === "string" ? msg.licenseText : "",
              notice: typeof msg.notice === "string" ? msg.notice : "",
            },
          })
          break

        // Path B M0: voice.model.state/progress → store mirror (no optimistic UI).
        // Persist lastKnown* for disconnect fail-closed (SoT §7 / ADR-023 L13).
        case "voice.model.state": {
          const VOICE_STATUSES = new Set(["ready", "absent", "incomplete", "downloading"])
          const rawModels = msg.models && typeof msg.models === "object" ? msg.models : {}
          const models: Record<
            string,
            { status: "ready" | "absent" | "incomplete" | "downloading"; bytesOnDisk?: number; error?: string }
          > = {}
          for (const [id, entry] of Object.entries(rawModels as Record<string, unknown>)) {
            if (!entry || typeof entry !== "object") continue
            const e = entry as { status?: unknown; bytesOnDisk?: unknown; error?: unknown }
            const status =
              typeof e.status === "string" && VOICE_STATUSES.has(e.status)
                ? (e.status as "ready" | "absent" | "incomplete" | "downloading")
                : "absent"
            models[id] = {
              status,
              ...(typeof e.bytesOnDisk === "number" ? { bytesOnDisk: e.bytesOnDisk } : {}),
              ...(typeof e.error === "string" ? { error: e.error } : {}),
            }
          }
          const binaryRaw = msg.binary && typeof msg.binary === "object" ? msg.binary : {}
          const binaryObj = binaryRaw as { status?: unknown; path?: unknown; message?: unknown }
          const sttEngine = msg.sttEngine === "local" ? "local" : "browser"
          const localModelId = typeof msg.localModelId === "string" ? msg.localModelId : "medium"
          const modelState = {
            sttEngine: sttEngine as "browser" | "local",
            localModelId,
            recommendedModelId:
              typeof msg.recommendedModelId === "string" ? msg.recommendedModelId : "medium",
            models,
            binary: {
              status: typeof binaryObj.status === "string" ? binaryObj.status : "not_found",
              ...(typeof binaryObj.path === "string" ? { path: binaryObj.path } : {}),
              ...(typeof binaryObj.message === "string" ? { message: binaryObj.message } : {}),
            },
            diskBudgetMB: typeof msg.diskBudgetMB === "number" ? msg.diskBudgetMB : 4096,
            diskUsedMB: typeof msg.diskUsedMB === "number" ? msg.diskUsedMB : 0,
            ...(typeof msg.whisperRoot === "string" ? { whisperRoot: msg.whisperRoot } : {}),
          }
          dispatch({ type: "SET_VOICE_MODEL_STATE", modelState })
          try {
            chrome.storage.local.set({
              lastKnownVoiceEngine: sttEngine,
              lastKnownVoiceModelId: localModelId,
            })
          } catch {
            /* best-effort mirror */
          }
          break
        }

        case "voice.model.progress":
          dispatch({
            type: "SET_VOICE_MODEL_PROGRESS",
            progress: {
              modelId: typeof msg.modelId === "string" ? msg.modelId : "",
              file: typeof msg.file === "string" ? msg.file : "",
              receivedBytes: typeof msg.receivedBytes === "number" ? msg.receivedBytes : 0,
              totalBytes: typeof msg.totalBytes === "number" ? msg.totalBytes : 0,
            },
          })
          break

        case "voice.binary.progress":
          dispatch({
            type: "SET_VOICE_BINARY_PROGRESS",
            progress: {
              phase: typeof msg.phase === "string" ? msg.phase : undefined,
              receivedBytes: typeof msg.receivedBytes === "number" ? msg.receivedBytes : 0,
              totalBytes: typeof msg.totalBytes === "number" ? msg.totalBytes : 0,
              file: typeof msg.file === "string" ? msg.file : undefined,
            },
          })
          break

        case "mcp.server.status_changed": {
          const server = msg.server
          if (server && server.name) {
            dispatch({ type: "UPDATE_MCP_SERVER_STATUS", server })
          }
          break
        }

        case "mcp.tool_call_started":
        case "mcp.tool_call_finished":
          // Best-effort UI hint — no store change required; could log to console.
          // Future enhancement: surface as a transient toast.
          break

        case "knowledge.list":
          if (!Array.isArray(msg.docs)) break
          dispatch({ type: "SET_KNOWLEDGE_DOCS", docs: msg.docs })
          break

        case "knowledge.import_directory_result": {
          if (msg.error) {
            const message = msg.error === "cancelled" ? "已取消选择文件夹" : `导入失败：${msg.error}`
            dispatch({ type: "SET_KNOWLEDGE_IMPORT_STATUS", status: { ok: false, message } })
            break
          }
          // Update the docs list regardless — even on partial failure, any
          // successfully imported notes should appear in the UI immediately.
          dispatch({ type: "SET_KNOWLEDGE_DOCS", docs: msg.docs || [] })

          const pieces: string[] = [`✓ 导入 ${msg.imported} 篇`]
          if (msg.skippedOversize > 0) pieces.push(`跳过 ${msg.skippedOversize} 个 >6MB`)
          if (msg.skippedUnsupported > 0) pieces.push(`跳过 ${msg.skippedUnsupported} 个不支持格式`)
          if (msg.failed > 0) pieces.push(`失败 ${msg.failed}`)
          if (msg.truncated) pieces.push(`(已达 ${msg.maxFiles} 上限)`)

          dispatch({
            type: "SET_KNOWLEDGE_IMPORT_STATUS",
            status: { ok: msg.imported > 0, message: pieces.join(" · ") },
          })
          break
        }

        case "skill.exported": {
          const { content, format, skill_name } = msg
          if (content) {
            const mimeType = format === "zip" ? "application/zip" : "text/markdown"
            const ext = format === "zip" ? ".zip" : ".md"
            // Decode: zip is base64, markdown is plain text
            const isBase64 = format === "zip"
            const bytes = isBase64
              ? Uint8Array.from(atob(content), c => c.charCodeAt(0))
              : new TextEncoder().encode(content)
            const blob = new Blob([bytes], { type: mimeType })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${skill_name}${ext}`
            a.click()
            URL.revokeObjectURL(url)
          }
          break
        }

        case "thread.exported_obsidian": {
          const { content, filename } = msg
          if (content) {
            const blob = new Blob([new TextEncoder().encode(content)], { type: "text/markdown" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename || "export.md"
            a.click()
            URL.revokeObjectURL(url)
          }
          // P3: a pending summary export just resolved (download or not) — clear its spinner.
          dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: null })
          break
        }

        case "obsidian.vault_folder_picked": {
          // Native folder-picker result from the companion. Adopt the path (config binds to
          // the input); clear the spinner. A cancel is silent; a real error is surfaced.
          if (msg.path) {
            dispatch({ type: "SET_CONFIG", config: { obsidian_vault_path: msg.path } })
            dispatch({ type: "SET_VAULT_PICKER", picking: false, error: null })
          } else if (msg.error === "cancelled") {
            dispatch({ type: "SET_VAULT_PICKER", picking: false, error: null })
          } else {
            dispatch({ type: "SET_VAULT_PICKER", picking: false, error: msg.error || "选择失败" })
          }
          break
        }

        case "obsidian.profile_ready": {
          const profile = msg.profile
          if (profile) {
            // Summarize what was learned: notes sampled + (P2) vault index size + template count.
            const parts = [`分析了 ${msg.files_sampled ?? profile.files_sampled ?? "?"} 篇笔记`]
            if (msg.index_count != null) parts.push(`索引 ${msg.index_count} 篇`)
            if (msg.template_count != null && msg.template_count > 0) parts.push(`模板 ${msg.template_count} 个`)
            dispatch({
              type: "SET_OBSIDIAN_PROFILE_STATUS",
              status: { ok: true, message: `✓ Vault 档案已更新（${parts.join(" · ")}）` },
            })
          } else {
            dispatch({
              type: "SET_OBSIDIAN_PROFILE_STATUS",
              status: { ok: false, message: msg.reason || "未识别到 vault 结构化约定" },
            })
          }
          break
        }

        case "skill.imported":
        case "skill.deleted":
          chrome.runtime.sendMessage({ type: "skill.list" })
          break

        case "knowledge.imported":
        case "knowledge.deleted":
          chrome.runtime.sendMessage({ type: "knowledge.list" })
          break

        // Progress while companion parses / vision-analyzes attachments.
        case "file.upload_status": {
          const stTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          if (stTid && !shouldApplyStreamEvent(stTid, activeThreadRef.current)) break
          if (stTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: stTid, busy: true })
          }
          dispatch({ type: "SET_PROCESSING", isProcessing: true })
          const label =
            typeof msg.message === "string" && msg.message
              ? msg.message
              : msg.phase === "vision"
                ? "正在分析文档内嵌图片…"
                : msg.phase === "chat"
                  ? "文档已解析，模型思考中…"
                  : "正在解析文档…"
          dispatch({ type: "SET_PROCESSING_STATUS", status: label })
          break
        }

        // File parse/type/size failures return before chatCreate — must clear
        // the optimistic "思考中" busy set by InputArea on send. Without this
        // the panel stays stuck forever (no chat.done / chat.error ever arrives).
        // S45 multi-lane P0: always clear mapBusy for the upload thread; panel
        // chrome (isProcessing / ADD_MESSAGE) only when that thread is active —
        // otherwise thread-switch mid-upload pollutes the wrong transcript.
        case "file.upload_error": {
          const uploadErrTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          if (uploadErrTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: uploadErrTid, busy: false })
          }
          // Companion parse/type/size fail after WS accept: retract the
          // exact optimistic id (ref — listener must not close over render state).
          const pending = uploadErrTid ? pendingUploadsRef.current[uploadErrTid] : undefined
          if (pending) {
            dispatch({ type: "REMOVE_MESSAGE", id: pending.messageId })
            dispatch({ type: "CLEAR_PENDING_UPLOAD", threadId: uploadErrTid })
            if (
              pending.composerText &&
              shouldApplyStreamEvent(uploadErrTid, activeThreadRef.current)
            ) {
              dispatch({ type: "REQUEST_COMPOSER_RESTORE", text: pending.composerText })
            }
          }
          if (!shouldApplyStreamEvent(uploadErrTid, activeThreadRef.current)) break
          streamingRef.current = ""
          reasoningRef.current = ""
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_STREAMING_REASONING", content: "" })
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
          {
            const raw = typeof msg.error === "string" ? msg.error : "文件上传失败"
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `${uploadErrTid || "file"}_upload_err_${Date.now()}`,
                thread_id: uploadErrTid,
                role: "assistant",
                content: `\u274c ${raw}`,
                created_at: new Date().toISOString(),
              },
            })
          }
          break
        }

        // Ack after successful parse+chat — chat.done already cleared busy; keep
        // as a safety net if chat path returned early without streaming.
        // S45 P1: clear mapBusy for upload thread always; isProcessing only if
        // active (avoid unlocking another thread's "thinking" after switch).
        case "file.uploaded": {
          const upTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          if (upTid) {
            dispatch({ type: "CLEAR_PENDING_UPLOAD", threadId: upTid })
            dispatch({ type: "SET_THREAD_BUSY", threadId: upTid, busy: false })
          }
          // F3: chip clear has no thread ownership — dispatch before the gate,
          // like SET_THREAD_BUSY above, or chips leak across threads.
          dispatch({ type: "BUMP_COMPOSER_UPLOAD_CLEAR" })
          if (!fileUploadedApplyToPanel(upTid, activeThreadRef.current)) break
          dispatch({ type: "SET_PROCESSING_STATUS", status: null })
          // Only clear processing if no stream is in flight for this panel.
          if (!streamingRef.current && !reasoningRef.current) {
            dispatch({ type: "SET_PROCESSING", isProcessing: false })
          }
          break
        }

        case "error":
          // WP5-I4: computer.model.* 错误(family:"computer.model")→ 设置页实验区
          // 错误位;判定先于 apps(family 无歧义,code 回退集含共享 BIOMETRIC_DENIED)。
          if (isComputerModelErrorMessage(msg)) {
            dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: msg.error || "Unknown computer.model error" })
            break
          }
          // Path B M0: voice.model.* 错误(family:"voice.model")→ 设置页语音区错误位。
          if (msg && typeof msg === "object" && msg.family === "voice.model") {
            dispatch({
              type: "SET_VOICE_MODEL_ERROR",
              error: typeof msg.error === "string" && msg.error ? msg.error : "Unknown voice.model error",
            })
            break
          }
          // ACP / coding agent panel — surface in processingStatus (panel rollback/start UX).
          // Must break before generic path that nulls processingStatus (Pi dual R1).
          if (
            msg.family === "acp" ||
            (typeof msg.error === "string" &&
              (/^acp[:.]|acp:\s|编程助手|cloud_disclosure|feature disabled/i.test(msg.error) ||
                /\bacp\b/i.test(msg.error) && /disabled|未启用|disclosure/i.test(msg.error)))
          ) {
            dispatch({
              type: "SET_PROCESSING_STATUS",
              status:
                typeof msg.error === "string" && msg.error
                  ? msg.error
                  : "编程助手错误",
            })
            break
          }
          // App tab (WP4, routing hardened in WP6a): apps.* failures
          // (biometric cancel, policy cap, add-flow validation, …) render in
          // the panel's error area instead of the chat stream — the user is
          // acting in the panel, not chatting. Routed by family:"apps" with
          // the legacy code set as fallback (isAppsErrorMessage).
          if (isAppsErrorMessage(msg)) {
            dispatch({ type: "SET_APPS_ERROR", error: msg.error || "Unknown apps error" })
            break
          }
          // ADR-019: user_env.* failures stay in Settings Secrets section (not chat).
          if (isUserEnvErrorMessage(msg)) {
            const code = typeof msg.error_code === "string" ? msg.error_code
              : typeof msg.code === "string" ? msg.code
              : undefined
            dispatch({
              type: "SET_USER_ENV_ERROR",
              error: mapUserEnvError(code, typeof msg.error === "string" ? msg.error : null),
            })
            break
          }
          {
            const errTid = activeThreadRef.current || ""
            if (errTid) {
              dispatch({ type: "SET_THREAD_BUSY", threadId: errTid, busy: false })
            }
            streamingRef.current = ""
            reasoningRef.current = ""
            dispatch({ type: "SET_STREAMING", content: "" })
            dispatch({ type: "SET_STREAMING_REASONING", content: "" })
            dispatch({ type: "SET_PROCESSING_STATUS", status: null })
            dispatch({ type: "SET_PROCESSING", isProcessing: false })
            dispatch({
              type: "ADD_MESSAGE",
              message: {
                id: `error_${Date.now()}`,
                thread_id: errTid,
                role: "assistant",
                content: `\u274c ${msg.error || "Unknown error"}`,
                created_at: new Date().toISOString(),
              },
            })
          }
          // P3: a failed summary export surfaces as an error chat message \u2014 clear its spinner.
          dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: null })
          break

        case "history.result":
          dispatch({ type: "SET_OPERATIONS", operations: msg.operations })
          break

        case "connected": {
          dispatch({ type: "SET_CONNECTION", state: "connected" })
          requestInitialData()
          break
        }
      }
      } catch {
        /* never break SW/UI response path for concurrent pages */
      }
      return false
    }
    chrome.runtime.onMessage.addListener(messageListener)

    // Poll connection status from background
    const pollStatus = () => {
      chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) return
        if (response) {
          dispatch({ type: "SET_CONNECTION", state: response.connectionState })
          if (response.connectionState === "connected") {
            requestInitialData()
          } else {
            initializedRef.current = false
          }
        }
      })
    }

    pollStatus()
    const interval = setInterval(pollStatus, 3000)

    // Refresh thread list when sidepanel becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        chrome.runtime.sendMessage({ type: "thread.list" })
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Long-lived port connection to keep the service worker alive while sidepanel is open
    const port = chrome.runtime.connect({ name: "cmspark-sidepanel" })

    return () => {
      clearInterval(interval)
      chrome.runtime.onMessage.removeListener(messageListener)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      port.disconnect()
    }
  }, [dispatch])

  const send = (msg: object) => {
    chrome.runtime.sendMessage(msg)
  }

  return {
    connectionState: state.connectionState,
    send,
  }
}
