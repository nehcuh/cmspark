import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  discoverCodingAgents,
  _resetDiscoverCache,
} from "../src/acp/discover"

describe("discoverCodingAgents", () => {
  beforeEach(() => {
    _resetDiscoverCache()
  })

  it("returns array and caches", () => {
    const a = discoverCodingAgents(true)
    assert.ok(Array.isArray(a))
    const b = discoverCodingAgents(false)
    assert.deepEqual(a, b)
    // On this machine we often have claude on PATH
    if (a.some((x) => x.id === "claude")) {
      const c = a.find((x) => x.id === "claude")!
      assert.ok(c.command.includes("claude") || c.command.endsWith("claude"))
      assert.ok(c.source === "path" || c.source === "common")
    }
  })
})
