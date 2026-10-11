import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { spawn, type ChildProcess } from "node:child_process"
import { killWindowsPtyTree } from "../src/pty/windows-tree"
import { windowsTaskkillPath } from "../src/acp/win-spawn"
import { resolveKnownFolders } from "../src/host-use/win/known-folders"

test("PTY taskkill uses the pinned path and catches asynchronous startup failure", async () => {
  const child = new EventEmitter() as ChildProcess
  let releases = 0
  killWindowsPtyTree(12345, () => { releases++ }, ((file: string, args: string[]) => {
    assert.equal(file, windowsTaskkillPath())
    assert.deepEqual(args, ["/pid", "12345", "/T", "/F"])
    queueMicrotask(() => { child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })); child.emit("close", -1) })
    return child
  }) as typeof spawn)
  assert.equal(releases, 0)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(releases, 1)
})

test("PTY handle stays live until tree cleanup completes and fallback is once only", () => {
  const child = new EventEmitter() as ChildProcess
  let releases = 0
  killWindowsPtyTree(12345, () => { releases++ }, (() => child) as typeof spawn)
  assert.equal(releases, 0)
  child.emit("close", 0)
  child.emit("error", new Error("late"))
  assert.equal(releases, 1)
  killWindowsPtyTree(12345, () => { releases++ }, (() => { throw new Error("sync") }) as typeof spawn)
  assert.equal(releases, 2)
})

test("PTY cleanup timeout kills only its taskkill child and releases once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const child = new EventEmitter() as ChildProcess
  let killerStops = 0
  child.kill = () => { killerStops++; return true }
  let releases = 0
  killWindowsPtyTree(12345, () => { releases++ }, (() => child) as typeof spawn)
  t.mock.timers.tick(5000)
  assert.equal(killerStops, 1)
  assert.equal(releases, 1)
  child.emit("error", new Error("late"))
  child.emit("close", 1)
  t.mock.timers.tick(5000)
  assert.equal(releases, 1)
})

test("Known Folder JSON preserves redirected paths and rejects malformed authority", async () => {
  const payload = { documents: "D:\\OneDrive 公司\\Documents", desktop: "C:\\Users\\O'Brien & !\\Desktop", downloads: "\\\\server\\home\\Downloads" }
  const roots = await resolveKnownFolders(async (_script, args) => {
    assert.deepEqual(args, [])
    return JSON.stringify(payload)
  })
  assert.deepEqual(roots, Object.entries(payload).map(([token, path]) => ({ token, path })))
  for (const invalid of [null, [], {}, { ...payload, documents: "relative" }, { ...payload, documents: "\\root-relative" }, { ...payload, desktop: "\\\\?\\C:\\Desktop" }]) {
    await assert.rejects(resolveKnownFolders(async () => JSON.stringify(invalid)), /known-folders/)
  }
})

test("Windows native Known Folder resolver returns current user folders without modifying them", { skip: process.platform !== "win32" }, async () => {
  const roots = await resolveKnownFolders()
  assert.deepEqual(roots.map((root) => root.token), ["documents", "desktop", "downloads"])
  assert.ok(roots.every((root) => root.path.length > 3))
})

test("Known Folder authority rejects drive and UNC share roots after normalization", async () => {
  const payload = { documents: "C:\\Users\\test\\Documents", desktop: "C:\\Users\\test\\Desktop", downloads: "C:\\Users\\test\\Downloads" }
  for (const root of ["C:\\", "c:/", "C:\\folder\\..", "\\\\server\\share", "\\\\server\\share\\", "\\\\server\\share\\folder\\..", "//server/share/"]) {
    for (const token of Object.keys(payload)) {
      await assert.rejects(resolveKnownFolders(async () => JSON.stringify({ ...payload, [token]: root })), /known-folders: invalid/)
    }
  }
})

test("Windows taskkill removes a real owned process tree", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
  // No shell or external application: the fixture owns both Node processes.
  const child = spawn(process.execPath, ["-e", `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)`], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
  let grandchild = 0
  try {
    grandchild = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture did not start")), 5000)
      child.once("error", (error) => { clearTimeout(timer); reject(error) })
      child.stdout!.once("data", (chunk) => { clearTimeout(timer); resolve(Number(String(chunk).trim())) })
    })
    assert.ok(grandchild > 0 && child.pid)
    await new Promise<void>((resolve) => killWindowsPtyTree(child.pid!, resolve))
    for (const pid of [child.pid!, grandchild]) {
      // TerminateProcess may return before the target has finished exiting.
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise<void>((resolve) => setTimeout(resolve, 25))
      }
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    }
  } finally {
    try { child.kill() } catch {}
    if (grandchild) { try { process.kill(grandchild) } catch {} }
  }
})
