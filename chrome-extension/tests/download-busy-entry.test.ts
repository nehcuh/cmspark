/**
 * BD-D13 production-entry tests.
 *
 * Proves DOWNLOAD_BUSY is enforced by runWithDownloadBusyBeforeQueue (the same
 * helper BrowserBridge.execute uses) BEFORE TabQueue — concurrent same-tab
 * downloads reject instead of serializing to dual success.
 *
 * Reverting D13 (busy only inside handler after queue) makes concurrent B wait
 * on TabQueue and succeed; these tests fail in that case.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { TabQueue } from "../src/background/tab-queue"
import {
  isBrowserDownloadToolName,
  runWithDownloadBusyBeforeQueue,
  type DownloadBusyToolResult,
} from "../src/background/download-busy-entry"

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

test("isBrowserDownloadToolName covers browser_download + download alias", () => {
  assert.equal(isBrowserDownloadToolName("browser_download"), true)
  assert.equal(isBrowserDownloadToolName("download"), true)
  assert.equal(isBrowserDownloadToolName("click"), false)
})

test("production entry: concurrent same-tab browser_download → DOWNLOAD_BUSY (not TabQueue serialize)", async () => {
  const busy = new Set<number>()
  const q = new TabQueue()
  let innerEntered = 0
  let releaseA!: () => void
  const aHold = new Promise<void>((r) => {
    releaseA = r
  })

  const executeInner = async (
    _name: string,
    params: Record<string, any>,
  ): Promise<DownloadBusyToolResult> => {
    innerEntered++
    await aHold
    return {
      success: true,
      data: {
        preAcquired: params.__downloadBusyPreAcquired === true,
        wave: params.wave,
      },
    }
  }

  const callA = runWithDownloadBusyBeforeQueue({
    toolName: "browser_download",
    params: { tabId: 7, text: "下载", wave: "A" },
    tabId: 7,
    downloadBusyTabs: busy,
    tabQueueRun: (id, fn) => q.run(id, fn),
    executeInner,
  })

  // Yield so A acquires busy and enters queue/inner
  await delay(15)
  assert.equal(busy.has(7), true, "A must hold busy bit before queue settles")
  assert.equal(innerEntered, 1, "A must have entered executeInner")

  // B arrives while A is still in-flight — must reject immediately, not wait on TabQueue
  const callB = await runWithDownloadBusyBeforeQueue({
    toolName: "browser_download",
    params: { tabId: 7, text: "下载", wave: "B" },
    tabId: 7,
    downloadBusyTabs: busy,
    tabQueueRun: (id, fn) => q.run(id, fn),
    executeInner,
  })

  assert.equal(callB.success, false)
  assert.equal(callB.data?.error_code, "DOWNLOAD_BUSY")
  assert.match(callB.error || "", /DOWNLOAD_BUSY/)
  assert.equal(innerEntered, 1, "B must not enter executeInner (busy before queue)")

  releaseA()
  const a = await callA
  assert.equal(a.success, true)
  assert.equal(a.data?.preAcquired, true, "execute must pass __downloadBusyPreAcquired")
  assert.equal(a.data?.wave, "A")
  assert.equal(busy.has(7), false, "busy released after A settles")
  assert.equal(busy.size, 0)
})

test("production entry: download alias also acquires busy-before-queue", async () => {
  const busy = new Set<number>()
  const q = new TabQueue()
  let releaseA!: () => void
  const aHold = new Promise<void>((r) => {
    releaseA = r
  })

  const executeInner = async (): Promise<DownloadBusyToolResult> => {
    await aHold
    return { success: true }
  }

  const callA = runWithDownloadBusyBeforeQueue({
    toolName: "download",
    params: { tabId: 3 },
    tabId: 3,
    downloadBusyTabs: busy,
    tabQueueRun: (id, fn) => q.run(id, fn),
    executeInner,
  })
  await delay(10)
  assert.equal(busy.has(3), true)

  const b = await runWithDownloadBusyBeforeQueue({
    toolName: "download",
    params: { tabId: 3 },
    tabId: 3,
    downloadBusyTabs: busy,
    tabQueueRun: (id, fn) => q.run(id, fn),
    executeInner,
  })
  assert.equal(b.data?.error_code, "DOWNLOAD_BUSY")

  releaseA()
  await callA
  assert.equal(busy.size, 0)
})

test("production entry: different tabs do not collide", async () => {
  const busy = new Set<number>()
  const q = new TabQueue()
  let concurrent = 0
  let maxConcurrent = 0

  const executeInner = async (): Promise<DownloadBusyToolResult> => {
    concurrent++
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await delay(30)
    concurrent--
    return { success: true }
  }

  const [r1, r2] = await Promise.all([
    runWithDownloadBusyBeforeQueue({
      toolName: "browser_download",
      params: { tabId: 1 },
      tabId: 1,
      downloadBusyTabs: busy,
      tabQueueRun: (id, fn) => q.run(id, fn),
      executeInner,
    }),
    runWithDownloadBusyBeforeQueue({
      toolName: "browser_download",
      params: { tabId: 2 },
      tabId: 2,
      downloadBusyTabs: busy,
      tabQueueRun: (id, fn) => q.run(id, fn),
      executeInner,
    }),
  ])
  assert.equal(r1.success, true)
  assert.equal(r2.success, true)
  assert.ok(maxConcurrent >= 2, "different tabs may run concurrently")
  assert.equal(busy.size, 0)
})

test("control: TabQueue alone would serialize (proves busy gate is what rejects)", async () => {
  // Without busy-before-queue, two same-tab runs through TabQueue both succeed.
  const q = new TabQueue()
  const order: string[] = []
  const a = q.run(9, async () => {
    order.push("a-start")
    await delay(25)
    order.push("a-end")
    return { success: true as const, wave: "A" }
  })
  const b = q.run(9, async () => {
    order.push("b-start")
    return { success: true as const, wave: "B" }
  })
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(ra.success, true)
  assert.equal(rb.success, true)
  assert.deepEqual(order, ["a-start", "a-end", "b-start"])
  // Contrast: production gate would have made B fail with DOWNLOAD_BUSY.
})

test("non-download tools skip busy set", async () => {
  const busy = new Set<number>()
  const q = new TabQueue()
  const r = await runWithDownloadBusyBeforeQueue({
    toolName: "click",
    params: { tabId: 1, selector: "a" },
    tabId: 1,
    downloadBusyTabs: busy,
    tabQueueRun: (id, fn) => q.run(id, fn),
    executeInner: async (_n, p) => {
      assert.equal(p.__downloadBusyPreAcquired, undefined)
      return { success: true }
    },
  })
  assert.equal(r.success, true)
  assert.equal(busy.size, 0)
})

