/**
 * meeting.* WS handlers (SoT meeting-minutes).
 * chrome-extension origin preferred for capture-related; generate allows extension.
 */

import { getConfig } from "../config"
import { logger } from "../logger"
import { isChromeExtensionOrigin } from "../voice/stt-handlers"
import type { LlmExtractConfig } from "../llm/llm-extract"
import { generateMeetingMinutes } from "./meeting-minutes"
import {
  appendTranscript,
  createMeeting,
  loadMeeting,
  listMeetings,
  setMeetingStatus,
  setMinutes,
  setTranscript,
  transcriptToText,
  type TranscriptLine,
  type TranscriptSource,
} from "./meeting-store"

export interface MeetingHandlerContext {
  origin?: string
  peerId?: string
  send?: (data: any) => void
}

export interface MeetingHandlerDeps {
  isExtensionOrigin?: (origin: string | undefined) => boolean
  getLlmConfig?: () => LlmExtractConfig | null
  generate?: typeof generateMeetingMinutes
}

function llmConfigFromCompanion(): LlmExtractConfig | null {
  try {
    const cfg = getConfig()
    const llm = cfg?.llm
    if (!llm?.base_url || !llm?.api_key || !llm?.model_name) return null
    return {
      base_url: llm.base_url,
      api_key: llm.api_key,
      model_name: llm.model_name,
      temperature: typeof llm.temperature === "number" ? llm.temperature : 0.3,
      protocol: llm.protocol,
      auth_style: llm.auth_style,
      client_header_profile: llm.client_header_profile,
      claude_code_compat_version: llm.claude_code_compat_version,
      extra_headers: llm.extra_headers,
      anthropic_version: llm.anthropic_version,
      context_window: llm.context_window,
    }
  } catch {
    return null
  }
}

function err(code: string, message: string, extra?: Record<string, unknown>) {
  return { type: "meeting.error", v: 1, code, message, ...extra }
}

export async function handleMeetingMessage(
  msg: any,
  ctx: MeetingHandlerContext = {},
  deps: MeetingHandlerDeps = {},
): Promise<any> {
  const type = msg?.type
  const originOk = (deps.isExtensionOrigin ?? isChromeExtensionOrigin)(ctx.origin)
  if (!originOk) {
    logger.warn("meeting.refused", {
      type: typeof type === "string" ? type : undefined,
      origin: ctx.origin ? "present" : "missing",
    })
    return err("origin_denied", "chrome-extension origin required")
  }

  if (type === "meeting.create") {
    const session = createMeeting({
      title: typeof msg.title === "string" ? msg.title : undefined,
      thread_id: typeof msg.thread_id === "string" ? msg.thread_id : null,
    })
    return { type: "meeting.created", v: 1, meeting: session }
  }

  if (type === "meeting.list") {
    return { type: "meeting.list_result", v: 1, meetings: listMeetings() }
  }

  if (type === "meeting.get") {
    const id = typeof msg.id === "string" ? msg.id : ""
    const m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.get_result", v: 1, meeting: m }
  }

  if (type === "meeting.set_transcript") {
    const id = typeof msg.id === "string" ? msg.id : ""
    const text = typeof msg.text === "string" ? msg.text : ""
    const source: TranscriptSource =
      msg.source === "stt" || msg.source === "paste" || msg.source === "user_edit"
        ? msg.source
        : "paste"
    if (!text.trim()) return err("empty_transcript", "empty transcript", { id })
    // Split by blank lines or newlines into lines
    const lines: TranscriptLine[] = text
      .split(/\n+/)
      .map((t: string) => t.trim())
      .filter(Boolean)
      .map((t: string) => ({ text: t, source }))
    const m = setTranscript(id, lines)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: m }
  }

  if (type === "meeting.append_transcript") {
    const id = typeof msg.id === "string" ? msg.id : ""
    const text = typeof msg.text === "string" ? msg.text : ""
    if (!text.trim()) return err("empty_transcript", "empty text", { id })
    const line: TranscriptLine = {
      text: text.trim(),
      source: msg.source === "stt" ? "stt" : "user_edit",
      speaker: typeof msg.speaker === "string" ? msg.speaker : undefined,
    }
    const m = appendTranscript(id, line)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: m }
  }

  if (type === "meeting.generate_minutes") {
    const id = typeof msg.id === "string" ? msg.id : ""
    // Optional one-shot: text without persisted meeting
    const inlineText = typeof msg.text === "string" ? msg.text : ""
    let transcriptText = inlineText.trim()
    let meetingId = id

    if (id) {
      const m = loadMeeting(id)
      if (!m) return err("not_found", "meeting not found", { id })
      transcriptText = transcriptToText(m.transcript) || inlineText.trim()
      setMeetingStatus(id, "generating")
    }

    if (!transcriptText) {
      if (id) setMeetingStatus(id, "error", "empty transcript")
      return err("empty_transcript", "empty transcript", { id })
    }

    const getLlm = deps.getLlmConfig ?? llmConfigFromCompanion
    const llm = getLlm()
    if (!llm) {
      if (id) setMeetingStatus(id, "error", "llm not configured")
      return err("llm_not_configured", "Companion LLM not configured")
    }

    const generate = deps.generate ?? generateMeetingMinutes
    const result = await generate({ transcriptText, config: llm })
    if (!result.ok) {
      if (id) setMeetingStatus(id, "error", result.message)
      return err(result.code, result.message, { id })
    }

    if (meetingId) {
      const updated = setMinutes(meetingId, result.minutes)
      return {
        type: "meeting.minutes_result",
        v: 1,
        meeting: updated,
        minutes: result.minutes,
      }
    }

    // Ephemeral generate (no id) — Mtg0 paste-only
    return {
      type: "meeting.minutes_result",
      v: 1,
      meeting: null,
      minutes: result.minutes,
    }
  }

  if (type === "meeting.set_status") {
    const id = typeof msg.id === "string" ? msg.id : ""
    const status = msg.status
    if (
      status !== "draft" &&
      status !== "recording" &&
      status !== "ready" &&
      status !== "generating" &&
      status !== "done" &&
      status !== "error"
    ) {
      return err("invalid_status", "invalid status")
    }
    const m = setMeetingStatus(id, status)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: m }
  }

  return err("unknown_type", `unknown type ${String(type)}`)
}
