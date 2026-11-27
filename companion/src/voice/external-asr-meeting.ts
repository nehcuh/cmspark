import { recognitionLanguage, transcriptionText } from "./transcription-language"
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import { reduceExternalConfig, defaultVoiceExternal, type VoiceExternalConfig } from "./external-asr-config"
import { canonicalExternalUrl } from "./external-asr-url"
import { externalStopDecision, validateExternalBudget } from "./external-asr-budget"
import { transcribeExternal, type ExternalTranscribeRequest } from "./external-asr-client"

export function meetingExternalRefusal(sttEngine: string | undefined | null) {
  if (sttEngine === "external") return { code: "meeting_external_unsupported" as const }
  return null
}

export interface MeetingAsrConfig {
  mode: "local" | "external"
  external: VoiceExternalConfig
}

type Segment = { bytes: number; sha256: string }
type Delivery = "not_sent" | "unknown" | "sent"
type Import = {
  language?: string
  token: string
  identity: string
  segments: Segment[]
  next: number
  expires: number
  current?: { controller: AbortController; delivery: Delivery }
}

const MAX_WAV_BYTES = 45 * 32_000 + 44
const MAX_SEGMENTS = 3 * 60 * 60
const IDLE_MS = 2 * 60_000
const MAX_IMPORTS = 16
const sha256 = /^[0-9a-f]{64}$/
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

function validSegment(value: any): value is Segment {
  return value && Number.isInteger(value.bytes) && value.bytes >= 46 && value.bytes <= MAX_WAV_BYTES &&
    value.bytes % 2 === 0 && typeof value.sha256 === "string" && sha256.test(value.sha256)
}

function validBase64(data: unknown): data is string {
  return typeof data === "string" && data.length > 0 && data.length <= Math.ceil(MAX_WAV_BYTES / 3) * 4 &&
    data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)
}

function validExternalPatch(value: any) {
  if (value === undefined) return true
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => ["style", "baseUrl", "model", "apiKey", "maxDurationMs", "maxBytes", "requestTimeoutMs"].includes(key)) &&
    (value.style === undefined || value.style === "deepseek" || value.style === "openai") &&
    (value.baseUrl === undefined || typeof value.baseUrl === "string" && value.baseUrl.length <= 2_048) &&
    (value.model === undefined || typeof value.model === "string" && value.model.length <= 256) &&
    (value.apiKey === undefined || typeof value.apiKey === "string" && value.apiKey.length <= 4_096 && !/[\x00-\x1f\x7f]/.test(value.apiKey)) &&
    (value.maxDurationMs === undefined || value.maxDurationMs === null || Number.isSafeInteger(value.maxDurationMs)) &&
    (value.maxBytes === undefined || Number.isSafeInteger(value.maxBytes)) &&
    (value.requestTimeoutMs === undefined || Number.isSafeInteger(value.requestTimeoutMs))
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && sha256.test(value)
}

export function validMeetingAsrMessage(message: any): boolean {
  if (message?.v !== 1 || typeof message.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(message.id)) return false
  switch (message.type) {
    case "meeting.asr.get":
      return true
    case "meeting.asr.set":
      return message.source === "settings" && validIdentity(message.expected_identity) &&
        (message.mode === "local" || message.mode === "external") && validExternalPatch(message.external)
    case "meeting.asr.authorize":
      return validIdentity(message.config_identity) && message.privacy_ack_v1 === true &&
        message.privacy_ack_meeting_asr_v1 === true && (message.lang === undefined || typeof message.lang === "string" && /^[a-z]{2,8}(?:-[A-Za-z]{2,4})?$/.test(message.lang)) && Array.isArray(message.segments) &&
        message.segments.length > 0 && message.segments.length <= MAX_SEGMENTS &&
        message.segments.every(validSegment)
    case "meeting.asr.segment":
      return typeof message.token === "string" && uuid.test(message.token) &&
        Number.isSafeInteger(message.index) && message.index >= 0 && message.index < MAX_SEGMENTS &&
        validBase64(message.data)
    case "meeting.asr.cancel":
      return typeof message.token === "string" && uuid.test(message.token)
    default:
      return false
  }
}

function validWav(wav: Buffer, expected: Segment) {
  return wav.length === expected.bytes && createHash("sha256").update(wav).digest("hex") === expected.sha256 &&
    wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(4) === wav.length - 8 &&
    wav.toString("ascii", 8, 16) === "WAVEfmt " && wav.readUInt32LE(16) === 16 &&
    wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 &&
    wav.readUInt32LE(24) === 16_000 && wav.readUInt32LE(28) === 32_000 &&
    wav.readUInt16LE(32) === 2 && wav.readUInt16LE(34) === 16 &&
    wav.toString("ascii", 36, 40) === "data" && wav.readUInt32LE(40) === wav.length - 44
}

function asrError(code: string, delivery: Delivery = "not_sent") {
  return { type: "meeting.asr.error", v: 1, code, delivery } as const
}

function meetingTarget(config: MeetingAsrConfig) {
  const external = config.external
  const canon = canonicalExternalUrl(external.style, external.baseUrl)
  const keyConfigured = external.apiKey.trim() !== ""
  const ready = canon.ok && keyConfigured && (external.style === "deepseek" || external.model.trim() !== "") &&
    validateExternalBudget({ ...external, limitNote: canon.limitNote }).ok
  const bytesCap = Math.min(external.maxBytes, MAX_WAV_BYTES)
  const segmentMs = Math.min(external.maxDurationMs ?? 45_000, 45_000, Math.floor((bytesCap - 44) / 32))
  return {
    mode: config.mode, ready, style: external.style, baseUrl: external.baseUrl, normalizedUrl: canon.ok ? canon.url : "",
    model: external.style === "deepseek" ? "DeepSeek ASR" : external.model.trim(), keyConfigured,
    segmentMs, requestTimeoutMs: external.requestTimeoutMs,
  }
}

export function createMeetingExternalAsr(deps: Pick<ExternalTranscribeRequest, "fetchImpl" | "lookup"> & {
  config: () => MeetingAsrConfig | undefined
  save: (config: MeetingAsrConfig) => void
  now?: () => number
}) {
  const imports = new Map<string, Import>()
  const salt = randomBytes(32)
  const now = deps.now ?? Date.now
  let generation = 0

  function readConfig(): MeetingAsrConfig {
    const saved = deps.config()
    const mode = saved?.mode === "external" ? "external" : "local"
    const fallback = defaultVoiceExternal()
    if (!saved?.external || !validExternalPatch(saved.external)) return { mode, external: fallback }
    const baseline = { ...fallback, model: saved.external.model?.trim() ? saved.external.model : fallback.model }
    const parsed = reduceExternalConfig({ sttEngine: mode, external: baseline }, { type: "set", ...saved.external })
    return { mode, external: parsed.ok ? parsed.external : fallback }
  }

  function identity(config: MeetingAsrConfig) {
    const { mode, external: e } = config
    return createHmac("sha256", salt).update(JSON.stringify([
      generation, mode, e.style, e.baseUrl, e.apiKey, e.model, e.maxBytes, e.maxDurationMs, e.requestTimeoutMs,
    ])).digest("hex")
  }

  function state() {
    const config = readConfig()
    return { type: "meeting.asr.state", v: 1, state: { ...meetingTarget(config), configIdentity: identity(config) } } as const
  }

  function cancel(peer: string) {
    const current = imports.get(peer)?.current
    imports.delete(peer)
    current?.controller.abort()
    return current?.delivery ?? "not_sent"
  }

  return {
    state,
    disconnect: cancel,
    openLive(expected: string) {
      const config = readConfig()
      const target = meetingTarget(config)
      if (identity(config) !== expected || config.mode !== "external" || !target.ready) return null
      const controller = new AbortController()
      const current = () => !controller.signal.aborted && identity(readConfig()) === expected
      return {
        segmentMs: Math.min(target.segmentMs, 8_000),
        abort: () => controller.abort(),
        async transcribe(wav: Buffer, language?: string) {
          if (!current()) return { ok: false, code: "external_configuration_changed", message: "meeting ASR target changed" } as const
          if (wav.length > target.segmentMs * 32 + 44) return { ok: false, code: "external_too_large", message: "meeting ASR audio limit" } as const
          const result = await transcribeExternal({
            style: target.style, url: target.normalizedUrl, apiKey: config.external.apiKey, wav,
            ...(target.style === "openai" ? { model: target.model } : {}), language: recognitionLanguage(language),
            signal: controller.signal, timeoutMs: target.requestTimeoutMs,
            lookup: deps.lookup, fetchImpl: deps.fetchImpl, beforeDispatch: current,
          })
          if (!current()) return { ok: false, code: "external_configuration_changed", message: "meeting ASR target changed" } as const
          if (!result.ok) {
            if (result.code === "external_empty") return { ok: true, text: "", modelId: target.model } as const
            return { ...result, message: "meeting ASR segment failed" }
          }
          const text = result.text.replace(/^[ \t]*(?:>>[ \t]*)?\[BLANK_AUDIO\][ \t]*\r?$/gm, "").trim()
          return { ...result, text: transcriptionText(text, language), modelId: target.model }
        },
      }
    },
    set(mode: MeetingAsrConfig["mode"], expected: string, external?: Partial<VoiceExternalConfig>) {
      const config = readConfig()
      if (identity(config) !== expected) return asrError("external_configuration_changed")
      let next = { ...config, mode }
      if (external) {
        const reduced = reduceExternalConfig(
          { sttEngine: config.mode, external: config.external },
          { type: "set", ...external },
        )
        if (!reduced.ok) return asrError("external_invalid_settings")
        next = { mode, external: reduced.external }
        if (next.external.apiKey && config.external.apiKey &&
            (config.external.style !== next.external.style || meetingTarget(config).normalizedUrl !== meetingTarget(next).normalizedUrl) &&
            (!external.apiKey?.trim() || external.apiKey === "***")) return asrError("external_key_required_for_endpoint")
      }
      if (mode === "external" && !meetingTarget(next).ready) return asrError("external_unconfigured")
      const nextIdentity = identity(next)
      if (nextIdentity !== expected) {
        let saveFailed = false
        try { deps.save(next) } catch { saveFailed = true }
        if (identity(readConfig()) !== nextIdentity) return asrError(saveFailed ? "external_save_failed" : "external_save_unknown")
        generation++
      }
      return state()
    },
    authorize(peer: string, expected: string, segments: Segment[], language?: string) {
      const config = readConfig()
      if (identity(config) !== expected) return asrError("external_configuration_changed")
      if (config.mode !== "external" || !meetingTarget(config).ready) return asrError("external_unconfigured")
      const totalPcm = segments.reduce((sum, part) => sum + part.bytes - 44, 0)
      if (totalPcm > MAX_SEGMENTS * 32_000 || segments.some(part => {
        const decision = externalStopDecision({ ...config.external, committedWavBytes: 44, candidatePcmBytes: part.bytes - 44 })
        return decision.keepBytes !== part.bytes
      })) return asrError("external_too_large")
      for (const [owner, job] of imports) if (!job.current && job.expires <= now()) imports.delete(owner)
      if (imports.has(peer) || imports.size >= MAX_IMPORTS) return asrError("external_import_busy")
      const token = randomUUID()
      imports.set(peer, {
        token, identity: expected, language, segments: segments.map(part => ({ bytes: part.bytes, sha256: part.sha256 })),
        next: 0, expires: now() + IDLE_MS,
      })
      return { type: "meeting.asr.authorized", v: 1, token } as const
    },
    cancel(peer: string, token: string) {
      if (imports.get(peer)?.token !== token) return asrError("external_authorization_required", "unknown")
      return { type: "meeting.asr.cancelled", v: 1, delivery: cancel(peer) } as const
    },
    async segment(peer: string, token: string, index: number, data: string) {
      const job = imports.get(peer)
      if (!job || job.token !== token || job.expires <= now()) return asrError("external_authorization_required")
      if (job.current || job.next !== index) return asrError("external_segment_order")
      const config = readConfig()
      const target = meetingTarget(config)
      if (job.identity !== identity(config) || config.mode !== "external" || !target.ready) {
        imports.delete(peer)
        return asrError("external_configuration_changed")
      }
      const expected = job.segments[index]
      const wav = Buffer.from(data, "base64")
      if (!expected || !validWav(wav, expected) || wav.toString("base64") !== data) return asrError("external_segment_mismatch")

      const current = { controller: new AbortController(), delivery: "not_sent" as Delivery }
      job.current = current
      let configurationChanged = false
      try {
        const result = await transcribeExternal({
          style: target.style, url: target.normalizedUrl, apiKey: config.external.apiKey, wav,
          ...(target.style === "openai" ? { model: target.model } : {}),
          language: recognitionLanguage(job.language), signal: current.controller.signal, timeoutMs: target.requestTimeoutMs,
          lookup: deps.lookup, fetchImpl: deps.fetchImpl,
          beforeDispatch: () => {
            configurationChanged = identity(readConfig()) !== job.identity
            if (configurationChanged) return false
            current.delivery = "unknown"
            return true
          },
          onResponse: () => { current.delivery = "sent" },
        })
        if (configurationChanged) return asrError("external_configuration_changed", current.delivery)
        if (!result.ok) return asrError(result.code, current.delivery)
        job.next++
        job.expires = now() + IDLE_MS
        return { type: "meeting.asr.result", v: 1, index, text: transcriptionText(result.text, job.language), delivery: current.delivery } as const
      } catch {
        return asrError("external_unreachable", current.delivery)
      } finally {
        job.current = undefined
        if (imports.get(peer) === job && (job.next === index || job.next === job.segments.length)) imports.delete(peer)
      }
    },
  }
}

export function handleMeetingAsrMessage(message: any, peer: string | undefined, service: ReturnType<typeof createMeetingExternalAsr>) {
  if (!peer || !validMeetingAsrMessage(message)) return asrError("external_invalid_request")
  switch (message.type) {
    case "meeting.asr.get": return service.state()
    case "meeting.asr.set": return service.set(message.mode, message.expected_identity, message.external)
    case "meeting.asr.authorize": return service.authorize(peer, message.config_identity, message.segments, message.lang)
    case "meeting.asr.segment": return service.segment(peer, message.token, message.index, message.data)
    case "meeting.asr.cancel": return service.cancel(peer, message.token)
    default: return asrError("external_invalid_request")
  }
}
