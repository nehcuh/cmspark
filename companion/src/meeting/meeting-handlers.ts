/**
 * meeting.* WS handlers (SoT meeting-minutes).
 * create/start/end: chrome-extension OR summoner + cmspark-tray://local.
 * generate_minutes / append_transcript: chrome-extension OR overlay (summoner + tray).
 * auto_diarize / import_text remain extension-only.
 */

import { DATA_DIR, getConfig, getConfigSnapshot, setVoiceFields } from "../config"
import { getSttSessionService, type SttSessionService } from "../voice/stt-session-service"
import { isCaptureId, isCaptureEpoch, meetingPcmCapsSnapshot, MEETING_PCM } from "../voice/meeting-pcm-contract"
import type { MeetingPcmCapture } from "../voice/meeting-pcm-capture"
import { resolveWinSapiHelper } from "../voice/win-sapi"
import { logger } from "../logger"
import { createMeetingExternalAsr, handleMeetingAsrMessage, meetingExternalRefusal } from "../voice/external-asr-meeting"
import { isChromeExtensionOrigin, isVoiceSttOriginAllowed, sttResult } from "../voice/stt-handlers"
import { hasMeetingPcmFields, validMeetingPcmMessage } from "../voice/meeting-pcm-schema"
import type { LlmExtractConfig } from "../llm/llm-extract"
import { displayModelEndpoint, resolveMeetingTextModel } from "../model-center"
import { assertLlmEndpointUrlAllowed } from "../security"
import { generateMeetingMinutes } from "./meeting-minutes"
import { MeetingVisualEvidenceUnavailableError, readMeetingVisualEvidence } from "./meeting-visual-store"
import { visualMinutesMaterial, visualSourceList } from "./minutes-evidence"
import { createTranslationService } from "./meeting-translation"
import { createMeetingVisualService } from "./meeting-visual-handlers"
import { consumeMinutesConsent, minutesConsentFingerprint, prepareMinutesConsent } from "./minutes-consent"
import { importMeetingReference, MEETING_REFERENCE_MAX_CHARS, MEETING_REFERENCE_MAX_NAME_CHARS } from "./meeting-reference"
import { MEETING_MINUTES_MAX_INPUT_CHARS, MEETING_MINUTES_MAX_TEMPLATE_CHARS } from "./minutes-prompt"
import {
  appendTranscript,
  beginMeetingCapture,
  checkpointMeetingCapture,
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
  meetingCaptureSourceNotice,
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
  isCurrentSession?: () => boolean
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
  sttService?: SttSessionService
}

function meetingExtractConfig(llm: LlmExtractConfig): LlmExtractConfig {
  return {
    base_url: llm.base_url,
    api_key: llm.api_key,
    model_name: llm.model_name,
    temperature: typeof llm.temperature === "number" ? llm.temperature : 0.3,
    reasoning_effort: llm.reasoning_effort,
    protocol: llm.protocol,
    auth_style: llm.auth_style,
    client_header_profile: llm.client_header_profile,
    claude_code_compat_version: llm.claude_code_compat_version,
    extra_headers: llm.extra_headers,
    anthropic_version: llm.anthropic_version,
    context_window: llm.context_window,
  }
}

function err(code: string, message: string, extra?: Record<string, unknown>) {
  return { type: "meeting.error", v: 1, code, message, ...extra }
}

const minutesInFlight = new Set<string>()
const translations = createTranslationService()
const meetingVisual = createMeetingVisualService()
const externalAsr = createMeetingExternalAsr({
  config: () => getConfig().voice?.meetingAsr,
  save: meetingAsr => { setVoiceFields({ meetingAsr }) },
})

export function disconnectMeetingAsr(peerId: string) {
  meetingVisual.disconnect(peerId)
  externalAsr.disconnect(peerId)
  translations.disconnect(peerId)
}

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
  "meeting.prepare_minutes",
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
  if (typeof type === "string" && type.startsWith("meeting.visual.")) {
    if (ctx.surface !== "panel" || !ctx.isCurrentSession?.()) return err("origin_denied", "connected extension panel required")
    return meetingVisual.handle(msg, ctx.peerId, ctx.isCurrentSession)
  }
  if (typeof type === "string" && type.startsWith("meeting.translation.")) return translations.handle(msg, ctx.peerId)
  if (typeof type === "string" && type.startsWith("meeting.asr.")) {
    return handleMeetingAsrMessage(msg, ctx.peerId, externalAsr)
  }
  if ((type === "meeting.start" || type === "meeting.end") && hasMeetingPcmFields(msg) && !validMeetingPcmMessage(msg)) return err("queue_protocol_error", "invalid continuous meeting message")

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
    const service = deps.sttService ?? getSttSessionService({ dataDir: DATA_DIR })
    if (msg.queue_contract !== undefined) {
      const id = resolveMeetingId(msg)
      const existing = id ? loadMeeting(id) : null
      if (msg.queue_contract !== 1 || !isCaptureId(msg.capture_id) || !isCaptureEpoch(msg.expected_capture_epoch) ||
          msg.expected_capture_epoch >= Number.MAX_SAFE_INTEGER || !ctx.peerId ||
          msg.audio_retained === true || msg.retain_days !== undefined) return err("queue_protocol_error", "invalid continuous begin")
      if (!existing) return err("not_found", "existing meeting required")
      if (existing.privacy.audio_retained) return err("queue_protocol_error", "continuous capture does not support retained audio")
      const speaker = typeof msg.speaker === "string" && msg.speaker.trim() ? msg.speaker.slice(0, 32) : undefined
      const wantsExternal = typeof msg.live_asr === "string" && msg.live_asr !== "local"
      if (msg.live_asr !== undefined && !isChromeExtensionOrigin(ctx.origin)) return err("origin_denied", "workbench live ASR requires browser confirmation")
      const previous = service.getMeetingCapture()
      if (previous?.owns(ctx.peerId, msg.capture_id, existing.capture_epoch ?? 0) && previous.identity.meeting_id === id) {
        if (previous.identity.capture_epoch !== msg.expected_capture_epoch + 1) return err("stale_capture", "capture operation epoch changed")
        if (previous.liveTarget !== msg.live_asr) return err("stale_capture", "capture ASR target changed")
        if (previous.speaker !== speaker) return err("segment_id_conflict", "capture operation label changed")
        return { type: "meeting.started", v: 1, meeting: existing, continuous_capture: previous.status(), meeting_pcm_contract: 1, meeting_pcm_caps: meetingPcmCapsSnapshot() }
      }
      if ((existing.capture_epoch ?? 0) !== msg.expected_capture_epoch) return err("stale_capture", "capture epoch changed")
      const voice = getConfig().voice
      const external = wantsExternal ? externalAsr.openLive(msg.live_asr) : null
      if (wantsExternal && !external || msg.live_asr === "local" && voice?.meetingAsr?.mode === "external") {
        return err("external_configuration_changed", "meeting ASR configuration changed")
      }
      if (!external) {
        // The workbench pins its own local/external preference. Legacy tray
        // clients still choose their engine through the existing voice setting.
        const engine = msg.live_asr === "local" ? "local" : voice?.sttEngine
        const refusal = meetingExternalRefusal(engine)
        if (refusal) return err(refusal.code, "此录制入口只支持本机或系统转写，请在工作台核对外部接收方。")
        if (engine !== "local" && engine !== "system") return err("engine_not_local", "trusted STT engine required")
        if (engine === "system" && (process.platform !== "win32" || !resolveWinSapiHelper().ok)) return err("system_unavailable", "system STT is unavailable")
        const ready = service.checkMeetingModelReady({ sessionId: msg.capture_id, modelId: voice?.localModelId ?? "medium",
          ...(engine === "system" ? { engine: "system" as const } : {}), format: "pcm_s16le", sampleRate: 16000, channels: 1 })
        if (!ready.ok) return err(ready.code, "model not ready")
      }
      let published = false
      const capture: MeetingPcmCapture | null = service.reserveMeetingCapture({ meeting_id: id, capture_id: msg.capture_id, capture_epoch: msg.expected_capture_epoch + 1 }, ctx.peerId, {
        persist: (segment, result) => {
          const current = loadMeeting(id)
          if (!current || current.capture_epoch !== capture!.identity.capture_epoch || current.capture_summary?.last_capture_id !== msg.capture_id) throw new Error("stale_capture")
          let savedText = false
          if (result.text?.trim()) {
            const formatted = sttResult(msg.capture_id, result.text, result.ms, result.modelId)
            const saved = formatted.text?.trim() ? appendTranscript(id, { segment_id: `${msg.capture_id}-${capture!.identity.capture_epoch}-s${segment.index}`,
              t0: segment.start / MEETING_PCM.rate, t1: segment.end / MEETING_PCM.rate, text: formatted.text, source: "stt", ...(capture!.speaker ? { speaker: capture!.speaker } : {}) }) : null
            if (formatted.text?.trim() && !saved) throw new Error("save_failed")
            savedText = !!saved
          }
          // Durable range checkpoint precedes PCM release, also for empty ASR.
          checkpointMeetingCapture({ ...capture!.status(), processed_end: segment.end, committed_end: segment.end })
          return savedText
        },
        checkpoint: status => { if (published) checkpointMeetingCapture(status) },
        send: status => { if (published) ctx.send?.(status) },
      }, speaker, msg.live_asr ? {
        target: msg.live_asr, segmentFrames: external ? external.segmentMs * 16 : MEETING_PCM.segmentFrames,
        transcribe: external?.transcribe, abort: external?.abort,
      } : undefined)
      if (!capture) return err("resource_conflict", "STT slot is owned")
      try {
        const liveEngine = msg.live_asr === undefined ? undefined : external ? "external" : "local"
        const started = beginMeetingCapture(id, msg.capture_id, msg.expected_capture_epoch, DATA_DIR, liveEngine)
        if (!started) { capture.cancel(); return err("stale_capture", "meeting changed") }
        published = true
        return { type: "meeting.started", v: 1, meeting: started, continuous_capture: capture.status(), meeting_pcm_contract: 1, meeting_pcm_caps: meetingPcmCapsSnapshot() }
      } catch {
        capture.cancel()
        return err("save_failed", "capture metadata was not committed")
      }
    }
    if (service.getMeetingCapture()) return err("resource_conflict", "continuous meeting owns STT slot")
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
    const active = (deps.sttService ?? getSttSessionService({ dataDir: DATA_DIR })).getMeetingCapture()
    if (active?.identity.meeting_id === id) return err("resource_conflict", "continuous capture has not retired")
    if (msg.queue_contract === 1) {
      const existing = loadMeeting(id)
      if (!existing || existing.capture_epoch !== msg.capture_epoch || !existing.capture_summary || existing.capture_summary.last_capture_id !== msg.capture_id ||
          !["finished", "failed"].includes(existing.capture_summary.phase)) return err("stale_capture", "capture has not finished")
    }
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
    const m = loadMeeting(id, DATA_DIR, "meeting-read")
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

  if (type === "meeting.prepare_minutes" || type === "meeting.generate_minutes") {
    const id = resolveMeetingId(msg)
    const preparing = type === "meeting.prepare_minutes"
    if ((msg.text !== undefined && typeof msg.text !== "string") ||
        (msg.reference_notes !== undefined && typeof msg.reference_notes !== "string") ||
        (msg.reference_name !== undefined && typeof msg.reference_name !== "string") ||
        (msg.template_md !== undefined && typeof msg.template_md !== "string")) {
      return err("invalid_material", "转写、参考笔记和纪要模板必须为文本", { id })
    }
    if (id && minutesInFlight.has(id)) return err("generation_busy", "该会议正在生成纪要，请等待当前结果", { id })
    let generating = false
    try {
      const meeting = id ? loadMeeting(id) : null
      if (id && !meeting) return err("not_found", "meeting not found", { id })
      // An explicit current snapshot wins, including an explicit empty draft.
      const storedTranscript = meeting ? transcriptToText(meeting.transcript) : ""
      const transcriptText = (msg.text !== undefined ? msg.text : storedTranscript).trim()
      const referenceNotes = msg.reference_notes ?? meeting?.reference_notes ?? ""
      const referenceName = msg.reference_name ?? meeting?.reference_name ?? ""
      const visualEvidence = meeting ? readMeetingVisualEvidence(meeting.id) : []
      const visualChars = visualEvidence.length ? JSON.stringify(visualMinutesMaterial(visualEvidence)).length : 0
      const templateMd = msg.template_md?.trim() || undefined
      if (!transcriptText) return err("empty_transcript", "empty transcript", { id })
      if (transcriptText.length > MEETING_MINUTES_MAX_INPUT_CHARS) return err("transcript_too_long", "转写不能超过 200000 字", { id })
      if (referenceNotes.length > MEETING_REFERENCE_MAX_CHARS || referenceNotes.length + transcriptText.length > MEETING_MINUTES_MAX_INPUT_CHARS) {
        return err("reference_too_long", "转写与参考笔记合计不能超过 200000 字，参考笔记不能超过 100000 字", { id })
      }
      if (referenceName.length > MEETING_REFERENCE_MAX_NAME_CHARS) return err("invalid_reference", "参考文件名不能超过 255 字", { id })
      if (visualChars && transcriptText.length + referenceNotes.length + visualChars > MEETING_MINUTES_MAX_INPUT_CHARS) {
        return err("visual_material_too_long", "转写、参考笔记和画面材料合计不能超过 200000 字；请精简后重试", { id })
      }
      if (msg.template_md?.length > MEETING_MINUTES_MAX_TEMPLATE_CHARS) return err("template_too_long", "纪要模板过长", { id })

      const configSnapshot = getConfigSnapshot()
      const resolved = deps.getLlmConfig
        ? { llm: deps.getLlmConfig(), profileId: null, profileName: null }
        : resolveMeetingTextModel(configSnapshot)
      if (!resolved?.llm) return err("llm_not_configured", "请在模型与服务中配置会议纪要模型", { id })
      const llm = meetingExtractConfig(resolved.llm)
      if (assertLlmEndpointUrlAllowed(llm.base_url)) return err("llm_endpoint_invalid", "纪要模型端点无效，请在模型与服务中检查配置", { id })
      const owner = JSON.stringify([ctx.origin, ctx.surface, ctx.peerId])
      const fingerprint = meetingSourceFingerprint(transcriptText, referenceNotes, referenceName, visualEvidence)
      const consentFingerprint = minutesConsentFingerprint([
        configSnapshot.revision, resolved.profileId, resolved.profileName, llm, id, fingerprint, templateMd,
        meeting ? meetingSourceFingerprint(storedTranscript, meeting.reference_notes ?? "", meeting.reference_name ?? "") : null,
      ])
      if (preparing) {
        return {
          type: "meeting.minutes_prepared", v: 1, id: msg.id, consent_token: prepareMinutesConsent(owner, consentFingerprint),
          target: { model_name: llm.model_name, base_url: displayModelEndpoint(llm.base_url), profile_name: resolved.profileName },
          material: { transcript_chars: transcriptText.length, reference_chars: referenceNotes.trim().length, reference_name: referenceName.trim(), template_chars: templateMd?.length ?? 0,
            ...(visualEvidence.length ? { visual_frames: visualEvidence.length, visual_chars: visualChars, visual_sources: visualSourceList(visualEvidence) } : {}) },
        }
      }
      if (typeof msg.consent_token !== "string" || !msg.consent_token) return err("minutes_consent_required", "请确认本次纪要的材料和模型端点", { id })
      if (!consumeMinutesConsent(msg.consent_token, owner, consentFingerprint)) return err("minutes_consent_changed", "纪要材料或配置已变化，请重新核对并确认", { id })
      // Older clients can echo the token without showing the newly added visual materials.
      if (visualEvidence.length && msg.visual_frames_confirmed !== visualEvidence.length) {
        return err("visual_confirmation_required", "请在支持画面材料确认的会议界面核对发送范围", { id })
      }
      generating = true
      if (id) minutesInFlight.add(id)
      if (meeting) {
        // Preserve STT provenance when the supplied text matches existing lines.
        if (transcriptText !== storedTranscript) {
          meeting.transcript = transcriptText.split("\n").map((text: string) => ({ text, source: "user_edit" }))
        }
        meeting.reference_notes = referenceNotes
        meeting.reference_name = referenceName
        meeting.status = "generating"
        saveMeeting(meeting) // persistence failure must prevent the LLM call
      }
      const generate = deps.generate ?? generateMeetingMinutes
      const result = await generate({ transcriptText, config: llm, templateMd, referenceNotes, referenceName,
        ...(visualEvidence.length ? { visualEvidence } : {}) })
      if (!result.ok) {
        if (id) setMeetingStatus(id, "error", result.message)
        return err(result.code, result.message, { id })
      }
      const minutes = { ...result.minutes, raw_md: `> ${meetingCaptureSourceNotice(meeting?.capture_summary, visualEvidence.length)}\n\n${result.minutes.raw_md}`, source_transcript: transcriptText, source_fingerprint: fingerprint, stale: false }
      if (id) {
        // setMinutes rechecks live materials: edits during inference stay marked stale.
        const updated = setMinutes(id, minutes)
        if (!updated) return err("not_found", "会议已删除，未保存纪要", { id })
        return { type: "meeting.minutes_result", v: 1, meeting: updated, minutes: updated.minutes }
      }
      return { type: "meeting.minutes_result", v: 1, meeting: null, minutes }
    } catch (cause) {
      if (cause instanceof MeetingVisualEvidenceUnavailableError) {
        try { if (id && generating) setMeetingStatus(id, "ready") } catch { /* storage may still be unavailable */ }
        return err(cause.code, cause.message, { id })
      }
      logger.warn("meeting.minutes.failed", { id, error: cause instanceof Error ? cause.message : "meeting minutes failed" })
      try { if (id && generating) setMeetingStatus(id, "error", "会议纪要生成或保存失败") } catch { /* storage may still be unavailable */ }
      return err("minutes_failed", "会议纪要生成或保存失败，原始转写仍保留，请重试", { id })
    } finally {
      if (id && generating) minutesInFlight.delete(id)
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
