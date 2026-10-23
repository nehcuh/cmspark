import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

// Trace d1anr7: Windows 0.6.14 rejected the thread JSON temp-to-final rename.
// The next user continuation worked; the failed save had already thrown.
// Attribution: external trigger unknown; one-shot application behavior reproduced.
// Protect: bounded rename-only recovery, synchronous writes, old data on failure.

// Execute the complete real writer module with only the OS rename failure and
// platform controlled. Real temp files and real successful renames are retained.
// This reproduces the application response, not the unknown Windows lock owner.
function writer(platform: string, file: string, errors: Error[], realWait = false) {
  const waits: number[] = []
  let renames = 0, writes = 0
  const source = fs.readFileSync(require.resolve("../src/io"), "utf8")
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as typeof import("../src/io") }
  vm.runInNewContext(js, {
    module, exports: module.exports, process: { pid: process.pid, platform },
    require: (name: string) => {
      assert.ok(name === "fs" || name === "node:fs", `unexpected writer dependency: ${name}`)
      return { ...fs,
        writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { writes++; return fs.writeFileSync(...args) },
        renameSync: (from: string, to: string) => {
          assert.equal(to, file)
          renames++
          const error = errors.shift()
          if (error) {
            assert.equal(fs.readFileSync(file, "utf8"), "previous complete data")
            throw error
          }
          fs.renameSync(from, to)
        },
      }
    },
    SharedArrayBuffer, Int32Array,
    Atomics: realWait ? Atomics : { wait: (_view: unknown, _index: number, _value: number, ms: number) => { waits.push(ms); return "timed-out" } },
  })
  return { api: module.exports, waits, count: () => ({ renames, writes }) }
}

const error = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code, syscall: "rename" })
test("mixed Windows rename refusals recover with the real Node wait primitive", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-atomic-")), file = path.join(root, "d1anr7.json")
  fs.writeFileSync(file, "previous complete data")
  try {
    const w = writer("win32", file, [error("EPERM"), error("EBUSY")], true)
    assert.equal(w.api.atomicWriteJSON(file, { messages: ["saved once"] }), undefined)
    assert.deepEqual(w.count(), { renames: 3, writes: 1 })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { messages: ["saved once"] })
    assert.deepEqual(fs.readdirSync(root), ["d1anr7.json"])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
for (const kind of ["json", "text"] as const) {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    test(`${kind}: one transient Windows ${code} retries only the rename`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-atomic-")), file = path.join(root, "d1anr7.json")
      fs.writeFileSync(file, "previous complete data")
      try {
        const w = writer("win32", file, [error(code)])
        const result = kind === "json" ? w.api.atomicWriteJSON(file, { messages: ["saved once"] }) : w.api.atomicWriteText(file, "saved once")
        assert.equal(result, undefined, "writer stays synchronous")
        assert.equal(fs.readFileSync(file, "utf8"), kind === "json" ? JSON.stringify({ messages: ["saved once"] }, null, 2) : "saved once")
        assert.deepEqual(w.count(), { renames: 2, writes: 1 })
        assert.deepEqual(w.waits, [10])
        assert.deepEqual(fs.readdirSync(root), ["d1anr7.json"])
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  }

  test(`${kind}: persistent refusal is bounded, preserves old data and original error`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-atomic-")), file = path.join(root, "d1anr7.json")
    fs.writeFileSync(file, "previous complete data")
    const primary = error("EPERM")
    try {
      const w = writer("win32", file, Array(10).fill(primary))
      assert.throws(() => kind === "json" ? w.api.atomicWriteJSON(file, {}) : w.api.atomicWriteText(file, "new"), e => e === primary)
      assert.deepEqual(w.count(), { renames: 5, writes: 1 })
      assert.deepEqual(w.waits, [10, 20, 40, 80])
      assert.equal(fs.readFileSync(file, "utf8"), "previous complete data")
      assert.deepEqual(fs.readdirSync(root), ["d1anr7.json"])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  for (const [platform, code] of [["darwin", "EPERM"], ["linux", "EBUSY"], ["win32", "ENOENT"], ["win32", "EXDEV"], ["win32", "ENOSPC"]]) {
    test(`${kind}: ${platform}/${code} retains immediate failure`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-atomic-")), file = path.join(root, "d1anr7.json")
      fs.writeFileSync(file, "previous complete data")
      const primary = error(code)
      try {
        const w = writer(platform, file, [primary])
        assert.throws(() => kind === "json" ? w.api.atomicWriteJSON(file, {}) : w.api.atomicWriteText(file, "new"), e => e === primary)
        assert.deepEqual(w.count(), { renames: 1, writes: 1 })
        assert.deepEqual(w.waits, [])
        assert.equal(fs.readFileSync(file, "utf8"), "previous complete data")
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  }
}
