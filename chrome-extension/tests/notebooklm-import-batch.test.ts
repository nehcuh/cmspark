import test from "node:test"
import assert from "node:assert/strict"
import { resumeIfPending, startBatch } from "../src/background/notebooklm-import-orchestrator"
import { RPC, buildAddTextSourceParams, buildAddUrlSourceParams } from "../src/notebooklm/rpc-client"
import type { BatchState } from "../src/notebooklm/types"

test("importing a URL and text sends both to the selected notebook and reports their results", async () => {
  const notebookId = "test-notebook"
  const url = "https://example.test/meeting"
  const text = "Meeting notes\nSecond line"
  const items = [{ url }, { text }]
  const calls: unknown[] = []
  const progress: BatchState[] = []
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 12, url: `https://notebooklm.google.com/notebook/${notebookId}` }] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: finish } },
    runtime: {
      sendMessage: async (message: { state: BatchState }) => {
        progress.push(structuredClone(message.state))
      },
    },
    scripting: {
      executeScript: async ({ target, args }: { target: { tabId: number }; args: string[] }) => {
        const [rpc, params, path] = args
        calls.push([target.tabId, rpc, JSON.parse(params), path])
        return [{ result: { ok: true, result: [[["00000000-0000-4000-8000-000000000001"]]] } }]
      },
    },
  } as unknown as typeof chrome

  try {
    await resumeIfPending()
    await startBatch(items, notebookId)
    await finished
    const target = `/notebook/${notebookId}`
    assert.deepEqual(calls, [
      [12, RPC.ADD_SOURCE, buildAddUrlSourceParams(notebookId, url), target],
      [12, RPC.ADD_SOURCE, buildAddTextSourceParams(notebookId, "Meeting notes Second line", text), target],
    ])
    const last = progress.at(-1)!
    assert.equal(last.status, "done")
    assert.deepEqual(last.results.map(result => [result?.item, result?.ok]), [[{ url }, true], [{ text }, true]])
  } finally {
    globalThis.chrome = previousChrome
  }
})
