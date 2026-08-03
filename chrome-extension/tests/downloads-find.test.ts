/**
 * #au4dch DL-1/DL-2 unit tests — filter + prefer_existing short-circuit.
 * Style: `import test from "node:test"` (extension tsconfig.test.json has no @types/node describe/it).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  filterCompletedDownloads,
  runDownloadsFind,
  isPathUnderDownloads,
  redactDownloadUrl,
  detectDownloadConflicts,
  githubZipMissHint,
} from "../src/background/downloads-find"
import { runBrowserDownload } from "../src/background/browser-download-handler"

test("isPathUnderDownloads accepts Downloads / 下载 segment", () => {
  assert.equal(isPathUnderDownloads("C:\\Users\\t\\Downloads\\a.tgz"), true)
  assert.equal(isPathUnderDownloads("/home/u/Downloads/a.tgz"), true)
  assert.equal(isPathUnderDownloads("/home/u/下载/a.tgz"), true)
})

test("isPathUnderDownloads rejects Desktop/Documents", () => {
  assert.equal(isPathUnderDownloads("C:\\Users\\t\\Desktop\\secret.pem"), false)
  assert.equal(isPathUnderDownloads("C:\\Users\\t\\Documents\\key.tgz"), false)
})

test("redactDownloadUrl strips query strings", () => {
  assert.equal(redactDownloadUrl("https://x.com/a.tgz?token=secret"), "https://x.com/a.tgz")
})

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

test("filterCompletedDownloads matches filenameHint and skips incomplete", () => {
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

test("filterCompletedDownloads matches urlContains", () => {
  const m = filterCompletedDownloads(items, {
    urlContains: "github.com",
    limit: 5,
  })
  assert.equal(m.length, 1)
  assert.equal(m[0].id, 1)
})

test("filterCompletedDownloads B1 drops Desktop paths even if filename matches", () => {
  const m = filterCompletedDownloads(items, {
    filenameHint: "black-cat",
    limit: 10,
  })
  assert.ok(m.every((x) => x.id !== 4))
})

test("detectDownloadConflicts flags same name different sizes (DL-4)", () => {
  const conflict = detectDownloadConflicts([
    {
      id: 1,
      path: "C:\\Users\\t\\Downloads\\a.zip",
      filename: "a.zip",
      bytes: 100,
      url: "https://x/a.zip",
      endTime: "2026-01-01T00:00:00Z",
      source: "cache",
    },
    {
      id: 2,
      path: "C:\\Users\\t\\Downloads\\a.zip",
      filename: "a.zip",
      bytes: 200,
      url: "https://y/a.zip",
      endTime: "2026-02-01T00:00:00Z",
      source: "cache",
    },
  ])
  assert.ok(conflict)
  assert.match(conflict!, /a\.zip/)
  assert.match(conflict!, /大小/)
})

test("detectDownloadConflicts null when single match", () => {
  assert.equal(
    detectDownloadConflicts([
      {
        id: 1,
        path: "C:\\Users\\t\\Downloads\\a.zip",
        filename: "a.zip",
        bytes: 100,
        url: "https://x/a.zip",
        source: "cache",
      },
    ]),
    null,
  )
})

test("runDownloadsFind requires a hint", async () => {
  const r = await runDownloadsFind({})
  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "HINT_REQUIRED")
})

test("runDownloadsFind returns matches from injectable API", async () => {
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

test("runDownloadsFind falls back to broad search when narrow regex misses", async () => {
  let calls = 0
  const r = await runDownloadsFind({
    filenameHint: "Black-cat-master",
    __downloadsApi: {
      search: async (q) => {
        calls++
        // First (narrow) call uses filenameRegex and returns empty — Chrome flaky path
        if (q.filenameRegex) return []
        // Broad call: full recent list
        return [
          {
            id: 11,
            filename: "C:\\Users\\t\\Downloads\\Black-cat-master.zip",
            url: "https://github.com/x/Black-cat/archive/refs/heads/master.zip",
            state: "complete",
            exists: true,
            fileSize: 87848,
          } as any,
        ]
      },
    },
  })
  assert.equal(r.success, true)
  assert.ok(calls >= 2, "expected narrow then broad search")
  assert.equal(r.data.search_mode, "broad")
  assert.equal(r.data.count, 1)
  assert.equal(r.data.matches[0].filename, "Black-cat-master.zip")
})

test("githubZipMissHint mentions Code button and archive URL", () => {
  const h = githubZipMissHint("Black-cat")
  assert.match(h, /Download ZIP/)
  assert.match(h, /archive\/refs\/heads/)
  assert.match(h, /skill_install/)
})

const bridge = {
  getTabId: () => 1,
  sendCdp: async () => ({}),
  scriptingExecute: async () => null,
  click: async () => ({ success: false, error: "should not click" }),
  downloadBusyTabs: new Set<number>(),
}

test("browser_download prefer_existing returns cache hit without click", async () => {
  const r = await runBrowserDownload(bridge as any, {
    tabId: 1,
    filenameHint: "already.tgz",
    prefer_existing: true,
    __downloadsApi: {
      search: async () => [
        {
          id: 3,
          filename: "/Users/t/Downloads/already.tgz",
          url: "https://x/already.tgz?token=secret",
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
  assert.ok(!String(r.data?.url || "").includes("token="))
})

test("browser_download force_redownload without selector fails selector requirement", async () => {
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
