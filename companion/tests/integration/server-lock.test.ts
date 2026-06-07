// Integration tests for server UDS lock behavior
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-slock-"))

before(() => {
  process.env.HOME = tempDir
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test("server lock integration: stale lock from dead process is cleaned up", async () => {
  const { acquireLock, releaseLock, writePidFile, cleanupPidFile } = require("../../src/daemon")

  const lockPath = path.join(tempDir, "daemon.sock")
  const pidPath = path.join(tempDir, "daemon.pid")

  // Simulate a stale lock from a dead process
  await acquireLock(lockPath)
  writePidFile(pidPath, 99999) // Non-existent PID

  // Verify lock exists
  assert.equal(fs.existsSync(lockPath), true)
  assert.equal(fs.existsSync(pidPath), true)

  // Cleanup manually (simulating what server.ts does)
  const { isProcessRunning, readPidFile } = require("../../src/daemon")
  const pid = readPidFile(pidPath)
  if (pid && !isProcessRunning(pid)) {
    cleanupPidFile(pidPath)
    releaseLock(lockPath)
  }

  assert.equal(fs.existsSync(lockPath), false)
  assert.equal(fs.existsSync(pidPath), false)
})

test("server lock integration: lock prevents double-start", async () => {
  const { acquireLock, releaseLock } = require("../../src/daemon")

  const lockPath = path.join(tempDir, "daemon2.sock")

  // First acquire should succeed
  const first = await acquireLock(lockPath)
  assert.equal(first, true)

  // Second acquire should fail (simulating another instance trying to start)
  const second = await acquireLock(lockPath)
  assert.equal(second, false)

  // Cleanup
  releaseLock(lockPath)
})

test("server lock integration: lock file contains socket", async () => {
  const { acquireLock, releaseLock } = require("../../src/daemon")

  const lockPath = path.join(tempDir, "daemon3.sock")
  await acquireLock(lockPath)

  assert.equal(fs.existsSync(lockPath), true)

  releaseLock(lockPath)
})
