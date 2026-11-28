import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import test from "node:test"
import { windowsPowerShellExePath } from "../src/process-path"
import { decodePngToRgba } from "../src/computer/png-decode"
import { captureMiniRegion } from "../src/mini/region-capture"

// These cases display a real Windows overlay. Run explicitly on an interactive desktop.
const enabled = process.platform === "win32" && process.env.CMSPARK_MINI_NATIVE_CAPTURE === "1"
for (const mode of ["select", "cancel", "delayed"] as const) {
  test(`Mini native region picker: ${mode}`, { skip: !enabled, timeout: 45_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mini-test-"))
    const finished = path.join(dir, "finished")
    const driver = spawn(windowsPowerShellExePath(), [
      "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", path.resolve("tests/fixtures/mini-region-driver.ps1"),
      "-OwnerPid", String(process.pid), "-Mode", mode, "-Finished", finished,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let diagnostic = ""
    driver.stderr.on("data", chunk => { diagnostic += chunk.toString().slice(0, 500) })
    const ended = new Promise<number | null>((resolve, reject) => {
      driver.once("error", reject)
      driver.once("close", resolve)
    })
    const lines = createInterface({ input: driver.stdout })
    const aborted = new AbortController()
    const timer = setTimeout(() => aborted.abort(), 35_000)
    try {
      const ready = new Promise<void>(resolve => lines.once("line", line => { if (line === "READY") resolve() }))
      await Promise.race([ready, ended.then(() => { throw new Error("Test canvas did not open: " + diagnostic) })])
      const timing = mode === "delayed" ? { seconds: 3 as const } : undefined
      const image = await Promise.race([captureMiniRegion(aborted.signal, timing), ended.then(() => { throw new Error("Test canvas closed early: " + diagnostic) })])
      if (mode === "cancel") assert.equal(image, null)
      else {
        assert.ok(image)
        const { width, height, rgba } = decodePngToRgba(image)
        assert.equal(width, 31)
        assert.equal(height, 23)
        const background = mode === "delayed" ? [120, 35, 180, 255] : [25, 89, 171, 255]
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const start: number = 4 * (y * width + x)
          assert.deepEqual(Array.from(rgba.subarray(start, start + 4)), x < 9 ? background : [219, 113, 44, 255])
        }
      }
    } finally {
      clearTimeout(timer)
      aborted.abort()
      lines.close()
      fs.writeFileSync(finished, "")
      try { assert.equal(await ended, 0, diagnostic) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    }
  })
}
