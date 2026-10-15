import test from "node:test"
import * as assert from "node:assert/strict"
import * as path from "node:path"
import * as os from "node:os"
import { execFileSync } from "node:child_process"

test("canonical meeting browser assets are byte-exact from both package and unrelated working directories", () => {
  const script = path.resolve("scripts/generate-meeting-capture.mjs")
  for (const cwd of [path.resolve("."), os.tmpdir()]) {
    assert.equal(execFileSync(process.execPath, [script, "--check"], { cwd, encoding: "utf8", timeout: 10_000 }), "")
  }
})
