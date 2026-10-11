// ACP retained a delayed naked-PID retry after the original process exited.
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import cp = require("node:child_process")
import { killAcpChild, windowsTaskkillPath } from "../src/acp/win-spawn"
import { JsonRpcStdioClient } from "../src/acp/jsonrpc-stdio"

for (const mode of ["success", "error", "exit", "throw", "timeout"] as const) {
  test(`Windows ACP cleanup: ${mode} is bounded, idempotent and never retries an exited PID`, async t => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    let launches = 0, fallback = 0, killerStops = 0
    const child = Object.assign(new EventEmitter(), { pid: 98765, exitCode: null as number | null, signalCode: null,
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { fallback++; child.exitCode = 1; child.emit("close", 1); return true },
    })
    const killer = Object.assign(new EventEmitter(), { kill() { killerStops++; return true } })
    t.mock.timers.enable({ apis: ["setTimeout"] })
    t.mock.method(cp, "spawn", (file: string, args: string[]) => {
      launches++; assert.equal(file, windowsTaskkillPath()); assert.deepEqual(args, ["/pid", "98765", "/T", "/F"])
      if (mode === "throw") throw new Error("owned startup failure")
      queueMicrotask(() => {
        if (mode === "error") killer.emit("error", new Error("owned error"))
        if (mode === "exit") killer.emit("close", 1)
        if (mode === "success") { child.exitCode = 0; child.emit("close", 0); killer.emit("close", 0) }
      })
      return killer
    })
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      new JsonRpcStdioClient(child as any).kill()
      await Promise.resolve()
      t.mock.timers.tick(6000)
      killAcpChild(child as any)
      assert.equal(launches, 1)
      assert.equal(fallback, mode === "success" ? 0 : 1)
      assert.equal(killerStops, mode === "timeout" ? 1 : 0)
    } finally { Object.defineProperty(process, "platform", platform) }
  })
}

test("Windows ACP cleanup removes an owned native tree and leaves an unrelated process alive", { skip: process.platform !== "win32", timeout: 25000 }, async () => {
  const sentinel = cp.spawn(process.execPath, ["-e", "setTimeout(()=>{},20000)"], { stdio: "ignore", windowsHide: true })
  const child = cp.spawn(process.execPath, ["-e", "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},15000)"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
  try {
    const descendant = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("owned fixture timeout")), 5000)
      child.once("error", e => { clearTimeout(timer); reject(e) })
      child.stdout!.once("data", b => { clearTimeout(timer); resolve(Number(String(b).trim())) })
    })
    assert.ok(descendant > 0)
    killAcpChild(child)
    for (const pid of [child.pid!, descendant]) {
      const until = Date.now() + 7000
      while (Date.now() < until) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise(r => setTimeout(r, 20))
      }
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    }
    killAcpChild(child)
    assert.doesNotThrow(() => process.kill(sentinel.pid!, 0))
  } finally { child.kill(); sentinel.kill() }
})
