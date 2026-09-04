/**
 * #295 review MAJOR — the live chat.assistant mid-loop echo must carry
 * tool_calls like the persisted row does, or the Side Panel honesty chip
 * mislabels a normal thinking-then-tool round as an empty reply.
 * Source-assertion lockstep (same pattern as chat-shell-copy-lockstep).
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("#295 chat.assistant mid-loop frame carries tool_calls", () => {
  const src = fs.readFileSync(srcFile("llm", "adapter.ts"), "utf8")
  const start = src.indexOf('type: "chat.assistant"')
  assert.ok(start >= 0, "chat.assistant frame missing")
  const body = src.slice(start, start + 500)
  assert.match(body, /tool_calls/, "chat.assistant frame must include tool_calls")
})
