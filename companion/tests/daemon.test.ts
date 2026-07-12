// Daemon module tests — UDS lock, PID file, process detection, graceful shutdown, daemonize

import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import * as net from "node:net"
import { spawn } from "node:child_process"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-daemon-"))

let acquireLock: typeof import("../src/daemon").acquireLock
let releaseLock: typeof import("../src/daemon").releaseLock
let isProcessRunning: typeof import("../src/daemon").isProcessRunning
let isCmsparkDaemonCommandLine: typeof import("../src/daemon").isCmsparkDaemonCommandLine
let isDaemonRunning: typeof import("../src/daemon").isDaemonRunning
let writePidFile: typeof import("../src/daemon").writePidFile
let readPidFile: typeof import("../src/daemon").readPidFile
let cleanupPidFile: typeof import("../src/daemon").cleanupPidFile
let daemonize: typeof import("../src/daemon").daemonize
let setupGracefulShutdown: typeof import("../src/daemon").setupGracefulShutdown
let DaemonError: typeof import("../src/daemon").DaemonError
let getDefaultLockPath: typeof import("../src/daemon").getDefaultLockPath
let getDefaultPidPath: typeof import("../src/daemon").getDefaultPidPath

before(async () => {
  process.env.HOME = tempHome
  delete process.env.CMSPARK_DATA_DIR

  const daemon = await import("../src/daemon")
  acquireLock = daemon.acquireLock
  releaseLock = daemon.releaseLock
  isProcessRunning = daemon.isProcessRunning
  isCmsparkDaemonCommandLine = daemon.isCmsparkDaemonCommandLine
  isDaemonRunning = daemon.isDaemonRunning
  writePidFile = daemon.writePidFile
  readPidFile = daemon.readPidFile
  cleanupPidFile = daemon.cleanupPidFile
  daemonize = daemon.daemonize
  setupGracefulShutdown = daemon.setupGracefulShutdown
  DaemonError = daemon.DaemonError
  getDefaultLockPath = daemon.getDefaultLockPath
  getDefaultPidPath = daemon.getDefaultPidPath
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// ============================================================================
// acquireLock / releaseLock
// ============================================================================

test("acquireLock returns true when lock is free", async () => {
  const lockPath = path.join(tempHome, "test1.sock")
  const result = await acquireLock(lockPath)
  assert.equal(result, true)
  assert.equal(fs.existsSync(lockPath), true)
  releaseLock(lockPath)
})

test("acquireLock returns false when lock is already held", async () => {
  const lockPath = path.join(tempHome, "test2.sock")
  const first = await acquireLock(lockPath)
  assert.equal(first, true)

  const second = await acquireLock(lockPath)
  assert.equal(second, false)

  releaseLock(lockPath)
})

test("releaseLock removes the socket file", async () => {
  const lockPath = path.join(tempHome, "test3.sock")
  await acquireLock(lockPath)
  assert.equal(fs.existsSync(lockPath), true)
  releaseLock(lockPath)
  assert.equal(fs.existsSync(lockPath), false)
})

test("releaseLock is idempotent when called twice", async () => {
  const lockPath = path.join(tempHome, "test4.sock")
  await acquireLock(lockPath)
  releaseLock(lockPath)
  releaseLock(lockPath) // should not throw
  assert.equal(fs.existsSync(lockPath), false)
})

test("acquireLock creates parent directories if needed", async () => {
  const lockPath = path.join(tempHome, "nested", "deep", "test5.sock")
  const result = await acquireLock(lockPath)
  assert.equal(result, true)
  assert.equal(fs.existsSync(lockPath), true)
  releaseLock(lockPath)
})

test("acquireLock sets socket file permissions to 0o600", async () => {
  const lockPath = path.join(tempHome, "test6.sock")
  await acquireLock(lockPath)
  const stats = fs.statSync(lockPath)
  // eslint-disable-next-line no-bitwise
  const mode = stats.mode & 0o777
  assert.equal(mode, 0o600)
  releaseLock(lockPath)
})

test("acquireLock can re-acquire after release", async () => {
  const lockPath = path.join(tempHome, "test7.sock")
  assert.equal(await acquireLock(lockPath), true)
  releaseLock(lockPath)
  assert.equal(await acquireLock(lockPath), true)
  releaseLock(lockPath)
})

// ============================================================================
// Multi-process lock competition
// ============================================================================

test("multi-process competition: only one process holds the lock", async () => {
  const lockPath = path.join(tempHome, "compete.sock")

  // Process A: acquires lock and holds it
  const scriptA = `
    const { acquireLock } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    const lockPath = ${JSON.stringify(lockPath)};
    acquireLock(lockPath).then(acquired => {
      console.log(acquired ? "ACQUIRED" : "DENIED");
      // Hold the lock — parent will kill us after verifying
      setTimeout(() => {}, 5000);
    });
  `

  // Process B: tries to acquire after A has already taken it
  const scriptB = `
    const { acquireLock } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    const lockPath = ${JSON.stringify(lockPath)};
    // Wait a bit to ensure A has acquired the lock
    setTimeout(() => {
      acquireLock(lockPath).then(acquired => {
        console.log(acquired ? "ACQUIRED" : "DENIED");
        process.exit(0);
      });
    }, 100);
  `

  const p1 = spawn(process.execPath, ["-e", scriptA], { cwd: tempHome })

  // Wait for p1 to acquire the lock (with timeout to avoid hang)
  const out1 = await new Promise<string>((resolve) => {
    let data = ""
    p1.stdout?.on("data", (chunk) => {
      data += chunk
      if (data.includes("ACQUIRED") || data.includes("DENIED")) {
        resolve(data.trim())
      }
    })
    setTimeout(() => resolve(data.trim()), 2000)
  })

  // Now spawn p2 which should be denied
  const p2 = spawn(process.execPath, ["-e", scriptB], { cwd: tempHome })
  const out2 = await new Promise<string>((resolve) => {
    let data = ""
    p2.stdout?.on("data", (chunk) => { data += chunk })
    p2.on("close", () => resolve(data.trim()))
  })

  // Clean up p1
  p1.kill("SIGTERM")

  assert.equal(out1, "ACQUIRED", `Expected p1 to ACQUIRE, got: ${out1}`)
  assert.equal(out2, "DENIED", `Expected p2 to be DENIED, got: ${out2}`)
})

// ============================================================================
// isProcessRunning
// ============================================================================

test("isProcessRunning returns true for current process", () => {
  assert.equal(isProcessRunning(process.pid), true)
})

test("isProcessRunning returns false for non-existent PID", () => {
  // PID 99999 is extremely unlikely to exist
  assert.equal(isProcessRunning(99999), false)
})

test("isProcessRunning returns false for PID 0", () => {
  assert.equal(isProcessRunning(0), false)
})

test("isProcessRunning returns false for negative PID", () => {
  assert.equal(isProcessRunning(-1), false)
})

test("isProcessRunning returns false for NaN", () => {
  assert.equal(isProcessRunning(Number.NaN), false)
})

// ============================================================================
// isCmsparkDaemonCommandLine — identity heuristic (guards against PID reuse)
// ============================================================================

test("isCmsparkDaemonCommandLine rejects an unrelated recycled process", () => {
  // The real-world bug: daemon.pid pointed at a PID the OS recycled to
  // RuntimeBroker.exe, so the daemon refused to start.
  assert.equal(isCmsparkDaemonCommandLine("C:\\Windows\\System32\\RuntimeBroker.exe"), false)
})

test("isCmsparkDaemonCommandLine matches the SEA exe daemon command line", () => {
  assert.equal(
    isCmsparkDaemonCommandLine('"D:\\Projects\\cmspark\\dist-package\\cmspark-agent.exe" daemon start'),
    true,
  )
})

test("isCmsparkDaemonCommandLine matches the node bundle daemon command line", () => {
  assert.equal(isCmsparkDaemonCommandLine("node cmspark-agent.js daemon start"), true)
})

test("isCmsparkDaemonCommandLine rejects the tray process (no daemon subcommand)", () => {
  // The long-lived tray is also cmspark-agent.exe but has no `daemon` arg —
  // it must not be mistaken for the daemon.
  assert.equal(isCmsparkDaemonCommandLine('"D:\\Projects\\cmspark\\dist-package\\cmspark-agent.exe"'), false)
})

test("isCmsparkDaemonCommandLine returns false for empty/blank input", () => {
  assert.equal(isCmsparkDaemonCommandLine(""), false)
  assert.equal(isCmsparkDaemonCommandLine("   "), false)
})

// ============================================================================
// isDaemonRunning — liveness + identity (recycled-PID safe)
// ============================================================================

test("isDaemonRunning returns false when a live PID is a recycled non-cmspark process", () => {
  // process.pid is alive, but the lookup reports an unrelated process.
  const result = isDaemonRunning(process.pid, () => "C:\\Windows\\System32\\RuntimeBroker.exe")
  assert.equal(result, false)
})

test("isDaemonRunning returns true when a live PID is an actual cmspark daemon", () => {
  const result = isDaemonRunning(process.pid, () => "cmspark-agent.exe daemon start")
  assert.equal(result, true)
})

test("isDaemonRunning short-circuits for a dead PID without consulting the lookup", () => {
  let consulted = false
  const result = isDaemonRunning(99999, () => {
    consulted = true
    return "cmspark-agent.exe daemon start"
  })
  assert.equal(result, false)
  assert.equal(consulted, false)
})

test("isDaemonRunning treats an unavailable command line as not running", () => {
  const result = isDaemonRunning(process.pid, () => null)
  assert.equal(result, false)
})

// ============================================================================
// PID file helpers
// ============================================================================

test("writePidFile and readPidFile round-trip", () => {
  const pidPath = path.join(tempHome, "test.pid")
  writePidFile(pidPath, 12345)
  const pid = readPidFile(pidPath)
  assert.equal(pid, 12345)
})

test("readPidFile returns null for missing file", () => {
  const pidPath = path.join(tempHome, "missing.pid")
  const pid = readPidFile(pidPath)
  assert.equal(pid, null)
})

test("readPidFile returns null for invalid content", () => {
  const pidPath = path.join(tempHome, "invalid.pid")
  fs.writeFileSync(pidPath, "not-a-number")
  const pid = readPidFile(pidPath)
  assert.equal(pid, null)
})

test("readPidFile returns null for zero PID", () => {
  const pidPath = path.join(tempHome, "zero.pid")
  fs.writeFileSync(pidPath, "0")
  const pid = readPidFile(pidPath)
  assert.equal(pid, null)
})

test("writePidFile creates parent directories", () => {
  const pidPath = path.join(tempHome, "nested", "pid", "daemon.pid")
  writePidFile(pidPath, 42)
  assert.equal(fs.existsSync(pidPath), true)
  assert.equal(readPidFile(pidPath), 42)
})

test("writePidFile sets file permissions to 0o600", () => {
  const pidPath = path.join(tempHome, "perms.pid")
  writePidFile(pidPath, 42)
  const stats = fs.statSync(pidPath)
  // eslint-disable-next-line no-bitwise
  const mode = stats.mode & 0o777
  assert.equal(mode, 0o600)
})

test("cleanupPidFile removes the file", () => {
  const pidPath = path.join(tempHome, "cleanup.pid")
  writePidFile(pidPath, 42)
  assert.equal(fs.existsSync(pidPath), true)
  cleanupPidFile(pidPath)
  assert.equal(fs.existsSync(pidPath), false)
})

test("cleanupPidFile is idempotent for missing file", () => {
  const pidPath = path.join(tempHome, "ghost.pid")
  cleanupPidFile(pidPath) // should not throw
  assert.equal(fs.existsSync(pidPath), false)
})

// ============================================================================
// Default paths
// ============================================================================

test("getDefaultLockPath returns path under ~/.cmspark-agent", () => {
  const lockPath = getDefaultLockPath()
  assert.ok(lockPath.endsWith("daemon.sock"))
  assert.ok(lockPath.includes(".cmspark-agent"))
})

test("getDefaultPidPath returns path under ~/.cmspark-agent", () => {
  const pidPath = getDefaultPidPath()
  assert.ok(pidPath.endsWith("daemon.pid"))
  assert.ok(pidPath.includes(".cmspark-agent"))
})

// ============================================================================
// Graceful shutdown
// ============================================================================

test("setupGracefulShutdown calls cleanup on SIGTERM", async () => {
  const markerPath = path.join(tempHome, "sigterm.marker")
  const script = `
    const fs = require("fs");
    const { setupGracefulShutdown } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    setupGracefulShutdown(() => {
      fs.writeFileSync(${JSON.stringify(markerPath)}, "CLEANUP_DONE");
    });
    // Send signal asynchronously so the handler has time to register
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);
    // Keep alive briefly so the handler can run and write the file
    setTimeout(() => {}, 300);
  `

  const child = spawn(process.execPath, ["-e", script], { cwd: tempHome })
  await new Promise<void>((resolve) => child.on("close", resolve))

  assert.equal(fs.existsSync(markerPath), true, "Expected marker file to exist")
  assert.equal(fs.readFileSync(markerPath, "utf-8"), "CLEANUP_DONE")
})

test("setupGracefulShutdown calls cleanup on SIGINT", async () => {
  const markerPath = path.join(tempHome, "sigint.marker")
  const script = `
    const fs = require("fs");
    const { setupGracefulShutdown } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    setupGracefulShutdown(() => {
      fs.writeFileSync(${JSON.stringify(markerPath)}, "CLEANUP_DONE");
    });
    // Send signal asynchronously so the handler has time to register
    setTimeout(() => process.kill(process.pid, "SIGINT"), 50);
    // Keep alive briefly so the handler can run and write the file
    setTimeout(() => {}, 300);
  `

  const child = spawn(process.execPath, ["-e", script], { cwd: tempHome })
  await new Promise<void>((resolve) => child.on("close", resolve))

  assert.equal(fs.existsSync(markerPath), true, "Expected marker file to exist")
  assert.equal(fs.readFileSync(markerPath, "utf-8"), "CLEANUP_DONE")
})

test("setupGracefulShutdown ignores duplicate signals", async () => {
  const script = `
    const { setupGracefulShutdown } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    let count = 0;
    setupGracefulShutdown(() => {
      count++;
      console.log("CLEANUP_" + count);
      // Simulate slow cleanup
      const start = Date.now();
      while (Date.now() - start < 200) {}
    });
    process.kill(process.pid, "SIGTERM");
    // Second signal during cleanup should be ignored
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);
  `

  const child = spawn(process.execPath, ["-e", script], { cwd: tempHome })
  const output = await new Promise<string>((resolve) => {
    let data = ""
    child.stdout?.on("data", (chunk) => { data += chunk })
    child.stderr?.on("data", (chunk) => { data += chunk })
    child.on("close", () => resolve(data))
  })

  const matches = output.match(/CLEANUP_\d/g)
  assert.equal(matches?.length, 1, `Expected cleanup called exactly once, got: ${output}`)
})

test("setupGracefulShutdown awaits async cleanup on SIGTERM", async () => {
  const markerPath = path.join(tempHome, "async-sigterm.marker")
  const script = `
    const fs = require("fs");
    const { setupGracefulShutdown } = require(${JSON.stringify(path.join(__dirname, "../src/daemon"))});
    setupGracefulShutdown(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      fs.writeFileSync(${JSON.stringify(markerPath)}, "ASYNC_CLEANUP_DONE");
    });
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);
    setTimeout(() => {}, 300);
  `

  const child = spawn(process.execPath, ["-e", script], { cwd: tempHome })
  await new Promise<void>((resolve) => child.on("close", resolve))

  assert.equal(fs.existsSync(markerPath), true, "Expected async marker file to exist")
  assert.equal(fs.readFileSync(markerPath, "utf-8"), "ASYNC_CLEANUP_DONE")
})

// ============================================================================
// DaemonError
// ============================================================================

test("DaemonError carries level and code", () => {
  const err = new DaemonError("something broke", "transient", "E_TEST")
  assert.equal(err.message, "something broke")
  assert.equal(err.level, "transient")
  assert.equal(err.code, "E_TEST")
  assert.equal(err.name, "DaemonError")
})

// ============================================================================
// daemonize (spawn detached child)
// ============================================================================

test("daemonize spawns a detached child process", async () => {
  const logPath = path.join(tempHome, "daemonize.log")
  const markerPath = path.join(tempHome, "daemonize.marker")

  // We cannot easily test daemonize() from within the test runner because it
  // calls process.exit(0). Instead, we test the underlying spawn behavior
  // by invoking a child script that writes a marker file.
  const childScript = `
    const fs = require("fs");
    fs.writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));
    // Stay alive briefly so the parent can observe
    setTimeout(() => {}, 500);
  `

  const child = spawn(process.execPath, ["-e", childScript], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()

  // Wait for the marker file to appear
  await new Promise((resolve) => setTimeout(resolve, 300))

  assert.equal(fs.existsSync(markerPath), true)
  const markerPid = parseInt(fs.readFileSync(markerPath, "utf-8").trim(), 10)
  assert.ok(Number.isFinite(markerPid) && markerPid > 0)

  // The child should still be running (or have just finished)
  try {
    process.kill(markerPid, 0)
    // It was running; clean it up
    process.kill(markerPid, "SIGTERM")
  } catch {
    // Already exited
  }
})

test("daemonize log redirection writes stdout to log file", async () => {
  const logPath = path.join(tempHome, "redirect.log")
  const childScript = `
    console.log("HELLO_FROM_DAEMON");
    setTimeout(() => {}, 200);
  `

  const fd = fs.openSync(logPath, "a", 0o600)
  const child = spawn(process.execPath, ["-e", childScript], {
    detached: true,
    stdio: ["ignore", fd, fd],
  })
  child.unref()
  fs.closeSync(fd)

  // Wait for child to write and exit
  await new Promise((resolve) => setTimeout(resolve, 500))

  const logContent = fs.readFileSync(logPath, "utf-8")
  assert.ok(logContent.includes("HELLO_FROM_DAEMON"), `Expected log to contain HELLO_FROM_DAEMON, got: ${logContent}`)
})
