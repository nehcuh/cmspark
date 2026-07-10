// Integration tests for daemon CLI commands
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-daemon-cli-test-"))

before(() => {
  process.env.HOME = tempHome
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("getLockFilePath returns correct path", () => {
  const { getLockFilePath } = require("../../src/config")
  const lockPath = getLockFilePath()
  assert.ok(lockPath.includes("daemon.sock"))
  assert.ok(lockPath.includes(".cmspark-agent"))
})

test("getPidFilePath returns correct path", () => {
  const { getPidFilePath } = require("../../src/config")
  const pidPath = getPidFilePath()
  assert.ok(pidPath.includes("daemon.pid"))
  assert.ok(pidPath.includes(".cmspark-agent"))
})

test("acquireLock returns true on first acquire", async () => {
  const { acquireLock, releaseLock } = require("../../src/daemon")
  const lockPath = path.join(tempHome, "test.lock")
  const result = await acquireLock(lockPath)
  assert.equal(result, true)
  // Cleanup: releaseLock closes the underlying net.Server handle (unlinkSync alone would leak
  // the listening server and keep the test process alive).
  releaseLock(lockPath)
})

test("acquireLock returns false when lock already held", async () => {
  const { acquireLock, releaseLock } = require("../../src/daemon")
  const lockPath = path.join(tempHome, "test2.lock")
  const first = await acquireLock(lockPath)
  assert.equal(first, true)
  const second = await acquireLock(lockPath)
  assert.equal(second, false)
  // Cleanup: release the held lock (closes the net.Server handle).
  releaseLock(lockPath)
})

test("isProcessRunning detects current process", () => {
  const { isProcessRunning } = require("../../src/daemon")
  assert.equal(isProcessRunning(process.pid), true)
})

test("isProcessRunning returns false for non-existent PID", () => {
  const { isProcessRunning } = require("../../src/daemon")
  // PID 99999 is extremely unlikely to exist
  assert.equal(isProcessRunning(99999), false)
})

test("writePidFile and readPidFile roundtrip", () => {
  const { writePidFile, readPidFile, cleanupPidFile } = require("../../src/daemon")
  const pidPath = path.join(tempHome, "test.pid")
  writePidFile(pidPath, 12345)
  const pid = readPidFile(pidPath)
  assert.equal(pid, 12345)
  cleanupPidFile(pidPath)
  assert.equal(fs.existsSync(pidPath), false)
})

test("readPidFile returns null for missing file", () => {
  const { readPidFile } = require("../../src/daemon")
  const pid = readPidFile(path.join(tempHome, "nonexistent.pid"))
  assert.equal(pid, null)
})

test("releaseLock cleans up lock file", async () => {
  const { acquireLock, releaseLock } = require("../../src/daemon")
  const lockPath = path.join(tempHome, "cleanup.lock")
  await acquireLock(lockPath)
  assert.equal(fs.existsSync(lockPath), true)
  releaseLock(lockPath)
  assert.equal(fs.existsSync(lockPath), false)
})

test("initDataDir creates logs directory with 0o700 permissions", async () => {
  const { initDataDir, DATA_DIR } = require("../../src/config")
  await initDataDir()
  const logsDir = path.join(DATA_DIR, "logs")
  assert.equal(fs.existsSync(logsDir), true)
  const stat = fs.statSync(logsDir)
  // Check mode includes 0o700 (owner read/write/execute)
  assert.ok((stat.mode & 0o700) === 0o700, `Expected mode to include 0o700, got ${(stat.mode & 0o777).toString(8)}`)
})

test("getLogDir returns logs directory", () => {
  const { getLogDir } = require("../../src/config")
  const logDir = getLogDir()
  assert.ok(logDir.includes("logs"))
})
