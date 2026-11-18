import type { ExternalAsrStyle, ExternalLimitNote } from "./external-asr-url"

export const EXTERNAL_MEMORY_GUARD_BYTES = 33_554_432
export const EXTERNAL_MIN_DURATION_MS = 1_000
export const EXTERNAL_MIN_WAV_BYTES = 32_044
export const EXTERNAL_MAX_USER_DURATION_MS = 1_800_000
export const DEEPSEEK_MAX_DURATION_MS = 120_000
export const DEEPSEEK_MAX_BYTES = 8_388_608
export const OPENAI_DOCS_MAX_BYTES = 25_000_000
export const EXTERNAL_DEFAULT_REQUEST_TIMEOUT_MS = 180_000
export const EXTERNAL_MIN_REQUEST_TIMEOUT_MS = 30_000
export const EXTERNAL_MAX_REQUEST_TIMEOUT_MS = 600_000

const HEADER = 44
const SAMPLE_BYTES = 2

export interface ExternalBudget {
  maxDurationMs: number | null
  maxBytes: number
  requestTimeoutMs: number
}

export interface ExternalBudgetInput extends ExternalBudget {
  style: ExternalAsrStyle
  limitNote: ExternalLimitNote
}

export type ExternalStopReason = "none" | "duration" | "bytes" | "both"

function integerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

export function factoryExternalBudget(style: ExternalAsrStyle, limitNote: ExternalLimitNote): ExternalBudget {
  if (style === "deepseek") {
    return { maxDurationMs: DEEPSEEK_MAX_DURATION_MS, maxBytes: DEEPSEEK_MAX_BYTES, requestTimeoutMs: EXTERNAL_DEFAULT_REQUEST_TIMEOUT_MS }
  }
  return {
    maxDurationMs: null,
    maxBytes: limitNote === "openai-file-cap" ? OPENAI_DOCS_MAX_BYTES : OPENAI_DOCS_MAX_BYTES,
    requestTimeoutMs: EXTERNAL_DEFAULT_REQUEST_TIMEOUT_MS,
  }
}

export function validateExternalBudget(input: ExternalBudgetInput): { ok: true } | { ok: false } {
  const byteMax = input.style === "deepseek"
    ? DEEPSEEK_MAX_BYTES
    : input.limitNote === "openai-file-cap"
      ? OPENAI_DOCS_MAX_BYTES
      : EXTERNAL_MEMORY_GUARD_BYTES
  if (!integerIn(input.maxBytes, EXTERNAL_MIN_WAV_BYTES, byteMax)) return { ok: false }
  if (!integerIn(input.requestTimeoutMs, EXTERNAL_MIN_REQUEST_TIMEOUT_MS, EXTERNAL_MAX_REQUEST_TIMEOUT_MS)) return { ok: false }
  if (input.maxDurationMs == null) {
    if (input.style === "deepseek") return { ok: false }
    return { ok: true }
  }
  const durationMax = input.style === "deepseek" ? DEEPSEEK_MAX_DURATION_MS : EXTERNAL_MAX_USER_DURATION_MS
  if (!integerIn(input.maxDurationMs, EXTERNAL_MIN_DURATION_MS, durationMax)) return { ok: false }
  return { ok: true }
}

function pcmCapForDuration(ms: number): number {
  return Math.floor((ms * 16_000) / 1000) * SAMPLE_BYTES
}

function pcmCapForBytes(maxBytes: number): number {
  const room = Math.max(0, maxBytes - HEADER)
  return room - (room % SAMPLE_BYTES)
}

export function externalStopDecision(args: {
  committedWavBytes: number
  candidatePcmBytes: number
  maxDurationMs: number | null
  maxBytes: number
}): { reason: ExternalStopReason; keepBytes: number } {
  const committedPcm = Math.max(0, args.committedWavBytes - HEADER)
  const alignedCommitted = committedPcm - (committedPcm % SAMPLE_BYTES)
  const candidate = Math.max(0, args.candidatePcmBytes - (args.candidatePcmBytes % SAMPLE_BYTES))
  const durationPcm = args.maxDurationMs == null ? null : pcmCapForDuration(args.maxDurationMs)
  const bytePcm = pcmCapForBytes(args.maxBytes)
  const over = (cap: number | null) => cap != null && alignedCommitted + candidate > cap
  const crossDuration = over(durationPcm)
  const crossBytes = over(bytePcm)
  const caps = [durationPcm, bytePcm].filter((cap): cap is number => cap != null)
  const effective = Math.min(...caps)
  const base = Math.min(alignedCommitted, effective)
  const accept = Math.min(candidate, Math.max(0, effective - base))
  const reason: ExternalStopReason = crossDuration && crossBytes
    ? "both"
    : crossDuration
      ? "duration"
      : crossBytes
        ? "bytes"
        : "none"
  return { reason, keepBytes: HEADER + base + accept }
}

export function externalUiWaitMs(requestTimeoutMs: number): number {
  return requestTimeoutMs + 10_000
}
