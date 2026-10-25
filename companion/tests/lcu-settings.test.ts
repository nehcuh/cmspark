import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { handleLcuSettingsMessage, type LcuSettingsHost } from "../src/computer/lcu/settings"
import { validLcuCommand } from "../src/computer/lcu/contract"

// Execute the entire real validator with deny-only boundaries for unrelated
// message families; loading its activity barrel would import native adapters.
const validateWsMessage = (() => {
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "ws/validate.ts"), "utf8")
  const exports: any = {}
  const forbidden = () => { throw Error("UNRELATED_VALIDATOR_CALLED") }
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports, require(name: string) {
    if (name === "../computer/lcu/contract") return { validLcuCommand }
    if (name === "../voice/meeting-pcm-schema") return { hasMeetingPcmFields: () => false, validMeetingPcmMessage: forbidden }
    return new Proxy({}, { get: () => forbidden })
  } }, { timeout: 1000 })
  return exports.validateWsMessage as (msg: unknown) => { valid: boolean; error?: string }
})()

const state: Awaited<ReturnType<LcuSettingsHost["getLcuState"]>> = {
  enabled: false, coordinateEnabled: false, platform: "win32", architecture: "x64",
  detection: "unsupported_platform", activeRuns: 0, cleanupUnknown: false, nativeVerified: false,
}
const message = (type: string, extra: Record<string, unknown> = {}) => ({ type, source: "settings", request_id: "lcu-settings-1", ...extra })
const owner = { ownerCurrent: () => true }

function fakeHost() {
  const calls: unknown[][] = []
  const host: LcuSettingsHost = {
    getLcuState: async () => { calls.push(["get"]); return state },
    probeLcuFromSettings: async channel => { calls.push(["probe", channel.current()]); return state },
    configureLcuFromSettings: async (patch, channel) => { calls.push(["configure", patch, channel.current()]); return state },
    setLcuEnabledFromSettings: async (enabled, channel) => { calls.push(["enabled", enabled, channel.current()]); return state },
  }
  return { calls, host }
}

test("LCU settings read is passive, correlated and uses the host's finite state producer", async () => {
  const { calls, host } = fakeHost()
  const reply = await handleLcuSettingsMessage(message("computer.lcu.get_state"), owner, host)
  assert.deepEqual(reply, { type: "computer.lcu.state", request_id: "lcu-settings-1", state })
  assert.deepEqual(calls, [["get"]])
  assert.equal(validateWsMessage(message("computer.lcu.get_state")).valid, true)
})

test("LCU settings dual fences reject missing source, correlation, arbitrary fields and executable argv", async () => {
  for (const bad of [
    message("computer.lcu.get_state", { source: "tool" }),
    message("computer.lcu.get_state", { request_id: "" }),
    message("computer.lcu.get_state", { args: ["--chrome"] }),
    message("computer.lcu.configure", { command: "lcu --chrome" }),
    message("computer.lcu.configure", { command: "/owned/lcu\n" }),
    message("computer.lcu.configure"),
    message("computer.lcu.set_enabled", { enabled: 1 }),
  ]) {
    const { calls, host } = fakeHost()
    assert.equal(validateWsMessage(bad).valid, false)
    assert.equal((await handleLcuSettingsMessage(bad, owner, host)).type, "error")
    assert.deepEqual(calls, [])
  }
})

test("LCU path reset and disable retain their exact limited host operations", async () => {
  const { calls, host } = fakeHost()
  assert.equal((await handleLcuSettingsMessage(message("computer.lcu.configure", { command: null }), owner, host)).type, "computer.lcu.state")
  assert.equal((await handleLcuSettingsMessage(message("computer.lcu.set_enabled", { enabled: false }), owner, host)).type, "computer.lcu.state")
  assert.deepEqual(calls, [["configure", { command: null }, true], ["enabled", false, true]])
})

test("LCU settings rejects absent, stale and aborted owners before host work", async () => {
  const abort = new AbortController(); abort.abort()
  for (const context of [{}, { ownerCurrent: () => false }, { ...owner, signal: abort.signal }]) {
    const { calls, host } = fakeHost()
    const reply = await handleLcuSettingsMessage(message("computer.lcu.probe"), context, host)
    assert.equal((reply as { code?: string }).code, "LCU_OWNER_UNAVAILABLE")
    assert.deepEqual(calls, [])
  }
})

test("LCU settings binds the human channel to the current owner and rejects late replies", async () => {
  let current = true, approvals = 0
  const { host } = fakeHost()
  host.probeLcuFromSettings = async channel => {
    current = false
    assert.equal(channel.current(), false)
    const decision = await channel.request({ toolName: "computer.lcu.probe", dangerousApis: [], code: "fixed status check" })
    assert.equal(decision.approved, false)
    return state
  }
  const reply = await handleLcuSettingsMessage(message("computer.lcu.probe"), {
    ownerCurrent: () => current,
    requestConfirmation: async () => { approvals++; return { confirmationId: "never", approved: true, reason: "approved" } },
  }, host)
  assert.equal((reply as { code?: string }).code, "LCU_OWNER_UNAVAILABLE")
  assert.equal(approvals, 0)
})

test("LCU settings projects fixed failures without raw status, stderr or paths", async () => {
  for (const [error, expected] of [[new Error("private /account/status raw stderr"), "LCU_SETTINGS_FAILED"], [new Error("LCU_SETTINGS_BUSY"), "LCU_SETTINGS_BUSY"]] as const) {
    const { host } = fakeHost()
    host.getLcuState = async () => { throw error }
    const reply = await handleLcuSettingsMessage(message("computer.lcu.get_state"), owner, host)
    assert.deepEqual(reply, { type: "error", family: "computer.lcu", request_id: "lcu-settings-1", code: expected, error: expected })
    assert.doesNotMatch(JSON.stringify(reply), /private|account|stderr/)
  }
})


test("LCU passive host state with no executable or prior receipt never dereferences absent cache", async () => {
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "computer/lcu/host.ts"), "utf8")
  const sf = ts.createSourceFile("host.ts", source, ts.ScriptTarget.Latest, true)
  const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getLcuState")
  assert.ok(fn)
  const exports: any = {}
  const body = ts.transpileModule(fn.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(body, { exports, config: () => ({ enabled: false, coordinateEnabled: false }), discoverLcu: async () => ({ status: "missing_lcu" }), process: { platform: "darwin", arch: "arm64" }, cached: undefined, runtime: undefined }, { timeout: 1000 })
  assert.deepEqual(JSON.parse(JSON.stringify(await exports.getLcuState())), { enabled: false, coordinateEnabled: false, platform: "darwin", architecture: "arm64", detection: "missing_lcu", activeRuns: 0, cleanupUnknown: false, nativeVerified: false })
})

async function settingsRaceFixture() {
  const { EventEmitter } = await import("node:events")
  const { upstreamStatus } = await import("./fixtures/lcu-v0.13.0/producer")
  const contract = await import("../src/computer/lcu/contract")
  const raw = await upstreamStatus()
  const observed = contract.projectLcuStatus(raw)!
  const identity = { command: "/owned/lcu", realPath: "/owned/release/lcu", dev: 1, ino: 2, size: 3, mtimeMs: 4 }
  const events = new EventEmitter(), config = { computer: { coordinateEnabled: true, lcu: { enabled: false, command: identity.command } } }
  const writes: boolean[] = []
  let resume!: (approved: boolean) => void, promptStarted!: () => void, constructed = 0
  const decision = new Promise<boolean>(resolve => { resume = resolve })
  const prompting = new Promise<void>(resolve => { promptStarted = resolve })
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "computer/lcu/host.ts"), "utf8")
  const exports: any = {}
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports, AbortSignal, AbortController, process: { platform: "darwin", arch: "arm64", env: {} },
    require(name: string) {
      if (name === "./discovery") return { discoverLcu: async () => ({ status: "detected_unverified", identity }), lcuCommandIdentity: async () => identity, probeLcu: async () => ({ status: "checked", observed, identity }) }
      if (name === "./contract") return contract
      if (name === "./authorization") return { authorizeLcuOperation: async (_channel: unknown, action: string) => {
        if (action === "computer.lcu.probe") return true
        assert.equal(action, "computer.lcu.set_enabled"); promptStarted(); return decision
      } }
      if (name === "./runtime") return { LcuRuntime: class { state = { activeRuns: 0, cleanupUnknown: false }; constructor() { constructed++ } abortStale() {} abort() {} } }
      if (name === "../../mcp/stdio-transport") return { OwnedStdioTransport: class { constructor() { throw Error("UNEXPECTED_RUNTIME_TRANSPORT") } } }
      if (name === "../task-abort-registry") return { getComputerTaskAbortRegistry: () => new Map(), onComputerTaskAbort() {} }
      if (name === "../../config") return { getConfig: () => config, configEvents: events, CONFIG_CHANGE_EVENT: "change", setComputerLcuFields: (patch: { enabled: boolean }) => {
        writes.push(patch.enabled); config.computer.lcu.enabled = patch.enabled; events.emit("change")
      } }
      throw Error(`UNEXPECTED_HOST_DEPENDENCY:${name}`)
    },
  }, { timeout: 1000 })
  return { api: exports as typeof import("../src/computer/lcu/host"), config, writes, events, resume, prompting, constructed: () => constructed }
}

test("first LCU enable installs revocation before awaits and a later disable defeats late approval", async () => {
  const f = await settingsRaceFixture(), channel = { current: () => true, request: async () => ({ confirmationId: "inert", approved: false, reason: "denied" as const }) }
  const enabling = f.api.setLcuEnabledFromSettings(true, channel)
  const rejected = assert.rejects(enabling, /LCU_OWNER_OR_CONFIG_REVOKED/)
  await f.prompting
  assert.equal(f.constructed(), 1)
  const disabled = await f.api.setLcuEnabledFromSettings(false, channel)
  assert.equal(disabled.enabled, false)
  f.resume(true); await rejected
  assert.deepEqual(f.writes, [false])
  assert.equal(f.config.computer.lcu.enabled, false)
})

test("first LCU enable rejects configuration A to B to A despite an identical final snapshot", async () => {
  const f = await settingsRaceFixture(), channel = { current: () => true, request: async () => ({ confirmationId: "inert", approved: false, reason: "denied" as const }) }
  const enabling = f.api.setLcuEnabledFromSettings(true, channel)
  const rejected = assert.rejects(enabling, /LCU_OWNER_OR_CONFIG_REVOKED/)
  await f.prompting
  const original = f.config.computer.lcu.command
  f.config.computer.lcu.command = "/owned/other/lcu"; f.events.emit("change")
  f.config.computer.lcu.command = original; f.events.emit("change")
  f.resume(true); await rejected
  assert.deepEqual(f.writes, [])
  assert.equal(f.config.computer.lcu.enabled, false)
})
