import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import { resolvePowerShellExe, resolveWinScript } from "../src/host-use/win/powershell"

// Uses a real interactive Windows desktop and targets only the HWND owned by the test.
const enabled = process.platform === "win32" && process.env.CMSPARK_MINI_NATIVE_ORB === "1"

test("Windows Mini opens its anchored chat, routes every capture leaf and exits on EOF", {
  skip: !enabled, timeout: 60_000,
}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cmspark-mini-orb-"))
  try {
    const { stdout } = await promisify(execFile)(resolvePowerShellExe(), [
      "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", path.resolve("tests/fixtures/mini-orb-driver.ps1"),
      "-HostScript", resolveWinScript("mini-orb.ps1"),
      "-PositionFile", path.join(dir, "position"),
    ], { windowsHide: true, timeout: 50_000 })
    assert.equal(stdout.trim(), "PASS")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
