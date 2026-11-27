/** Strip only complete words (or CJK characters) re-recognized from the preceding audio. */
export function trimMeetingOverlap(previous: string, current: string): string {
  const words = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}])+/gu
  const before = Array.from(previous.matchAll(words)).slice(-12)
  const after = Array.from(current.matchAll(words)).slice(0, 12)
  for (let n = Math.min(before.length, after.length); n >= 1; n--) {
    if (n === 1 && after[0][0].length < 4) break
    if (after.slice(0, n).every((match, i) => match[0].toLowerCase() === before[before.length - n + i][0].toLowerCase())) {
      const last = after[n - 1]
      return current.slice(last.index! + last[0].length).replace(/^[\s\p{P}]+/u, "")
    }
  }
  return current
}
