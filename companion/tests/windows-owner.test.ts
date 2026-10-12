import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import cp = require("node:child_process")
import { WindowsJobOwner, queryWindowsOwner } from "../src/process/windows-owner"
import { spawnWindowsJob } from "../src/process/windows-job"

const filetime = "134046125350000001"

test("concurrent owner waiters share a query; cancelling one preserves the other and the cache", async () => {
  let calls = 0, querySignal!: AbortSignal, publish!: (value: string) => void
  const owner = new WindowsJobOwner(signal => { calls++; querySignal = signal; return new Promise(resolve => { publish = resolve }) })
  const cancelled = new AbortController()
  const first = owner.prepare(cancelled.signal), second = owner.prepare()
  const refused = assert.rejects(first, { name: "AbortError" })
  await Promise.resolve()
  cancelled.abort(); await refused
  assert.equal(calls, 1); assert.equal(querySignal.aborted, false)
  publish(filetime); await second
  assert.equal(owner.created, filetime)
  await owner.prepare(); assert.equal(calls, 1)
  await assert.rejects(owner.prepare(cancelled.signal), { name: "AbortError" })
})

test("last cancellation awaits query cleanup; an overlapping retry cannot inherit its late result", async () => {
  const pending: { signal: AbortSignal; finish: (value: string) => void }[] = []
  const owner = new WindowsJobOwner(signal => new Promise(resolve => pending.push({ signal, finish: resolve })))
  const abort = new AbortController(); let settled = false
  const first = owner.prepare(abort.signal).finally(() => { settled = true })
  const refused = assert.rejects(first, { name: "AbortError" })
  await Promise.resolve(); abort.abort(); await Promise.resolve(); await Promise.resolve()
  assert.equal(pending[0].signal.aborted, true); assert.equal(settled, false)
  const replacement = owner.prepare(); await Promise.resolve()
  assert.equal(pending.length, 2)
  pending[0].finish("134046125350000002"); await refused
  assert.throws(() => owner.created, /initialized/)
  pending[1].finish(filetime); await replacement
  assert.equal(owner.created, filetime)
})

for (const invalid of ["", "0", "-1", "NaN", "123\n456", "18446744073709551616", "1".repeat(200)]) {
  test(`invalid owner output ${JSON.stringify(invalid.slice(0, 25))} is refused and not cached`, async () => {
    let calls = 0
    const owner = new WindowsJobOwner(async () => ++calls === 1 ? invalid : filetime)
    await assert.rejects(owner.prepare(), /Cannot establish/)
    assert.throws(() => owner.created, /initialized/)
    await owner.prepare(); assert.equal(owner.created, filetime); assert.equal(calls, 2)
  })
}

test("query failure resets singleflight and the next attempt can succeed", async () => {
  let calls = 0
  const owner = new WindowsJobOwner(async () => { if (++calls === 1) throw new Error("owned query failure"); return filetime })
  await assert.rejects(owner.prepare(), /owned query failure/)
  await owner.prepare(); assert.equal(calls, 2); assert.equal(owner.created, filetime)
})

test("execFile early AbortError cannot settle ownership before its owned process closes", async t => {
  const child = new EventEmitter()
  let callback!: (error: Error | null, stdout: string) => void, queryClosed = false
  t.mock.method(cp, "execFile", (_file: string, args: string[], options: any, cb: typeof callback) => {
    assert.ok(args.at(-1)!.includes("[Diagnostics.Process]::GetProcessById"))
    assert.equal(options.env, undefined); assert.equal(options.timeout, 10000)
    assert.equal(options.killSignal, "SIGKILL"); assert.equal(options.maxBuffer, 4096)
    callback = cb
    options.signal.addEventListener("abort", () => callback(Object.assign(new Error("abort"), { name: "AbortError" }), ""))
    return child
  })
  const abort = new AbortController()
  let settled = false
  const query = queryWindowsOwner(abort.signal).finally(() => { settled = true })
  const refused = assert.rejects(query, { name: "AbortError" })
  abort.abort(); await Promise.resolve(); assert.equal(settled, false)
  queryClosed = true; child.emit("close", 1); await refused
  assert.equal(queryClosed && settled, true)
})

test("unprepared owned spawn fails before attempting a launcher", t => {
  t.mock.method(cp, "spawn", () => { assert.fail("ownership must be ready before any spawn") })
  assert.throws(() => spawnWindowsJob("owned.exe", [], { stdio: "ignore" }), /must be initialized/)
})
