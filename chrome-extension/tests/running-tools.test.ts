import test from "node:test"
import assert from "node:assert/strict"
import {
  collectRunningTools,
  formatRunningToolsLabel,
} from "../src/sidepanel/utils/running-tools"

test("collectRunningTools finds running tool_calls newest first", () => {
  const tools = collectRunningTools([
    {
      tool_calls: [{ status: "success", tool_name: "old" }],
    },
    {
      tool_calls: [
        { status: "running", tool_name: "shell_exec", progress_elapsed_ms: 23000 },
      ],
    },
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, "shell_exec")
  assert.equal(tools[0].elapsed_ms, 23000)
})

test("collectRunningTools dedupes by name keeping newest", () => {
  const tools = collectRunningTools([
    {
      tool_calls: [{ status: "running", tool_name: "a", progress_elapsed_ms: 1000 }],
    },
    {
      tool_calls: [{ status: "running", tool_name: "a", progress_elapsed_ms: 9000 }],
    },
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0].elapsed_ms, 9000)
})

test("formatRunningToolsLabel includes seconds and more count", () => {
  const label = formatRunningToolsLabel(
    [
      { name: "shell_exec", elapsed_ms: 5000 },
      { name: "navigate" },
      { name: "click" },
      { name: "type" },
    ],
    3,
  )
  assert.equal(label, "执行中: shell_exec 5s, navigate, click +1")
})

test("formatRunningToolsLabel null when empty", () => {
  assert.equal(formatRunningToolsLabel([]), null)
})
