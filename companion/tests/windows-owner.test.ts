import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import cp = require("node:child_process")
import fs from "node:fs"
import { WindowsJobOwner, queryWindowsOwner } from "../src/process/windows-owner"
import { spawnWindowsJob } from "../src/process/windows-job"
import { logger, getLogFilePath } from "../src/logger"

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

function ownerProbeFixture(t: TestContext) {
  const child = Object.assign(new EventEmitter(), { killed: false, signalCode: null, exitCode: null })
  const records: Array<{ event: string; fields: Record<string, unknown> }> = []
  let callback!: (error: Error | null, stdout: string) => void
  t.mock.method(logger, "warn", (event: string, fields: Record<string, unknown>) => records.push({ event, fields }))
  t.mock.method(cp, "execFile", (_file: string, args: string[], options: any, cb: typeof callback) => {
    assert.ok(args.at(-1)!.includes("[Diagnostics.Process]::GetProcessById"))
    assert.equal(options.timeout, 10000); assert.equal(options.killSignal, "SIGKILL")
    assert.equal(options.maxBuffer, 4096); assert.equal(options.env, undefined)
    callback = cb
    return child
  })
  return { child, records, returned: (error: Error | null, output = "") => callback(error, output) }
}

test("owner timeout diagnostics expose only sanitized phase/timing and kill facts after close", async t => {
  const { child, records, returned } = ownerProbeFixture(t)
  const secret = "OWNED_FAKE_CREDENTIAL_COMMAND_STDERR"
  const error = Object.assign(new Error(secret), { killed: true, signal: "SIGKILL", code: secret, cmd: secret, stderr: secret })
  let settled = false
  const query = queryWindowsOwner(new AbortController().signal).finally(() => { settled = true })
  const refused = assert.rejects(query, observed => observed === error)
  child.emit("spawn")
  Object.assign(child, { killed: true, signalCode: "SIGKILL" })
  returned(error, secret)
  await Promise.resolve()
  assert.equal(settled, false); assert.equal(records.length, 0)
  child.emit("close", null, "SIGKILL")
  await refused
  assert.equal(records.length, 1)
  const { event, fields } = records[0]
  assert.equal(event, "process.windows_owner_probe.failed")
  assert.equal(fields.phase, "probe")
  assert.equal(fields.error_code, "unknown")
  assert.equal(fields.error_killed, true); assert.equal(fields.child_killed, true)
  assert.equal(fields.error_signal, "SIGKILL"); assert.equal(fields.close_signal, "SIGKILL")
  assert.equal(fields.aborted, false)
  for (const key of ["spawn_elapsed_ms", "callback_elapsed_ms", "close_elapsed_ms", "returned_elapsed_ms"]) {
    assert.equal(typeof fields[key], "number"); assert.ok(Number(fields[key]) >= 0)
  }
  assert.ok(Number(fields.returned_elapsed_ms) >= Number(fields.close_elapsed_ms))
  assert.ok(!JSON.stringify(records).includes(secret))
  assert.deepEqual(Object.keys(fields).sort(), ["aborted", "callback_elapsed_ms", "child_killed", "close_elapsed_ms", "close_exit_status", "close_signal", "error_code", "error_killed", "error_signal", "phase", "returned_elapsed_ms", "spawn_elapsed_ms", "timeout_ms",
    "stdout_first_data_elapsed_ms", "stdout_filetime_line_elapsed_ms", "stdout_end_elapsed_ms", "stderr_first_data_elapsed_ms"].sort())
  assert.equal(fields.timeout_ms, 10000)
})

test("owner launch failure has no spawn receipt and reports the system error code", async t => {
  const { child, records, returned } = ownerProbeFixture(t)
  const error = Object.assign(new Error("owned missing executable"), { code: "ENOENT" })
  const query = queryWindowsOwner(new AbortController().signal)
  const refused = assert.rejects(query, observed => observed === error)
  returned(error); child.emit("close", -2, null)
  await refused
  assert.equal(records[0].fields.phase, "launch")
  assert.equal(records[0].fields.spawn_elapsed_ms, null)
  assert.equal(records[0].fields.error_code, "ENOENT")
  assert.equal(records[0].fields.close_exit_status, -2)
})

test("owner abort diagnostics still await process close and retain the exact AbortError", async t => {
  const { child, records, returned } = ownerProbeFixture(t)
  const abort = new AbortController(), error = Object.assign(new Error("owned abort"), { name: "AbortError", code: "ABORT_ERR" })
  let settled = false
  const query = queryWindowsOwner(abort.signal).finally(() => { settled = true })
  const refused = assert.rejects(query, observed => observed === error)
  child.emit("spawn"); abort.abort(); returned(error)
  await Promise.resolve(); assert.equal(settled, false)
  child.emit("close", null, "SIGTERM"); await refused
  assert.equal(records[0].fields.aborted, true)
  assert.equal(records[0].fields.error_code, "ABORT_ERR")
  assert.equal(records[0].fields.close_signal, "SIGTERM")
})

test("owner synchronous exec failure reports no child receipts and does not log its exception", async t => {
  const records: Array<Record<string, unknown>> = []
  const secret = "OWNED_FAKE_ENV_VALUE", error = Object.assign(new Error(secret), { code: "EINVAL" })
  t.mock.method(logger, "warn", (_event: string, fields: Record<string, unknown>) => records.push(fields))
  t.mock.method(cp, "execFile", () => { throw error })
  await assert.rejects(queryWindowsOwner(new AbortController().signal), observed => observed === error)
  assert.equal(records.length, 1)
  assert.equal(records[0].phase, "exec")
  assert.equal(records[0].spawn_elapsed_ms, null)
  assert.equal(records[0].callback_elapsed_ms, null)
  assert.equal(records[0].close_elapsed_ms, null)
  assert.equal(records[0].error_code, "EINVAL")
  assert.ok(!JSON.stringify(records).includes(secret))
})

test("successful owner probe preserves trimmed FILETIME and emits no failure diagnostic", async t => {
  const { child, records, returned } = ownerProbeFixture(t)
  const query = queryWindowsOwner(new AbortController().signal)
  child.emit("spawn"); child.emit("close", 0, null)
  returned(null, ` ${filetime}\n`)
  assert.equal(await query, filetime)
  assert.deepEqual(records, [])
})

test("real execFile abort reaps the owned query and persists only sanitized diagnostic facts", { timeout: 5000 }, async t => {
  // Native host child_process and production query/logger. Only substitute the
  // executable for a test-owned Node process; this is not native Windows proof.
  const actualExec = cp.execFile
  const abort = new AbortController(), secret = "OWNED_FAKE_STDERR_COMMAND_623"
  const probeEntries = () => fs.existsSync(getLogFilePath())
    ? fs.readFileSync(getLogFilePath(), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
      .filter(entry => entry.event === "process.windows_owner_probe.failed") : []
  const previousEntries = probeEntries().length
  let owned!: cp.ChildProcess
  t.mock.method(cp, "execFile", (_file: string, _args: string[], options: any, callback: any) => {
    assert.equal(options.timeout, 10000); assert.equal(options.killSignal, "SIGKILL")
    owned = actualExec(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(secret)});setTimeout(()=>{},60000)`], options, callback)
    owned.once("spawn", () => { setImmediate(() => abort.abort()) })
    return owned
  })
  await assert.rejects(queryWindowsOwner(abort.signal), { name: "AbortError" })
  assert.throws(() => process.kill(owned.pid!, 0), /ESRCH/)
  const entries = probeEntries().slice(previousEntries)
  assert.equal(entries.length, 1)
  const data = entries[0].data
  assert.equal(data.phase, "probe"); assert.equal(data.aborted, true)
  assert.equal(data.error_code, "ABORT_ERR"); assert.equal(data.child_killed, true)
  // execFile's timeout killSignal is unchanged; AbortSignal follows Node's
  // spawn cancellation path. Pin the log to the actual child receipt.
  assert.equal(data.close_signal, owned.signalCode)
  assert.ok(data.spawn_elapsed_ms <= data.close_elapsed_ms)
  assert.ok(data.callback_elapsed_ms <= data.returned_elapsed_ms)
  assert.ok(data.close_elapsed_ms <= data.returned_elapsed_ms)
  assert.ok(!JSON.stringify(entries).includes(secret))
  for (const key of ["pid", "command", "env", "stdout", "stderr", "message", "stack", "value"]) {
    assert.equal(Object.hasOwn(data, key), false)
  }
  t.diagnostic(JSON.stringify(entries[0])) // sanitized actual producer log receipt
})
