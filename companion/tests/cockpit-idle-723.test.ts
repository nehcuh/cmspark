import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const file = path.resolve(__dirname, "../src/ws/cockpit-idle")
test("#723 real synchronous idle endpoint uses all authority sources and same authenticated socket", () => {
  // The baseline has no endpoint: fail an explicit missing-contract assertion before require.
  assert.ok(fs.existsSync(file + ".js") || fs.existsSync(file + ".ts"), "missing authoritative cockpit endpoint")
  const { sendCockpitIdleSnapshot } = require(file)
  const auth = { authenticated: true, surface: "panel", origin: "chrome-extension://owned" }
  for (const mode of ["idle", "own", "foreign", "unbound", "task", "aborting", "unknown", "stale", "tray", "summoner", "origin", "invalid"]) {
    const sent: any[] = [], registry = new Map<string, boolean>()
    if (mode === "task" || mode === "aborting") registry.set("fixed", mode === "aborting")
    const current = { ...auth, ...(mode === "tray" || mode === "summoner" ? { surface: mode } : {}), ...(mode === "origin" ? { origin: "cmspark-tray://local" } : {}) }
    const ws = { readyState: 1, send(data: string) { sent.push(JSON.parse(data)) } }
    sendCockpitIdleSnapshot(ws, { type: "cockpit.idle.get", id: "fixed-id", ...(mode === "invalid" ? { extra: 1 } : {}) }, current, () => mode === "stale" ? { ...current } : current,
      () => { if (mode === "unknown") throw Error("PRIVATE"); return ["own", "foreign", "unbound"].includes(mode) ? 1 : 0 }, registry)
    if (["stale", "tray", "summoner", "origin", "invalid"].includes(mode)) assert.equal(sent.length, 0, mode)
    else assert.deepEqual(sent, [{ type: "cockpit.idle.result", id: "fixed-id", state: mode === "idle" ? "IDLE" : mode === "unknown" ? "UNKNOWN" : "BUSY" }], mode)
  }
})

test("#723 actual confirmation manager and task registry keep all-owner activity conservative", async () => {
  assert.ok(fs.existsSync(file + ".js") || fs.existsSync(file + ".ts"))
  const { sendCockpitIdleSnapshot } = require(file)
  const { SecurityConfirmationManager } = require("../src/security-confirmation")
  const { getComputerTaskAbortRegistry } = require("../src/computer/task-abort-registry")
  const manager = new SecurityConfirmationManager(), tasks = getComputerTaskAbortRegistry()
  const owner: any = {}, foreign: any = {}; const auth = { authenticated: true, surface: "panel", origin: "chrome-extension://owned" }
  const replies: any[] = [], ws = { readyState: 1, send(data: string) { replies.push(JSON.parse(data)) } }
  const read = () => { sendCockpitIdleSnapshot(ws, { type: "cockpit.idle.get", id: "real-manager" }, auth, () => auth, () => manager.pendingCount(), tasks); return replies.pop().state }
  assert.equal(tasks.size, 0); assert.equal(read(), "IDLE")
  for (const originWs of [owner, foreign, undefined]) {
    const signal = new AbortController(); const pending = manager.request(() => {}, { toolName: "fixed", code: "", dangerousApis: [] }, { originWs, signal: signal.signal })
    assert.equal(read(), "BUSY"); signal.abort(); await pending; assert.equal(read(), "IDLE")
  }
  tasks.set("owned-inert", true)
  try { assert.equal(read(), "BUSY") } finally { tasks.delete("owned-inert") }
  assert.equal(read(), "IDLE"); assert.equal(manager.pendingCount(), 0)
})
