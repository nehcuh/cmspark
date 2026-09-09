/**
 * meeting.* WS handlers (SoT meeting-minutes).
 * create/start/end: chrome-extension OR summoner + cmspark-tray://local.
 * generate_minutes / append_transcript: chrome-extension OR overlay (summoner + tray).
 * auto_diarize / import_text remain extension-only.
 */

import { getConfig } from "../config"
import { logger } from "../logger"
import { isChromeExtensionOrigin, isVoiceSttOriginAllowed } from "../voice/stt-handlers"
import type { LlmExtractConfig } from "../llm/llm-extract"
import { generateMeetingMinutes } from "./meeting-minutes"
import { importMeetingReference, MEETING_REFERENCE_MAX_CHARS, MEETING_REFERENCE_MAX_NAME_CHARS } from "./meeting-reference"
import { MEETING_MINUTES_MAX_INPUT_CHARS } from "./minutes-prompt"
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
  setReference,
  saveMeeting,
  meetingSourceFingerprint,
  MeetingTranscriptLimitError,
  MeetingTranscriptSegmentCollisionError,
  isSafeMeetingId,
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
  extractSegmentFeatures,
} from "./auto-diarize"
import { diarizeByEmbeddings } from "./diarize-cluster"
import { embedSegmentsForDiarize } from "./diarize-embed"
import {
  appendPcmChunk,
  consumeFinalizedPcm,
  createPcmSession,
  finalizePcmSession,
} from "./diarize-pcm-store"

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
  /** #260 test seam: override speaker-embedding runtime. */
  embedSegments?: typeof embedSegmentsForDiarize
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

const minutesInFlight = new Set<string>()

function transcriptWriteError(cause: unknown, id: string) {
  if (cause instanceof MeetingTranscriptSegmentCollisionError) return err("segment_id_conflict", cause.message, { id })
  return cause instanceof MeetingTranscriptLimitError
    ? err("transcript_too_long", cause.message, { id })
    : err("transcript_save_failed", "转写保存失败，请保留当前稿并重试", { id })
}

const OVERLAY_MEETING_TYPES = new Set([
  "meeting.create",
  "meeting.start",
  "meeting.end",
  "meeting.append_transcript",
  "meeting.generate_minutes",
  "meeting.import_reference",
  "meeting.set_reference",
  "meeting.list",
  "meeting.get",
  // #244 NEVER: auto_diarize / import_text remain extension-only (#246 had
  // auto_diarize here; this ticket peels it back. Overlay UI has no entry.)
])

/**
 * Overlay tray RPC stamps `id: "tray-N"` for correlation. That is not a meeting
 * id (`mtg_…`). Prefer `meeting_id`; ignore tray request ids and unsafe paths.
 */
export function resolveMeetingId(msg: any): string {
  const candidates = [msg?.meeting_id, msg?.id]
  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw) continue
    if (/^tray-\d+$/.test(raw)) continue
    if (!isSafeMeetingId(raw)) continue
    return raw
  }
  return ""
}

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
    let id = resolveMeetingId(msg)
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
    const id = resolveMeetingId(msg)
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
    const id = resolveMeetingId(msg)
    if (!id) return err("invalid_id", "meeting.delete requires id")
    const ok = deleteMeeting(id)
    if (!ok) return err("not_found", "meeting not found", { id })
    return { type: "meeting.deleted", v: 1, id }
  }

  if (type === "meeting.get") {
    const id = resolveMeetingId(msg)
    const m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    return { type: "meeting.get_result", v: 1, meeting: m }
  }

  if (type === "meeting.import_reference") {
    try {
      const result = await importMeetingReference(msg.file)
      return result.ok
        ? { type: "meeting.reference_imported", v: 1, reference: result.reference }
        : err(result.code, result.message)
    } catch {
      return err("reference_parse_failed", "参考文件解析失败，请检查文件后重试")
    }
  }

  if (type === "meeting.set_reference") {
    const id = resolveMeetingId(msg)
    if (!id) return err("invalid_id", "meeting.set_reference requires meeting_id")
    if (typeof msg.reference_notes !== "string" || msg.reference_notes.length > MEETING_REFERENCE_MAX_CHARS) {
      return err("invalid_reference", "参考笔记必须为文本，且不能超过 100000 字", { id })
    }
    if (msg.reference_name !== undefined && (typeof msg.reference_name !== "string" || msg.reference_name.length > MEETING_REFERENCE_MAX_NAME_CHARS)) {
      return err("invalid_reference", "参考文件名必须为文本，且不能超过 255 字", { id })
    }
    try {
      const existing = loadMeeting(id)
      if (!existing) return err("not_found", "meeting not found", { id })
      const name = msg.reference_name ?? (msg.reference_notes ? existing.reference_name || "" : "")
      const meeting = setReference(id, msg.reference_notes, name)
      if (!meeting) return err("not_found", "meeting not found", { id })
      return { type: "meeting.updated", v: 1, meeting }
    } catch {
      return err("reference_save_failed", "参考笔记保存失败，原稿仍在面板中，请重试", { id })
    }
  }

  if (type === "meeting.set_transcript") {
    const id = resolveMeetingId(msg)
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
    try {
      const m = setTranscript(id, lines)
      if (!m) return err("not_found", "meeting not found", { id })
      return { type: "meeting.updated", v: 1, meeting: m }
    } catch (cause) { return transcriptWriteError(cause, id) }
  }

  if (type === "meeting.append_transcript") {
    const id = resolveMeetingId(msg)
    if (msg.segment_id !== undefined && (typeof msg.segment_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(msg.segment_id))) {
      return err("invalid_segment_id", "转写段标识需为 8–128 位字母、数字、下划线或短横线", { id })
    }
    const text = typeof msg.text === "string" ? msg.text : ""
    if (!text.trim()) return err("empty_transcript", "empty text", { id })
    const line: TranscriptLine = {
      ...(msg.segment_id !== undefined ? { segment_id: msg.segment_id } : {}),
      text: text.trim(),
      source:
        msg.source === "stt"
          ? "stt"
          : msg.source === "asr_refiner"
            ? "asr_refiner"
            : "user_edit",
      speaker: typeof msg.speaker === "string" ? msg.speaker.slice(0, 32) : undefined,
    }
    try {
      const m = appendTranscript(id, line)
      if (!m) return err("not_found", "meeting not found", { id })
      return { type: "meeting.updated", v: 1, meeting: m }
    } catch (cause) { return transcriptWriteError(cause, id) }
  }

  /**
   * Mtg2: re-apply silence-cut heuristic on stored transcript (manual labeling prep).
   * Optional msg.text: replace transcript from text first (avoids client race after set_transcript).
   * Does NOT invent speakers.
   */
  if (type === "meeting.apply_silence_cut") {
    const id = resolveMeetingId(msg)
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
    const id = resolveMeetingId(msg)
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
    const id = resolveMeetingId(msg)
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
   * #260 PCM upload pipeline for embedding diarize. Extension-only (not in
   * OVERLAY_MEETING_TYPES). Audio stays in memory, consumed once by
   * meeting.auto_diarize mode:"embedding"; TTL + caps fail closed.
   */
  if (type === "meeting.diarize.upload_start") {
    if (msg.privacy_ack_v1 !== true) {
      return err("need_privacy_ack", "meeting_privacy_ack_v1 required for pcm upload")
    }
    const r = createPcmSession({
      segments: msg.segments,
      sampleRate: msg.sample_rate,
      format: msg.format,
    })
    if (!r.ok) return err(r.code, r.message)
    return { type: "meeting.diarize.upload_started", v: 1, session_id: r.value }
  }

  if (type === "meeting.diarize.upload_chunk") {
    const r = appendPcmChunk(msg.session_id, msg.index, msg.seq, msg.data)
    if (!r.ok) return err(r.code, r.message, { session_id: msg.session_id })
    return {
      type: "meeting.diarize.chunk_ok",
      v: 1,
      session_id: msg.session_id,
      index: msg.index,
      seq: msg.seq,
    }
  }

  if (type === "meeting.diarize.upload_end") {
    const r = finalizePcmSession(msg.session_id, msg.total_seqs)
    if (!r.ok) return err(r.code, r.message, { session_id: msg.session_id })
    return {
      type: "meeting.diarize.upload_ended",
      v: 1,
      session_id: msg.session_id,
      segments: r.value.segments,
    }
  }

  /**
   * Mtg3: auto-tag speakers (anonymous 发言人N).
   * mode=audio_cluster: 旧版 3 维特征 k-means（区分度低·experimental）。接受
   * features[][] 或（#260 round-2 起）pcm_session —— 服务端提特征。
   * mode=text_gap is weak alternating labels (explicit; not acoustic).
   * mode=#260 embedding: PCM uploaded via meeting.diarize.upload_*; local ONNX
   * speaker embeddings + cosine agglomerative clustering (round-2 held-out
   * gate FAILED 2026-09-05 → stays experimental).
   */
  if (type === "meeting.auto_diarize") {
    if (msg.privacy_ack_v1 !== true) {
      return err("need_privacy_ack", "meeting_privacy_ack_v1 required for auto_diarize")
    }
    const id = resolveMeetingId(msg)
    let m = loadMeeting(id)
    if (!m) return err("not_found", "meeting not found", { id })
    // Optional text: silence-cut set before diarize (text_gap path)
    if (typeof msg.text === "string" && msg.text.trim()) {
      m = setTranscript(id, silenceCutText(msg.text, "user_edit")) || m
    }
    if (!m.transcript.length) {
      return err("empty_transcript", "empty transcript", { id })
    }
    const mode =
      msg.mode === "text_gap"
        ? "text_gap"
        : msg.mode === "embedding"
          ? "embedding"
          : "audio_cluster"
    const k = clampDiarizeK(msg.k)
    let result
    if (mode === "text_gap") {
      result = diarizeByTextGap(m.transcript, k)
    } else if (mode === "embedding") {
      const sessionId = typeof msg.pcm_session === "string" ? msg.pcm_session : ""
      if (!sessionId) {
        return err("pcm_session_required", "embedding requires pcm_session from upload_end", { id })
      }
      const pcm = consumeFinalizedPcm(sessionId)
      if (!pcm) {
        return err(
          "pcm_session_not_found",
          "pcm session not found or not finalized (upload_end first)",
          { id },
        )
      }
      if (pcm.length !== m.transcript.length) {
        return err(
          "pcm_mismatch",
          `pcm segments ${pcm.length} != transcript ${m.transcript.length}`,
          { id },
        )
      }
      const embed = deps.embedSegments ?? embedSegmentsForDiarize
      const embedResult = await embed(pcm, {
        onProgress: (p) => {
          ctx.send?.({ type: "meeting.diarize.progress", v: 1, id, done: p.done, total: p.total })
        },
      })
      if (!embedResult.ok) {
        return err(embedResult.code, embedResult.message, { id })
      }
      result = diarizeByEmbeddings(m.transcript, embedResult.embeddings, k)
    } else {
      // #260 round-2 MAJOR-1: audio_cluster 也接受 pcm_session —— 服务端从上传
      // PCM 提 3 维特征（旧引擎显式回退；extension 新 UI 不再本地提特征）。
      const features = Array.isArray(msg.features) ? msg.features : null
      let feats = features && features.length > 0 ? features : null
      if (!feats) {
        const sessionId = typeof msg.pcm_session === "string" ? msg.pcm_session : ""
        if (!sessionId) {
          return err(
            "features_required",
            "audio_cluster requires features or pcm_session aligned with transcript lines",
            { id },
          )
        }
        const pcm = consumeFinalizedPcm(sessionId)
        if (!pcm) {
          return err(
            "pcm_session_not_found",
            "pcm session not found or not finalized (upload_end first)",
            { id },
          )
        }
        if (pcm.length !== m.transcript.length) {
          return err(
            "pcm_mismatch",
            `pcm segments ${pcm.length} != transcript ${m.transcript.length}`,
            { id },
          )
        }
        feats = pcm.map((s) => Array.from(extractSegmentFeatures(s, 16000)))
      }
      if (feats.length !== m.transcript.length) {
        return err(
          "features_mismatch",
          `features length ${feats.length} != transcript ${m.transcript.length}`,
          { id },
        )
      }
      result = diarizeByAudioFeatures(m.transcript, feats, k)
    }
    const lines = applyDiarizeToLines(m.transcript, result, {
      // Default: full auto overwrite. preserve_manual keeps hand labels (Mtg2).
      preserveManual: msg.preserve_manual === true,
    })
    const updated = setDiarizeResult(id, lines, {
      method: result.method,
      k: result.k,
      at: new Date().toISOString(),
      experimental: result.experimental,
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
    let id = resolveMeetingId(msg)
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
    const id = resolveMeetingId(msg)
    if ((msg.text !== undefined && typeof msg.text !== "string") ||
        (msg.reference_notes !== undefined && typeof msg.reference_notes !== "string") ||
        (msg.reference_name !== undefined && typeof msg.reference_name !== "string")) {
      return err("invalid_material", "转写和参考笔记必须为文本", { id })
    }
    if (id && minutesInFlight.has(id)) return err("generation_busy", "该会议正在生成纪要，请等待当前结果", { id })
    if (id) minutesInFlight.add(id)
    try {
      const meeting = id ? loadMeeting(id) : null
      if (id && !meeting) return err("not_found", "meeting not found", { id })
      // An explicit current snapshot wins, including an explicit empty draft.
      const transcriptText = (msg.text !== undefined ? msg.text : meeting ? transcriptToText(meeting.transcript) : "").trim()
      const referenceNotes = msg.reference_notes ?? meeting?.reference_notes ?? ""
      const referenceName = msg.reference_name ?? meeting?.reference_name ?? ""
      if (!transcriptText) return err("empty_transcript", "empty transcript", { id })
      if (transcriptText.length > MEETING_MINUTES_MAX_INPUT_CHARS) return err("transcript_too_long", "转写不能超过 200000 字", { id })
      if (referenceNotes.length > MEETING_REFERENCE_MAX_CHARS || referenceNotes.length + transcriptText.length > MEETING_MINUTES_MAX_INPUT_CHARS) {
        return err("reference_too_long", "转写与参考笔记合计不能超过 200000 字，参考笔记不能超过 100000 字", { id })
      }
      if (referenceName.length > MEETING_REFERENCE_MAX_NAME_CHARS) return err("invalid_reference", "参考文件名不能超过 255 字", { id })
      const getLlm = deps.getLlmConfig ?? llmConfigFromCompanion
      const llm = getLlm()
      if (!llm) {
        if (id) setMeetingStatus(id, "error", "llm not configured")
        return err("llm_not_configured", "Companion LLM not configured", { id })
      }
      if (meeting) {
        // Preserve STT provenance when the supplied text matches existing lines.
        if (transcriptText !== transcriptToText(meeting.transcript)) {
          meeting.transcript = transcriptText.split("\n").map((text: string) => ({ text, source: "user_edit" }))
        }
        meeting.reference_notes = referenceNotes
        meeting.reference_name = referenceName
        meeting.status = "generating"
        saveMeeting(meeting) // persistence failure must prevent the LLM call
      }
      const fingerprint = meetingSourceFingerprint(transcriptText, referenceNotes, referenceName)
      const generate = deps.generate ?? generateMeetingMinutes
      const templateMd = typeof msg.template_md === "string" ? msg.template_md : undefined
      const result = await generate({ transcriptText, config: llm, templateMd, referenceNotes, referenceName })
      if (!result.ok) {
        if (id) setMeetingStatus(id, "error", result.message)
        return err(result.code, result.message, { id })
      }
      const minutes = { ...result.minutes, source_transcript: transcriptText, source_fingerprint: fingerprint, stale: false }
      if (id) {
        // setMinutes rechecks live materials: edits during inference stay marked stale.
        const updated = setMinutes(id, minutes)
        if (!updated) return err("not_found", "会议已删除，未保存纪要", { id })
        return { type: "meeting.minutes_result", v: 1, meeting: updated, minutes: updated.minutes }
      }
      return { type: "meeting.minutes_result", v: 1, meeting: null, minutes }
    } catch (cause) {
      logger.warn("meeting.minutes.failed", { id, error: cause instanceof Error ? cause.message : "meeting minutes failed" })
      try { if (id) setMeetingStatus(id, "error", "会议纪要生成或保存失败") } catch { /* storage may still be unavailable */ }
      return err("minutes_failed", "会议纪要生成或保存失败，原始转写仍保留，请重试", { id })
    } finally {
      if (id) minutesInFlight.delete(id)
    }
  }

  if (type === "meeting.set_status") {
    const id = resolveMeetingId(msg)
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
