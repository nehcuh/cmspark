import "./integration/_security-gates-setup"
import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import cp = require("node:child_process")
import { EventEmitter } from "node:events"
import { logger, getLogFilePath } from "../src/logger"
import { queryWindowsOwner } from "../src/process/windows-owner"
import { observeWindowsOwnerFailures } from "./fixtures/windows-owner-diagnostics"

async function actualOwnerFailure(t: TestContext): Promise<Record<string, unknown>> {
  const secret = "OWNED_FAKE_COMMAND_STDERR_SECRET_639"
  const error = Object.assign(new Error(secret), { code: secret, killed: true, signal: "SIGKILL", cmd: secret, stderr: secret })
  const child = Object.assign(new EventEmitter(), { killed: true })
  t.mock.method(cp, "execFile", (_file: any, _args: any, options: any, callback: any) => {
    assert.equal(options.timeout, 10000); assert.equal(options.killSignal, "SIGKILL")
    queueMicrotask(() => { child.emit("spawn"); callback(error, ""); child.emit("close", null, "SIGKILL") })
    return child as never
  })
  await assert.rejects(queryWindowsOwner(new AbortController().signal), observed => observed === error)
  const entries = fs.readFileSync(getLogFilePath(), "utf8").trim().split("\n").map(line => JSON.parse(line))
  return entries.filter(entry => entry.event === "process.windows_owner_probe.failed").at(-1).data
}

test("#639 actual owner failure keeps its original rejection and emits bounded sanitized TAP facts", async t => {
  const receipts: string[] = []
  t.mock.method(t, "diagnostic", (value: string) => { receipts.push(value) })
  observeWindowsOwnerFailures(t)
  const productionFacts = await actualOwnerFailure(t)
  assert.equal(receipts.length, 1)
  assert.ok(!receipts[0].includes("OWNED_FAKE_COMMAND_STDERR_SECRET_639"))
  const actual = JSON.parse(receipts[0])
  assert.equal(actual.event, "process.windows_owner_probe.failed")
  assert.deepEqual(actual.data, productionFacts, "TAP facts must come from the actual producer, not a guessed receipt")
  assert.equal(actual.data.error_code, "unknown")
  assert.equal(actual.data.close_signal, "SIGKILL")
  assert.equal(actual.data.aborted, false)
})

test("#639 foreign events, hostile fields and repeated failure cannot leak or flood TAP", async t => {
  const productionFacts = await actualOwnerFailure(t)
  const receipts: string[] = []
  t.mock.method(t, "diagnostic", (value: string) => { receipts.push(value) })
  observeWindowsOwnerFailures(t)
  const secret = "OWNED_FAKE_PRIVATE_BUSINESS_639"
  logger.warn("unrelated.owned.fixture", { message: secret })
  assert.equal(receipts.length, 0)
  logger.warn("process.windows_owner_probe.failed", {
    ...productionFacts, phase: { toString: () => "probe", toJSON: () => secret }, timeout_ms: secret,
    error_code: secret, close_signal: secret, returned_elapsed_ms: secret, close_exit_status: Infinity,
    child_killed: secret, pid: 1234, command: secret, env: { secret }, stdout: secret, stderr: secret, value: secret,
  })
  assert.equal(receipts.length, 1)
  assert.ok(!receipts[0].includes(secret))
  const actual = JSON.parse(receipts[0]).data
  assert.equal(actual.phase, null); assert.equal(actual.error_code, null); assert.equal(actual.child_killed, null)
  for (const key of ["pid", "command", "env", "stdout", "stderr", "value", "message", "stack"])
    assert.equal(Object.hasOwn(actual, key), false)
  logger.warn("process.windows_owner_probe.failed", productionFacts)
  assert.equal(receipts.length, 1)
})

test("#639 successful actual owner query emits no failure diagnostic", async t => {
  const receipts: string[] = []
  t.mock.method(t, "diagnostic", (value: string) => { receipts.push(value) })
  observeWindowsOwnerFailures(t)
  const child = Object.assign(new EventEmitter(), { killed: false })
  t.mock.method(cp, "execFile", (_file: any, _args: any, _options: any, callback: any) => {
    queueMicrotask(() => { child.emit("spawn"); callback(null, " 134046125350000001\n"); child.emit("close", 0, null) })
    return child as never
  })
  assert.equal(await queryWindowsOwner(new AbortController().signal), "134046125350000001")
  assert.deepEqual(receipts, [])
})
