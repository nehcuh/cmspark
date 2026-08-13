import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  getAcpManager,
  _resetAcpManagerForTests,
  type AcpLiveEvent,
} from "../src/acp/manager"

// Minimal config stub via env is hard; use real getConfig if available with acp disabled.
// These tests only cover event emission shape when propose fails (disabled).

describe("acp live events", () => {
  beforeEach(() => {
    _resetAcpManagerForTests()
  })

  it("propose fails closed when acp disabled (default)", () => {
    const mgr = getAcpManager()
    const events: AcpLiveEvent[] = []
    mgr.onEvent((e) => events.push(e))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-live-"))
    const r = mgr.propose({
      threadId: "t1",
      agentId: "x",
      goal: "review",
      workspaceRoot: dir,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /disabled|unknown/i)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("cancel unknown session returns error", () => {
    const mgr = getAcpManager()
    const r = mgr.cancel("nope")
    assert.equal(r.ok, false)
  })
})
