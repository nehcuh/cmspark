// Integration tests for server UDS lock behavior
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-slock-"))

before(() => {
  process.env.HOME = tempDir
  process.env.CMSPARK_DATA_DIR = path.join(tempDir, ".cmspark-agent")
})

after(async () => {
  try {
    for (const lockPath of ownedLockServers.keys()) await releaseFixtureLock(lockPath)
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }) }
})


// Windows IPC endpoints are not filesystem entries. Track only the net.Server
// created by this fixture's acquire so release has an actual close barrier.
const netForLocks: typeof import("node:net") = require("node:net")
const ownedLockServers = new Map<string, import("node:net").Server>()
const ownedLockClosed = new Map<string, Promise<unknown>>()
function fixtureLockPath(name: string): string {
  return process.platform === "win32"
    ? `\\\\?\\pipe\\cmspark-integration-server-lock-${process.pid}-${name}-${require("node:crypto").randomUUID()}`
    : path.join(tempDir, name)
}
async function acquireFixtureLock(lockPath: string, captureServer = process.platform === "win32"): Promise<boolean> {
  const { acquireLock } = require("../../src/daemon")
  if (!captureServer) return acquireLock(lockPath)
  const original = netForLocks.createServer
  let created: import("node:net").Server | undefined
  ;(netForLocks as any).createServer = function (...args: any[]) {
    created = Reflect.apply(original, this, args)
    return created
  }
  try {
    const acquired = await acquireLock(lockPath)
    if (acquired && created) {
      ownedLockServers.set(lockPath, created)
      ownedLockClosed.set(lockPath, require("node:events").once(created, "close"))
    }
    return acquired
  } finally { (netForLocks as any).createServer = original }
}
async function connectedFixtureLock(lockPath: string): Promise<void> {
  const client = netForLocks.createConnection(lockPath)
  try {
    await require("node:events").once(client, "connect")
    const closed = require("node:events").once(client, "close")
    client.end()
    await closed
  } finally { client.destroy() }
}
async function releaseFixtureLock(lockPath: string): Promise<void> {
  const { releaseLock } = require("../../src/daemon")
  const server = ownedLockServers.get(lockPath)
  if (!server) { releaseLock(lockPath); return }
  const closed = ownedLockClosed.get(lockPath)
  assert.ok(closed, "fixture must observe its actual server close")
  releaseLock(lockPath)
  // releaseLock only retains the current global server. An earlier failed
  // callback may still own this exact captured instance after that slot changed.
  if (server.listening) server.close()
  await closed
  ownedLockServers.delete(lockPath)
  ownedLockClosed.delete(lockPath)
  await assert.rejects(() => connectedFixtureLock(lockPath), (error: any) =>
    error?.code === "ENOENT" || error?.code === "ECONNREFUSED")
}

test("server lock integration: stale lock from dead process is cleaned up", async () => {
  const { writePidFile, cleanupPidFile } = require("../../src/daemon")

  const lockPath = fixtureLockPath("daemon.sock")
  let held = false
  try {
    const pidPath = path.join(tempDir, "daemon.pid")

    // Simulate a stale lock from a dead process
    held = await acquireFixtureLock(lockPath)
    writePidFile(pidPath, 99999) // Non-existent PID

    // Verify lock exists
    if (process.platform === "win32") await connectedFixtureLock(lockPath)
    else assert.equal(fs.existsSync(lockPath), true)
    assert.equal(fs.existsSync(pidPath), true)

    // Cleanup manually (simulating what server.ts does)
    const { isProcessRunning, readPidFile } = require("../../src/daemon")
    const pid = readPidFile(pidPath)
    if (pid && !isProcessRunning(pid)) {
      cleanupPidFile(pidPath)
      await releaseFixtureLock(lockPath)
      held = false
    }

    if (process.platform !== "win32") assert.equal(fs.existsSync(lockPath), false)
    assert.equal(fs.existsSync(pidPath), false)
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
})

test("server lock integration: lock prevents double-start", async () => {

  const lockPath = fixtureLockPath("daemon2.sock")
  let held = false
  try {

    // First acquire should succeed
    const first = await acquireFixtureLock(lockPath)
    held = first
    assert.equal(first, true)

    // Same-process re-acquire is idempotent (daemon → startServer handoff).
    // Cross-process exclusion is covered by daemon.test.ts multi-process competition.
    const second = await acquireFixtureLock(lockPath)
    assert.equal(second, true)
    if (process.platform === "win32") await connectedFixtureLock(lockPath)

    // Cleanup
    await releaseFixtureLock(lockPath)
    held = false
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
})

test("server lock integration: lock file contains socket", async () => {

  const lockPath = fixtureLockPath("daemon3.sock")
  let held = false
  try {
    held = await acquireFixtureLock(lockPath)

    if (process.platform === "win32") await connectedFixtureLock(lockPath)
    else assert.equal(fs.existsSync(lockPath), true)

    await releaseFixtureLock(lockPath)
    held = false
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
})


test("fixture cleanup closes its owned server after another lock retires", async () => {
  const aPath = fixtureLockPath("own-a.sock")
  const bPath = fixtureLockPath("own-b.sock")
  let aServer: import("node:net").Server | undefined
  let pending: Promise<void> | undefined
  try {
    assert.equal(await acquireFixtureLock(aPath, true), true)
    aServer = ownedLockServers.get(aPath)
    assert.ok(aServer)
    assert.equal(await acquireFixtureLock(bPath, true), true)
    await releaseFixtureLock(bPath)
    // Production has retired B and no longer points at A. The fixture owns A.
    pending = releaseFixtureLock(aPath)
    assert.equal(aServer.listening, false, "cleanup must actually close its retained server")
    await pending
    assert.equal(ownedLockServers.size, 0)
  } finally {
    // An old broken helper must fail this assertion without hanging the test run.
    if (aServer?.listening) {
      const closed = require("node:events").once(aServer, "close")
      aServer.close()
      await closed
    }
    if (pending) await pending
  }
})
