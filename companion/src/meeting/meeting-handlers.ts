/**
 * meeting.* WS handlers (SoT meeting-minutes).
 * create/start/end: chrome-extension OR summoner + cmspark-tray://local.
 * generate_minutes / auto_diarize / import_text / append remain extension-only.
 */

import { getConfig } from "../config"
import { logger } from "../logger"
import { isChromeExtensionOrigin, isVoiceSttOriginAllowed } from "../voice/stt-handlers"
import type { LlmExtractConfig } from "../llm/llm-extract"
import { generateMeetingMinutes } from "./meeting-minutes"
import {
  appendTranscript,
  createMeeting,
  endMeetingRecording,
  loadMeeting,
  listMeetings,
  deleteMeeting,
  replaceTranscript,
  setDiarizeResult,
  setMeetingStatus,
  setMinutes,
  setTranscript,
  startMeetingRecording,
  transcriptToText,
  type TranscriptLine,
  type TranscriptSource,
} from "./meeting-store"
import {
  applySilenceCut,
  applySpeakersByIndex,
  bulkSetSpeaker,
  silenceCutText,
} from "./silence-cut"
import {
  applyDiarizeToLines,
  clampDiarizeK,
  diarizeByAudioFeatures,
  diarizeByTextGap,
} from "./auto-diarize"

export interface MeetingHandlerContext {
  origin?: string
  peerId?: string
  send?: (data: any) => void
  /** Handshake surface. create/start/end allow summoner + tray origin. */
  surface?: string
}

export interface MeetingHandlerDeps {
  isExtensionOrigin?: (origin: string | undefined) => boolean
  getLlmConfig?: () => LlmExtractConfig | null
  generate?: typeof generateMeetingMinutes
  /** Best-effort: drop stale STT max-1 slot (e.g. prior dictation still inferring). */
  clearSttSessions?: () => void
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

const OVERLAY_MEETING_TYPES = new Set(["meeting.create", "meeting.start", "meeting.end"])

export async function handleMeetingMessage(
  msg: any,
  ctx: MeetingHandlerContext = {},
  deps: MeetingHandlerDeps = {},
): Promise<any> {
  const type = msg?.type
  const originOk = deps.isExtensionOrigin
    ? deps.isExtensionOrigin(ctx.origin)
    : typeof type === "string" && OVERLAY_MEETING_TYPES.has(type)
      ? isVoiceSttOriginAllowed(ctx.origin, ctx.surface)
      : isChromeExtensionOrigin(ctx.origin)
  if (!originOk) {
    logger.warn("meeting.refused", {
      type: typeof type === "string" ? type : undefined,
      origin: ctx.origin ? "present" : "missing",
      surface: ctx.surface,
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

  /**
   * Mtg1 live capture start.
   * Requires privacy_ack_v1 === true (meeting_privacy_ack_v1; voice v3 cannot substitute).
   * Does not open mic on server — extension owns gUM + voice.stt.* segments.
   */
  if (type === "meeting.start") {
    if (msg.privacy_ack_v1 !== true) {
      return err("need_privacy_ack", "meeting_privacy_ack_v1 required before start")
    }
    let id = typeof msg.id === "string" ? msg.id : ""
    if (!id) {
      const session = createMeeting({
        title: typeof msg.title === "string" ? msg.title : undefined,
        thread_id: typeof msg.thread_id === "string" ? msg.thread_id : null,
      })
      id = session.id
    } else {
      const existing = loadMeeting(id)
      if (!existing) return err("not_found", "meeting not found", { id })
      if (existing.status === "recording") {
        return err("already_recording", "meeting already recording", { id })
      }
    }
    const started = startMeetingRecording(id, {
      audio_retained: msg.audio_retained === true,
      retain_days: typeof msg.retain_days === "number" ? msg.retain_days : undefined,
    })
    if (!started) return err("not_found", "meeting not found", { id })
    // Free STT max-1 slot so extension voice.stt.* for this meeting is not blocked
    // by a prior dictation/meeting segment still inferring (resource_conflict).
    try {
      deps.clearSttSessions?.()
    } catch {
      /* best-effort */
    }
    logger.info("meeting.start.ok", {
      id: started.id,
      audio_retained: started.privacy.audio_retained,
    })
    return { type: "meeting.started", v: 1, meeting: started }
  }

  /** End live capture; default delete meetings/<id>/audio when not retained. */
  if (type === "meeting.end") {
    const id = typeof msg.id === "string" ? msg.id : ""
    if (!id) return err("invalid_id", "meeting.end requires id")
    const result = endMeetingRecording(id)
    if (!result) return err("not_found", "meeting not found", { id })
    logger.info("meeting.end.ok", {
      id,
      audioDeleted: result.audioDeleted,
      retained: result.session.privacy.audio_retained,
    })
    return {
      type: "meeting.ended",
      v: 1,
      meeting: result.session,
      audio_deleted: result.audioDeleted,
    }
  }

  if (type === "meeting.list") {
    return { type: "meeting.list_result", v: 1, meetings: listMeetings() }
  }

  if (type === "meeting.delete") {
    const id = typeof msg.id === "string" ? msg.id : ""
    if (!id) return err("invalid_id", "meeting.delete requires id")
    const ok = deleteMeeting(id)
    if (!ok) return err("not_found", "meeting not found", { id })
    return { type: "meeting.deleted", v: 1, id }
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
    // Mtg2: default silence-cut + speaker prefix parse; opt-out with silence_cut:false
    const lines: TranscriptLine[] =
      msg.silence_cut === false
        ? text
            .split(/\n+/)
            .map((t: string) => t.trim())
            .filter(Boolean)
            .map((t: string) => ({ text: t, source }))
        : silenceCutText(text, source)
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
      source:
        msg.source === "stt"
          ? "stt"
          : msg.source === "asr_refiner"
            ? "asr_refiner"
            : "user_edit",
      speaker: typeof msg.speaker === "string" ? msg.speaker.slice(0, 32) : undefined,
    }
    const m = appendTranscript(id, line)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: m }
  }

  /**
   * Mtg2: re-apply silence-cut heuristic on stored transcript (manual labeling prep).
   * Optional msg.text: replace transcript from text first (avoids client race after set_transcript).
   * Does NOT invent speakers.
   */
  if (type === "meeting.apply_silence_cut") {
    const id = typeof msg.id === "string" ? msg.id : ""
    let m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    if (typeof msg.text === "string" && msg.text.trim()) {
      m = setTranscript(id, silenceCutText(msg.text, "user_edit")) || m
    }
    const next = applySilenceCut(m.transcript)
    const updated = replaceTranscript(id, next)
    if (!updated) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: updated, cut: true }
  }

  /**
   * Mtg2: manual speaker labels by line index.
   * assignments: [{ index, speaker }] speaker null/"" clears.
   */
  if (type === "meeting.set_speakers") {
    const id = typeof msg.id === "string" ? msg.id : ""
    const m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    const raw = Array.isArray(msg.assignments) ? msg.assignments : []
    if (raw.length === 0) return err("invalid_assignments", "assignments required", { id })
    if (raw.length > 500) return err("invalid_assignments", "too many assignments", { id })
    const assignments: Array<{ index: number; speaker: string | null }> = []
    for (const a of raw) {
      if (typeof a?.index !== "number" || !Number.isInteger(a.index) || a.index < 0) {
        return err("invalid_assignments", "each assignment needs non-negative integer index", { id })
      }
      assignments.push({
        index: a.index,
        speaker: a?.speaker == null || a.speaker === "" ? null : String(a.speaker).slice(0, 32),
      })
    }
    const next = applySpeakersByIndex(m.transcript, assignments)
    const updated = replaceTranscript(id, next)
    if (!updated) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: updated }
  }

  /**
   * Mtg2: set one speaker on all lines (e.g. 「我」) or clear with speaker:null.
   * Optional msg.text: set transcript (silence-cut) first — single round-trip, no client race.
   */
  if (type === "meeting.bulk_speaker") {
    const id = typeof msg.id === "string" ? msg.id : ""
    let m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    if (typeof msg.text === "string" && msg.text.trim()) {
      m = setTranscript(id, silenceCutText(msg.text, "user_edit")) || m
    }
    const speaker =
      msg.speaker == null || msg.speaker === ""
        ? null
        : String(msg.speaker).slice(0, 32)
    const next = bulkSetSpeaker(m.transcript, speaker)
    const updated = replaceTranscript(id, next)
    if (!updated) return err("not_found", "meeting not found", { id })
    return { type: "meeting.updated", v: 1, meeting: updated, cut: true }
  }

  /**
   * Mtg3: auto-tag speakers (anonymous 发言人N).
   * mode=audio_cluster requires features[][] aligned with transcript lines.
   * mode=text_gap is weak alternating labels (explicit; not acoustic).
   */
  if (type === "meeting.auto_diarize") {
    if (msg.privacy_ack_v1 !== true) {
      return err("need_privacy_ack", "meeting_privacy_ack_v1 required for auto_diarize")
    }
    const id = typeof msg.id === "string" ? msg.id : ""
    let m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    // Optional text: silence-cut set before diarize (text_gap path)
    if (typeof msg.text === "string" && msg.text.trim()) {
      m = setTranscript(id, silenceCutText(msg.text, "user_edit")) || m
    }
    if (!m.transcript.length) {
      return err("empty_transcript", "empty transcript", { id })
    }
    const mode = msg.mode === "text_gap" ? "text_gap" : "audio_cluster"
    const k = clampDiarizeK(msg.k)
    let result
    if (mode === "text_gap") {
      result = diarizeByTextGap(m.transcript, k)
    } else {
      const features = Array.isArray(msg.features) ? msg.features : null
      if (!features || features.length === 0) {
        return err(
          "features_required",
          "audio_cluster requires features aligned with transcript lines",
          { id },
        )
      }
      if (features.length !== m.transcript.length) {
        return err(
          "features_mismatch",
          `features length ${features.length} != transcript ${m.transcript.length}`,
          { id },
        )
      }
      result = diarizeByAudioFeatures(m.transcript, features, k)
    }
    const lines = applyDiarizeToLines(m.transcript, result, {
      // Default: full auto overwrite. preserve_manual keeps hand labels (Mtg2).
      preserveManual: msg.preserve_manual === true,
    })
    const updated = setDiarizeResult(id, lines, {
      method: result.method,
      k: result.k,
      at: new Date().toISOString(),
      experimental: true,
    })
    if (!updated) return err("not_found", "meeting not found", { id })
    logger.info("meeting.auto_diarize.ok", {
      id,
      method: result.method,
      k: result.k,
      lines: lines.length,
    })
    return {
      type: "meeting.diarized",
      v: 1,
      meeting: updated,
      diarize: updated.diarize,
      cut: true,
    }
  }

  /**
   * Mtg2: import plain text / markdown transcript file content (already read by extension).
   * Same as set_transcript with silence_cut; creates meeting if no id.
   */
  if (type === "meeting.import_text") {
    if (msg.privacy_ack_v1 !== true) {
      return err("need_privacy_ack", "meeting_privacy_ack_v1 required for import")
    }
    const text = typeof msg.text === "string" ? msg.text : ""
    if (!text.trim()) return err("empty_transcript", "empty import text")
    if (text.length > 200_000) return err("too_large", "import text too long (max 200000)")
    let id = typeof msg.id === "string" ? msg.id : ""
    if (!id) {
      const session = createMeeting({
        title: typeof msg.title === "string" ? msg.title : undefined,
        thread_id: typeof msg.thread_id === "string" ? msg.thread_id : null,
      })
      id = session.id
    }
    const lines = silenceCutText(text, "paste")
    const m = setTranscript(id, lines)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.imported", v: 1, meeting: m, kind: "text" }
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
    const templateMd = typeof msg.template_md === "string" ? msg.template_md : undefined
    const result = await generate({ transcriptText, config: llm, templateMd })
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
