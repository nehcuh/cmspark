import test from "node:test"
import assert from "node:assert/strict"
import {
  createDownloadWaiter,
  DownloadWaitError,
  type DownloadsApi,
} from "../src/background/download-waiter"

type Item = chrome.downloads.DownloadItem
type Delta = chrome.downloads.DownloadDelta

function mockDownloads(): DownloadsApi & {
  emitCreated: (item: Partial<Item> & { id: number }) => void
  emitChanged: (delta: Delta) => void
  setSearchResult: (items: Item[]) => void
} {
  const created: Array<(item: Item) => void> = []
  const changed: Array<(delta: Delta) => void> = []
  let searchItems: Item[] = []
  return {
    onCreated: {
      addListener(cb) {
        created.push(cb)
      },
      removeListener(cb) {
        const i = created.indexOf(cb)
        if (i >= 0) created.splice(i, 1)
      },
    },
    onChanged: {
      addListener(cb) {
        changed.push(cb)
      },
      removeListener(cb) {
        const i = changed.indexOf(cb)
        if (i >= 0) changed.splice(i, 1)
      },
    },
    async search() {
      return searchItems
    },
    emitCreated(item) {
      const full = {
        filename: "/Users/t/Downloads/a.zip",
        url: "https://example.com/a.zip",
        state: "in_progress",
        fileSize: 0,
        totalBytes: 100,
        startTime: new Date().toISOString(),
        ...item,
      } as Item
      for (const cb of [...created]) cb(full)
    },
    emitChanged(delta) {
      for (const cb of [...changed]) cb(delta)
    },
    setSearchResult(items) {
      searchItems = items
    },
  }
}

test("download waiter: created → complete success", async () => {
  const api = mockDownloads()
  const waiter = createDownloadWaiter({
    timeoutMs: 5000,
    downloadsApi: api,
  })
  api.emitCreated({ id: 42, state: "in_progress" })
  api.setSearchResult([
    {
      id: 42,
      filename: "/Users/t/Downloads/skill.zip",
      url: "https://ex/skill.zip",
      state: "complete",
      fileSize: 12345,
      totalBytes: 12345,
    } as Item,
  ])
  const p = waiter.wait()
  api.emitChanged({ id: 42, state: { current: "complete", previous: "in_progress" } })
  const info = await p
  assert.equal(info.filename, "/Users/t/Downloads/skill.zip")
  assert.equal(info.fileSize, 12345)
  waiter.dispose()
})

test("download waiter: timeout → DOWNLOAD_TIMEOUT", async () => {
  const api = mockDownloads()
  let timerFn: (() => void) | undefined
  let scheduledMs: number | undefined
  const waiter = createDownloadWaiter({
    timeoutMs: 10,
    downloadsApi: api,
    setTimer: (fn, ms) => {
      timerFn = fn
      scheduledMs = ms
      return 1 as any
    },
    clearTimer: () => {},
  })
  const p = waiter.wait()
  assert.equal(scheduledMs, 10, "setTimer must schedule with timeoutMs")
  timerFn?.()
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof DownloadWaitError)
  assert.equal((err as DownloadWaitError).code, "DOWNLOAD_TIMEOUT")
  assert.match((err as DownloadWaitError).message, /10ms/)
})

test("download waiter: interrupted → DOWNLOAD_CANCELED", async () => {
  const api = mockDownloads()
  const waiter = createDownloadWaiter({ timeoutMs: 5000, downloadsApi: api })
  api.emitCreated({ id: 7 })
  const p = waiter.wait()
  api.emitChanged({ id: 7, state: { current: "interrupted", previous: "in_progress" } })
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof DownloadWaitError)
  assert.equal((err as DownloadWaitError).code, "DOWNLOAD_CANCELED")
})

test("download waiter: ignores complete without prior onCreated (pre-existing)", async () => {
  const api = mockDownloads()
  let timerFn: (() => void) | undefined
  let scheduledMs: number | undefined
  const waiter = createDownloadWaiter({
    timeoutMs: 50,
    downloadsApi: api,
    setTimer: (fn, ms) => {
      timerFn = fn
      scheduledMs = ms
      return 1 as any
    },
    clearTimer: () => {},
  })
  api.setSearchResult([
    {
      id: 99,
      filename: "/Users/t/Downloads/old.zip",
      state: "complete",
      fileSize: 1,
      totalBytes: 1,
    } as Item,
  ])
  // Foreign / pre-existing complete only via onChanged — must NOT settle
  api.emitChanged({ id: 99, state: { current: "complete", previous: "in_progress" } })
  const p = waiter.wait()
  assert.equal(scheduledMs, 50, "setTimer must schedule with timeoutMs=50")
  // Fire timeout to prove we did not latch the foreign complete
  timerFn?.()
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof DownloadWaitError)
  assert.equal((err as DownloadWaitError).code, "DOWNLOAD_TIMEOUT")
  assert.match((err as DownloadWaitError).message, /50ms/)
})

test("download waiter: ignores concurrent foreign download complete", async () => {
  const api = mockDownloads()
  const waiter = createDownloadWaiter({ timeoutMs: 5000, downloadsApi: api })
  // Our download
  api.emitCreated({ id: 10, filename: "/Users/t/Downloads/ours.zip" })
  // Foreign download completes without onCreated for this waiter
  api.setSearchResult([
    {
      id: 11,
      filename: "/Users/t/Downloads/foreign.zip",
      state: "complete",
      fileSize: 9,
      totalBytes: 9,
    } as Item,
  ])
  api.emitChanged({ id: 11, state: { current: "complete", previous: "in_progress" } })
  // Our download completes
  api.setSearchResult([
    {
      id: 10,
      filename: "/Users/t/Downloads/ours.zip",
      state: "complete",
      fileSize: 42,
      totalBytes: 42,
      url: "https://ex/ours.zip",
    } as Item,
  ])
  const p = waiter.wait()
  api.emitChanged({ id: 10, state: { current: "complete", previous: "in_progress" } })
  const info = await p
  assert.equal(info.id, 10)
  assert.equal(info.filename, "/Users/t/Downloads/ours.zip")
  assert.equal(info.fileSize, 42)
  waiter.dispose()
})

test("download waiter: rejects onCreated with startTime before registration", async () => {
  const api = mockDownloads()
  let timerFn: (() => void) | undefined
  let scheduledMs: number | undefined
  const regNow = Date.parse("2026-07-30T12:00:00.000Z")
  const waiter = createDownloadWaiter({
    timeoutMs: 50,
    downloadsApi: api,
    now: () => regNow,
    setTimer: (fn, ms) => {
      timerFn = fn
      scheduledMs = ms
      return 1 as any
    },
    clearTimer: () => {},
  })
  api.emitCreated({
    id: 5,
    startTime: new Date(regNow - 60_000).toISOString(),
    filename: "/Users/t/Downloads/stale.zip",
  })
  api.setSearchResult([
    {
      id: 5,
      filename: "/Users/t/Downloads/stale.zip",
      state: "complete",
      fileSize: 1,
      totalBytes: 1,
    } as Item,
  ])
  api.emitChanged({ id: 5, state: { current: "complete", previous: "in_progress" } })
  const p = waiter.wait()
  assert.equal(scheduledMs, 50, "setTimer must schedule with timeoutMs=50")
  timerFn?.()
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof DownloadWaitError)
  assert.equal((err as DownloadWaitError).code, "DOWNLOAD_TIMEOUT")
})

test("download waiter: wall-clock setTimeout path honors short timeoutMs", async () => {
  // No injectable setTimer — proves production default setTimeout wiring.
  const api = mockDownloads()
  const waiter = createDownloadWaiter({
    timeoutMs: 40,
    downloadsApi: api,
  })
  const t0 = Date.now()
  let err: unknown
  try {
    await waiter.wait()
  } catch (e) {
    err = e
  }
  const elapsed = Date.now() - t0
  assert.ok(err instanceof DownloadWaitError)
  assert.equal((err as DownloadWaitError).code, "DOWNLOAD_TIMEOUT")
  assert.match((err as DownloadWaitError).message, /40ms/)
  // Allow scheduling jitter; must not resolve "instantly" without waiting.
  assert.ok(elapsed >= 25, `expected ~40ms wait, got ${elapsed}ms`)
  assert.ok(elapsed < 2000, `timeout hung too long: ${elapsed}ms`)
})
