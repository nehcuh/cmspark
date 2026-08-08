/**
 * M2 — adaptive partial_request poll interval.
 * Medium Whisper often exceeds fixed 1.4s; pace polls to last infer time
 * so we spend less time in partial_busy without starving hypotheses.
 */

export const STREAM_PARTIAL_POLL_MIN_MS = 1_400
export const STREAM_PARTIAL_POLL_MAX_MS = 6_000
export const STREAM_PARTIAL_POLL_DEFAULT_MS = 1_400

/**
 * Next poll delay after a successful hypothesis with known infer wall ms.
 * Uses 1.15× last infer, clamped to [min, max].
 */
export function nextPartialPollMs(
  lastInferMs: number | null | undefined,
  opts?: { min?: number; max?: number; defaultMs?: number },
): number {
  const min = opts?.min ?? STREAM_PARTIAL_POLL_MIN_MS
  const max = opts?.max ?? STREAM_PARTIAL_POLL_MAX_MS
  const def = opts?.defaultMs ?? STREAM_PARTIAL_POLL_DEFAULT_MS
  if (typeof lastInferMs !== "number" || !Number.isFinite(lastInferMs) || lastInferMs <= 0) {
    return def
  }
  const paced = Math.ceil(lastInferMs * 1.15)
  return Math.max(min, Math.min(max, paced))
}

/**
 * After a soft busy skip, back off slightly so we do not hammer the companion.
 */
export function backoffPartialPollMs(
  currentMs: number,
  opts?: { min?: number; max?: number },
): number {
  const min = opts?.min ?? STREAM_PARTIAL_POLL_MIN_MS
  const max = opts?.max ?? STREAM_PARTIAL_POLL_MAX_MS
  const next = Math.ceil((currentMs || min) * 1.25)
  return Math.max(min, Math.min(max, next))
}
