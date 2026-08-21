import test from "node:test"
import assert from "node:assert/strict"
import { runBrowserDownload, type BrowserDownloadBridge } from "../src/background/browser-download-handler"
import type { DownloadsApi } from "../src/background/download-waiter"

type Item = chrome.downloads.DownloadItem
type Delta = chrome.downloads.DownloadDelta

function mockBridge(overrides: Partial<BrowserDownloadBridge> = {}): BrowserDownloadBridge {
  const bridge: BrowserDownloadBridge = {
    getTabId: (p) => {
      if (typeof p.tabId !== "number") throw new Error("tabId is required")
      return p.tabId
    },
    sendCdp: async () => ({}),
    scriptingExecute: async () => null,
    click: async () => ({ success: true }),
    resolveLocator: async (tabId, params) => {
      const text = typeof params.text === "string" && params.text.trim() ? params.text.trim() : undefined
      const selector =
        typeof params.selector === "string" && params.selector.trim() ? params.selector.trim() : undefined
      if (!text && !selector) {
        return {
          ok: false,
          result: {
            success: false,
            error: "SELECTOR_OR_TEXT_REQUIRED: provide text or selector",
            data: { error_code: "SELECTOR_OR_TEXT_REQUIRED" },
          },
        }
      }
      if (text) {
        let match: { count?: number; matches?: Array<{ x: number; y: number }> } | null = null
        try {
          const r = await bridge.sendCdp(tabId, "Runtime.evaluate", {})
          match = r?.result?.value ?? null
        } catch {
          match = null
        }
        const count = match?.count ?? 0
        if (count <= 0) {
          return {
            ok: false,
            result: {
              success: false,
              error: `ELEMENT_NOT_FOUND: no visible element matching text "${text}"`,
              data: { error_code: "ELEMENT_NOT_FOUND" },
            },
          }
        }
        if (count > 1) {
          return {
            ok: false,
            result: {
              success: false,
              error: `ELEMENT_AMBIGUOUS: ${count} elements match text "${text}"`,
              data: {
                error_code: "ELEMENT_AMBIGUOUS",
                count,
                matches: match?.matches,
                user_hint_zh: `页面上有 ${count} 处匹配「${text}」`,
                suggested_action: "disambiguate_selector_or_exact_text",
              },
            },
          }
        }
        const m0 = match?.matches?.[0]
        if (m0 && typeof m0.x === "number") return { ok: true, coords: { x: m0.x, y: m0.y } }
        return { ok: true, selector: '[data-cmspark-dl-hit="1"]' }
      }
      return { ok: true, selector }
    },
    downloadBusyTabs: new Set<number>(),
    ...overrides,
  }
  return bridge
}

function hangDownloadsApi(): DownloadsApi & {
  emitCreated: (item: Partial<Item> & { id: number }) => void
  emitChanged: (delta: Delta) => void
} {
  const created: Array<(item: Item) => void> = []
  const changed: Array<(delta: Delta) => void> = []
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
      return []
    },
    emitCreated(item) {
      const full = {
        filename: "/Users/t/Downloads/a.zip",
        url: "https://example.com/a.zip",
        state: "in_progress",
        startTime: new Date().toISOString(),
        ...item,
      } as Item
      for (const cb of [...created]) cb(full)
    },
    emitChanged(delta) {
      for (const cb of [...changed]) cb(delta)
    },
  }
}

function singleTextMatchCdp() {
  return async (_tab: number, method: string) => {
    if (method === "Runtime.evaluate") {
      return {
        result: {
          value: {
            count: 1,
            matches: [{ tag: "a", text: "下载", x: 10, y: 20 }],
          },
        },
      }
    }
    return {}
  }
}

test("runBrowserDownload: concurrent same tab → DOWNLOAD_BUSY (pre-seed)", async () => {
  const bridge = mockBridge()
  bridge.downloadBusyTabs.add(9)
  const r = await runBrowserDownload(bridge, { tabId: 9, text: "下载" })
  assert.equal(r.success, false)
  assert.match(r.error || "", /DOWNLOAD_BUSY/)
  assert.equal(r.data?.error_code, "DOWNLOAD_BUSY")
})

test("runBrowserDownload: in-flight acquire + concurrent same tab → DOWNLOAD_BUSY", async () => {
  const bridge = mockBridge({ sendCdp: singleTextMatchCdp() })
  const hang = hangDownloadsApi()
  let timerFn: (() => void) | undefined

  let scheduledMs: number | undefined
  const callA = runBrowserDownload(bridge, {
    tabId: 5,
    text: "下载",
    timeoutMs: 60_000,
    __downloadsApi: hang,
    __setTimer: (fn: () => void, ms: number) => {
      timerFn = fn
      scheduledMs = ms
      return 1 as any
    },
    __clearTimer: () => {},
  })

  // Yield so callA can acquire busy, finish click, and attach waiter.wait()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(bridge.downloadBusyTabs.has(5), true, "A must acquire busy bit")
  assert.equal(scheduledMs, 60_000, "production setTimer must use timeoutMs=60000")

  const callB = await runBrowserDownload(bridge, { tabId: 5, text: "下载" })
  assert.equal(callB.success, false)
  assert.equal(callB.data?.error_code, "DOWNLOAD_BUSY")
  assert.match(callB.error || "", /DOWNLOAD_BUSY/)

  // Finish A via timeout only after wait() is attached (avoids unhandled rejection)
  assert.ok(timerFn, "waiter must register timeout timer")
  const aSettled = callA
  timerFn!()
  const a = await aSettled
  assert.equal(a.success, false)
  assert.equal(a.data?.error_code, "DOWNLOAD_TIMEOUT")
  assert.match(a.error || "", /60000ms|60.?000/)
  assert.equal(bridge.downloadBusyTabs.has(5), false, "busy released after A settles")
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: selector and text both empty → error + busy not held", async () => {
  const bridge = mockBridge()
  const r = await runBrowserDownload(bridge, { tabId: 1 })
  assert.equal(r.success, false)
  assert.ok(
    (r.error || "").includes("selector") ||
      (r.error || "").includes("text") ||
      r.data?.error_code === "SELECTOR_OR_TEXT_REQUIRED",
  )
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: UNC path → PATH_ESCAPE + busy not held", async () => {
  const bridge = mockBridge()
  const r = await runBrowserDownload(bridge, {
    tabId: 1,
    text: "下载",
    downloadPath: "\\\\evil\\share\\x",
  })
  assert.equal(r.success, false)
  assert.match(r.error || "", /PATH_ESCAPE/)
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: text zero match → ELEMENT_NOT_FOUND + busy released", async () => {
  const bridge = mockBridge({
    sendCdp: async (_tab, method) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { count: 0, matches: [] } } }
      }
      return {}
    },
  })
  const r = await runBrowserDownload(bridge, { tabId: 3, text: "下载" })
  assert.equal(r.success, false)
  assert.match(r.error || "", /ELEMENT_NOT_FOUND/)
  assert.equal(r.data?.error_code, "ELEMENT_NOT_FOUND")
  assert.equal(bridge.downloadBusyTabs.size, 0)
  assert.equal(bridge.downloadBusyTabs.has(3), false)
})

test("runBrowserDownload: text multi-match → ELEMENT_AMBIGUOUS + busy released", async () => {
  const bridge = mockBridge({
    sendCdp: async (_tab, method) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            value: {
              count: 2,
              matches: [
                { tag: "a", text: "下载", x: 1, y: 1 },
                { tag: "button", text: "下载", x: 2, y: 2 },
              ],
            },
          },
        }
      }
      return {}
    },
  })
  const r = await runBrowserDownload(bridge, { tabId: 3, text: "下载" })
  assert.equal(r.success, false)
  assert.match(r.error || "", /ELEMENT_AMBIGUOUS/)
  assert.equal(r.data?.error_code, "ELEMENT_AMBIGUOUS")
  assert.equal(r.data?.count, 2)
  assert.match(String(r.data?.user_hint_zh || ""), /匹配/)
  assert.ok(Array.isArray(r.data?.matches) && r.data.matches.length >= 2)
  assert.equal(bridge.downloadBusyTabs.size, 0)
  assert.equal(bridge.downloadBusyTabs.has(3), false)
})

test("runBrowserDownload: DOWNLOAD_TIMEOUT via injectable downloads API + busy released", async () => {
  const bridge = mockBridge({ sendCdp: singleTextMatchCdp() })
  const hang = hangDownloadsApi()
  let timerFn: (() => void) | undefined
  let scheduledMs: number | undefined
  const p = runBrowserDownload(bridge, {
    tabId: 8,
    text: "下载",
    timeoutMs: 5_000,
    __downloadsApi: hang,
    __setTimer: (fn: () => void, ms: number) => {
      timerFn = fn
      scheduledMs = ms
      return 1 as any
    },
    __clearTimer: () => {},
  })
  // Wait until click path done and wait() is attached
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(bridge.downloadBusyTabs.has(8), true)
  assert.ok(timerFn, "timeout timer registered")
  assert.equal(scheduledMs, 5_000, "setTimer ms must equal timeoutMs=5000")
  timerFn!()
  const r = await p
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "DOWNLOAD_TIMEOUT")
  assert.match(r.error || "", /DOWNLOAD_TIMEOUT/)
  assert.match(r.error || "", /5000ms/)
  assert.equal(r.data?.suggested_action, "downloads_find_then_skill_install")
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: force_redownload + TIMEOUT must NOT recover pre-existing cache", async () => {
  const bridge = mockBridge({ sendCdp: singleTextMatchCdp() })
  const completeItem = {
    id: 58,
    filename: "/Users/t/Downloads/dashiai-ppt-skill-main.zip",
    url: "https://github.com/x/dashiai-ppt-skill/archive/refs/heads/main.zip",
    state: "complete",
    exists: true,
    fileSize: 46339298,
    totalBytes: 46339298,
    endTime: new Date().toISOString(),
  } as Item
  const api: DownloadsApi = {
    onCreated: {
      addListener() {},
      removeListener() {},
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
    async search() {
      return [completeItem]
    },
  }
  let timerFn: (() => void) | undefined
  const p = runBrowserDownload(bridge, {
    tabId: 11,
    text: "Download ZIP",
    filenameHint: "dashiai-ppt-skill",
    timeoutMs: 3_000,
    force_redownload: true,
    __downloadsApi: api,
    __setTimer: (fn: () => void) => {
      timerFn = fn
      return 1 as any
    },
    __clearTimer: () => {},
  })
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(timerFn)
  timerFn!()
  const r = await p
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "DOWNLOAD_TIMEOUT")
  assert.equal(r.data?.force_redownload, true)
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: TIMEOUT recovers only post-op complete (not stale shelf)", async () => {
  const bridge = mockBridge({ sendCdp: singleTextMatchCdp() })
  const now = Date.now()
  const stale = {
    id: 1,
    filename: "/Users/t/Downloads/dashiai-ppt-skill-main.zip",
    url: "https://github.com/x/old.zip",
    state: "complete",
    exists: true,
    fileSize: 1,
    endTime: new Date(now - 86_400_000).toISOString(),
    startTime: new Date(now - 86_400_000).toISOString(),
  } as Item
  const fresh = {
    id: 58,
    filename: "/Users/t/Downloads/dashiai-ppt-skill-main.zip",
    url: "https://github.com/x/dashiai-ppt-skill/archive/refs/heads/main.zip",
    state: "complete",
    exists: true,
    fileSize: 46339298,
    endTime: new Date(now).toISOString(),
    startTime: new Date(now - 500).toISOString(),
  } as Item
  const api: DownloadsApi = {
    onCreated: {
      addListener() {},
      removeListener() {},
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
    async search() {
      // Newest first (Chrome orderBy -startTime); stale would win without time floor
      return [stale, fresh]
    },
  }
  let timerFn: (() => void) | undefined
  const p = runBrowserDownload(bridge, {
    tabId: 12,
    text: "Download ZIP",
    filenameHint: "dashiai-ppt-skill",
    timeoutMs: 3_000,
    prefer_existing: false, // exercise click path then timeout recovery
    force_redownload: false,
    __now: () => now,
    __downloadsApi: api,
    __setTimer: (fn: () => void) => {
      timerFn = fn
      return 1 as any
    },
    __clearTimer: () => {},
  })
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(timerFn)
  timerFn!()
  const r = await p
  assert.equal(r.success, true, r.error)
  assert.equal(r.data?.source, "cache_after_timeout")
  assert.equal(r.data?.download_id, 58)
  assert.equal(r.data?.bytes, 46339298)
  assert.equal(bridge.downloadBusyTabs.size, 0)
})

test("runBrowserDownload: success path mock created→complete", async () => {
  const bridge = mockBridge({ sendCdp: singleTextMatchCdp() })
  const created: Array<(item: Item) => void> = []
  const changed: Array<(delta: Delta) => void> = []
  let searchItems: Item[] = []
  const api: DownloadsApi = {
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
  }

  const p = runBrowserDownload(bridge, {
    tabId: 2,
    text: "下载",
    timeoutMs: 5000,
    __downloadsApi: api,
  })
  await new Promise((r) => setTimeout(r, 15))
  // Simulate onCreated after click
  for (const cb of created) {
    cb({
      id: 77,
      filename: "/Users/t/Downloads/report.pdf",
      url: "https://ex/report.pdf",
      state: "in_progress",
      startTime: new Date().toISOString(),
      fileSize: 0,
      totalBytes: 99,
    } as Item)
  }
  searchItems = [
    {
      id: 77,
      filename: "/Users/t/Downloads/report.pdf",
      url: "https://ex/report.pdf",
      state: "complete",
      fileSize: 99,
      totalBytes: 99,
    } as Item,
  ]
  for (const cb of changed) {
    cb({ id: 77, state: { current: "complete", previous: "in_progress" } })
  }
  const r = await p
  assert.equal(r.success, true)
  assert.equal(r.data?.path, "/Users/t/Downloads/report.pdf")
  assert.equal(r.data?.filename, "report.pdf")
  assert.equal(r.data?.bytes, 99)
  assert.equal(r.data?.transport, "downloads")
  assert.equal(bridge.downloadBusyTabs.size, 0)
})
