/**
 * M2 local streaming — stabilize progressive Whisper re-decode hypotheses.
 * whisper.cpp has no token interim; we re-decode cumulative audio and commit
 * the longest common prefix that is stable across consecutive hypotheses.
 */

export type StabilizeResult = {
  /** Cumulative committed text (grows monotonically when possible). */
  stable: string
  /** Unstable tail of the latest hypothesis (composer interim). */
  interim: string
  /** Newly committed slice since previous stable (emit as finalChunk). */
  newlyStable: string
}

/**
 * Longest common prefix (character-level; CJK-friendly).
 */
export function longestCommonPrefix(a: string, b: string): string {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return a.slice(0, i)
}

/**
 * Given previous stable text and a new full-session hypothesis, compute
 * next stable / interim. Prefer growing stable when hypothesis extends it;
 * on revision, retreat to LCP (may shrink newlyStable to empty and shrink stable).
 */
export function stabilizeHypothesis(
  prevStable: string,
  hypothesis: string,
): StabilizeResult {
  const h = (hypothesis || "").trim()
  const prev = prevStable || ""
  if (!h) {
    return { stable: prev, interim: "", newlyStable: "" }
  }
  if (!prev) {
    // Bootstrap: keep short unstable; only commit empty newlyStable so UI shows interim.
    // Optionally commit nothing until second tick — show full as interim.
    return { stable: "", interim: h, newlyStable: "" }
  }
  if (h.startsWith(prev)) {
    const interim = h.slice(prev.length)
    return { stable: prev, interim, newlyStable: "" }
  }
  // Hypothesis revised earlier text — retreat to LCP
  const lcp = longestCommonPrefix(prev, h)
  return {
    stable: lcp,
    interim: h.slice(lcp.length),
    newlyStable: "",
  }
}

/**
 * After a second (or later) hypothesis that still extends a prefix of the first,
 * commit the shared extended stable region once two hypotheses agree on more text.
 *
 * Call with (stable, prevHypothesis, nextHypothesis):
 * - common = LCP(prevH, nextH)
 * - if common longer than stable → grow stable to common
 */
export function promoteStableByAgreement(
  prevStable: string,
  prevHypothesis: string,
  nextHypothesis: string,
): StabilizeResult {
  const prevH = (prevHypothesis || "").trim()
  const nextH = (nextHypothesis || "").trim()
  const stable0 = prevStable || ""
  if (!nextH) {
    return { stable: stable0, interim: "", newlyStable: "" }
  }
  if (!prevH) {
    return stabilizeHypothesis(stable0, nextH)
  }
  const agreed = longestCommonPrefix(prevH, nextH)
  // Only grow stable forward; never past agreed
  let stable = stable0
  let newlyStable = ""
  if (agreed.length > stable.length && agreed.startsWith(stable)) {
    newlyStable = agreed.slice(stable.length)
    stable = agreed
  } else if (!agreed.startsWith(stable) && stable.length > 0) {
    // Conflict: retreat
    stable = longestCommonPrefix(stable, agreed)
    newlyStable = ""
  }
  const interim = nextH.startsWith(stable) ? nextH.slice(stable.length) : nextH
  return { stable, interim, newlyStable }
}
