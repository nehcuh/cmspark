// crash-handlers tests — fatal exit on uncaughtException / unhandledRejection,
// and crash.log diagnostics. The handlers are exercised in spawned children
// (calling process.exit(1) in the test runner itself would kill the runner).

import test from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { spawn } from "node:child_process"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-crash-"))

let writeCrashLog: typeof import("../src/crash-handlers").writeCrashLog

const crashLogPath = path.join(tempHome, ".cmspark-agent", "logs", "crash.log")
const modulePath = JSON.stringify(path.join(__dirname, "../src/crash-handlers"))

test.before(async () => {
  process.env.HOME = tempHome
  const mod = await import("../src/crash-handlers")
  writeCrashLog = mod.writeCrashLog
})

test.after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// Spawn helper: returns { code, signal } after the child exits.
function runChild(script: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const child = spawn(process.execPath, ["-e", script], {
    cwd: tempHome,
    env: { ...process.env, HOME: tempHome },
  })
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }))
  })
}

test("writeCrashLog appends a labeled diagnostic to crash.log", () => {
  // Use a fresh subdir so this assertion is independent of the spawn tests.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-crash-unit-"))
  const prev = process.env.HOME
  process.env.HOME = home
  // Silence writeCrashLog's console.error so the (intentional) error object
  // doesn't look like a real test-runner rejection in CI output.
  const origErr = console.error
  console.error = () => {}
  try {
    writeCrashLog("unhandledRejection", new Error("unit-boom"))
    const logFile = path.join(home, ".cmspark-agent", "logs", "crash.log")
    assert.equal(fs.existsSync(logFile), true, "crash.log should be created")
    const content = fs.readFileSync(logFile, "utf-8")
    assert.ok(content.includes("unhandledRejection"), `label present: ${content}`)
    assert.ok(content.includes("unit-boom"), `message present: ${content}`)
  } finally {
    console.error = origErr
    process.env.HOME = prev
  }
})

test("installFatalHandlers exits with code 1 on unhandledRejection", async () => {
  // Ensure a clean crash.log to read for this test.
  fs.rmSync(crashLogPath, { force: true })

  const script = `
    process.env.HOME = ${JSON.stringify(tempHome)};
    const { installFatalHandlers } = require(${modulePath});
    installFatalHandlers();
    // Fire an unhandled rejection (no .catch). The handler must exit(1).
    Promise.reject(new Error("async-boom"));
    // Keep the loop alive so the rejection microtask can fire.
    setTimeout(() => {}, 1000);
  `

  const { code, signal } = await runChild(script)
  assert.equal(signal, null, `expected clean exit not signal, got ${signal}`)
  assert.equal(code, 1, `unhandledRejection should exit(1), got ${code}`)

  const content = fs.readFileSync(crashLogPath, "utf-8")
  assert.ok(content.includes("unhandledRejection"), `label logged: ${content}`)
  assert.ok(content.includes("async-boom"), `reason logged: ${content}`)
})

test("installFatalHandlers exits with code 1 on uncaughtException (parity)", async () => {
  fs.rmSync(crashLogPath, { force: true })

  const script = `
    process.env.HOME = ${JSON.stringify(tempHome)};
    const { installFatalHandlers } = require(${modulePath});
    installFatalHandlers();
    setTimeout(() => { throw new Error("sync-boom"); }, 50);
    setTimeout(() => {}, 1000);
  `

  const { code, signal } = await runChild(script)
  assert.equal(signal, null, `expected clean exit not signal, got ${signal}`)
  assert.equal(code, 1, `uncaughtException should exit(1), got ${code}`)

  const content = fs.readFileSync(crashLogPath, "utf-8")
  assert.ok(content.includes("uncaughtException"), `label logged: ${content}`)
  assert.ok(content.includes("sync-boom"), `error logged: ${content}`)
})
