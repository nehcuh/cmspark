import "./integration/_security-gates-setup"
import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import cp = require("node:child_process")
import { queryWindowsOwner } from "../src/process/windows-owner"
import { logger } from "../src/logger"
import { observeWindowsOwnerFailures } from "./fixtures/windows-owner-diagnostics"

const keys = ["stdout_first_data_elapsed_ms", "stdout_filetime_line_elapsed_ms", "stdout_end_elapsed_ms", "stderr_first_data_elapsed_ms"]
const ft = "134046125350000001"

function fixture(t: TestContext, stdout: any = new PassThrough()) {
  const stderr = new PassThrough(), child = Object.assign(new EventEmitter(), { stdout, stderr, killed: true })
  const records: Record<string, unknown>[] = [], diagnostics: string[] = []
  let callback!: (error: Error | null, value: string) => void
  t.mock.method(logger, "warn", (_event: string, data: Record<string, unknown>) => { records.push(data) })
  t.mock.method(t, "diagnostic", (value: string) => { diagnostics.push(value) })
  observeWindowsOwnerFailures(t)
  t.mock.method(cp, "execFile", (_file: string, args: string[], options: any, cb: typeof callback) => {
    assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 4096)
    assert.equal(options.killSignal, "SIGKILL"); assert.equal(options.env, undefined)
    assert.equal(args.at(-1), `$ErrorActionPreference='Stop'; $owner=[Diagnostics.Process]::GetProcessById(${process.pid}); try { $owner.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) } finally { $owner.Dispose() }`)
    callback = cb; return child as never
  })
  const promise = queryWindowsOwner(new AbortController().signal); child.emit("spawn")
  return {
    child, stdout, stderr, records, diagnostics, promise,
    fail: async () => {
      const error = Object.assign(new Error("OWNED_PRIVATE_STDERR_COMMAND"), { killed: true, signal: "SIGKILL" })
      const rejected = assert.rejects(promise, actual => actual === error)
      callback(error, ""); child.emit("close", null, "SIGKILL"); await rejected
      assert.equal(records.length, 1); assert.equal(diagnostics.length, 1)
      const data = JSON.parse(diagnostics[0]).data; assert.deepEqual(data, records[0]); return data as Record<string, unknown>
    },
    success: async () => { callback(null, ` ${ft}\n`); child.emit("close", 0, null); return promise },
  }
}

test("#639 passive streams real producer records fragmented CRLF, existing stderr and EOF without raw data", async t => {
  const f = fixture(t)
  for (const byte of Buffer.from(ft + "\r\n")) f.stdout.write(Buffer.from([byte]))
  f.stderr.write("OWNED_PRIVATE_STDERR"); f.stdout.emit("end")
  const facts = await f.fail()
  for (const key of keys) assert.equal(typeof facts[key], "number")
  assert.ok(Number(facts[keys[0]]) <= Number(facts[keys[1]]))
  assert.ok(Number(facts[keys[1]]) <= Number(facts[keys[2]]))
  assert.equal(Object.keys(facts).length, 17)
  assert.ok(!JSON.stringify(facts).includes(ft)); assert.ok(!JSON.stringify(facts).includes("OWNED_PRIVATE"))
  assert.equal(f.stdout.listenerCount("data"), 0); assert.equal(f.stdout.listenerCount("end"), 0)
  assert.equal(f.stderr.listenerCount("data"), 0)
})

test("#639 passive absence is null and cannot imply script entry", async t => {
  const facts = await fixture(t).fail()
  for (const key of keys) assert.equal(facts[key], null)
})

for (const invalid of ["0\n", "18446744073709551616\n", "-1\n", "12.3\n", " 123\n", "x123\n", "123\rX\n", "123"]) {
  test(`#639 passive nonidentity stdout ${JSON.stringify(invalid)} is not a complete FILETIME line`, async t => {
    const f = fixture(t); f.stdout.write(invalid); f.stdout.emit("end")
    const facts = await f.fail()
    assert.equal(typeof facts[keys[0]], "number"); assert.equal(facts[keys[1]], null)
    assert.equal(typeof facts[keys[2]], "number")
  })
}

test("#639 passive multiple lines invalidate an earlier numeric observation", async t => {
  const f = fixture(t); f.stdout.write(ft + "\n"); f.stdout.write("2\n"); f.stdout.emit("end")
  const facts = await f.fail(); assert.equal(facts[keys[1]], null)
  assert.equal(typeof facts[keys[0]], "number"); assert.equal(typeof facts[keys[2]], "number")
})

test("#639 passive more than64 stdout bytes cannot retain a numeric suffix or old line", async t => {
  const f = fixture(t); f.stdout.write(ft + "\n"); f.stdout.write("x".repeat(100000)); f.stdout.write(ft + "\n")
  f.stdout.emit("end"); const facts = await f.fail()
  assert.equal(facts[keys[1]], null); assert.equal(typeof facts[keys[0]], "number")
  assert.equal(typeof facts[keys[2]], "number")
})

test("#639 passive stderr content is never interpreted as FILETIME", async t => {
  const f = fixture(t); f.stderr.write(ft + "\r\n"); const facts = await f.fail()
  assert.equal(facts[keys[0]], null); assert.equal(facts[keys[1]], null)
  assert.equal(facts[keys[2]], null); assert.equal(typeof facts[keys[3]], "number")
})

test("#639 passive late data and EOF cannot change the published failure receipt", async t => {
  const f = fixture(t), facts = await f.fail()
  f.stdout.write(ft + "\n"); f.stdout.emit("end"); f.stderr.write("late")
  assert.deepEqual(JSON.parse(f.diagnostics[0]).data, facts)
  for (const key of keys) assert.equal(facts[key], null)
})

test("#639 passive observation attachment failure preserves success and original FILETIME", async t => {
  const f = fixture(t, { on() { throw new Error("OWNED_OBSERVER_FAILURE") } })
  assert.equal(await f.success(), ft); assert.deepEqual(f.records, [])
})

test("#639 passive TAP projection never serializes hostile stream values", t => {
  const diagnostics: string[] = []; t.mock.method(logger, "warn", () => {})
  t.mock.method(t, "diagnostic", (value: string) => { diagnostics.push(value) }); observeWindowsOwnerFailures(t)
  logger.warn("process.windows_owner_probe.failed", {
    stdout_first_data_elapsed_ms: Infinity, stdout_filetime_line_elapsed_ms: -1,
    stdout_end_elapsed_ms: "1", stderr_first_data_elapsed_ms: { toJSON() { return "PRIVATE" } }, stdout: "PRIVATE",
  })
  const data = JSON.parse(diagnostics[0]).data
  for (const key of keys) assert.equal(data[key], null)
  assert.ok(!diagnostics[0].includes("PRIVATE"))
})

for (const exit of [0, 7]) {
  test(`#639 passive actual execFile retains4080B stderr acceptance with original stdout and exit${exit}`, async t => {
    const original = cp.execFile, records: Record<string, unknown>[] = []
    let actualStderrBytes = -1
    t.mock.method(logger, "warn", (_event: string, data: Record<string, unknown>) => { records.push(data) })
    t.mock.method(cp, "execFile", (_file: string, _args: string[], options: any, callback: any) => {
      assert.equal(options.maxBuffer, 4096); assert.equal(options.timeout, 10000)
      const script = `process.stderr.write('x'.repeat(4080));process.stdout.write('${ft}\\r\\n');process.exitCode=${exit}`
      return original(process.execPath, ["-e", script], options, (error, stdout, stderr) => {
        actualStderrBytes = Buffer.byteLength(stderr); callback(error, stdout)
      })
    })
    const pending = queryWindowsOwner(new AbortController().signal)
    if (exit === 0) { assert.equal(await pending, ft); assert.deepEqual(records, []) }
    else {
      await assert.rejects(pending, { code: exit }); assert.equal(records.length, 1)
      for (const key of keys) assert.equal(typeof records[0][key], "number")
      assert.ok(!JSON.stringify(records).includes(ft)); assert.ok(!JSON.stringify(records).includes("xxxx"))
    }
    assert.equal(actualStderrBytes, 4080, "passive observation must neither add bytes nor steal existing bytes")
  })
}
