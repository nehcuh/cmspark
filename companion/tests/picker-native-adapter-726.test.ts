// Execute the whole test-only transport with an inert ChildProcess pipe.
// No PowerShell/UIA/Win32 or subprocess is executed by these controls.
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
const filename = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests/helpers/picker-native-adapter-726.cjs" : "helpers/picker-native-adapter-726.cjs")
function fixture() {
  const target: any = { pid: 31, exitCode: null, signalCode: null }
  const pipe: any = new EventEmitter(); pipe.stdout = new EventEmitter(); pipe.exitCode = null; pipe.signalCode = null
  const abort = new AbortController(); const calls: any[] = [], commands: any[] = [], registered: any[] = []
  let kills = 0, callbacks = 0
  pipe.kill = () => { kills++; return true }
  pipe.stdin = { write(line: string, callback: any) { const request = JSON.parse(line); commands.push(request); callback?.() } }
  const mod = { exports: {} as any }
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { exports: mod.exports, Buffer, require(name: string) {
    assert.equal(name, "node:child_process"); return { spawn(...args: any[]) { calls.push(args); return pipe } }
  } }, { filename })
  const adapter = mod.exports.nativePickerAdapter726({ child: target, expectedPath: "C:\\owned\\中文", script: "owned-controller.ps1", powershell: "owned-powershell.exe", signal: abort.signal, registerChild(child: any) { registered.push(child) } })
  const emit = (row: any) => pipe.stdout.emit("data", Buffer.from(JSON.stringify(row) + "\n"))
  const close = () => { pipe.exitCode = 0; pipe.emit("close", 0, null) }
  return { target, pipe, abort, adapter, calls, commands, registered, emit, close, kills: () => kills, callbacks: () => callbacks,
    subscribe: () => adapter.subscribe(target, () => { callbacks++ }),
    async ready() { const pending = this.subscribe(); assert.equal(registered[0], pipe); emit({ event: "ready" }); await pending },
    async stop() { const pending = adapter.stop(); const cmd = commands.at(-1); if (cmd?.op === "stop") emit({ id: cmd.id, result: "STOPPED" }); close(); await pending },
  }
}
test("726 native transport registers actual child before waiting for ready", async () => {
  const f = fixture(); await f.ready(); assert.equal(f.calls.length, 1); assert.equal(f.registered.length, 1)
  assert.equal(f.calls[0][1].join("|"), "-NoProfile|-STA|-File|owned-controller.ps1|-OwnerPid|31")
  f.emit({ event: "opened" }); assert.equal(f.callbacks(), 1); await f.stop()
})
test("726 native transport accepts only exact native modal verification; never sends initial path into controller", async () => {
  const f = fixture(); await f.ready(); const snapshot = f.adapter.snapshot(); const cmd = f.commands.at(-1)
  assert.equal(Object.hasOwn(cmd, "path"), false); f.emit({ id: cmd.id, result: "EXACT" }); const row = await snapshot
  assert.equal(row.owner, f.target); const invoke = f.adapter.invoke(row, "ok"); const action = f.commands.at(-1)
  assert.equal(action.mode, "ok"); f.emit({ id: action.id, result: "INVOKED" }); assert.equal(await invoke, row); await f.stop()
})
test("726 unknown actual modal provider refuses without invoking", async () => {
  const f = fixture(); await f.ready(); const snapshot = f.adapter.snapshot(); f.emit({ id: f.commands.at(-1).id, result: "UNKNOWN_UIA" })
  await assert.rejects(snapshot, /NATIVE_UNKNOWN/); assert.equal(f.commands.some(c => c.op === "invoke"), false); await f.stop()
})
test("726 foreign owner cannot launch a native controller", async () => {
  const f = fixture(); await assert.rejects(f.adapter.subscribe({}, () => {}), /OWNER_REFUSED/); assert.equal(f.calls.length, 0); await f.adapter.stop()
})
test("726 abort before subscription creates no process", async () => {
  const f = fixture(); f.abort.abort(); await assert.rejects(f.subscribe(), /OWNER_REFUSED/); assert.equal(f.calls.length, 0); await f.adapter.stop()
})
test("726 failed open remains registered and cleanup waits actual close", async () => {
  const f = fixture(); const subscribe = f.subscribe(); f.pipe.emit("error", Error("inert")); await assert.rejects(subscribe)
  f.abort.abort(); let settled = false; const stop = f.adapter.stop().then(() => { settled = true }); await Promise.resolve()
  assert.equal(settled, false); assert.ok(f.kills() > 0); assert.equal(f.registered[0], f.pipe); f.close(); await stop
})
test("726 abort rejects pending native request and cannot return a late exact receipt", async () => {
  const f = fixture(); await f.ready(); const pending = f.adapter.snapshot(); const id = f.commands.at(-1).id
  f.abort.abort(); await assert.rejects(pending); f.emit({ id, result: "EXACT" }); f.close(); await f.adapter.stop()
})
test("726 unknown response and capped pipe data cannot certify native display", async () => {
  for (const shape of ["unknown", "oversized"]) {
    const f = fixture(); await f.ready(); const pending = f.adapter.snapshot()
    if (shape === "unknown") f.emit({ id: f.commands.at(-1).id, result: "INVENTED" })
    else f.pipe.stdout.emit("data", Buffer.alloc(8193, 120))
    await assert.rejects(pending); f.abort.abort(); f.close(); await f.adapter.stop()
  }
})
