import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  discoverCodingAgents,
  listCodingAgentProbes,
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

  it("probes grok / kimi / opencode with vendor install dirs", () => {
    const probes = listCodingAgentProbes()
    const ids = probes.map((p) => p.id)
    for (const id of ["claude", "gemini", "codex", "pi", "grok", "kimi", "opencode"]) {
      assert.ok(ids.includes(id), `missing probe ${id}`)
    }
    const grok = probes.find((p) => p.id === "grok")!
    const kimi = probes.find((p) => p.id === "kimi")!
    const opencode = probes.find((p) => p.id === "opencode")!
    const grokVendor = path.join(os.homedir(), ".grok", "bin", "grok")
    const kimiVendor = path.join(os.homedir(), ".kimi-code", "bin", "kimi")
    const opencodeVendor = path.join(os.homedir(), ".opencode", "bin", "opencode")
    assert.ok(grok.commonPaths.includes(grokVendor), grok.commonPaths.join(","))
    assert.ok(kimi.commonPaths.includes(kimiVendor), kimi.commonPaths.join(","))
    assert.ok(opencode.commonPaths.includes(opencodeVendor), opencode.commonPaths.join(","))
    assert.ok(opencode.commonPaths.includes(path.join(os.homedir(), ".bun", "bin", "opencode")))
  })

  it("discovers grok and kimi when their vendor bins exist on this host", () => {
    const agents = discoverCodingAgents(true)
    const expectIfPresent = (id: string, candidate: string) => {
      if (!fs.existsSync(candidate)) return
      const hit = agents.find((a) => a.id === id)
      assert.ok(hit, `${id} should be discovered (candidate ${candidate})`)
      assert.ok(path.isAbsolute(hit!.command), hit!.command)
    }
    expectIfPresent("grok", path.join(os.homedir(), ".local", "bin", "grok"))
    expectIfPresent("grok", path.join(os.homedir(), ".grok", "bin", "grok"))
    expectIfPresent("kimi", path.join(os.homedir(), ".kimi-code", "bin", "kimi"))
  })
})
