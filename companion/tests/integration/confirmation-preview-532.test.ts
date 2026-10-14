// #532: real admission/helper/manager chain; native APIs are controlled seams.
// Regression: a failed preview emitted a prompt with no operator-visible reason.
// No approval/token issuance; origin mismatch and deny remain authoritative.
import "./_security-gates-setup.js"
import test, { before, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { WebSocket } from "ws"
import { initDataDir, getConfig, saveConfig, replaceAppsEntries } from "../../src/config"
import { runL2ToolAdmission } from "../../src/tool/l2-admission"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { MacWindowEnumerator, MacScreenCapturer, MacLocator, MacPreviewBuilder } from "../../src/computer/darwin-adapters"
import * as previewHelper from "../../src/computer/l2-preview-image"
import type { AppEntry } from "../../src/apps/types"

before(async () => { await initDataDir() })
const roots: string[] = []
afterEach(() => { mock.restoreAll(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

async function prompt(mode: "capture" | "success" | "no_window" | "unattempted" | "timeout") {
  mock.method(os, "platform", () => "darwin")
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-preview532-")); roots.push(ownedRoot)
  const raw = path.join(ownedRoot, "raw.png")
  let didRemove!: () => void
  const removed = new Promise<void>(resolve => { didRemove = resolve })
  const actualRemove = fs.promises.rm
  mock.method(fs.promises, "rm", async (target: Parameters<typeof actualRemove>[0], options: Parameters<typeof actualRemove>[1]) => {
    await actualRemove(target, options)
    if (target === raw) didRemove()
  })
  mock.method(MacWindowEnumerator.prototype, "enumerateByExe", async () => mode === "no_window" ? [] : [{ hwnd: 7, pid: 9, title: "private title", rect: { x: 0, y: 0, width: 100, height: 100 } }])
  let releaseCapture!: () => void
  const delayedCapture = new Promise<void>(resolve => { releaseCapture = resolve })
  if (mode === "timeout") {
    const actualHelper = previewHelper.buildComputerL2PreviewImage
    mock.method(previewHelper, "buildComputerL2PreviewImage", (deps: Parameters<typeof actualHelper>[0], opts: Parameters<typeof actualHelper>[1]) => {
      assert.equal(opts.timeoutMs, 5000, "production preview budget remains 5s")
      return actualHelper(deps, { ...opts, sleep: async () => { await new Promise<void>(resolve => setImmediate(resolve)) } })
    })
  }
  let captures = 0
  mock.method(MacScreenCapturer.prototype, "captureWindow", async () => {
    captures++
    if (mode === "timeout") await delayedCapture
    if (mode === "capture") throw new Error("stale or solid frame: /private/sensitive-path OCR=secret")
    fs.writeFileSync(raw, "controlled synthetic raw")
    return { path: raw, rect: { x: 0, y: 0, width: 100, height: 100 }, client: { x: 0, y: 0, width: 100, height: 100 } }
  })
  mock.method(MacLocator.prototype, "ocr", async () => ({ words: [], language: "en" }))
  mock.method(MacPreviewBuilder.prototype, "build", async () => "ZmFrZQ==")
  const token = "mac.app.preview532"
  replaceAppsEntries({ [token]: { token, kind: "gui", display_name: "Controlled App", source: "user", policy: "manual", enabled: true,
    added_at: "2026-10-14T00:00:00Z", coordinateAllowed: true,
    ...(mode === "unattempted" ? {} : { bundleId: "example.preview532" }),
  } as AppEntry })
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false }, computer: { coordinateEnabled: true } } as any)
  const manager = new SecurityConfirmationManager()
  const frames: any[] = []
  const ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw); frames.push(frame)
    if (frame.type === "security.confirmation.request") queueMicrotask(() => {
      assert.equal(manager.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
      assert.equal(manager.respondFrom(frame.confirmation_id, false, ws).outcome, "resolved")
    })
  } } as unknown as WebSocket
  const result = await runL2ToolAdmission({ toolName: "host_computer", finalParams: { app: token, task: "controlled task", actions: [{ action: "click", x: 1, y: 1 }] },
    toolCallId: "preview532", startedAt: Date.now(), ws, sessionId: "controlled-session", isOutboundMcpCall: false,
    logToolFinish() {}, securityConfirmations: manager, getThreadManager: () => ({ get: () => null }) as any,
    getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: async () => ({ saturated: () => false, statusLine: () => "controlled rate status" }) as any,
    activeTrayConfirmsByWs: new WeakMap(), clients: new Set([ws]), wsAuthGet: () => ({ authenticated: true, origin: "chrome-extension://controlled" }),
  })
  assert.equal(result.ok, false, "deny must still refuse")
  assert.equal(manager.pendingCount(), 0)
  if (mode === "timeout") {
    releaseCapture(); await removed
  }
  assert.equal(JSON.stringify(result).includes("security_token"), false)
  assert.equal(JSON.stringify(result).includes("preview_unavailable_reason"), false, "operator diagnostic never enters tool result")
  const frame = frames.find(f => f.type === "security.confirmation.request")
  assert.ok(frame, `actual prompt required, result=${JSON.stringify(result)}`)
  assert.equal(frame.timeout_ms, 45000)
  assert.equal(JSON.stringify(frame).includes("sensitive-path"), false)
  assert.equal(JSON.stringify(frame).includes("private title"), false)
  assert.equal(fs.existsSync(raw), false, "raw cleanup completed on settled paths")
  console.log("PREVIEW532_RECEIPT " + JSON.stringify({ mode, frame }))
  return { frame, captures }
}

test("#532 capture failure survives real helper/admission/manager as fixed reason", async () => {
  const { frame, captures } = await prompt("capture")
  assert.equal(captures, 1)
  assert.equal(frame.preview_unavailable_reason, "capture_failed")
  assert.equal(frame.preview_image, undefined)
})
test("#532 no window is distinct from screenshot failure", async () => {
  const { frame, captures } = await prompt("no_window")
  assert.equal(captures, 0)
  assert.equal(frame.preview_unavailable_reason, "target_unavailable")
})
test("#532 success and unattempted previews do not claim screenshot failure", async () => {
  const success = await prompt("success")
  assert.equal(success.frame.preview_image, "ZmFrZQ==")
  assert.equal(success.frame.preview_unavailable_reason, undefined)
  mock.restoreAll()
  const unattempted = await prompt("unattempted")
  assert.equal(unattempted.captures, 0)
  assert.equal(unattempted.frame.preview_unavailable_reason, undefined)
})

test("#532 real timeout prompt remains unchanged after late capture and deny", { timeout: 3000 }, async () => {
  const { frame, captures } = await prompt("timeout")
  assert.equal(captures, 1)
  assert.equal(frame.preview_unavailable_reason, "timeout")
  assert.equal(frame.preview_image, undefined)
})

test("#532 manager rejects unknown/raw preview reason without changing nonce/origin", async () => {
  const manager = new SecurityConfirmationManager()
  const ws = {} as WebSocket, frames: any[] = []
  const result = manager.request(frame => { frames.push(frame) }, { toolName: "host_computer", dangerousApis: [], code: "controlled", nonceChallenge: "ABC123", previewUnavailableReason: "secret /private/raw" as any }, { originWs: ws })
  const frame = frames[0]
  assert.equal(frame.preview_unavailable_reason, undefined)
  assert.equal(frame.nonce_challenge, "ABC123")
  assert.equal(manager.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
  assert.equal(manager.respondFrom(frame.confirmation_id, false, ws).outcome, "resolved")
  assert.equal((await result).approved, false)
})
