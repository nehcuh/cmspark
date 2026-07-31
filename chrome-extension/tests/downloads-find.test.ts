/**
 * #au4dch DL-1/DL-2 unit tests — filter + prefer_existing short-circuit.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  filterCompletedDownloads,
  runDownloadsFind,
  isPathUnderDownloads,
  redactDownloadUrl,
} from "../src/background/downloads-find"
import { runBrowserDownload } from "../src/background/browser-download-handler"

describe("isPathUnderDownloads / redactDownloadUrl", () => {
  it("accepts Downloads segment", () => {
    assert.equal(isPathUnderDownloads("C:\\Users\\t\\Downloads\\a.tgz"), true)
    assert.equal(isPathUnderDownloads("/home/u/Downloads/a.tgz"), true)
    assert.equal(isPathUnderDownloads("/home/u/下载/a.tgz"), true)
  })
  it("rejects Desktop/Documents", () => {
    assert.equal(isPathUnderDownloads("C:\\Users\\t\\Desktop\\secret.pem"), false)
    assert.equal(isPathUnderDownloads("C:\\Users\\t\\Documents\\key.tgz"), false)
  })
  it("redacts query strings", () => {
    assert.equal(
      redactDownloadUrl("https://x.com/a.tgz?token=secret"),
      "https://x.com/a.tgz",
    )
  })
})

describe("filterCompletedDownloads", () => {
  const items = [
    {
      id: 1,
      filename: "C:\\Users\\t\\Downloads\\black-cat-v1.1.0.tar.gz",
      url: "https://github.com/x/releases/download/v1.1.0/black-cat-v1.1.0.tar.gz?sig=abc",
      state: "complete",
      exists: true,
      fileSize: 100,
    },
    {
      id: 2,
      filename: "C:\\Users\\t\\Downloads\\other.zip",
      url: "https://example.com/other.zip",
      state: "complete",
      exists: true,
      fileSize: 50,
    },
    {
      id: 3,
      filename: "C:\\Users\\t\\Downloads\\black-cat-v1.1.0.tar.gz",
      state: "in_progress",
      exists: true,
    },
    {
      id: 4,
      filename: "C:\\Users\\t\\Desktop\\black-cat-v1.1.0.tar.gz",
      url: "https://evil/secret",
      state: "complete",
      exists: true,
      fileSize: 1,
    },
  ]

  it("matches filenameHint and skips incomplete", () => {
    const m = filterCompletedDownloads(items, {
      filenameHint: "black-cat-v1.1.0.tar.gz",
      limit: 5,
    })
    assert.equal(m.length, 1)
    assert.equal(m[0].id, 1)
    assert.equal(m[0].source, "cache")
    assert.ok(m[0].path.includes("black-cat"))
    assert.ok(!m[0].url.includes("sig="))
  })

  it("matches urlContains", () => {
    const m = filterCompletedDownloads(items, {
      urlContains: "github.com",
      limit: 5,
    })
    assert.equal(m.length, 1)
    assert.equal(m[0].id, 1)
  })

  it("B1: drops Desktop paths even if filename matches", () => {
    const m = filterCompletedDownloads(items, {
      filenameHint: "black-cat",
      limit: 10,
    })
    assert.ok(m.every((x) => x.id !== 4))
  })
})

describe("runDownloadsFind", () => {
  it("requires a hint", async () => {
    const r = await runDownloadsFind({})
    assert.equal(r.success, false)
    assert.equal(r.data?.error_code, "HINT_REQUIRED")
  })

  it("returns matches from injectable API", async () => {
    const r = await runDownloadsFind({
      filenameHint: "pkg.tgz",
      __downloadsApi: {
        search: async () => [
          {
            id: 9,
            filename: "/tmp/Downloads/pkg.tgz",
            url: "https://x/pkg.tgz",
            state: "complete",
            exists: true,
            fileSize: 12,
          } as any,
        ],
      },
    })
    assert.equal(r.success, true)
    assert.equal(r.data.count, 1)
    assert.equal(r.data.matches[0].filename, "pkg.tgz")
  })
})

describe("browser_download prefer_existing", () => {
  const bridge = {
    getTabId: () => 1,
    sendCdp: async () => ({}),
    scriptingExecute: async () => null,
    click: async () => ({ success: false, error: "should not click" }),
    downloadBusyTabs: new Set<number>(),
  }

  it("returns cache hit without click", async () => {
    const r = await runBrowserDownload(bridge as any, {
      tabId: 1,
      filenameHint: "already.tgz",
      prefer_existing: true,
      __downloadsApi: {
        search: async () => [
          {
            id: 3,
            filename: "/Users/t/Downloads/already.tgz",
            url: "https://x/already.tgz",
            state: "complete",
            exists: true,
            fileSize: 99,
          },
        ],
        onCreated: { addListener() {}, removeListener() {} },
        onChanged: { addListener() {}, removeListener() {} },
      },
    })
    assert.equal(r.success, true)
    assert.equal(r.data?.source, "cache")
    assert.equal(r.data?.transport, "downloads_cache")
    assert.equal(r.data?.filename, "already.tgz")
  })

  it("force_redownload without selector fails selector requirement", async () => {
    const r = await runBrowserDownload(bridge as any, {
      tabId: 1,
      filenameHint: "already.tgz",
      force_redownload: true,
      __downloadsApi: {
        search: async () => [
          {
            id: 3,
            filename: "/Users/t/Downloads/already.tgz",
            state: "complete",
            exists: true,
          },
        ],
        onCreated: { addListener() {}, removeListener() {} },
        onChanged: { addListener() {}, removeListener() {} },
      },
    })
    assert.equal(r.success, false)
    assert.equal(r.data?.error_code, "SELECTOR_OR_TEXT_REQUIRED")
  })
})
