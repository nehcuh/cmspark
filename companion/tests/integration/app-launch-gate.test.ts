// Integration test: App tab WP3 — host_app L2 gate + policy matrix.
//
// Mirrors security-gates.test.ts's harness (WS pair + createToolExecutor).
// Verifies the adversary 接线警示 end to end:
//   ① host_app is in the L2 gate tool list (policy != auto → confirmation)
//   ② binding payload non-empty (unit-tested in security-policy.test.ts)
//   ③ executor validate branch (reached after the gate; fake exe path proves
//     it — launch fails with a typed "exe not found", NOT a gate error)
//
// Policy matrix (owner decisions 1+2):
//   auto    → silent (no confirmation), audit reason app_whitelist
//   ai      → first launch in thread: L2 WITH trust checkbox; trusted: silent
//   manual  → always L2, NO checkbox, trust-injection attempt is a no-op
//   disabled entry / apps.enabled=false / unknown token → typed error, no dialog
//
// All policy-matrix tests are win32-only (the gate skips host_app elsewhere;
// the executor then returns the platform typed error).

import "./_security-gates-setup.js"
import test, { before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { WebSocketServer, WebSocket } from "ws"

import {
  createToolExecutor,
  handleToolResult,
  applyConnectionCloseGracePeriod,
  pendingToolCalls,
  securityConfirmations,
  handleSecurityConfirmationResponse,
  getSessionIdForTests,
} from "../../src/server.js"
import { saveConfig, getConfig, replaceAppsEntries } from "../../src/config.js"
import { getThreadApprovals } from "../../src/host-use/thread-approvals.js"
import type { AppEntry } from "../../src/apps/types.js"

const WIN = process.platform === "win32"
const DARWIN = process.platform === "darwin"
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-appgate-"))
const FAKE_EXE = "C:\\Program Files\\GateTest\\gated.exe" // never existsSync-true

let wss: WebSocketServer
let serverSideWs: WebSocket
let clientSideWs: WebSocket
let serverPort: number

function exeEntry(token: string, policy: AppEntry["policy"], overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    token,
    kind: "gui",
    display_name: `Gate Test ${token}`,
    source: "user",
    policy,
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: FAKE_EXE, signer: "CN=Gate Test", user_writable_dir: false },
    ...overrides,
  }
}

function seedApps(entries: Record<string, AppEntry>, enabled = true) {
  replaceAppsEntries(entries)
  if ((getConfig().apps?.enabled ?? true) !== enabled) {
    saveConfig({ apps: { enabled, entries } } as any)
  }
}

before(() => {
  process.env.HOME = tempDir
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false },
  })
  seedApps({})

  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  serverPort = (wss.address() as { port: number }).port

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      serverSideWs = ws
      ws.on("error", () => { /* expected during teardown */ })
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === "security.confirmation.response") {
            securityConfirmations.respond(String(msg.confirmation_id || ""), msg.approved === true)
          } else if (msg.type === "tool.result") {
            handleToolResult(msg)
          }
        } catch { /* ignore malformed */ }
      })
      resolve()
    })
    clientSideWs = new WebSocket(`ws://127.0.0.1:${serverPort}`)
    clientSideWs.on("error", () => { /* expected during teardown */ })
  })
})

afterEach(async () => {
  const sid = getSessionIdForTests(serverSideWs)
  if (sid) getThreadApprovals().clearThread(sid)
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  applyConnectionCloseGracePeriod()
  securityConfirmations.rejectAll("disconnect")
  seedApps({})
  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientSideWs)
  safeTerminate(serverSideWs)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

function expectClientMessage(type: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clearTimeout(timeout)
          clientSideWs.off("message", handler)
          resolve(msg)
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
  })
}

function expectNoClientMessage(type: string, stabilizationMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clientSideWs.off("message", handler)
          reject(new Error(`unexpected ${type} arrived: ${JSON.stringify(msg).slice(0, 200)}`))
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
    setTimeout(() => {
      clientSideWs.off("message", handler)
      resolve()
    }, stabilizationMs)
  })
}

// =============================================================================
// Policy matrix (win32 only)
// =============================================================================

test("auto policy: silent launch — NO confirmation, executor reached (app_whitelist)", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "auto") })
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_auto", "host_app", { app: "win.app.gated", action: "launch" })
  await noConfirm
  // Gate skipped L2; the executor reached the launch engine, which failed on
  // the (intentionally nonexistent) exe — proof the whole chain ran silently.
  assert.equal(result.success, false)
  assert.match(result.error!, /exe not found/)
})

test("ai policy, untrusted thread: L2 with trust checkbox (relevant_apps = token)", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "ai") })
  const executeTool = createToolExecutor(serverSideWs)
  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const resultPromise = executeTool("tc_app_ai_deny", "host_app", { app: "win.app.gated", action: "launch" })
  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "host_app")
  assert.deepEqual(confirmation.relevant_apps, ["win.app.gated"], "ai policy must offer the trust checkbox")
  assert.match(confirmation.code_preview, /Gate Test win\.app\.gated/, "dialog shows WHICH app launches")
  clientSideWs.send(JSON.stringify({
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: false,
  }))
  const result = await resultPromise
  assert.equal(result.success, false)
  assert.match(result.error!, /denied|unavailable/)
})

test("ai policy: approve WITH checkbox → thread-trusted; second launch is silent", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "ai") })
  const executeTool = createToolExecutor(serverSideWs)
  const sid = getSessionIdForTests(serverSideWs)
  assert.ok(sid, "executor session id must be registered")

  // First launch: L2, approve with add_to_thread_whitelist via the REAL
  // response handler (same path as production routing, same session id).
  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const firstPromise = executeTool("tc_app_ai_1", "host_app", { app: "win.app.gated", action: "launch" })
  const confirmation = await confirmationPromise
  await handleSecurityConfirmationResponse(serverSideWs, {
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: true,
    add_to_thread_whitelist: true,
  }, sid)
  const first = await firstPromise
  // Approved → executor reached launch (fake exe → typed launch error, not a gate error).
  assert.equal(first.success, false)
  assert.match(first.error!, /exe not found/)
  assert.equal(getThreadApprovals().has(sid!, "win.app.gated", "app-launch"), true, "trust must be granted")

  // Second launch in the same thread/session: NO confirmation.
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const second = await executeTool("tc_app_ai_2", "host_app", { app: "win.app.gated", action: "launch" })
  await noConfirm
  assert.equal(second.success, false)
  assert.match(second.error!, /exe not found/)
})

test("manual policy: always L2, NO checkbox; trust-injection attempt is a no-op", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "manual") })
  const executeTool = createToolExecutor(serverSideWs)
  const sid = getSessionIdForTests(serverSideWs)

  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const firstPromise = executeTool("tc_app_manual_1", "host_app", { app: "win.app.gated", action: "launch" })
  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "host_app")
  assert.deepEqual(confirmation.relevant_apps ?? [], [], "manual must NOT offer the trust checkbox")

  // Malicious/buggy client tries to force trust anyway — relevantApps was
  // empty, so the response handler must NOT grant anything.
  await handleSecurityConfirmationResponse(serverSideWs, {
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: true,
    add_to_thread_whitelist: true,
  }, sid)
  await firstPromise
  assert.equal(getThreadApprovals().has(sid!, "win.app.gated", "app-launch"), false, "injected trust must NOT be granted for manual")

  // Second launch: STILL confirmed (manual = every time).
  const confirmation2Promise = expectClientMessage("security.confirmation.request")
  const secondPromise = executeTool("tc_app_manual_2", "host_app", { app: "win.app.gated", action: "launch" })
  const confirmation2 = await confirmation2Promise
  clientSideWs.send(JSON.stringify({
    type: "security.confirmation.response",
    confirmation_id: confirmation2.confirmation_id,
    approved: false,
  }))
  const second = await secondPromise
  assert.equal(second.success, false)
  assert.match(second.error!, /denied|unavailable/)
})

// =============================================================================
// W2 (WP3 review follow-up) — host_read thread-trust grant composition.
// Mirrors the host_app "ai" test above: dialog → approve with
// add_to_thread_whitelist via the REAL response handler → has(sid, id, "read")
// → second read silent. This composition had NO coverage when the
// getToolName-after-respondFrom bug existed (WP3 commit message: "W7 host_read
// was equally affected") — the grant silently never happened and nothing
// failed. OneNote is used as the application so the APPROVED path fails fast
// inside host-use with a typed Phase-1 error (never spawns the Outlook PS).
// =============================================================================

test("host_read: approve WITH checkbox → thread-trusted (kind read); second read silent", { skip: !WIN }, async () => {
  const executeTool = createToolExecutor(serverSideWs)
  const sid = getSessionIdForTests(serverSideWs)
  assert.ok(sid, "executor session id must be registered")

  // First read: L2 dialog offers the trust checkbox (relevant_apps = the
  // resolved application). Approve WITH add_to_thread_whitelist.
  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const firstPromise = executeTool("tc_hr_trust_1", "host_read", { application: "win.onenote.desktop" })
  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "host_read")
  assert.deepEqual(confirmation.relevant_apps, ["win.onenote.desktop"], "host_read must offer the W7 trust checkbox")
  await handleSecurityConfirmationResponse(serverSideWs, {
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: true,
    add_to_thread_whitelist: true,
  }, sid)
  const first = await firstPromise
  // Approved → gate passed; executor reached host-use, which rejects OneNote
  // reads with a typed Phase-1 error — proof the whole chain ran post-grant.
  assert.equal(first.success, false)
  assert.match(first.error!, /not implemented in Phase 1/)
  assert.equal(
    getThreadApprovals().has(sid!, "win.onenote.desktop", "read"),
    true,
    "W7 read trust must be granted (regression: getToolName must be captured before respondFrom)",
  )

  // Second read in the same thread/session: NO confirmation (threadTrusted
  // skips L2), executor reaches host-use again.
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const second = await executeTool("tc_hr_trust_2", "host_read", { application: "win.onenote.desktop" })
  await noConfirm
  assert.equal(second.success, false)
  assert.match(second.error!, /not implemented in Phase 1/)
})

// =============================================================================
// Typed errors (no dialog)
// =============================================================================

test("unknown token → typed error, NO confirmation requested", { skip: !WIN }, async () => {
  seedApps({})
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_unknown", "host_app", { app: "win.app.nope", action: "launch" })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /unknown app token/)
})

test("disabled entry → typed error, NO confirmation requested", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "manual", { enabled: false }) })
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_disabled", "host_app", { app: "win.app.gated", action: "launch" })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /disabled/)
})

test("apps.enabled=false kill-switch → typed error, NO confirmation requested", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "auto") }, false)
  assert.equal(getConfig().apps?.enabled, false)
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_killswitch", "host_app", { app: "win.app.gated", action: "launch" })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /Apps feature is disabled/)
})

test("non-launch action → typed error, NO confirmation requested", { skip: !WIN }, async () => {
  seedApps({ "win.app.gated": exeEntry("win.app.gated", "auto") })
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_action", "host_app", { app: "win.app.gated", action: "run_template" })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /unsupported action/)
})

// =============================================================================
// Platform honesty (everywhere): off win32 the gate is skipped and the
// executor returns the typed platform error. On win32 CI this test exercises
// nothing meaningful — the matrix above owns win32 behavior.
// =============================================================================

test("host_app off win32+darwin → typed platform error, no dialog", { skip: WIN || DARWIN }, async () => {
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc_app_platform", "host_app", { app: "win.app.gated", action: "launch" })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /requires macOS or Windows/)
})
