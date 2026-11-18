// Chat external ASR session. PCM frames stay at or below 256 KiB and are
// assembled in a temp file. This module does not call stt-session-core.appendChunk.

import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { externalStopDecision } from "./external-asr-budget"
import {
  transcribeExternal,
  type ExternalFetchInit,
  type ExternalFetchResponse,
  type ExternalLookupAnswer,
} from "./external-asr-client"
import type { VoiceExternalConfig } from "./external-asr-config"
import { canonicalExternalUrl } from "./external-asr-url"

const CHUNK_MAX = 256 * 1024
const IDLE_MS = 15_000

export interface ExternalAsrSessionDeps {
  now: () => number
  fetchImpl?: (url: string, init: ExternalFetchInit) => Promise<ExternalFetchResponse>
  lookup?: (hostname: string) => Promise<ExternalLookupAnswer[]>
  readFile?: (path: string) => Buffer
  config: () => { sttEngine: string; external: VoiceExternalConfig }
}

interface ActiveExternal {
  id: string
  dir: string
  pcmPath: string
  fd: number
  pcmBytes: number
  lastChunkAt: number
  aborted: boolean
  stopped: boolean
  posting: boolean
  controller: AbortController | null
  lang?: string
}

function primaryLanguage(lang: string | undefined): string | null {
  if (typeof lang !== "string") return null
  const primary = lang.trim().toLowerCase().split("-")[0] ?? ""
  return /^[a-z]{2}$/.test(primary) ? primary : null
}

function wavBytes(pcm: Uint8Array): Uint8Array {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  header.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, 36 + pcm.byteLength, true)
  header.set([0x57, 0x41, 0x56, 0x45], 8)
  header.set([0x66, 0x6d, 0x74, 0x20], 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  header.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, pcm.byteLength, true)
  const wav = new Uint8Array(44 + pcm.byteLength)
  wav.set(header, 0)
  wav.set(pcm, 44)
  return wav
}

function cleanup(state: ActiveExternal) {
  try {
    closeSync(state.fd)
  } catch {
    /* already closed */
  }
  try {
    rmSync(state.dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

export function createExternalAsrSession(deps: ExternalAsrSessionDeps) {
  let active: ActiveExternal | null = null

  return {
    owns(sessionId: string) {
      return active?.id === sessionId
    },
    start(input: { sessionId: string; privacyAckExternalV1: boolean; lang?: string }) {
      const cfg = deps.config()
      if (input.privacyAckExternalV1 !== true || cfg.sttEngine !== "external" || cfg.external.apiKey === "") {
        return { ok: false as const, code: "external_unconfigured" }
      }
      if (active) return { ok: false as const, code: "session_busy" }
      const safe = input.sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "s"
      const dir = mkdtempSync(join(tmpdir(), `cmspark-external-asr-${safe}-`))
      const pcmPath = join(dir, "audio.pcm")
      active = {
        id: input.sessionId,
        dir,
        pcmPath,
        fd: openSync(pcmPath, "a"),
        pcmBytes: 0,
        lastChunkAt: deps.now(),
        aborted: false,
        stopped: false,
        posting: false,
        controller: null,
        lang: input.lang,
      }
      return { ok: true as const }
    },
    chunk(input: { sessionId: string; seq: number; pcm: Uint8Array }) {
      if (!active || active.id !== input.sessionId || active.aborted) {
        return { ok: false as const, code: "session_not_found" }
      }
      if (input.pcm.byteLength > CHUNK_MAX) {
        return { ok: false as const, code: "payload_too_large" }
      }
      if (active.stopped) return { ok: true as const, stopped: true }
      const budget = deps.config().external
      const decision = externalStopDecision({
        committedWavBytes: 44 + active.pcmBytes,
        candidatePcmBytes: input.pcm.byteLength,
        maxDurationMs: budget.maxDurationMs,
        maxBytes: budget.maxBytes,
      })
      const keepPcm = Math.max(0, decision.keepBytes - 44)
      if (keepPcm < active.pcmBytes) {
        ftruncateSync(active.fd, keepPcm)
        active.pcmBytes = keepPcm
        active.stopped = true
        return { ok: true as const, stopped: true }
      }
      const accept = keepPcm - active.pcmBytes
      if (accept > 0) {
        const bytes = Buffer.from(input.pcm.buffer, input.pcm.byteOffset, accept)
        let offset = 0
        while (offset < bytes.length) {
          offset += writeSync(active.fd, bytes, offset, bytes.length - offset)
        }
        active.pcmBytes += accept
        active.lastChunkAt = deps.now()
      }
      if (decision.reason !== "none") active.stopped = true
      return { ok: true as const, ...(active.stopped ? { stopped: true as const } : {}) }
    },
    abort(sessionId: string) {
      if (!active || active.id !== sessionId) return { sent: false }
      active.aborted = true
      active.controller?.abort()
      if (!active.posting) {
        cleanup(active)
        active = null
      }
      return { sent: false }
    },
    async end(sessionId: string) {
      const state = active
      if (!state || state.id !== sessionId) return { ok: false as const, sent: false, code: "session_not_found" }
      if (state.aborted) {
        if (active?.id === sessionId) active = null
        cleanup(state)
        return { ok: false as const, sent: false, code: "aborted" }
      }
      if (deps.now() - state.lastChunkAt >= IDLE_MS) {
        if (active?.id === sessionId) active = null
        cleanup(state)
        return { ok: false as const, sent: false, code: "external_idle" }
      }
      const cfg = deps.config()
      const canon = canonicalExternalUrl(cfg.external.style, cfg.external.baseUrl)
      if (!canon.ok || cfg.sttEngine !== "external" || cfg.external.apiKey === "") {
        if (active?.id === sessionId) active = null
        cleanup(state)
        return { ok: false as const, sent: false, code: "external_unconfigured" }
      }
      if (cfg.external.style === "openai" && cfg.external.model.trim() === "") {
        if (active?.id === sessionId) active = null
        cleanup(state)
        return { ok: false as const, sent: false, code: "external_unconfigured" }
      }
      const size = statSync(state.pcmPath).size
      const decision = externalStopDecision({
        committedWavBytes: 44,
        candidatePcmBytes: size,
        maxDurationMs: cfg.external.maxDurationMs,
        maxBytes: cfg.external.maxBytes,
      })
      if (decision.keepBytes < 44 + size) {
        if (active?.id === sessionId) active = null
        cleanup(state)
        return { ok: false as const, sent: false, code: "external_too_large" }
      }
      const pcm = (deps.readFile ?? readFileSync)(state.pcmPath)
      const wav = wavBytes(pcm)
      const language = primaryLanguage(state.lang)
      const controller = new AbortController()
      state.controller = controller
      state.posting = true
      try {
        const result = await transcribeExternal({
          style: cfg.external.style,
          url: canon.url,
          apiKey: cfg.external.apiKey,
          wav,
          ...(cfg.external.style === "openai"
            ? { model: cfg.external.model.trim(), ...(language ? { language } : {}) }
            : {}),
          timeoutMs: cfg.external.requestTimeoutMs,
          signal: controller.signal,
          fetchImpl: deps.fetchImpl,
          // An injected fetch without a lookup is an offline test. Production
          // omits both and performs one lookup. The lookup does not pin the socket.
          lookup: deps.lookup ?? (deps.fetchImpl ? async () => [{ address: "1.1.1.1", family: 4 }] : undefined),
        })
        if (!result.ok) return { ok: false as const, sent: true, code: result.code }
        return { ok: true as const, sent: true, text: result.text }
      } finally {
        if (active?.id === sessionId) active = null
        cleanup(state)
      }
    },
    partialRequest(_sessionId: string) {
      return { fetched: false as const }
    },
  }
}
