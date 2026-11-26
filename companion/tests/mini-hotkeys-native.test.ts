import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import { resolvePowerShellExe, resolveWinScript } from "../src/host-use/win/powershell"

// Sends real keyboard input on an interactive Windows desktop using isolated bindings.
const enabled = process.platform === "win32" && process.env.CMSPARK_MINI_NATIVE_HOTKEYS === "1"

async function exercise(...options: string[]): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cmspark-mini-hotkeys-"))
  try {
    const { stdout } = await promisify(execFile)(resolvePowerShellExe(), [
      "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", path.resolve("tests/fixtures/mini-hotkeys-driver.ps1"),
      "-HostScript", resolveWinScript("mini-hotkeys.ps1"),
      "-BindingsFile", path.join(dir, "bindings.json"), ...options,
    ], { windowsHide: true, timeout: 55_000 })
    assert.equal(stdout.trim(), "PASS")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("Windows reserves saved Mini shortcuts, reports an OS conflict and releases registrations on exit", {
  skip: !enabled, timeout: 65_000,
}, () => exercise("-OwnershipOnly"))

test("Mini global shortcuts work across apps and survive conflicts, edits, clear and restart", {
  skip: !enabled, timeout: 65_000,
}, () => exercise())
