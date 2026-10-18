import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import fsNative from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { appendCapabilityAudit } from "../src/packs/audit-log"

test("append creates restricted file with one json line", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  const calls: Array<{ op: string; mode?: string | number | null }> = [], restore: Array<() => void> = []
  let ownedFd: number | undefined
  if (process.platform === "win32") {
    // Observe actual append/close and mode requests; Windows stat is not a DACL.
    const write = fsNative.writeFileSync, open = fsNative.openSync, append = fsNative.writeSync, close = fsNative.closeSync, chmod = fsNative.chmodSync
    const w = t.mock.method(fsNative, "writeFileSync", function (this: typeof fsNative, ...args: Parameters<typeof write>) {
      if (args[0] === p) calls.push({ op: "create", mode: typeof args[2] === "object" ? args[2]?.mode : undefined })
      return Reflect.apply(write, this, args)
    })
    restore.push(() => w.mock.restore())
    const o = t.mock.method(fsNative, "openSync", function (this: typeof fsNative, ...args: Parameters<typeof open>) {
      const fd = Reflect.apply(open, this, args)
      if (args[0] === p && args[1] === "a") { calls.push({ op: "open-append", mode: args[2] }); ownedFd = fd }
      return fd
    })
    restore.push(() => o.mock.restore())
    const a = t.mock.method(fsNative, "writeSync", function (this: typeof fsNative, ...args: Parameters<typeof append>) {
      if (args[0] === ownedFd) calls.push({ op: "append" })
      return Reflect.apply(append, this, args)
    })
    restore.push(() => a.mock.restore())
    const c = t.mock.method(fsNative, "closeSync", function (this: typeof fsNative, ...args: Parameters<typeof close>) {
      if (args[0] === ownedFd) calls.push({ op: "close" })
      return Reflect.apply(close, this, args)
    })
    restore.push(() => c.mock.restore())
    const m = t.mock.method(fsNative, "chmodSync", function (this: typeof fsNative, ...args: Parameters<typeof chmod>) {
      if (args[0] === p) calls.push({ op: "chmod", mode: args[1] })
      return Reflect.apply(chmod, this, args)
    })
    restore.push(() => m.mock.restore())
  }
  try {
  appendCapabilityAudit(
    { type: "pack.apply", pack_id: "x", thread_id: "t1", at: new Date().toISOString() },
    p,
  )
  } finally { for (const undo of restore.reverse()) undo() }
  assert.ok(fs.existsSync(p))
  const st = fs.statSync(p)
  // not world/group writable
  if (process.platform === "win32") {
    assert.deepEqual(calls, [{ op: "create", mode: 0o600 }, { op: "open-append", mode: 0o600 }, { op: "append" }, { op: "close" }, { op: "chmod", mode: 0o600 }])
  } else {
    assert.equal(st.mode & 0o022, 0)
  }
  const line = fs.readFileSync(p, "utf8").trim()
  assert.equal(JSON.parse(line).type, "pack.apply")
})

test("oversized line does not throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  const huge = "x".repeat(300_000)
  appendCapabilityAudit({ type: "pack.apply", pack_id: huge, at: new Date().toISOString() }, p)
  // may create empty file or no content for that event
  assert.ok(true)
})
