import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const fixture = path.resolve(__dirname, "../../../tests/fixtures/windows-owner-probe.cjs")
const base = path.resolve(__dirname, "../../src")
const modes = ["mcp-timeout", "mcp-close", "mcp-config-disable", "acp-cancel", "acp-shutdown", "acp-timeout", "owner-failure",
  ...(process.platform === "win32" ? ["native-positive", "native-mismatch"] : [])]
for (const mode of modes) {
  test(`cold Windows owner query: ${mode}`, { timeout: 30000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-owner-609-"))
    try {
      const stdout = await new Promise<string>((resolve, reject) => execFile(process.execPath, [fixture, base, mode, root],
        { timeout: 25000, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) : resolve(stdout)))
      const line = stdout.split(/\r?\n/).find(line => line.startsWith("OWNER_PROBE="))
      assert.ok(line, stdout)
      const result = JSON.parse(line.slice("OWNER_PROBE=".length))
      assert.equal(result.native, process.platform === "win32")
      console.log("OWNER_NATIVE_EVIDENCE", JSON.stringify(result))
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}
