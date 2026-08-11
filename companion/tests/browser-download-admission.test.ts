/**
 * browser_download path-sandbox admission (C10 Phase E1).
 * Isolates DATA_DIR before config/path helpers load.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-bd-adm-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp
process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  runBrowserDownloadAdmission,
  type BrowserDownloadAdmissionCtx,
} from "../src/tool/browser-download-admission"

function makeCtx(
  overrides: Partial<BrowserDownloadAdmissionCtx> & {
    toolName: string
    finalParams?: Record<string, any>
  },
): BrowserDownloadAdmissionCtx {
  return {
    finalParams: {},
    toolCallId: "tc-bd",
    startedAt: Date.now(),
    logToolFinish: () => {},
    getThreadManager: () => null,
    ...overrides,
  }
}

describe("runBrowserDownloadAdmission", () => {
  it("pass-through for non-browser_download tools", () => {
    const params = { tabId: 1, foo: "bar" }
    const out = runBrowserDownloadAdmission(
      makeCtx({ toolName: "navigate", finalParams: params }),
    )
    assert.equal(out.ok, true)
    if (!out.ok) return
    assert.equal(out.finalParams, params)
    assert.equal(out.isWorker, false)
  })

  it("rejects PATH_ESCAPE for path outside Downloads roots", () => {
    const finished: any[] = []
    const out = runBrowserDownloadAdmission(
      makeCtx({
        toolName: "browser_download",
        finalParams: {
          text: "Download ZIP",
          // Absolute path outside user Downloads → PATH_ESCAPE
          downloadPath: "/etc/passwd-not-downloads",
        },
        logToolFinish: (_id, name, _t, result) => {
          finished.push({ name, result })
        },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.success, false)
    assert.match(String(out.result.error), /PATH_ESCAPE|outside|escape|not allowed|Downloads/i)
    assert.equal(out.result.data?.error_code, "PATH_ESCAPE")
    assert.equal(finished.length, 1)
    assert.equal(finished[0].name, "browser_download")
  })

  it("denies custom downloadPath for worker threads", () => {
    const workerTm = {
      get: () => ({ agent_role: "worker" }),
    }
    const out = runBrowserDownloadAdmission(
      makeCtx({
        toolName: "browser_download",
        actingThreadId: "worker-1",
        getThreadManager: () => workerTm,
        finalParams: {
          text: "Download",
          downloadPath: path.join(tmp, "not-the-default-downloads"),
        },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "WORKER_PATH_DENIED")
    assert.match(String(out.result.error), /WORKER_PATH_DENIED/)
  })

  it("accepts default Downloads with selector/text and rewrites downloadPath", () => {
    const out = runBrowserDownloadAdmission(
      makeCtx({
        toolName: "browser_download",
        finalParams: {
          tabId: 42,
          text: "Download ZIP",
        },
      }),
    )
    assert.equal(out.ok, true)
    if (!out.ok) return
    assert.equal(out.finalParams.tabId, 42)
    assert.equal(out.finalParams.text, "Download ZIP")
    assert.ok(typeof out.finalParams.downloadPath === "string")
    assert.ok(out.finalParams.downloadPath.length > 0)
    assert.ok(out.downloadPath)
    assert.equal(out.isWorker, false)
  })

  it("rejects missing selector/text without prefer_existing hints", () => {
    const out = runBrowserDownloadAdmission(
      makeCtx({
        toolName: "browser_download",
        finalParams: { tabId: 1 },
      }),
    )
    assert.equal(out.ok, false)
    if (out.ok) return
    assert.equal(out.result.data?.error_code, "SELECTOR_OR_TEXT_REQUIRED")
  })
})
