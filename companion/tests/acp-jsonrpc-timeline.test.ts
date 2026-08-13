import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSessionUpdate, timelineItem, capTimeline } from "../src/acp/timeline"

// repo-context is extension-side; mirror parse for companion isolation
function parseRepo(pageUrl: string) {
  try {
    const u = new URL(pageUrl)
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    return { owner: parts[0], name: parts[1], isPr: parts.includes("pull") }
  } catch {
    return null
  }
}

describe("timeline parseSessionUpdate", () => {
  it("maps agent_message_chunk", () => {
    const r = parseSessionUpdate({
      update: { sessionUpdate: "agent_message_chunk", content: { text: "hello world" } },
    })
    assert.ok(r.items.some((i) => i.kind === "agent_message"))
    assert.match(r.textAppend || "", /hello/)
  })

  it("maps tool_call", () => {
    const r = parseSessionUpdate({
      update: {
        sessionUpdate: "tool_call",
        title: "Read",
        path: "src/a.ts",
        status: "completed",
      },
    })
    assert.equal(r.items[0]?.kind, "tool")
    assert.match(r.items[0]?.label || "", /Read/)
  })

  it("maps plan entries", () => {
    const r = parseSessionUpdate({
      update: {
        sessionUpdate: "plan",
        entries: [{ content: "step one" }, { content: "step two" }],
      },
    })
    assert.equal(r.items[0]?.kind, "plan")
    assert.match(r.items[0]?.label || "", /step one/)
  })

  it("capTimeline keeps last N", () => {
    const items = Array.from({ length: 100 }, (_, i) => timelineItem("status", `n${i}`))
    const c = capTimeline(items, 10)
    assert.equal(c.length, 10)
    assert.match(c[9].label, /n99/)
  })
})

describe("repo parse (S5)", () => {
  it("parses github PR url", () => {
    const r = parseRepo("https://github.com/nehcuh/cmspark/pull/185")
    assert.ok(r)
    assert.equal(r!.owner, "nehcuh")
    assert.equal(r!.name, "cmspark")
    assert.equal(r!.isPr, true)
  })
})
