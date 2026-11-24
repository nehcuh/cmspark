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
import { getComputerSessionTrust } from "../../src/computer/session-trust"
import type { AppEntry } from "../../src/apps/types"

before(async () => { await initDataDir() })
const roots: string[] = []
afterEach(() => { mock.restoreAll(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

async function deniedAdmission(finalParams: Record<string, unknown>) {
  const manager = new SecurityConfirmationManager()
  const frames: any[] = []
  const ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw); frames.push(frame)
    if (frame.type === "security.confirmation.request") queueMicrotask(() => {
      assert.equal(manager.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
      assert.equal(manager.respondFrom(frame.confirmation_id, false, ws).outcome, "resolved")
    })
  } } as unknown as WebSocket
  const result = await runL2ToolAdmission({ toolName: "host_computer", finalParams,
    toolCallId: "preview532", startedAt: Date.now(), ws, sessionId: "controlled-session", isOutboundMcpCall: false,
    logToolFinish() {}, securityConfirmations: manager, getThreadManager: () => ({ get: () => null }) as any,
    getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: async () => ({ saturated: () => false, statusLine: () => "controlled rate status" }) as any,
    activeTrayConfirmsByWs: new WeakMap(), clients: new Set([ws]), wsAuthGet: () => ({ authenticated: true, origin: "chrome-extension://controlled" }),
  })
  assert.equal(manager.pendingCount(), 0)
  return { result, frames }
}

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
  const { result, frames } = await deniedAdmission({ app: token, task: "controlled task", actions: [{ action: "click", x: 1, y: 1 }] })
  assert.equal(result.ok, false, "deny must still refuse")
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

for (const platform of ["darwin", "win32"] as const) {
  test(`host_computer ${platform}: invalid drafts and trusted actions do not capture for a dialog`, async () => {
    mock.method(os, "platform", () => platform)
    const preview = mock.method(previewHelper, "buildComputerL2PreviewImage", async () => null)
    const token = platform === "darwin" ? "mac.app.preview" : "win.app.preview"
    replaceAppsEntries({ [token]: { token, kind: "gui", display_name: "Fixture", source: "user", policy: "manual",
      enabled: true, coordinateAllowed: true, added_at: "2026-10-14T00:00:00Z",
      bundleId: "example.preview", exe: { path: "C:\\Fixture\\preview.exe", user_writable_dir: false } } })
    saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false }, computer: { coordinateEnabled: true } } as any)
    const base = { app: token, task: "Controlled action", __thread_id: "preview-thread", actions: [{ action: "click", x: 0, y: 0 }] }
    const invalid = [
      { draft: { ...base, task: " " }, code: "COMPUTER_INPUT_INVALID" },
      { draft: { ...base, actions: [{ action: "double_click", x: 0 }] }, code: "COMPUTER_INPUT_INVALID" },
      { draft: { ...base, actions: [{ action: "type", text: "x".repeat(1500) }, { action: "type", text: "x".repeat(501) }] }, code: "TYPE_TEXT_TOO_LONG" },
    ]
    for (const { draft, code } of invalid) {
      const { result, frames } = await deniedAdmission(draft)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.result.error_code, code)
      assert.deepEqual(frames, [])
      assert.equal(preview.mock.callCount(), 0)
    }
    for (const keys of [["win", "shift"], ["f1"], ["ctrl", "f12", "enter"]]) {
      const before = preview.mock.callCount()
      const { result, frames } = await deniedAdmission({ ...base, actions: [{ action: "key", keys }] })
      assert.equal(result.ok, false)
      if (platform === "darwin") {
        if (!result.ok) assert.equal(result.result.error_code, "COMPUTER_INPUT_INVALID")
        assert.deepEqual(frames, [])
        assert.equal(preview.mock.callCount(), before)
      } else {
        assert.equal(frames.filter(f => f.type === "security.confirmation.request").length, 1)
        assert.equal(preview.mock.callCount(), before + 1)
      }
    }
    const beforeTrust = preview.mock.callCount()
    const key = "thread:preview-thread"
    const trust = getComputerSessionTrust()
    try {
      trust.grant(key, token, { explicitOptIn: true })
      trust.recordBudget(key, token, 15)
      trust.recordActions(key, token, 1)
      const reused = await deniedAdmission({ ...base, actions: [{ action: "key", keys: ["win", "enter"] }] })
      assert.equal(reused.result.ok, true)
      assert.deepEqual(reused.frames, [])
      assert.equal(preview.mock.callCount(), beforeTrust)

      trust.markCredentialSurfaceSeen(key, token, true)
      const prompted = await deniedAdmission(base)
      assert.equal(prompted.result.ok, false)
      assert.equal(prompted.frames.filter(f => f.type === "security.confirmation.request").length, 1)
      assert.equal(preview.mock.callCount(), beforeTrust + 1)
    } finally { trust.clearSession(key) }
  })
}
