import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"

const fixture = path.resolve(__dirname, "../../tests/fixtures/windows-owner-probe.cjs")

// Calibrate the actual fixture's assertions with a deterministic clock. This
// is an oracle test; integration/windows-owner-609 still exercises real owners.
async function runOracle(options: { preamble?: number; closeAfter?: number; block?: number; noQuery?: boolean; noHeartbeat?: boolean; lateTarget?: boolean; secondQuery?: boolean; unclosed?: boolean }) {
  let now = 1000, nextId = 0, finished = false
  const timers = new Map<number, { at: number; repeat: number; run: () => void }>()
  const schedule = (run: () => void, delay: number, repeat = 0) => {
    const id = ++nextId
    timers.set(id, { at: now + delay, repeat, run })
    return id
  }
  const messages: string[] = [], errors: unknown[] = []
  let child: EventEmitter | undefined, closed = false
  const cp = {
    execFile: (..._args: unknown[]) => {
      now += options.block ?? 0
      child = new EventEmitter()
      Object.assign(child, { pid: 123 })
      schedule(() => { closed = true; if (!options.unclosed) child!.emit("close", 1) }, options.closeAfter ?? 90)
      return child
    },
    execFileSync: () => { throw new Error("unexpected sync owner query") },
    spawn: () => { throw new Error("unexpected real spawn") },
  }
  class McpClient {
    constructor(_name: string, config: { startup_timeout_ms: number }) {
      assert.equal(config.startup_timeout_ms, 80)
    }
    async connect() {
      now += options.preamble ?? 0
      if (!options.noQuery) cp.execFile("owned", ["-Command", "inert"], {}, () => {})
      if (options.secondQuery) cp.execFile("owned", ["-Command", "inert"], {}, () => {})
      if (options.lateTarget) (cp.spawn as (...args: unknown[]) => unknown)("owned", ["-EncodedCommand", "inert"], {})
      await new Promise((_resolve, reject) => schedule(() => reject(new Error("startup > 80ms")), 80))
    }
    async close() {
      if (child && !closed) await new Promise<void>(resolve => {
        // Even the deliberately unclosed-child case must finish this synthetic
        // client's cleanup so the fixture's own closed-child guard is tested.
        schedule(resolve, Math.max(0, (options.closeAfter ?? 90) - 80))
      })
    }
  }
  const fakeProcess = { argv: ["node", "fixture", "owned-base", "mcp-timeout", "owned-root"], platform: "win32", execPath: "owned-node", env: {}, exitCode: 0 }
  const result = vm.runInNewContext(fs.readFileSync(fixture, "utf8"), {
    require(name: string) {
      if (name === "node:fs") return {}
      if (name === "node:path") return path
      if (name === "node:child_process") return cp
      if (name === "node:events") return { EventEmitter }
      if (name === "node:stream") return { PassThrough, Writable }
      if (name === "node:assert/strict") return assert
      if (name === path.join("owned-base", "mcp/client.js")) return { McpClient }
      throw new Error(`unexpected module ${name}`)
    },
    process: fakeProcess, performance: { now: () => now },
    setTimeout: (run: () => void, delay: number) => schedule(run, delay),
    setInterval: (run: () => void, delay: number) => schedule(() => { if (!options.noHeartbeat) run() }, delay, delay),
    clearInterval: (id: number) => timers.delete(id),
    queueMicrotask, console: { log: (line: string) => messages.push(line), error: (error: unknown) => errors.push(error) },
  }) as Promise<void>
  result.finally(() => { finished = true })
  for (let turns = 0; !finished && turns < 1000; turns++) {
    // Drain promise continuations before selecting the next virtual timer.
    for (let micro = 0; micro < 10; micro++) await Promise.resolve()
    if (finished) break
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
    assert.ok(next, "fixture stalled without a timer")
    const [id, timer] = next
    now = Math.max(now, timer.at)
    if (timer.repeat) timer.at = now + timer.repeat
    else timers.delete(id)
    timer.run()
  }
  assert.ok(finished, "fixture did not settle")
  await result
  return { exitCode: fakeProcess.exitCode, messages, errors }
}

test("owner clock excludes unrelated pre-query work but retains whole caller latency", async () => {
  const result = await runOracle({ preamble: 600 })
  assert.equal(result.exitCode, 0, String(result.errors))
  const record = JSON.parse(result.messages.find(line => line.startsWith("OWNER_PROBE="))!.slice("OWNER_PROBE=".length))
  assert.equal(record.elapsed, 690)
  assert.equal(record.ownerElapsed, 90)
  assert.equal(record.queries, 1)
  assert.equal(record.targets, 0)
  assert.equal(record.heartbeat, 10)
  assert.equal(record.queryChildren[0].closed, true)
})

for (const [name, options] of [
  ["late owner cancellation", { closeAfter: 450 }],
  ["synchronous owner blocking", { block: 250 }],
  ["no query despite matching timeout wording", { noQuery: true }],
  ["no heartbeat", { noHeartbeat: true }],
  ["late target", { lateTarget: true }],
  ["duplicate query", { secondQuery: true }],
  ["query without its close receipt", { unclosed: true }],
] as const) {
  test(`owner clock still rejects ${name}`, async () => {
    const result = await runOracle(options)
    assert.equal(result.exitCode, 1)
    assert.equal(result.messages.length, 0)
    assert.equal(result.errors.length, 1)
    assert.ok(result.errors[0] instanceof assert.AssertionError, String(result.errors[0]))
  })
}
