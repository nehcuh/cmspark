/**
 * shell_exec abort + timeout process-tree kill.
 * Covers: chat.stop signal, registry abort by thread/id, timeout kills grandchildren.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-abort-"))
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.HOME = tempHome

let shell: typeof import("../src/capability/shell")
let clearConfigCache: any
let saveConfig: any

function enableShell() {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: { available: true, enabled: true, policy: "confirm_per_command" },
    },
  } as any)
  clearConfigCache()
}

before(async () => {
  const configMod = await import("../src/config")
  await configMod.initDataDir()
  clearConfigCache = configMod.clearConfigCache
  saveConfig = configMod.saveConfig
  clearConfigCache()
  shell = await import("../src/capability/shell")
  enableShell()
})

after(() => {
  shell._resetShellRunsForTests()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("resolveShellTimeoutMs clamps and defaults", () => {
  assert.equal(shell.resolveShellTimeoutMs(undefined), shell.DEFAULT_TIMEOUT_MS)
  assert.equal(shell.resolveShellTimeoutMs(500), 1000)
  assert.equal(shell.resolveShellTimeoutMs(999_999), shell.MAX_TIMEOUT_MS)
  assert.equal(shell.resolveShellTimeoutMs(12_345), 12_345)
})

test("shell_exec respects AbortSignal mid-run", async () => {
  enableShell()
  shell._resetShellRunsForTests()
  const ac = new AbortController()
  const p = shell.shellExec({
    command: "sleep 30",
    timeoutMs: 60_000,
    signal: ac.signal,
    runKey: "tc-signal-1",
    threadId: "thread-signal",
  })
  // Let spawn settle
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(shell.listActiveShellRunIds().includes("tc-signal-1"))
  ac.abort()
  const r = await p
  assert.equal(r.success, true)
  assert.equal(r.data?.aborted, true)
  assert.equal(r.data?.timed_out, false)
  assert.equal(r.data?.exit_code, -1)
  assert.ok((r.data?.duration_ms ?? 99999) < 10_000)
  assert.equal(shell.listActiveShellRunIds().length, 0)
})

test("abortShellRunsForThread kills registered run", async () => {
  enableShell()
  shell._resetShellRunsForTests()
  const p = shell.shellExec({
    command: "sleep 30",
    timeoutMs: 60_000,
    runKey: "tc-thread-1",
    threadId: "thread-A",
  })
  await new Promise((r) => setTimeout(r, 200))
  const n = shell.abortShellRunsForThread("thread-A")
  assert.equal(n, 1)
  const r = await p
  assert.equal(r.data?.aborted, true)
  assert.equal(r.data?.timed_out, false)
})

test("abortShellRunById kills one tool_call", async () => {
  enableShell()
  shell._resetShellRunsForTests()
  const p = shell.shellExec({
    command: "sleep 30",
    timeoutMs: 60_000,
    runKey: "tc-solo-1",
    threadId: "thread-B",
  })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(shell.abortShellRunById("tc-solo-1"), true)
  assert.equal(shell.abortShellRunById("missing"), false)
  const r = await p
  assert.equal(r.data?.aborted, true)
})

test("timeout kills process group grandchildren (POSIX)", async (t) => {
  if (process.platform === "win32") {
    t.skip("process-group check is POSIX-specific")
    return
  }
  enableShell()
  shell._resetShellRunsForTests()
  // Grandchild marker: sleep continues if only the shell parent is killed
  const marker = path.join(tempHome, `orphan-${Date.now()}`)
  const r = await shell.shellExec({
    // shell:true path (metachar) so bash -c owns the sleep child
    command: `sleep 20; touch "${marker}"`,
    timeoutMs: 800,
    runKey: "tc-timeout-tree",
    threadId: "thread-to",
  })
  assert.equal(r.data?.timed_out, true)
  assert.equal(r.data?.aborted, false)
  // Give a stray orphan a moment to write the marker if killProcessTree failed
  await new Promise((res) => setTimeout(res, 1500))
  assert.equal(fs.existsSync(marker), false, "grandchild must not outlive timeout kill")
  // No leftover sleep from this test
  try {
    const out = execSync('pgrep -fl "sleep 20" || true', { encoding: "utf8" })
    assert.ok(!out.includes("sleep 20"), `orphan sleep still running: ${out}`)
  } catch {
    /* pgrep not available — marker check is enough */
  }
})

test("pre-aborted signal refuses before spawn", async () => {
  enableShell()
  const ac = new AbortController()
  ac.abort()
  const r = await shell.shellExec({
    command: "echo should-not-run",
    signal: ac.signal,
  })
  assert.equal(r.success, false)
  assert.match(r.error || "", /aborted/i)
  assert.equal(r.data?.aborted, true)
})
