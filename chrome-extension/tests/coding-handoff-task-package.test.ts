import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCodingTaskPackage,
  summarizeDialogMessages,
} from "../src/sidepanel/coding-handoff/task-package"

test("buildCodingTaskPackage includes goal, workspace, and privacy constraints", () => {
    const { markdown, hasWorkspace, title } = buildCodingTaskPackage({
      goal: "Fix empty CSV export on staging",
      workspaceRoot: "/Users/me/proj/app",
      pageUrl: "https://staging.example.com/export",
      pageTitle: "Export",
      dialogSummary: "User: export is empty",
      includePageExcerpt: false,
      createdAt: "2026-08-13T00:00:00.000Z",
    })
    assert.equal(hasWorkspace, true)
    assert.match(title, /app/)
    assert.match(markdown, /Fix empty CSV export/)
    assert.match(markdown, /\/Users\/me\/proj\/app/)
    assert.match(markdown, /staging\.example\.com/)
    assert.match(markdown, /编程接力/)
    assert.match(markdown, /Do not commit\/push/)
    assert.match(markdown, /Handback/)
})

test("buildCodingTaskPackage marks missing workspace honestly", () => {
  const { markdown, hasWorkspace } = buildCodingTaskPackage({
    goal: "review auth",
    workspaceRoot: null,
  })
  assert.equal(hasWorkspace, false)
  assert.match(markdown, /未绑定/)
})

test("buildCodingTaskPackage caps long excerpts", () => {
  const long = "x".repeat(5000)
  const { markdown } = buildCodingTaskPackage({
    goal: "g",
    pageExcerpt: long,
    includePageExcerpt: true,
  })
  assert.match(markdown, /truncated/)
  assert.ok(markdown.length < 9000)
})

test("summarizeDialogMessages takes last N messages", () => {
  const msgs = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }))
  const s = summarizeDialogMessages(msgs, 4)
  assert.match(s, /m9/)
  assert.ok(!s.includes("m0"))
})
