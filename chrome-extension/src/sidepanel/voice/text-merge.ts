/**
 * Merge voice finals into composer base text (pure).
 * CJK: no forced space; Latin: insert space when needed.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function endsWithCjk(s: string): boolean {
  if (!s) return false
  return CJK_RE.test(s[s.length - 1]!)
}

function startsWithCjk(s: string): boolean {
  if (!s) return false
  return CJK_RE.test(s[0]!)
}

/** Join base + final chunks with light spacing rules. */
export function mergeFinalTranscript(baseText: string, finals: string[]): string {
  let out = baseText ?? ""
  for (const raw of finals) {
    const chunk = (raw || "").trim()
    if (!chunk) continue
    if (!out) {
      out = chunk
      continue
    }
    const needSpace =
      !/\s$/.test(out) &&
      !/^\s/.test(chunk) &&
      !endsWithCjk(out) &&
      !startsWithCjk(chunk) &&
      !/[([{（【「『]$/.test(out) &&
      !/^[,.!?;:，。！？；：、)\]）】」』]/.test(chunk)
    out = needSpace ? `${out} ${chunk}` : `${out}${chunk}`
  }
  return out
}

export function isEmptyFinals(finals: string[]): boolean {
  return finals.every((f) => !(f || "").trim())
}

/**
 * Composer display while voice session is active.
 * Must include `processing` (local continuous segment gaps) — otherwise
 * live overlay drops and the textarea falls back to stale draft (flash/disappear).
 */
export function voiceLiveComposerText(opts: {
  phase: string
  abortReason: string | null | undefined
  baseText: string
  finals: string[]
  interim: string
}): string | null {
  const ph = opts.phase
  const live =
    (ph === "listening" ||
      ph === "starting" ||
      ph === "stopping" ||
      ph === "processing") &&
    !opts.abortReason
  if (!live) return null
  return (
    mergeFinalTranscript(opts.baseText, opts.finals) + (opts.interim || "")
  )
}
