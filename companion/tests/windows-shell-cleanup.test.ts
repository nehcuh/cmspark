// #599 F1: cancelling shell_exec must survive async taskkill startup failures.
// The old sync catch missed ChildProcess.error and terminated Companion.
// Inject only owned process boundaries; native CI also exercises a real tree.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import cp = require("node:child_process")
import fs from "node:fs"
import { initDataDir, saveConfig } from "../src/config"
import { shellExec, listActiveShellRunIds, killProcessTree } from "../src/capability/shell"
import { windowsTaskkillPath } from "../src/acp/win-spawn"

before(async () => {
  await initDataDir()
  saveConfig({ capability_profile: "enterprise", modules: {
    shell: { available: true, enabled: true, policy: "confirm_per_command" },
  } } as any)
})

for (const trigger of ["abort", "timeout"] as const) for (const mode of ["error", "exit", "throw", "timeout"] as const) {
  test(`Windows shell ${trigger}: ${mode} cleanup is bounded and once-only`, async t => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    const root = Object.assign(new EventEmitter(), { pid: 98765, exitCode: null as number | null,
      signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(),
      kill() { releases++; root.exitCode = 1; queueMicrotask(() => root.emit("close", 1)); return true },
    })
    const killer = Object.assign(new EventEmitter(), { kill() { killerStops++; return true } })
    let releases = 0, killerStops = 0, kills = 0
    t.mock.timers.enable({ apis: ["setTimeout"] })
    t.mock.method(cp, "spawn", (file: string, args: string[]) => {
      if (file === "owned.exe") return root
      kills++
      assert.equal(file, windowsTaskkillPath())
      assert.deepEqual(args, ["/pid", "98765", "/T", "/F"])
      if (mode === "throw") throw new Error("owned synchronous failure")
      queueMicrotask(() => {
        if (mode === "error") killer.emit("error", Object.assign(new Error("owned missing taskkill"), { code: "ENOENT" }))
        if (mode === "exit") killer.emit("close", 1)
      })
      return killer
    })
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const controller = new AbortController()
      const call = shellExec({ command: "owned.exe", signal: controller.signal, timeoutMs: 1000, runKey: `owned-${mode}` })
      if (trigger === "abort") controller.abort()
      else t.mock.timers.tick(1000)
      if (mode === "timeout") t.mock.timers.tick(5000)
      const result = await call
      assert.equal(result.data.aborted, trigger === "abort")
      assert.equal(result.data.timed_out, trigger === "timeout")
      assert.equal(releases, 1)
      assert.equal(kills, 1)
      assert.equal(killerStops, mode === "timeout" ? 1 : 0)
      if (mode !== "throw") { killer.emit("close", 1); killer.emit("error", new Error("late")) }
      killProcessTree(root as unknown as cp.ChildProcess)
      assert.equal(releases, 1)
      assert.equal(kills, 1)
      assert.deepEqual(listActiveShellRunIds(), [])
    } finally { Object.defineProperty(process, "platform", platform) }
  })
}

test("Windows shell cleanup stops an owned native Node tree", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  const child = cp.spawn(process.execPath, ["-e", "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
  let grandchild = 0
  try {
    grandchild = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("owned fixture not ready")), 5000)
      child.once("error", error => { clearTimeout(timer); reject(error) })
      child.stdout!.once("data", data => { clearTimeout(timer); resolve(Number(String(data).trim())) })
    })
    assert.ok(grandchild > 0 && child.pid)
    killProcessTree(child)
    for (const pid of [child.pid!, grandchild]) {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    }
  } finally {
    try { child.kill() } catch {}
    if (grandchild) { try { process.kill(grandchild) } catch {} }
  }
})

// Adversarial review caught a Windows guard suppressing POSIX group cleanup.
// An exited leader can still have live descendants in its detached group.
// Implementation regression; use owned processes and always clean the group.
// Protects shell cancellation from leaving background work behind on POSIX.
test("POSIX shell cleanup stops descendants after the group leader exits", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  const root = cp.spawn(process.execPath, ["-e", "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);c.unref()"], { detached: true, stdio: ["ignore", "pipe", "ignore"] })
  let grandchild = 0
  const alive = () => {
    try {
      // Minimal Linux images have /proc but may not ship ps. Zombies are dead.
      if (process.platform === "linux") {
        const stat = fs.readFileSync(`/proc/${grandchild}/stat`, "utf8")
        return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z"
      }
      return !/^Z/.test(cp.execFileSync("ps", ["-o", "stat=", "-p", String(grandchild)], { encoding: "utf8" }).trim())
    }
    catch { return false }
  }
  try {
    grandchild = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("owned fixture not ready")), 5000)
      root.once("error", error => { clearTimeout(timer); reject(error) })
      root.stdout!.once("data", data => { clearTimeout(timer); resolve(Number(String(data).trim())) })
    })
    if (root.exitCode === null) await new Promise<void>(resolve => root.once("exit", () => resolve()))
    assert.equal(root.exitCode, 0)
    assert.ok(grandchild > 0 && alive())
    killProcessTree(root)
    const deadline = Date.now() + 3000
    while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(alive(), false)
  } finally { if (root.pid) { try { process.kill(-root.pid, "SIGKILL") } catch {} } }
})
