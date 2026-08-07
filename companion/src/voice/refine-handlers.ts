/**
 * voice.refine.* WS handlers (Dictation+ D1b / ADR-024).
 * chrome-extension origin only; text-only; no client system prompt.
 */

import { getConfig } from "../config"
import { logger } from "../logger"
import { isChromeExtensionOrigin } from "./stt-handlers"
import { runAsrRefine, type RunAsrRefineResult } from "./asr-refiner"
import type { LlmExtractConfig } from "../llm/llm-extract"

export interface VoiceRefineHandlerContext {
  origin?: string
  peerId?: string
  send?: (data: any) => void
}

export interface VoiceRefineHandlerDeps {
  isExtensionOrigin?: (origin: string | undefined) => boolean
  getLlmConfig?: () => LlmExtractConfig | null
  runRefine?: typeof runAsrRefine
}

/** In-flight aborts keyed by refineGen (per process). */
const inflight = new Map<string, AbortController>()

function inflightKey(sessionId: string, refineGen: number): string {
  return `${sessionId}#${refineGen}`
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

function refineError(
  sessionId: string,
  refineGen: number,
  code: string,
  message: string,
) {
  return {
    type: "voice.refine.error" as const,
    v: 1 as const,
    sessionId,
    refineGen,
    code,
    message,
  }
}

function refineResult(
  sessionId: string,
  refineGen: number,
  text: string,
  unchanged: boolean,
) {
  return {
    type: "voice.refine.result" as const,
    v: 1 as const,
    sessionId,
    refineGen,
    text,
    unchanged,
  }
}

export async function handleVoiceRefineMessage(
  msg: any,
  ctx: VoiceRefineHandlerContext = {},
  deps: VoiceRefineHandlerDeps = {},
): Promise<any> {
  const type = msg?.type
  const sessionId = typeof msg?.sessionId === "string" ? msg.sessionId : ""
  const refineGen = typeof msg?.refineGen === "number" ? msg.refineGen : -1

  const originOk = (deps.isExtensionOrigin ?? isChromeExtensionOrigin)(ctx.origin)
  if (!originOk) {
    logger.warn("voice.refine.refused", {
      type: typeof type === "string" ? type : undefined,
      origin: ctx.origin ? "present" : "missing",
    })
    return refineError(sessionId, refineGen, "origin_denied", "chrome-extension origin required")
  }

  if (type === "voice.refine.abort") {
    if (!sessionId || refineGen < 0) {
      return refineError(sessionId, refineGen, "invalid_request", "sessionId and refineGen required")
    }
    const key = inflightKey(sessionId, refineGen)
    const ac = inflight.get(key)
    if (ac) {
      ac.abort()
      inflight.delete(key)
    }
    return { type: "voice.refine.aborted", v: 1, sessionId, refineGen }
  }

  if (type !== "voice.refine.request") {
    return refineError(sessionId, refineGen, "unknown_type", `unknown type ${String(type)}`)
  }

  // Ignore any client-supplied system prompt field (strip attack surface)
  if (msg?.systemPrompt != null || msg?.system_prompt != null) {
    logger.warn("voice.refine.client_prompt_ignored", { sessionId_len: sessionId.length })
  }

  const text = typeof msg?.text === "string" ? msg.text : ""
  if (!sessionId || sessionId.length > 128) {
    return refineError(sessionId, refineGen, "invalid_session_id", "invalid sessionId")
  }
  if (refineGen < 0 || !Number.isFinite(refineGen)) {
    return refineError(sessionId, refineGen, "invalid_refine_gen", "invalid refineGen")
  }
  if (!text.trim()) {
    return refineError(sessionId, refineGen, "empty_input", "empty text")
  }

  const getLlm = deps.getLlmConfig ?? llmConfigFromCompanion
  const llmCfg = getLlm()
  if (!llmCfg) {
    return refineError(
      sessionId,
      refineGen,
      "llm_not_configured",
      "Companion LLM not configured",
    )
  }

  const key = inflightKey(sessionId, refineGen)
  // Abort any previous same key
  inflight.get(key)?.abort()
  const ac = new AbortController()
  inflight.set(key, ac)

  const run = deps.runRefine ?? runAsrRefine
  let result: RunAsrRefineResult
  try {
    result = await run({ raw: text, config: llmCfg, signal: ac.signal })
  } finally {
    inflight.delete(key)
  }

  if (!result.ok) {
    return refineError(sessionId, refineGen, result.code, result.message)
  }
  return refineResult(sessionId, refineGen, result.text, result.unchanged)
}

/** Test seam */
export function _clearRefineInflightForTests(): void {
  for (const ac of inflight.values()) ac.abort()
  inflight.clear()
}
