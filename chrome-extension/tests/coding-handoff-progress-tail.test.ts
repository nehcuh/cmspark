/**
 * UI progress_tail display cap — last 200 lines / 12k chars
 * (mirrors companion/src/acp/progress-caps.ts dual-synthesis intent).
 */
import test from "node:test"
import assert from "node:assert/strict"

const PROGRESS_TAIL_CLI_CHARS = 12_000
const PROGRESS_TAIL_DISPLAY_LINES = 200

function displayProgressTail(
  text: string,
  maxLines: number = PROGRESS_TAIL_DISPLAY_LINES,
  maxChars: number = PROGRESS_TAIL_CLI_CHARS,
): string {
  const raw = String(text || "")
  const charCapped = raw.length > maxChars ? raw.slice(-maxChars) : raw
  const lines = charCapped.split("\n")
  if (lines.length <= maxLines) return charCapped
  return lines.slice(-maxLines).join("\n")
}

test("displayProgressTail keeps short text intact", () => {
  assert.equal(displayProgressTail("hello\nworld"), "hello\nworld")
})

test("displayProgressTail keeps last 200 lines", () => {
  const lines = Array.from({ length: 250 }, (_, i) => `L${i}`)
  const out = displayProgressTail(lines.join("\n"))
  const outLines = out.split("\n")
  assert.equal(outLines.length, 200)
  assert.equal(outLines[0], "L50")
  assert.equal(outLines[199], "L249")
})

test("displayProgressTail applies char cap before line cap", () => {
  const long = "x".repeat(PROGRESS_TAIL_CLI_CHARS + 500)
  const out = displayProgressTail(long)
  assert.ok(out.length <= PROGRESS_TAIL_CLI_CHARS)
})
