/**
 * N5 multi-surface confirm fan-out: onTerminal fires once per terminal resolve.
 * Late respond / unknown must NOT re-fire. Wire outcome stays "unknown".
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  SecurityConfirmationManager,
  type SecurityConfirmationDecision,
} from "../src/security-confirmation"

type TerminalEvent = {
  confirmationId: string
  approved: boolean
  reason: SecurityConfirmationDecision["reason"]
}

describe("SecurityConfirmationManager onTerminal (N5)", () => {
  it("invokes onTerminal once when respond wins", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(5000)
    mgr.setOnTerminal((e) => events.push(e))
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "cid-1",
    )
    assert.equal(mgr.respond("cid-1", true), true)
    const d = await p
    assert.equal(d.approved, true)
    assert.equal(events.length, 1)
    assert.equal(events[0].confirmationId, "cid-1")
    assert.equal(events[0].reason, "approved")
    assert.equal(events[0].approved, true)
    // late respond — unknown path, no second terminal
    assert.equal(mgr.respond("cid-1", false), false)
    assert.equal(events.length, 1)
  })

  it("invokes onTerminal with denied when respond denies", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(5000)
    mgr.setOnTerminal((e) => events.push(e))
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "cid-deny",
    )
    assert.equal(mgr.respond("cid-deny", false), true)
    const d = await p
    assert.equal(d.approved, false)
    assert.equal(d.reason, "denied")
    assert.equal(events.length, 1)
    assert.equal(events[0].reason, "denied")
  })

  it("invokes onTerminal once when respondFrom wins; late is unknown", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(5000)
    mgr.setOnTerminal((e) => events.push(e))
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "cid-from",
    )
    assert.equal(mgr.respondFrom("cid-from", true).outcome, "resolved")
    await p
    assert.equal(events.length, 1)
    assert.equal(events[0].reason, "approved")
    assert.equal(mgr.respondFrom("cid-from", false).outcome, "unknown")
    assert.equal(events.length, 1)
  })

  it("invokes onTerminal on timeout with reason timeout", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(30)
    mgr.setOnTerminal((e) => events.push(e))
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "cid-to",
    )
    const d = await p
    assert.equal(d.reason, "timeout")
    assert.equal(events.length, 1)
    assert.equal(events[0].confirmationId, "cid-to")
    assert.equal(events[0].reason, "timeout")
    assert.equal(events[0].approved, false)
  })

  it("invokes onTerminal for each entry on rejectAll disconnect", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(60_000)
    mgr.setOnTerminal((e) => events.push(e))
    const p1 = mgr.request(() => {}, { toolName: "a", dangerousApis: [], code: "1" }, undefined, "r1")
    const p2 = mgr.request(() => {}, { toolName: "b", dangerousApis: [], code: "2" }, undefined, "r2")
    mgr.rejectAll("disconnect")
    const [d1, d2] = await Promise.all([p1, p2])
    assert.equal(d1.reason, "disconnect")
    assert.equal(d2.reason, "disconnect")
    assert.equal(events.length, 2)
    assert.ok(events.every((e) => e.reason === "disconnect"))
    assert.deepEqual(
      events.map((e) => e.confirmationId).sort(),
      ["r1", "r2"],
    )
  })

  it("invokes onTerminal for rejectForWorker", async () => {
    const events: TerminalEvent[] = []
    const mgr = new SecurityConfirmationManager(60_000)
    mgr.setOnTerminal((e) => events.push(e))
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1", workerId: "w1" },
      undefined,
      "cid-w",
    )
    assert.equal(mgr.rejectForWorker("w1", "disconnect"), 1)
    const d = await p
    assert.equal(d.reason, "disconnect")
    assert.equal(events.length, 1)
    assert.equal(events[0].confirmationId, "cid-w")
    assert.equal(events[0].reason, "disconnect")
  })

  it("onTerminal throw does not break resolve path", async () => {
    const mgr = new SecurityConfirmationManager(5000)
    mgr.setOnTerminal(() => {
      throw new Error("listener boom")
    })
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "cid-boom",
    )
    assert.equal(mgr.respond("cid-boom", true), true)
    const d = await p
    assert.equal(d.approved, true)
  })
})
