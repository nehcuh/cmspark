// CPU-only contracts execute the original lifecycle fixture callback. Its imports
// are intercepted before evaluation; no ACP manager, subprocess or SDK is loaded.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

type Scenario = "failed" | "rejected" | "completed" | "marker-first" | "same-tick" | "pending"
const fixturePath = path.resolve(__dirname, "../../tests/integration/acp-slot-boundaries-607.test.ts")
const fixtureSource = fs.readFileSync(fixturePath, "utf8")
const fixtureJs = ts.transpileModule(fixtureSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

async function executeFixture(scenario: Scenario) {
  let clock = 0, cancels = 0, shutdowns = 0, rejectObserverAttached = false, admissionChecks = 0
  const files = new Map<string, string>()
  const registered: Array<{ name: string; run: () => Promise<void> }> = []
  const owned = "/inert/cmspark-607-slot-owned"
  const originalError = Object.assign(new Error("inert original rejection"), { inert: true })
  let finish: ((value: { ok: boolean }) => void) | undefined
  const publishMarker = () => {
    files.set(path.posix.join(owned, "protocol.json"), JSON.stringify({ pid: 123 }))
    files.set(path.posix.join(owned, "prompt.json"), "prompt")
  }
  class InertManager {
    propose() { return { ok: true, session: { session_id: "inert", transport: "acp", state: "closed" } } }
    start() {
      if (scenario === "failed") return Promise.resolve({ ok: false })
      if (scenario === "completed") return Promise.resolve({ ok: true })
      if (scenario === "rejected") {
        const rejected = Promise.reject(originalError)
        const then = rejected.then.bind(rejected)
        rejected.then = ((fulfilled: any, rejectedHandler: any) => {
          rejectObserverAttached ||= typeof rejectedHandler === "function"
          return then(fulfilled, rejectedHandler)
        }) as typeof rejected.then
        return rejected
      }
      const pending = new Promise<{ ok: boolean }>(resolve => { finish = resolve })
      if (scenario === "marker-first") publishMarker()
      if (scenario === "same-tick") queueMicrotask(() => { publishMarker(); finish!({ ok: false }) })
      return pending
    }
    checkStartAdmission(sessionId: string) {
      assert.equal(sessionId, "inert"); admissionChecks++
      return { ok: scenario !== "pending" }
    }
    cancel() { cancels++; finish?.({ ok: false }); return { ok: true } }
    async shutdown() { shutdowns++; finish?.({ ok: false }) }
  }
  const imports: Record<string, unknown> = {
    "./_security-gates-setup": {},
    "node:test": (name: string, _options: unknown, run: () => Promise<void>) => registered.push({ name, run }),
    "node:assert/strict": assert,
    "node:path": path.posix,
    "node:os": { tmpdir: () => "/inert" },
    "node:fs": {
      realpathSync: (value: string) => value,
      mkdtempSync: (value: string) => value + "owned",
      writeFileSync: (name: string, value: string) => files.set(name, value),
      existsSync: (name: string) => files.has(name),
      readFileSync: (name: string) => files.get(name),
      rmSync: () => files.clear(),
    },
    "../../src/acp/manager": { AcpManager: InertManager },
    "../../src/config": { initDataDir: async () => {}, saveConfig: () => {} },
  }
  vm.runInNewContext(fixtureJs, {
    exports: {},
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), "unadmitted fixture import")
      return imports[name]
    },
    process: { platform: "win32", execPath: "/inert/node", kill: () => { throw new Error("inert PID absent") } },
    Date: { now: () => clock },
    Promise,
    setTimeout: (callback: () => void, milliseconds: number) => { clock += milliseconds; queueMicrotask(callback); return 1 },
  }, { filename: "source-derived-owned-acp-fixture.js" })
  const selected = registered.find(row => row.name === "ACP admission waits for owned process close: cancel")
  assert.ok(selected, "original cancel lifecycle callback must exist")
  let failure: unknown
  try { await selected.run() } catch (error) { failure = error }
  assert.equal(shutdowns, 1, "original finally must run")
  return { failure, clock, cancels, originalError, rejectObserverAttached, admissionChecks }
}

for (const [scenario, expected] of [
  ["failed", "owned ACP failed before required marker"],
  ["completed", "owned ACP completed before required marker"],
] as const) {
  test(`owned ACP marker wait exposes ${scenario} before a marker`, async () => {
    const observed = await executeFixture(scenario)
    assert.equal((observed.failure as Error)?.message, expected)
    assert.ok(observed.clock <= 10, "settled result must not consume the marker deadline")
    assert.equal(observed.cancels, 0)
  })
}

test("owned ACP marker wait observes rejection immediately and preserves its original object", async () => {
  const observed = await executeFixture("rejected")
  assert.equal(observed.failure, observed.originalError)
  assert.equal(observed.rejectObserverAttached, true)
  assert.ok(observed.clock <= 10)
  assert.equal(observed.cancels, 0)
})

for (const scenario of ["marker-first", "same-tick"] as const) {
  test(`owned ACP marker keeps the original lifecycle assertions: ${scenario}`, async () => {
    const observed = await executeFixture(scenario)
    assert.equal(observed.failure, undefined)
    assert.equal(observed.cancels, 1)
    assert.equal(observed.admissionChecks, 1, "original after-close admission boundary must be visited")
  })
}

test("owned ACP marker still rejects a pending start at the original 20-second deadline", async () => {
  const observed = await executeFixture("pending")
  assert.equal((observed.failure as Error)?.message, "owned ACP fixture deadline")
  assert.equal(observed.clock, 20_000)
  assert.equal(observed.cancels, 0)
})
