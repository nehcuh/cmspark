// UTF-16 surrogate sanitization for text leaving the filesystem for an LLM request body.
//
// Vault notes / thread content can contain LONE (unpaired) surrogates — either from corrupt
// source files (e.g. iCloud-sync hiccups) or, more commonly, from a naive string.slice() that
// splits a surrogate pair at the boundary. A lone surrogate is invalid Unicode: JSON.stringify
// emits it as `\uD8XX`, and strict server-side JSON parsers (DeepSeek's, serde_json) reject it
// as a malformed / unpaired `\u` escape (surfacing as "unexpected end of hex escape"). These
// helpers keep LLM-bound text clean.

/**
 * Replace lone (unpaired) surrogates with U+FFFD so the text round-trips through JSON.stringify
 * without producing an unpaired `\u` escape. Paired surrogates (valid astral chars, e.g. emoji)
 * are preserved.
 */
export function stripLoneSurrogates(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      // high surrogate — valid only if followed by a low surrogate
      const n = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += text[i] + text[i + 1]
        i++
      } else {
        out += "�"
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // low surrogate without a preceding high → lone
      out += "�"
    } else {
      out += text[i]
    }
  }
  return out
}

/**
 * Slice to at most `max` code units WITHOUT splitting a surrogate pair: if the cut would leave
 * a dangling high surrogate at the end, drop it. Use this instead of `text.slice(0, max)` for
 * any preview/cap derived from arbitrary text.
 */
export function safeSlice(text: string, max: number): string {
  const s = text.slice(0, max)
  const last = s.length > 0 ? s.charCodeAt(s.length - 1) : 0
  if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, -1) // drop dangling high surrogate
  return s
}
