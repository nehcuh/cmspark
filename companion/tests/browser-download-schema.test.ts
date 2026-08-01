// PR-5 schema cases for browser_download + BD-ALIAS createToolExecutor path sandbox
import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import * as os from "node:os"
import { parseToolArgs, tryParseToolArgs } from "../src/bridge/tool-schemas.js"
import { getAllToolDefinitions, getToolDefinitions } from "../src/bridge/tool-definitions.js"
import { TAB_LEASE_TOOLS } from "../src/orchestrator/constants.js"
import {
  resolveToolDispatchTimeoutMs,
  TOOL_EXECUTION_TIMEOUT_MS,
  BROWSER_DOWNLOAD_MAX_TIMEOUT_MS,
  createToolExecutor,
  handleToolResult,
  pendingToolCalls,
} from "../src/server.js"

test("browser_download is in tool catalog", () => {
  const names = getAllToolDefinitions().map((t) => t.function.name)
  assert.ok(names.includes("browser_download"), "full catalog must include browser_download")
  // Visible on all platforms (not darwin-only)
  assert.ok(getToolDefinitions("win32").some((t) => t.function.name === "browser_download"))
  assert.ok(getToolDefinitions("darwin").some((t) => t.function.name === "browser_download"))
})

test("browser_download ∈ TAB_LEASE_TOOLS", () => {
  assert.ok(TAB_LEASE_TOOLS.has("browser_download"))
})

test("browser_download: text only ok", () => {
  const out = parseToolArgs("browser_download", { tabId: 1, text: "下载" })
  assert.equal(out.tabId, 1)
  assert.equal(out.text, "下载")
})

test("browser_download: selector only ok", () => {
  const out = parseToolArgs("browser_download", { tabId: 2, selector: "a.download" })
  assert.equal(out.selector, "a.download")
})

test("browser_download: both empty rejected", () => {
  const r = tryParseToolArgs("browser_download", { tabId: 1 })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /selector|text/i)
})

test("browser_download: prefer_existing + filenameHint without selector ok", () => {
  const out = parseToolArgs("browser_download", {
    tabId: 1,
    filenameHint: "black-cat-v1.1.0.tar.gz",
    prefer_existing: true,
  })
  assert.equal(out.filenameHint, "black-cat-v1.1.0.tar.gz")
})

test("downloads_find is in tool catalog", () => {
  const names = getAllToolDefinitions().map((t) => t.function.name)
  assert.ok(names.includes("downloads_find"), "catalog must include downloads_find")
})

test("downloads_find: requires hint", () => {
  const r = tryParseToolArgs("downloads_find", {})
  assert.equal(r.ok, false)
})

test("downloads_find: filenameHint ok", () => {
  const out = parseToolArgs("downloads_find", { filenameHint: "pkg.tgz" })
  assert.equal(out.filenameHint, "pkg.tgz")
})

test("browser_download: missing tabId rejected", () => {
  assert.throws(() => parseToolArgs("browser_download", { text: "下载" }), /tabId/i)
})

test("browser_download: timeoutMs max enforced by zod", () => {
  const r = tryParseToolArgs("browser_download", {
    tabId: 1,
    text: "dl",
    timeoutMs: 200_000,
  })
  assert.equal(r.ok, false)
})

// --- dispatch timeout (must not undercut extension 60–120s waits) ---

test("resolveToolDispatchTimeoutMs: browser_download default >= 65s", () => {
  const ms = resolveToolDispatchTimeoutMs("browser_download", {})
  assert.ok(ms >= 65_000, `expected >=65000, got ${ms}`)
  assert.equal(ms, 60_000 + 5_000)
})

test("resolveToolDispatchTimeoutMs: browser_download timeoutMs=120000 capped", () => {
  const ms = resolveToolDispatchTimeoutMs("browser_download", { timeoutMs: 120_000 })
  assert.ok(ms >= 125_000, `expected >=125000, got ${ms}`)
  assert.ok(ms <= BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000)
  assert.equal(ms, Math.min(BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000, 120_000 + 5_000))
})

test("resolveToolDispatchTimeoutMs: other tools stay at TOOL_EXECUTION_TIMEOUT_MS", () => {
  assert.equal(resolveToolDispatchTimeoutMs("click", {}), TOOL_EXECUTION_TIMEOUT_MS)
  assert.equal(resolveToolDispatchTimeoutMs("navigate", { timeoutMs: 120_000 }), TOOL_EXECUTION_TIMEOUT_MS)
})

test("resolveToolDispatchTimeoutMs: download alias normalized only by executor — raw name stays 15s", () => {
  // Schema / dispatcher must not special-case raw "download"; createToolExecutor renames first.
  // Document: if someone forgets alias normalize, resolve alone would undercut — alias is the fix.
  assert.equal(resolveToolDispatchTimeoutMs("download", { timeoutMs: 120_000 }), TOOL_EXECUTION_TIMEOUT_MS)
})

// --- BD-ALIAS-SANDBOX: createToolExecutor renames download → browser_download then runs prepare ---

function mockExecutorWs(onMessage?: (msg: any) => void): any {
  return {
    readyState: 1, // WebSocket.OPEN
    send(raw: string) {
      try {
        const msg = JSON.parse(raw)
        onMessage?.(msg)
      } catch {
        /* ignore */
      }
    },
  }
}

function evilPathOutsideDownloads(): string {
  // PATH_ESCAPE: outside user Downloads (UNC on win; /tmp sibling of home on posix).
  if (process.platform === "win32") {
    return "\\\\evil\\share\\malware.exe"
  }
  return path.join(os.tmpdir(), "cmspark-bd-alias-escape-" + Date.now())
}

test("createToolExecutor: download alias → prepare PATH_ESCAPE (no tool.execute)", async () => {
  const sent: any[] = []
  const executeTool = createToolExecutor(mockExecutorWs((m) => sent.push(m)))
  const evil = evilPathOutsideDownloads()
  const result = await executeTool("tc-alias-escape", "download", {
    tabId: 1,
    text: "下载",
    downloadPath: evil,
  })
  assert.equal(result.success, false, "malicious path must fail")
  assert.match(String(result.error || ""), /PATH_ESCAPE/)
  assert.equal((result as any).data?.error_code, "PATH_ESCAPE")
  const executes = sent.filter((m) => m.type === "tool.execute")
  assert.equal(
    executes.length,
    0,
    "PATH_ESCAPE must reject before extension dispatch (tool.execute)",
  )
  // tool.start may still fire (sent before sandbox); must not include a successful forward of evil path via execute
  for (const ex of executes) {
    assert.ok(!String(ex.params?.downloadPath || "").includes(evil))
  }
})

test("createToolExecutor: download alias renames tool_name to browser_download on tool.execute + sandboxed path", async () => {
  const sent: any[] = []
  const ws = mockExecutorWs((m) => {
    sent.push(m)
    if (m.type === "tool.execute") {
      // Resolve the pending dispatch with a fake extension success (production path after sandbox).
      queueMicrotask(() => {
        handleToolResult({
          tool_call_id: m.tool_call_id,
          result: {
            success: true,
            data: {
              path: path.join(os.homedir(), "Downloads", "a.pdf"),
              filename: "a.pdf",
              bytes: 1,
              transport: "downloads",
            },
          },
        })
      })
    }
  })
  const executeTool = createToolExecutor(ws)
  const result = await executeTool("tc-alias-rename", "download", {
    tabId: 42,
    text: "下载",
    timeoutMs: 60_000,
  })
  assert.equal(result.success, true, `expected success, got ${JSON.stringify(result)}`)
  const exec = sent.find((m) => m.type === "tool.execute")
  assert.ok(exec, "must dispatch tool.execute after sandbox ok")
  // BD-ALIAS: raw tool name "download" must be renamed before dispatch
  assert.equal(
    exec.tool_name,
    "browser_download",
    "alias must rename download → browser_download before extension",
  )
  assert.equal(exec.params.tabId, 42)
  assert.equal(exec.params.text, "下载")
  // prepareBrowserDownloadParams must have forced a Downloads-rooted absolute path
  const dl = String(exec.params.downloadPath || "")
  assert.ok(dl.length > 0, "sandboxed downloadPath required")
  assert.ok(
    dl.toLowerCase().includes("downloads") ||
      path.resolve(dl).toLowerCase().startsWith(path.resolve(path.join(os.homedir(), "Downloads")).toLowerCase()),
    `downloadPath must be under Downloads, got ${dl}`,
  )
  assert.ok(!dl.includes(".."), "no path escape markers in forwarded path")
  // Cleanup any leaked pending (should already be cleared by handleToolResult)
  for (const id of Array.from(pendingToolCalls.keys())) {
    const p = pendingToolCalls.get(id)!
    clearTimeout(p.timer)
    pendingToolCalls.delete(id)
  }
})

test("createToolExecutor: browser_download direct name still path-sandboxes (no alias-only hole)", async () => {
  const sent: any[] = []
  const executeTool = createToolExecutor(mockExecutorWs((m) => sent.push(m)))
  const result = await executeTool("tc-direct-escape", "browser_download", {
    tabId: 1,
    selector: "a#dl",
    downloadPath: evilPathOutsideDownloads(),
  })
  assert.equal(result.success, false)
  assert.match(String(result.error || ""), /PATH_ESCAPE/)
  assert.equal(sent.filter((m) => m.type === "tool.execute").length, 0)
})
