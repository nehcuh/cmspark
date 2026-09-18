/**
 * #502 D-G1 source lock for the 100-round cap exit.
 *
 * The cap ends a run, not the task, so the exit must NOT be an error frame and
 * must NOT carry the old tombstone copy — that copy told the user the run was
 * paused while the loop kernel quietly did nothing (the G1 stall).
 *
 * adapter.chatCreate is far too heavy to drive to 100 rounds in a unit test, so
 * this pins the exit shape by source lock (same technique as
 * site-op-memory.test.ts / web-act-loop-wave1.test.ts).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function adapterSource(): string {
  return readFileSync(join(process.cwd(), "src/llm/adapter.ts"), "utf8")
}

test("adapter: the 100-round exit carries no tombstone copy", () => {
  const src = adapterSource()
  // The exact user-facing string that made the stall look like an intentional
  // pause. If it ever comes back, G1 regressed.
  assert.doesNotMatch(src, /达到最大工具调用轮次/)
  assert.doesNotMatch(src, /最大工具调用轮次/)
})

test("adapter: the continuous-failure breaker copy is untouched", () => {
  const src = adapterSource()
  // G1 splits the 100-round cap out of the breakers; the 5-API-failure breaker
  // keeps its own honest copy and its circuit_breaker terminal.
  assert.match(src, /连续 \$\{CONTINUOUS_FAILURE_LIMIT\} 次失败/)
})

test("adapter: the 100-round exit is a run boundary (chat.done + round_limit)", () => {
  const src = adapterSource()
  // The while-loop exhaustion exit: chat.done, and terminal set to round_limit.
  assert.match(src, /type: "chat\.done",[\s\S]{0,400}?round_limit/)
  assert.match(src, /runStats\.terminal = "round_limit"/)
})

test("adapter: same-tool and continuous-failure breakers stay circuit_breaker", () => {
  const src = adapterSource()
  // Exactly two breaker sites: MAX_SAME_TOOL_RECOVERABLE_FAILURES and
  // CONTINUOUS_FAILURE_LIMIT. G1 must not have flipped either to round_limit.
  const breakers = src.match(/runStats\.terminal = "circuit_breaker"/g) ?? []
  assert.equal(breakers.length, 2, `expected 2 circuit_breaker sites, got ${breakers.length}`)
  const roundLimits = src.match(/runStats\.terminal = "round_limit"/g) ?? []
  assert.equal(roundLimits.length, 1, `expected 1 round_limit site, got ${roundLimits.length}`)
})

test("adapter: the 100-round exit does not emit chat.error", () => {
  const src = adapterSource()
  // Locate the exit by its runStats assignment and check the frame right before it.
  const idx = src.indexOf('runStats.terminal = "round_limit"')
  assert.ok(idx > 0, "round_limit exit not found")
  const before = src.slice(Math.max(0, idx - 600), idx)
  assert.doesNotMatch(before, /type: "chat\.error"/)
})
