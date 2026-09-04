// Path B M1 — voice.stt.* WS handlers (ADR-023 §7).
//
// Security:
//   - NOT source:settings (runtime Side Panel messages)
//   - Origin must be chrome-extension:// (reject tray / missing origin)
//   - peerId = connection identity (panelId); session bound in SttSessionService
//   - Never log audio base64 or full transcript

import { DATA_DIR, getConfig } from "../config"
import { logger } from "../logger"
import {
  getSttSessionService,
  resetSttSessionServiceForTests,
  type SttServiceErrorCode,
  type SttSessionService,
  type SttSessionServiceDeps,
} from "./stt-session-service"
import { applyVoicePostprocess, defaultVoicePostprocessPrefs } from "./stt-postprocess"
import { resolveWinSapiHelper } from "./win-sapi"

// --- types --------------------------------------------------------------------

export interface VoiceSttHandlerContext {
  /** WS Origin header captured at connection time. */
  origin?: string
  /** Handshake surface from wsAuth (summoner overlay vs tray menus). */
  surface?: string
  /** Connection identity (server panelId). */
  peerId?: string
  /** Unicast to origin socket (partial status). */
  send?: (data: any) => void
}

/** Injectable deps for unit tests. */
export interface VoiceSttHandlerDeps {
  service?: SttSessionService
  /** Lazy factory when service not pre-built (production). */
  getService?: () => SttSessionService
  /** Override origin gate for pure unit tests (default: real check). */
  isExtensionOrigin?: (origin: string | undefined) => boolean
  /** #259: platform / helper-resolve seams for the system engine gate. */
  platform?: NodeJS.Platform
  resolveSapi?: typeof resolveWinSapiHelper
}

// --- origin gate --------------------------------------------------------------

/**
 * ADR-023 L6 / §7.2: voice.stt.* only from chrome-extension:// peers.
 * Tray (`cmspark-tray://local`) and missing origin are refused unless the
 * overlay handshake surface is summoner (narrow amend).
 */
export function isChromeExtensionOrigin(origin: string | undefined | null): boolean {
  if (typeof origin !== "string") return false
  return /^chrome-extension:\/\/[A-Za-z0-9_-]+$/i.test(origin)
}

const TRAY_ORIGIN = "cmspark-tray://local"

/** Extension origin always. Tray origin only when surface === "summoner". */
export function isVoiceSttOriginAllowed(
  origin: string | undefined | null,
  surface?: string,
): boolean {
  if (isChromeExtensionOrigin(origin)) return true
  return origin === TRAY_ORIGIN && surface === "summoner"
}

// --- response helpers ---------------------------------------------------------

function sttError(
  sessionId: string | undefined,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return {
    type: "voice.stt.error" as const,
    v: 1 as const,
    sessionId: sessionId ?? "",
    code,
    message,
    ...extra,
  }
}

function sttPartial(
  sessionId: string,
  status: "receiving" | "transcribing" | "hypothesis",
  text?: string,
  ms?: number,
) {
  return {
    type: "voice.stt.partial" as const,
    v: 1 as const,
    sessionId,
    status,
    // M2: hypothesis text only when status === "hypothesis" (progressive re-decode)
    ...(typeof text === "string" ? { text } : {}),
    // Infer wall time so client can adapt poll cadence (medium models)
    ...(typeof ms === "number" && Number.isFinite(ms) ? { ms } : {}),
  }
}

function sttResult(sessionId: string, text: string, ms: number | undefined, modelId: string | undefined) {
  const voice = getConfig().voice
  const prefs = {
    ...defaultVoicePostprocessPrefs(),
    fillers: voice?.postprocessFillers === true,
    lowercase: voice?.postprocessLowercase === true,
    stripPunct: voice?.postprocessStripPunct === true,
    map: Array.isArray(voice?.postprocessMap) ? voice.postprocessMap : [],
  }
  const out = applyVoicePostprocess(text, prefs)
  return {
    type: "voice.stt.result" as const,
    v: 1 as const,
    sessionId,
    text: out.text,
    ms: ms ?? 0,
    modelId: modelId ?? "",
    ...(out.postprocessed ? { postprocessed: true } : {}),
  }
}

// --- service resolve ----------------------------------------------------------

function resolveService(deps: VoiceSttHandlerDeps): SttSessionService {
  if (deps.service) return deps.service
  if (deps.getService) return deps.getService()
  // Production singleton: first call initializes with DATA_DIR
  return getSttSessionService({ dataDir: DATA_DIR })
}

/** Test seam: reset singleton (delegates to session-service). */
export function _resetVoiceSttHandlersForTests(): void {
  resetSttSessionServiceForTests()
}

/** Build a service for tests (or production init with custom deps). */
export function createSttServiceForHandlers(deps: SttSessionServiceDeps): SttSessionService {
  return getSttSessionService(deps)
}

// --- handler ------------------------------------------------------------------

export async function handleVoiceSttMessage(
  msg: any,
  ctx: VoiceSttHandlerContext = {},
  deps: VoiceSttHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg ?? {}
  const sessionId = typeof rest.sessionId === "string" ? rest.sessionId : undefined

  const originOk = deps.isExtensionOrigin
    ? deps.isExtensionOrigin(ctx.origin)
    : isVoiceSttOriginAllowed(ctx.origin, ctx.surface)
  if (!originOk) {
    logger.warn("voice.stt.refused", {
      type: typeof type === "string" ? type : undefined,
      reason: "origin_not_extension",
      originClass:
        typeof ctx.origin === "string"
          ? ctx.origin.startsWith("chrome-extension:")
            ? "chrome-extension"
            : ctx.origin.startsWith("cmspark-tray:")
              ? "tray"
              : "other"
          : "missing",
    })
    return sttError(sessionId, "origin_denied", "voice.stt.* requires chrome-extension:// origin or summoner surface", {
      family: "voice.stt",
    })
  }

  const peerId = typeof ctx.peerId === "string" && ctx.peerId ? ctx.peerId : ""
  if (!peerId) {
    logger.warn("voice.stt.refused", { type, reason: "missing_peer_id" })
    return sttError(sessionId, "peer_mismatch", "connection peerId required", {
      family: "voice.stt",
    })
  }

  const service = resolveService(deps)

  switch (type) {
    case "voice.stt.start": {
      const format = rest.format
      const modelId = rest.modelId
      const sampleRate = rest.sampleRate
      const channels = rest.channels
      const maxMs = rest.maxMs
      const lang = rest.lang

      if (typeof sessionId !== "string" || !sessionId) {
        return sttError(undefined, "invalid_session_id", "sessionId required")
      }

      // #259: engine:"system" = per-session Windows SAPI fallback. Win32 +
      // helper verified + privacy_ack_v2 gates; NEVER writes config and never
      // silently drops to browser (user is already on a failed path).
      if (rest.engine === "system") {
        const platform = deps.platform ?? process.platform
        const resolveSapi = deps.resolveSapi ?? resolveWinSapiHelper
        const sapi = resolveSapi()
        const unavailable = platform !== "win32" || !sapi.ok
        const reason = platform !== "win32" ? "not_win32" : !sapi.ok ? sapi.reason : undefined
        if (unavailable) {
          logger.warn("voice.stt.start.refused", {
            reason: "system_unavailable",
            platform,
            helper: reason,
          })
          return sttError(
            sessionId,
            "system_unavailable",
            "系统语音识别不可用（Windows 系统语音或 helper 未就绪）",
            { family: "voice.stt" },
          )
        }
        if (rest.privacy_ack_v2 !== true) {
          logger.warn("voice.stt.start.refused", { reason: "need_privacy_ack_v2", engine: "system" })
          return sttError(
            sessionId,
            "need_privacy_ack",
            "privacy_ack_v2 required before system STT",
            { family: "voice.stt" },
          )
        }
        const startReq = {
          sessionId,
          modelId: typeof modelId === "string" ? modelId : "",
          engine: "system" as const,
          format: format as "pcm_s16le" | "wav",
          sampleRate: typeof sampleRate === "number" ? sampleRate : 0,
          channels: typeof channels === "number" ? channels : 0,
          ...(typeof maxMs === "number" ? { maxMs } : {}),
        }
        const r = service.start(startReq, peerId)
        if (!r.ok) {
          logger.info("voice.stt.start.rejected", { sessionId, code: r.code, engine: "system" })
          return sttError(sessionId, r.code, r.message)
        }
        logger.info("voice.stt.start.ok", {
          sessionId,
          engine: "system",
          format: typeof format === "string" ? format : undefined,
          lang: typeof lang === "string" ? lang : undefined,
        })
        const partial = sttPartial(sessionId, "receiving")
        ctx.send?.(partial)
        return partial
      }

      // P1: server-enforce engine=local + privacy_ack_v2 (client chrome.storage alone is not a gate)
      const sttEngine = getConfig().voice?.sttEngine
      if (sttEngine !== "local") {
        logger.warn("voice.stt.start.refused", { reason: "engine_not_local", sttEngine })
        return sttError(sessionId, "engine_not_local", "local STT requires voice.sttEngine=local", {
          family: "voice.stt",
        })
      }
      if (rest.privacy_ack_v2 !== true) {
        logger.warn("voice.stt.start.refused", { reason: "need_privacy_ack_v2" })
        return sttError(sessionId, "need_privacy_ack", "privacy_ack_v2 required before local STT", {
          family: "voice.stt",
        })
      }

      const startReq = {
        sessionId,
        modelId: typeof modelId === "string" ? modelId : "",
        format: format as "pcm_s16le" | "wav",
        sampleRate: typeof sampleRate === "number" ? sampleRate : 0,
        channels: typeof channels === "number" ? channels : 0,
        ...(typeof maxMs === "number" ? { maxMs } : {}),
      }

      const r = service.start(startReq, peerId)
      if (!r.ok) {
        logger.info("voice.stt.start.rejected", {
          sessionId,
          code: r.code,
          // no audio / no path
        })
        return sttError(sessionId, r.code, r.message)
      }

      logger.info("voice.stt.start.ok", {
        sessionId,
        modelId: typeof modelId === "string" ? modelId : undefined,
        format: typeof format === "string" ? format : undefined,
        lang: typeof lang === "string" ? lang : undefined,
      })
      const partial = sttPartial(sessionId, "receiving")
      ctx.send?.(partial)
      return partial
    }

    case "voice.stt.chunk": {
      if (typeof sessionId !== "string" || !sessionId) {
        return sttError(undefined, "invalid_session_id", "sessionId required")
      }
      const seq = rest.seq
      if (!Number.isInteger(seq) || (seq as number) < 0) {
        return sttError(sessionId, "seq_gap", "seq must be non-negative integer")
      }
      if (typeof rest.data !== "string") {
        return sttError(sessionId, "payload_too_large", "data must be base64 string")
      }
      // Decode base64 → raw bytes (never log rest.data)
      let buf: Buffer
      try {
        buf = Buffer.from(rest.data, "base64")
      } catch {
        return sttError(sessionId, "payload_too_large", "invalid base64 data")
      }

      const r = service.chunk(sessionId, seq as number, buf, peerId)
      if (!r.ok) {
        logger.info("voice.stt.chunk.rejected", {
          sessionId,
          seq,
          code: r.code,
          bytes: buf.length,
        })
        return sttError(sessionId, r.code, r.message)
      }
      // No per-chunk ack in protocol (fire-and-forget success)
      return undefined
    }

    case "voice.stt.partial_request": {
      // M2: progressive hypothesis re-decode (not decoder token stream)
      if (typeof sessionId !== "string" || !sessionId) {
        return sttError(undefined, "invalid_session_id", "sessionId required")
      }
      const r = await service.partial(sessionId, peerId)
      if (!r.ok) {
        // F4: progressive path is best-effort — never surface hard errors that kill the live mic session
        if (
          r.code === "partial_skipped" ||
          r.code === "partial_busy" ||
          r.code === "infer_timeout" ||
          r.code === "resource_conflict" ||
          r.code === "model_missing" ||
          r.code === "binary_missing" ||
          r.code === "hash_fail"
        ) {
          return undefined
        }
        logger.info("voice.stt.partial.rejected", { sessionId, code: r.code })
        return sttError(sessionId, r.code, r.message)
      }
      const text = typeof r.text === "string" ? r.text : ""
      // Empty hypothesis is still a partial (UI can keep previous interim)
      const partial = sttPartial(
        sessionId,
        "hypothesis",
        text,
        typeof r.ms === "number" ? r.ms : undefined,
      )
      ctx.send?.(partial)
      return partial
    }

    case "voice.stt.end": {
      if (typeof sessionId !== "string" || !sessionId) {
        return sttError(undefined, "invalid_session_id", "sessionId required")
      }
      const totalSeq = rest.totalSeq
      if (!Number.isInteger(totalSeq) || (totalSeq as number) < 0) {
        return sttError(sessionId, "total_seq_mismatch", "totalSeq must be non-negative integer")
      }

      const transcribing = sttPartial(sessionId, "transcribing")
      ctx.send?.(transcribing)

      const r = await service.end(sessionId, totalSeq as number, peerId)
      if (!r.ok) {
        logger.info("voice.stt.end.rejected", {
          sessionId,
          code: r.code,
        })
        return sttError(sessionId, r.code, r.message)
      }

      const text = typeof r.text === "string" ? r.text : ""
      if (!text.trim()) {
        logger.info("voice.stt.end.empty", { sessionId, ms: r.ms, modelId: r.modelId })
        return sttError(sessionId, "empty_result", "empty transcription", {
          modelId: r.modelId,
        })
      }

      // Audit: sizes/ms/modelId only — never full transcript
      logger.info("voice.stt.end.ok", {
        sessionId,
        ms: r.ms,
        modelId: r.modelId,
        textLen: text.length,
      })
      return sttResult(sessionId, text, r.ms, r.modelId)
    }

    case "voice.stt.abort": {
      if (typeof sessionId !== "string" || !sessionId) {
        return sttError(undefined, "invalid_session_id", "sessionId required")
      }
      const r = service.abort(sessionId, peerId)
      if (!r.ok) {
        logger.info("voice.stt.abort.rejected", { sessionId, code: r.code })
        return sttError(sessionId, r.code as SttServiceErrorCode, r.message)
      }
      logger.info("voice.stt.abort.ok", { sessionId })
      // Extension treats code "aborted" as silent
      return sttError(sessionId, "aborted", "session aborted")
    }

    default:
      return sttError(sessionId, "UNKNOWN_TYPE", `unknown voice.stt message type: ${String(type)}`, {
        family: "voice.stt",
      })
  }
}
