import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/tray/build-tray.sh")

test("custom tray output refuses invalid paths and never overwrites an existing file", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tray-output-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const existing = path.join(root, "cmspark-tray")
  fs.writeFileSync(existing, "owned sentinel")
  const cases = [["--output", existing], ["--output", path.join(root, "wrong-name")], ["--output", path.join(root, "absent", "cmspark-tray")], ["--output"], ["--unknown"]]
  for (const args of cases) {
    const result = spawnSync("bash", [script, ...args], { encoding: "utf8" })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--output requires/)
    assert.equal(fs.readFileSync(existing, "utf8"), "owned sentinel")
  }
})
