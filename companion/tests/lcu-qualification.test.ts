import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { lcuEnableRefusal, lcuOwnedPadQualification, projectLcuStatus } from "../src/computer/lcu/contract"
import { LcuRuntime } from "../src/computer/lcu/runtime"
import { upstreamStatus } from "./fixtures/lcu-v0.13.0/producer"
import { mcpFixture } from "./fixtures/lcu-v0.13.0/mcp"

const tuple = { appVersion: "26.1016.61520", runtime: "0.0.33/20261020111233-d92591792fee" }
const observed = async () => projectLcuStatus(await upstreamStatus(tuple))!
const identity = { command: "/owned/lcu", realPath: "/owned/release/lcu", dev: 1, ino: 2, size: 3, mtimeMs: 4 }

test("775 actual status producer retains upstream untested and permits only the owned-pad qualified tuple", async () => {
  const status = await observed()
  assert.equal(status.pair, "untested")
  assert.equal(status.nativeVerified, false)
  assert.equal(lcuOwnedPadQualification(status), "macos-arm64-20261026")
  assert.equal(lcuEnableRefusal(status), undefined)
  const raw = await upstreamStatus({ appVersion: "unlisted" }) as Record<string, unknown>
  raw.ownedPadQualification = "macos-arm64-20261026"
  raw.nativeVerified = true
  const unqualified = projectLcuStatus(raw)!
  assert.equal(lcuOwnedPadQualification(unqualified), undefined)
  assert.equal(lcuEnableRefusal(unqualified), "LCU_RUNTIME_PAIR_UNVERIFIED")
  assert.equal(unqualified.nativeVerified, false)
  assert.equal(Object.hasOwn(unqualified, "ownedPadQualification"), false)
})

test("775 single-field drift, missing record and changed installation cannot reuse the finite qualification", async () => {
  const status = await observed()
  for (const patch of [
    { appVersion: "26.1016.61521" }, { runtimeVersion: tuple.runtime + "-changed" },
    { lcuVersion: "0.13.1" }, { platform: "linux" as const }, { architecture: "x64" as const },
    { changedSinceInstall: true }, { pair: "unknown" as const },
  ]) {
    const changed = { ...status, ...patch }
    assert.equal(lcuOwnedPadQualification(changed), undefined, JSON.stringify(patch))
    assert.ok(lcuEnableRefusal(changed), JSON.stringify(patch))
  }
  for (const options of [{ ...tuple, changed: true }, { ...tuple, record: "missing" as const }]) {
    assert.ok(lcuEnableRefusal(projectLcuStatus(await upstreamStatus(options))))
  }
  assert.equal(lcuOwnedPadQualification(undefined), undefined)
  assert.equal(lcuEnableRefusal(projectLcuStatus(await upstreamStatus())), undefined)
})

test("775 real SDK runtime admits the qualified pair but still requires each call approval and blocks a changed tuple", async t => {
  const fixture = await mcpFixture(), status = await observed()
  let current = status, transports = 0
  const runtime = new LcuRuntime({ config: () => ({ enabled: true, coordinateEnabled: true }),
    inspect: async () => ({ status: "checked", identity, observed: current }), identity: async () => identity,
    transport: () => { transports++; return fixture.transport }, tasks: new Map() })
  const owner = { threadId: "owned", runId: "owned-run", current: () => true, confirmTool: async () => false, confirmApp: async () => false }
  const turn = await runtime.open(owner)
  t.after(async () => { await turn.finish("Interrupt"); await fixture.close() })
  assert.equal((await turn.call("lcu_js", { code: "must not execute" }, "denied")).result.error, "LCU_HUMAN_APPROVAL_REQUIRED")
  assert.equal(fixture.calls.length, 0)
  await turn.finish("Stop")
  assert.equal((await turn.call("lcu_js", { code: "after stop must not execute" }, "stale")).result.error, "LCU_DISABLED_OR_REVOKED")
  assert.equal(fixture.calls.length, 0)
  current = { ...status, runtimeVersion: tuple.runtime + "-updated" }
  await assert.rejects(runtime.open({ ...owner, runId: "new-run" }), /LCU_RUNTIME_PAIR_UNVERIFIED/)
  assert.equal(transports, 1)
  assert.deepEqual(runtime.state, { activeRuns: 0, pendingRuns: 0, cleanupUnknown: false })
})

test("775 passive settings state derives its qualification from the same checked command only", async () => {
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "computer/lcu/host.ts"), "utf8")
  const sf = ts.createSourceFile("host.ts", source, ts.ScriptTarget.Latest, true)
  const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getLcuState")
  assert.ok(fn)
  const body = ts.transpileModule(fn.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const status = await observed()
  for (const command of [identity.command, "/owned/different/lcu"]) {
    const exports: any = {}
    vm.runInNewContext(body, { exports, lcuOwnedPadQualification,
      config: () => ({ enabled: false, coordinateEnabled: true }), discoverLcu: async () => ({ status: "detected_unverified", identity }),
      process: { platform: "darwin", arch: "arm64" }, cached: { command, observed: status }, runtime: undefined }, { timeout: 1000 })
    const result = JSON.parse(JSON.stringify(await exports.getLcuState()))
    assert.equal(result.ownedPadQualification, command === identity.command ? "macos-arm64-20261026" : undefined)
    assert.equal(result.nativeVerified, false)
    assert.equal(result.observed?.pair, command === identity.command ? "untested" : undefined)
    assert.equal(result.enabled, false)
  }
})
