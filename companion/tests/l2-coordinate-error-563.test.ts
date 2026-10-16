/** #563: production policy -> full L2 admission -> JSON -> registered classifier.
 * Platform selection and negative fault injection are inert seams; no native,
 * authenticated executor, biometric or real permission grant is exercised. */
import test, { before, after, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"
import net from "node:net"

const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-l2-code-563-"))
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let config: typeof import("../src/config")
let admission: typeof import("../src/tool/l2-admission")
let coordinate: typeof import("../src/computer/policy")
let computer: typeof import("../src/computer/types")
let security: typeof import("../src/security")
let securityPolicy: typeof import("../src/security-policy").securityPolicy

before(async () => {
  config = await import("../src/config")
  await config.initDataDir()
  admission = await import("../src/tool/l2-admission")
  coordinate = await import("../src/computer/policy")
  computer = await import("../src/computer/types")
  security = await import("../src/security")
  securityPolicy = (await import("../src/security-policy")).securityPolicy
})
after(() => fs.rmSync(owned, { recursive: true, force: true }))

type Kind = "optout" | "structural" | "unknown"
async function run(t: TestContext, kind: Kind, label: string, fault?: Error) {
  // This selects the existing JS admission branch, not a native platform claim.
  t.mock.method(os, "platform", () => "darwin")
  const effects = { process: 0, network: 0, issuer: 0, confirmation: 0, previewOrRate: 0 }
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    t.mock.method(cp, key, () => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") })
  t.mock.method(net.Socket.prototype, "connect", () => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") })
  t.mock.method(globalThis, "fetch", () => { effects.network++; throw Error("OWNED_FETCH_FORBIDDEN") })
  for (const key of ["issueToken", "issueTokenFor"] as const)
    t.mock.method(securityPolicy, key, () => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") })
  const cfg = config.getConfig(), originalApps = cfg.apps, originalComputer = cfg.computer
  const disk = path.join(process.env.CMSPARK_DATA_DIR!, "config.json"), beforeDisk = fs.readFileSync(disk)
  const token = `mac.app.${label.replace(/ /g, "_")}`
  cfg.apps = { ...originalApps, enabled: true, entries: kind === "unknown" ? {} : {
    [token]: { token, kind: "gui", display_name: label, source: "user", policy: "manual", enabled: true,
      coordinateAllowed: kind !== "optout", added_at: "2026-10-15T00:00:00Z",
      bundleId: kind === "structural" ? "com.apple.Terminal" : "com.example.OwnedFixture" },
  } }
  cfg.computer = { ...originalComputer, coordinateEnabled: true }
  try {
    let typed: Error = fault!
    if (fault) t.mock.method(coordinate, "assertCoordinateAllowed", () => { throw fault })
    else {
      try { coordinate.assertCoordinateAllowed(cfg, token, { allowVaultBrowserOneShot: true }) }
      catch (error) { assert.ok(error instanceof computer.ComputerError); typed = error }
      assert.ok(typed instanceof computer.ComputerError)
    }
    const finishes: any[][] = []
    const denyConfirmation = () => { effects.confirmation++; throw Error("OWNED_CONFIRMATION_FORBIDDEN") }
    const actual = await admission.runL2ToolAdmission({ toolName: "host_computer",
      finalParams: { app: token, task: "Owned refusal only", actions: [{ action: "click", target: "Owned" }] },
      toolCallId: "owned-563", startedAt: Date.now(), ws: { readyState: 1 }, sessionId: "owned-no-auth",
      isOutboundMcpCall: false, logToolFinish: (...args: any[]) => finishes.push(args),
      securityConfirmations: new Proxy({}, { get: () => denyConfirmation }),
      getThreadManager: () => ({ get: () => undefined }), getCachedTabUrl: () => undefined, getDomainFromUrl: () => "",
      computerRateLimiter: async () => { effects.previewOrRate++; throw Error("OWNED_AFTER_POLICY_FORBIDDEN") },
      activeTrayConfirmsByWs: new WeakMap(), clients: new Set(), wsAuthGet: () => undefined,
    } as any)
    assert.equal(actual.ok, false)
    if (actual.ok) throw Error("Expected actual refusal")
    const wire = JSON.parse(JSON.stringify(actual.result))
    assert.equal(wire.success, false)
    assert.equal(wire.error, typed.message)
    assert.equal(finishes.length, 1)
    assert.deepEqual(finishes[0][3], actual.result)
    assert.deepEqual(effects, { process: 0, network: 0, issuer: 0, confirmation: 0, previewOrRate: 0 })
    return { wire, typed }
  } finally {
    cfg.apps = originalApps
    cfg.computer = originalComputer
    assert.deepEqual(fs.readFileSync(disk), beforeDisk, "no config persistence or live permission mutation")
  }
}

for (const kind of ["optout", "structural"] as const)
  for (const label of ["ordinary", "timeout", "disconnected", "security block"]) {
    test(`#563 real ${kind} refusal preserves upstream code with ${label} metadata`, async t => {
      const { wire, typed } = await run(t, kind, label)
      assert.ok(typed instanceof computer.ComputerError)
      const expected = kind === "optout" ? "APP_COORDINATE_DENIED" : "APP_COORDINATE_STRUCTURAL"
      assert.equal(typed.code, expected)
      assert.equal(wire.error_code, typed.code)
      assert.equal(security.classifyError(wire.error, { toolName: "host_computer", error_code: wire.error_code }), "non_recoverable")
    })
  }

for (const label of ["ordinary", "timeout", "disconnected"])
  test(`#563 genuine unknown-app refusal preserves its finite hard code with ${label}`, async t => {
    const { wire, typed } = await run(t, "unknown", label)
    assert.ok(typed instanceof computer.ComputerError)
    assert.equal(typed.code, "APP_NOT_WHITELISTED")
    assert.equal(security.ERROR_CODE_LEVELS.get(typed.code), "non_recoverable")
    assert.equal(wire.error_code, typed.code)
    assert.equal(security.classifyError(wire.error, { error_code: wire.error_code }), "non_recoverable")
  })

test("#563 ordinary Errors cannot forge a registered computer code", async t => {
  const fault = Object.assign(new Error("timeout owned ordinary error"), { code: "APP_COORDINATE_DENIED", name: "ComputerError" })
  const { wire } = await run(t, "optout", "owned", fault)
  assert.equal(Object.hasOwn(wire, "error_code"), false)
  assert.equal(security.classifyError(wire.error), "recoverable")
})

test("#563 unrelated and unknown ComputerError codes keep their original catch shape", async t => {
  for (const code of ["DANGER_HARD_DENY", "OWNED_UNKNOWN_CODE", "APP_COORDINATE_DENIED "]) {
    const fault = new computer.ComputerError(code as any, "timeout owned unrelated error")
    const { wire } = await run(t, "optout", "owned", fault)
    assert.equal(Object.hasOwn(wire, "error_code"), false)
    assert.equal(security.classifyError(wire.error), "recoverable")
    t.mock.restoreAll()
  }
})
