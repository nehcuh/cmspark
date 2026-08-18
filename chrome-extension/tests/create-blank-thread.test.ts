import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("S2.1 createBlankThread inherits live config — no DeepSeek stamp", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/ThreadList.tsx"),
    "utf8",
  )
  const start = src.indexOf("export function createBlankThread")
  assert.ok(start >= 0, "createBlankThread export missing")
  const end = src.indexOf("function generateShortId", start)
  const fn = src.slice(start, end > start ? end : start + 800)
  assert.match(fn, /config_override:\s*\{\}\s*as Thread/)
  assert.ok(!/provider:\s*["']deepseek["']/i.test(fn))
  assert.ok(!/model:\s*["']deepseek/i.test(fn))
})
