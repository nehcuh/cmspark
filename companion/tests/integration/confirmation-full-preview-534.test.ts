// #534: real schema -> admission -> origin-bound manager DENY -> recorded UI frames.
// Semantic darwin/no-window seams are explicit; no native/provider/human approval.
import test, { before, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import cp from "node:child_process"
import net from "node:net"
import { WebSocket } from "ws"
import { initDataDir, getConfig, saveConfig, replaceAppsEntries } from "../../src/config"
import { runL2ToolAdmission } from "../../src/tool/l2-admission"
import { tryParseToolArgs } from "../../src/bridge/tool-schemas"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { SecurityPolicy } from "../../src/security-policy"
import { MacWindowEnumerator, MacScreenCapturer } from "../../src/computer/darwin-adapters"

before(async () => {
  assert.ok(process.env.CMSPARK_DATA_DIR, "use canonical isolated runner")
  await initDataDir()
})
afterEach(() => mock.restoreAll())
const recorded = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../chrome-extension/tests/fixtures/confirmation-full-preview-534.json"), "utf8"))
for (const row of recorded.cases) {
  test("#534 real denied browser-task producer matches recorded " + row.case, async () => {
    const effects = { process: 0, network: 0, issuer: 0, capture: 0, allow: 0 }
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
      mock.method(cp, key, () => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") })
    }
    mock.method(net.Socket.prototype, "connect", () => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") })
    for (const key of ["issueToken", "issueTokenFor"] as const) {
      mock.method(SecurityPolicy.prototype, key, () => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") })
    }
    mock.method(os, "platform", () => "darwin")
    mock.method(MacWindowEnumerator.prototype, "enumerateByExe", async () => [])
    mock.method(MacScreenCapturer.prototype, "captureWindow", async () => { effects.capture++; throw Error("OWNED_CAPTURE_FORBIDDEN") })
    const token = row.params.app
    replaceAppsEntries({ [token]: { token, kind: "gui", display_name: "OWNED_BROWSER", source: "user", policy: "manual", enabled: true, added_at: "2026-10-15T00:00:00Z", bundleId: "com.google.Chrome" } })
    saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false }, computer: { coordinateEnabled: true } } as any)
    const parsed = tryParseToolArgs("host_computer", row.params)
    assert.equal(parsed.ok, true)
    const manager = new SecurityConfirmationManager()
    const frames: any[] = []
    const ws = { readyState: WebSocket.OPEN, send(raw: string) {
      const frame = JSON.parse(raw); frames.push(frame)
      if (frame.type === "security.confirmation.request") queueMicrotask(() => {
        assert.equal(manager.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
        assert.equal(manager.respondFrom(frame.confirmation_id, false, ws).outcome, "resolved")
      })
    } } as unknown as WebSocket
    const denied = await runL2ToolAdmission({ toolName: "host_computer", finalParams: row.params,
      toolCallId: "OWNED534-" + row.case, startedAt: Date.now(), ws, sessionId: "OWNED534", isOutboundMcpCall: false,
      logToolFinish() {}, securityConfirmations: manager, getThreadManager: () => ({ get: () => null }) as any,
      getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: async () => ({ saturated: () => false, statusLine: () => "OWNED_RATE" }) as any,
      activeTrayConfirmsByWs: new WeakMap(), clients: new Set([ws]),
      // Synthetic owned authenticated-peer boundary, not a real WS/HMAC or human approval.
      wsAuthGet: () => ({ authenticated: true, origin: "chrome-extension://owned534" }),
    })
    assert.equal(denied.ok, false)
    assert.equal(manager.pendingCount(), 0)
    const frame = frames.find(f => f.type === "security.confirmation.request")
    assert.ok(frame)
    for (const field of ["full_preview", "code_preview", "tool_name", "timeout_ms", "auto_confirm_eligible", "relevant_apps", "preview_unavailable_reason"])
      assert.deepEqual(frame[field], row.frame[field], field)
    assert.equal(frame.timeout_ms, 45000)
    assert.ok(frame.full_preview.includes("动作预算: " + row.params.budget))
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0, capture: 0, allow: 0 })
    console.log("FULL534_RECEIPT " + JSON.stringify({ case: row.case, fullChars: frame.full_preview.length, legacyChars: frame.code_preview.length, effects, denied: true, pending: manager.pendingCount() }))
  })
}
