import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const native = { skip: process.platform !== "win32", timeout: 15_000 }

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

// The owned foreign process opens the actual conversation file with read/write
// sharing but WITHOUT delete sharing. No rename error is synthesized. A release
// file lets it close its handle while the Node main thread is synchronously waiting.
async function holdFile(file: string, root: string) {
  const systemRoot = process.env.SystemRoot
  assert.ok(systemRoot && path.isAbsolute(systemRoot))
  const release = path.join(root, "release")
  const script = `
    $ErrorActionPreference = 'Stop'
    $handle = [System.IO.File]::Open($env:CMSPARK_LOCK_FILE, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      [Console]::Out.WriteLine('LOCKED')
      [Console]::Out.Flush()
      $clock = [System.Diagnostics.Stopwatch]::StartNew()
      while (-not [System.IO.File]::Exists($env:CMSPARK_RELEASE_FILE)) {
        if ($clock.ElapsedMilliseconds -gt 10000) { throw 'owned lock release deadline' }
        [System.Threading.Thread]::Sleep(1)
      }
    } finally { $handle.Dispose() }
  `
  const child = spawn(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { SystemRoot: systemRoot, windir: systemRoot, TEMP: root, TMP: root,
        CMSPARK_LOCK_FILE: file, CMSPARK_RELEASE_FILE: release },
    })
  let closed = false
  const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (code, signal) => { closed = true; resolve({ code, signal }) })
  })
  child.stderr.resume()
  const ready = new Promise<void>((resolve, reject) => {
    let output = ""
    child.once("error", reject)
    child.stdout.on("data", data => {
      output += data.toString("utf8")
      if (output.length > 64) reject(new Error("invalid owned lock readiness"))
      else if (output === "LOCKED\r\n" || output === "LOCKED\n") resolve()
    })
    void close.then(() => reject(new Error("owned lock closed before readiness")))
  })
  const releaseHandle = () => fs.writeFileSync(release, "release", { mode: 0o600 })
  try { await within(ready, 5000, "owned lock readiness deadline") } catch (error) {
    if (!closed) child.kill()
    await within(close, 5000, "owned lock startup cleanup deadline")
    throw error
  }
  return {
    release: releaseHandle,
    async dispose() {
      releaseHandle()
      try {
        const result = await within(close, 5000, "owned lock close deadline")
        assert.deepEqual(result, { code: 0, signal: null })
      } finally {
        if (!closed) {
          child.kill()
          await within(close, 5000, "owned lock kill/close deadline")
        }
      }
    },
  }
}

for (const releaseAfterFailure of [true, false]) {
  test(`Windows real ThreadManager save: ${releaseAfterFailure ? "foreign handle release recovers" : "persistent lock preserves history and continuation"}`, native, async t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-session-save-")))
    const previousDataDir = process.env.CMSPARK_DATA_DIR
    process.env.CMSPARK_DATA_DIR = path.join(root, "data")
    let lock: Awaited<ReturnType<typeof holdFile>> | undefined
    try {
      const { initDataDir, clearConfigCache } = await import("../src/config")
      clearConfigCache()
      await initDataDir()
      const { ThreadManager } = await import("../src/threads/thread-manager")
      const manager = new ThreadManager(), id = "save-native"
      manager.create("Owned Windows save", id)
      manager.addMessage(id, { thread_id: id, role: "user", content: "previous message" })
      const file = path.join(process.env.CMSPARK_DATA_DIR, "threads", `${id}.json`)
      const before = fs.readFileSync(file)
      lock = await holdFile(file, root)
      const rename = fs.renameSync
      let attempts = 0
      const failures: NodeJS.ErrnoException[] = []
      t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
        if (String(to) !== file) return rename(from, to)
        attempts++
        try { return rename(from, to) } catch (error) {
          const failure = error as NodeJS.ErrnoException
          failures.push(failure)
          assert.equal(failure.syscall, "rename")
          assert.ok(["EPERM", "EACCES", "EBUSY"].includes(failure.code!))
          assert.deepEqual(fs.readFileSync(file), before, "refused replacements retain the complete old JSON")
          if (releaseAfterFailure && failures.length === 1) lock!.release()
          throw error
        }
      })
      const save = () => manager.addMessage(id, { thread_id: id, role: "assistant", content: "saved once" })
      if (releaseAfterFailure) {
        assert.doesNotThrow(save)
        assert.ok(attempts >= 2 && attempts <= 5)
        assert.ok(failures.length >= 1, "negative control must observe an actual Windows rename refusal")
      } else {
        assert.throws(save, error => error === failures.at(-1))
        assert.equal(attempts, 5)
        assert.equal(failures.length, 5)
        assert.deepEqual(fs.readFileSync(file), before)
        assert.deepEqual(manager.getMessages(id).map(m => m.content), ["previous message"])
      }
      assert.equal(fs.existsSync(`${file}.tmp-${process.pid}`), false)
      t.mock.restoreAll()
      await lock.dispose()
      lock = undefined
      if (!releaseAfterFailure) save()
      const messages = new ThreadManager().getMessages(id)
      assert.deepEqual(messages.map(m => m.content), ["previous message", "saved once"])
      assert.equal(fs.existsSync(`${file}.tmp-${process.pid}`), false)
    } finally {
      t.mock.restoreAll()
      try { if (lock) await lock.dispose() } finally {
        if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR
        else process.env.CMSPARK_DATA_DIR = previousDataDir
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })
}
