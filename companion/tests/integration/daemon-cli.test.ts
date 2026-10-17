// Integration tests for daemon CLI commands
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-daemon-cli-test-"))

before(() => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
})

after(async () => {
  try {
    for (const lockPath of ownedLockServers.keys()) await releaseFixtureLock(lockPath)
  } finally { fs.rmSync(tempHome, { recursive: true, force: true }) }
})


// Windows IPC endpoints are not filesystem entries. Track only the net.Server
// created by this fixture's acquire so release has an actual close barrier.
const netForLocks: typeof import("node:net") = require("node:net")
const ownedLockServers = new Map<string, import("node:net").Server>()
const ownedLockClosed = new Map<string, Promise<unknown>>()
function fixtureLockPath(name: string): string {
  return process.platform === "win32"
    ? `\\\\?\\pipe\\cmspark-integration-daemon-cli-${process.pid}-${name}-${require("node:crypto").randomUUID()}`
    : path.join(tempHome, name)
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

test("getLockFilePath returns correct path", () => {
  const { getLockFilePath } = require("../../src/config")
  const lockPath = getLockFilePath()
  if (process.platform === "win32") {
    assert.equal(lockPath, "\\\\?\\pipe\\cmspark-agent-lock")
  } else {
    assert.ok(lockPath.includes("daemon.sock"))
    assert.ok(lockPath.includes(".cmspark-agent"))
  }
})

test("getPidFilePath returns correct path", () => {
  const { getPidFilePath } = require("../../src/config")
  const pidPath = getPidFilePath()
  assert.ok(pidPath.includes("daemon.pid"))
  assert.ok(pidPath.includes(".cmspark-agent"))
})

test("acquireLock returns true on first acquire", async () => {
  const lockPath = fixtureLockPath("test.lock")
  let held = false
  try {
    const result = await acquireFixtureLock(lockPath)
    held = result
    assert.equal(result, true)
    if (process.platform === "win32") await connectedFixtureLock(lockPath)
    // Cleanup: releaseLock closes the underlying net.Server handle (unlinkSync alone would leak
    // the listening server and keep the test process alive).
    await releaseFixtureLock(lockPath)
    held = false
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
})

test("acquireLock is idempotent when lock already held by this process", async () => {
  const lockPath = fixtureLockPath("test2.lock")
  let held = false
  try {
    const first = await acquireFixtureLock(lockPath)
    held = first
    assert.equal(first, true)
    const second = await acquireFixtureLock(lockPath)
    assert.equal(second, true)
    if (process.platform === "win32") await connectedFixtureLock(lockPath)
    // Cleanup: release the held lock (closes the net.Server handle).
    await releaseFixtureLock(lockPath)
    held = false
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
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
  const lockPath = fixtureLockPath("cleanup.lock")
  let held = false
  try {
    held = await acquireFixtureLock(lockPath)
    if (process.platform === "win32") await connectedFixtureLock(lockPath)
    else assert.equal(fs.existsSync(lockPath), true)
    await releaseFixtureLock(lockPath)
    held = false
    if (process.platform !== "win32") assert.equal(fs.existsSync(lockPath), false)
  } finally {
    if (held) await releaseFixtureLock(lockPath)
  }
})

test("initDataDir creates logs directory with 0o700 permissions", async () => {
  const { initDataDir, DATA_DIR } = require("../../src/config")
  const logsDir = path.join(DATA_DIR, "logs")
  const calls: unknown[] = []
  const fsNative: typeof import("node:fs") = require("node:fs")
  const originalMkdir = fsNative.mkdirSync
  if (process.platform === "win32") {
    ;(fsNative as any).mkdirSync = function (...args: any[]) {
      if (args[0] === logsDir) calls.push(args[1]?.mode)
      return Reflect.apply(originalMkdir, this, args)
    }
  }
  try { await initDataDir() }
  finally { if (process.platform === "win32") (fsNative as any).mkdirSync = originalMkdir }
  assert.equal(fs.existsSync(logsDir), true)
  if (process.platform === "win32") {
    // API request intent only; Windows stat bits are not an NTFS DACL oracle.
    assert.deepEqual(calls, [0o700])
  } else {
    const stat = fs.statSync(logsDir)
    // Check mode includes 0o700 (owner read/write/execute)
    assert.ok((stat.mode & 0o700) === 0o700, `Expected mode to include 0o700, got ${(stat.mode & 0o777).toString(8)}`)
  }
})

test("getLogDir returns logs directory", () => {
  const { getLogDir } = require("../../src/config")
  const logDir = getLogDir()
  assert.ok(logDir.includes("logs"))
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
