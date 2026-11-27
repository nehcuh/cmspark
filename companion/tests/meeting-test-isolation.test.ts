import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"

test("direct checkpoint test leaves the operator's configured directory untouched", t => {
  const configured = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-test-configured-"))
  t.after(() => fs.rmSync(configured, { recursive: true, force: true }))
  const file = path.join(configured, "config.json")
  const original = JSON.stringify({ voice: { sttEngine: "browser" } })
  fs.writeFileSync(file, original)

  const env: NodeJS.ProcessEnv = { ...process.env, CMSPARK_DATA_DIR: configured }
  delete env.CMSPARK_TEST_RUN_DIR
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    "--test", "--test-name-pattern=^actual q1 metadata checkpoint none ",
    path.join(__dirname, "meeting-pcm-checkpoint-failure.test.js"),
  ], { env, encoding: "utf8", timeout: 30_000, windowsHide: true })

  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /\bpass 1\b/)
  assert.equal(fs.readFileSync(file, "utf8"), original)
  assert.deepEqual(fs.readdirSync(configured), ["config.json"])
})
