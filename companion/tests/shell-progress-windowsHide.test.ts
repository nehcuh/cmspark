/**
 * #au4dch SH-A: windowsHide spawn options + progress tails + tailChars.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  shellSpawnOptions,
  tailChars,
  PROGRESS_TAIL_CHARS,
  buildChildEnv,
} from "../src/capability/shell"

describe("shellSpawnOptions", () => {
  it("always sets windowsHide true (win console flash fix)", () => {
    const o = shellSpawnOptions("/tmp", buildChildEnv())
    assert.equal(o.shell, true)
    assert.equal(o.windowsHide, true)
    assert.equal(o.cwd, "/tmp")
  })
})

describe("tailChars", () => {
  it("returns full string when short", () => {
    assert.equal(tailChars("abc", 10), "abc")
  })
  it("returns last N chars when long", () => {
    const s = "x".repeat(100)
    assert.equal(tailChars(s, 10), "x".repeat(10))
    const long = "y".repeat(PROGRESS_TAIL_CHARS + 50)
    assert.equal(tailChars(long).length, PROGRESS_TAIL_CHARS)
  })
})
