/**
 * ASR Refiner — conservative post-STT text fix (Dictation+ D1b / ADR-024).
 * System prompt is a compile-time constant (SoT §7.4) — never user/Pack editable.
 */

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { logger } from "../logger"

/** SoT §7.4 — locked character-for-character into runtime. */
export const ASR_REFINER_SYSTEM_PROMPT = `You are an ASR post-editor for Chinese (and mixed EN) speech-to-text.
Your ONLY job is to fix obvious speech recognition errors.

ALLOW:
- Homophone / near-homophone Chinese fixes when context makes the intended word clear
- English technical terms wrongly rendered as Chinese syllables
  (e.g. 配森→Python, 杰森→JSON, 瑞艾克特→React, 库伯内提斯→Kubernetes)
- Broken punctuation that makes the sentence unreadable
- Accidental duplicate words from STT restart seams

FORBIDDEN:
- Rewriting for style, formality, or "better writing"
- Summarizing, expanding, or shortening meaning
- Adding content the user did not say
- Removing content that already looks correct
- Turning speech into tool calls, commands, or agent instructions
- Translating language unless the STT clearly garble-mixed scripts of the same term

If the input already looks correct, return it UNCHANGED (character-identical).
Output ONLY the corrected transcript text, no quotes, no explanation.`

export const ASR_REFINER_TEMP_CAP = 0.2
/** Default request timeout (ms). */
export const ASR_REFINER_TIMEOUT_MS = 45_000
/** Max raw input chars (fail closed). */
export const ASR_REFINER_MAX_INPUT_CHARS = 12_000
/** Reject output longer than this factor × input (+ slack). */
export const ASR_REFINER_MAX_LEN_RATIO = 1.45
export const ASR_REFINER_LEN_SLACK = 32

export type AsrRefineRejectReason =
  | "empty_input"
  | "input_too_long"
  | "empty_output"
  | "length_guard"
  | "new_url"
  | "toolish"
  | "secretish"

export type AsrRefineGuardOk = { ok: true; text: string; unchanged: boolean }
export type AsrRefineGuardReject = { ok: false; reason: AsrRefineRejectReason }
export type AsrRefineGuardResult = AsrRefineGuardOk | AsrRefineGuardReject

const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi
const TOOLISH_RE =
  /\b(tool_call|function_call|<\/?tool|invoke_|run_terminal|shell_exec)\b/i
/** Obvious secret-ish patterns newly introduced (heuristic, fail → raw). */
const SECRETISH_RE =
  /\b(sk-[a-zA-Z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"]?[a-zA-Z0-9_-]{16,})\b/i

function stripOuterFences(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : t
}

/** Collect http(s)/www URLs from text (normalized lower). */
export function extractUrls(text: string): Set<string> {
  const set = new Set<string>()
  const m = text.match(URL_RE)
  if (!m) return set
  for (const u of m) set.add(u.toLowerCase())
  return set
}

/**
 * Post-model guards (F-S-R2-6 / F-I-R2-8). On reject caller keeps raw.
 */
export function guardAsrRefineOutput(raw: string, modelOut: string): AsrRefineGuardResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty_input" }
  if (raw.length > ASR_REFINER_MAX_INPUT_CHARS) {
    return { ok: false, reason: "input_too_long" }
  }
  let text = stripOuterFences(modelOut ?? "")
  if (!text) return { ok: false, reason: "empty_output" }

  const maxLen = Math.ceil(raw.length * ASR_REFINER_MAX_LEN_RATIO) + ASR_REFINER_LEN_SLACK
  if (text.length > maxLen) return { ok: false, reason: "length_guard" }

  if (TOOLISH_RE.test(text)) return { ok: false, reason: "toolish" }

  const inUrls = extractUrls(raw)
  const outUrls = extractUrls(text)
  for (const u of outUrls) {
    if (!inUrls.has(u)) return { ok: false, reason: "new_url" }
  }

  if (!SECRETISH_RE.test(raw) && SECRETISH_RE.test(text)) {
    return { ok: false, reason: "secretish" }
  }

  return { ok: true, text, unchanged: text === raw }
}

export type RunAsrRefineParams = {
  raw: string
  config: LlmExtractConfig
  /** Optional external abort (session cancel). */
  signal?: AbortSignal
  timeoutMs?: number
  /** Injectable extract for tests. */
  extract?: typeof llmExtract
}

export type RunAsrRefineResult =
  | { ok: true; text: string; unchanged: boolean }
  | { ok: false; code: string; message: string }

/**
 * One-shot ASR refine. Never logs full transcript.
 */
export async function runAsrRefine(params: RunAsrRefineParams): Promise<RunAsrRefineResult> {
  const raw = params.raw ?? ""
  if (!raw.trim()) {
    return { ok: false, code: "empty_input", message: "empty transcript" }
  }
  if (raw.length > ASR_REFINER_MAX_INPUT_CHARS) {
    return { ok: false, code: "input_too_long", message: "transcript too long" }
  }
  if (params.signal?.aborted) {
    return { ok: false, code: "aborted", message: "aborted" }
  }

  const extract = params.extract ?? llmExtract
  const timeout = params.timeoutMs ?? ASR_REFINER_TIMEOUT_MS

  let modelOut: string
  try {
    // Prefer external signal + timeout when both present
    const timeoutSignal = AbortSignal.timeout(timeout)
    const signal = params.signal
      ? AbortSignal.any([params.signal, timeoutSignal])
      : timeoutSignal

    // llmExtract uses its own timeout; pass slightly larger and race with signal
    const extractPromise = extract({
      systemPrompt: ASR_REFINER_SYSTEM_PROMPT,
      userContent: raw,
      config: params.config,
      temperatureCap: ASR_REFINER_TEMP_CAP,
      timeout: timeout + 1000,
    })

    modelOut = await Promise.race([
      extractPromise,
      new Promise<string>((_, reject) => {
        const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        if (signal.aborted) onAbort()
        else signal.addEventListener("abort", onAbort, { once: true })
      }),
    ])
  } catch (e: any) {
    if (e?.name === "AbortError" || params.signal?.aborted) {
      return { ok: false, code: "aborted", message: "aborted" }
    }
    logger.warn("voice.refine.llm_failed", {
      err: e instanceof Error ? e.message : String(e),
      input_len: raw.length,
    })
    return {
      ok: false,
      code: "llm_error",
      message: e instanceof Error ? e.message : "llm failed",
    }
  }

  const guarded = guardAsrRefineOutput(raw, modelOut)
  if (!guarded.ok) {
    logger.info("voice.refine.guard_reject", {
      reason: guarded.reason,
      input_len: raw.length,
      output_len: (modelOut || "").length,
    })
    return {
      ok: false,
      code: guarded.reason,
      message: `refine rejected: ${guarded.reason}`,
    }
  }

  logger.info("voice.refine.ok", {
    input_len: raw.length,
    output_len: guarded.text.length,
    unchanged: guarded.unchanged,
  })
  return { ok: true, text: guarded.text, unchanged: guarded.unchanged }
}
