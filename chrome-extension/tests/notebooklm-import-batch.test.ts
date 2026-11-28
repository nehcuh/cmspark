import test from "node:test"
import assert from "node:assert/strict"
import { setImmediate } from "node:timers"
import { cancelBatch, getActiveBatch, resumeIfPending, startBatch } from "../src/background/notebooklm-import-orchestrator"
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

test("a cancelled request returning late cannot finish the replacement batch", async () => {
  const pending: Array<() => void> = []
  const storage: Record<string, BatchState> = {}
  const progress: BatchState[] = []
  const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 12, url: "https://notebooklm.google.com/notebook/test" }] },
    storage: {
      local: {
        get: async () => structuredClone(storage),
        set: async (update: Record<string, BatchState>) => { Object.assign(storage, structuredClone(update)) },
        remove: async (key: string) => { delete storage[key] },
      },
    },
    runtime: {
      sendMessage: async (message: { state: BatchState }) => { progress.push(structuredClone(message.state)) },
    },
    scripting: {
      executeScript: () => new Promise(resolve => pending.push(() => resolve([
        { result: { ok: true, result: [[["source-id"]]] } },
      ]))),
    },
  } as unknown as typeof chrome

  try {
    await resumeIfPending()
    await startBatch([{ text: "First" }], "test")
    await nextTurn()
    await cancelBatch()
    const replacement = await startBatch([{ text: "Second" }], "test")
    await nextTurn()
    assert.equal(pending.length, 2)
    pending.shift()!()
    await nextTurn()
    assert.equal(getActiveBatch()?.id, replacement.id)
    assert.equal(replacement.nextIndex, 0)
    assert.deepEqual(Object.values(storage), [replacement])
    assert.equal(progress.at(-1)?.id, replacement.id)
    assert.equal(progress.at(-1)?.status, "running")
    pending.shift()!()
    await nextTurn()
    assert.equal(replacement.status, "done")
    assert.deepEqual(replacement.results[0]?.item, { text: "Second" })
    assert.equal(progress.at(-1)?.status, "done")
    assert.deepEqual(storage, {})
  } finally {
    for (const finish of pending) finish()
    await nextTurn()
    globalThis.chrome = previousChrome
  }
})

test("cancelling while a source is waiting to retry prevents a second submission", async () => {
  const previousChrome = globalThis.chrome
  const originalTimeout = globalThis.setTimeout
  let submissions = 0
  let retryReady!: () => void
  let continueRetry!: () => void
  const waitingToRetry = new Promise<void>(resolve => { retryReady = resolve })
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 12, url: "https://notebooklm.google.com/notebook/test" }] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: { sendMessage: async () => {} },
    scripting: {
      executeScript: async () => {
        submissions++
        return [{ result: { ok: false, error: "HTTP 403" } }]
      },
    },
  } as unknown as typeof chrome
  globalThis.setTimeout = ((callback: () => void) => {
    continueRetry = callback
    retryReady()
    return 1
  }) as typeof setTimeout

  try {
    await resumeIfPending()
    await startBatch([{ url: "https://example.test/first" }], "test")
    await waitingToRetry
    await cancelBatch()
    continueRetry()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(submissions, 1)
  } finally {
    globalThis.setTimeout = originalTimeout
    globalThis.chrome = previousChrome
  }
})
