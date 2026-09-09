import test from "node:test"
import assert from "node:assert/strict"
import { createToolExecutor, handleToolResult, seedExtensionWsAuthForTests } from "../src/server"
import { resolveBrowserSiteTarget } from "../src/site-context/browser-resolver"
import { siteTargetFromBrowser } from "../src/site-context/target"

function browserHarness(success = true) {
  const sent: any[] = []
  const ws = {
    readyState: 1,
    send(raw: string) {
      const frame = JSON.parse(raw)
      sent.push(frame)
      if (frame.type === "tool.execute") {
        queueMicrotask(() => handleToolResult({
          tool_call_id: frame.tool_call_id,
          result: success
            ? { success: true, data: { site_target: siteTargetFromBrowser(17, "https://example.com/change", Date.now()) } }
            : { success: false, error: "Tab no longer exists" },
        }, ws as any))
      }
    },
  }
  seedExtensionWsAuthForTests(ws as any)
  return { sent, execute: createToolExecutor(ws as any) }
}

test("#496: metadata discovery must not leave an unpaired chat tool.start", async () => {
  const { sent, execute } = browserHarness()
  const target = await resolveBrowserSiteTarget(execute, "thread-496", 17)
  assert.equal(target?.tab_id, 17, "metadata must still use the authenticated browser executor")
  assert.equal(sent.filter(frame => frame.type === "tool.execute").length, 1)
  assert.deepEqual(sent.filter(frame => frame.type === "tool.start"), [],
    "internal metadata is not an LLM tool call and has no adapter-owned tool.result")
})

test("#496: failed metadata reads do not create running chat tools either", async () => {
  const { sent, execute } = browserHarness(false)
  assert.equal(await resolveBrowserSiteTarget(execute, "thread-496", 17), undefined)
  assert.equal(sent.filter(frame => frame.type === "tool.execute").length, 1)
  assert.equal(sent.filter(frame => frame.type === "tool.start").length, 0)
})

test("#496: ordinary list_tabs stays visible, even with spoofed internal params or id", async () => {
  const { sent, execute } = browserHarness()
  const id = "site-context-model-supplied-id"
  await execute(id, "list_tabs", { __thread_id: "thread-496", __site_context_tab_id: 17 })
  const starts = sent.filter(frame => frame.type === "tool.start")
  assert.equal(starts.length, 1)
  assert.equal(starts[0].tool_call_id, id)
  assert.equal(starts[0].thread_id, "thread-496")
  assert.equal(sent.find(frame => frame.type === "tool.execute").params.__site_context_tab_id, undefined)
})

test("#496: invalid internal tab options cannot hide ordinary tool starts", async () => {
  for (const siteContextTabId of [-1, NaN, 1.5]) {
    const { sent, execute } = browserHarness()
    await execute("ordinary-list-tabs", "list_tabs", { __thread_id: "thread-496" }, undefined, { siteContextTabId })
    assert.equal(sent.filter(frame => frame.type === "tool.start").length, 1)
  }
})
