import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

// Whole production plugin adapter and exact actual Summoner HTML/workflow functions.
// Only capture, auth-free transport and deferred ASR final are synthetic seams.
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-494-callers-"))
let result: any
try {
  execFileSync(process.execPath, [path.resolve("tests/fixtures/meeting-pcm-callers.cjs")], {
    env: { ...process.env, CMSPARK_494_PROBE_DIR: owned, CMSPARK_494_REPO: path.resolve("..") },
    timeout: 20_000,
  })
  result = JSON.parse(fs.readFileSync(path.join(owned, "actual-probe.json"), "utf8"))
} finally { fs.rmSync(owned, { recursive: true, force: true }) }
for (const caller of ["plugin", "summoner"] as const) {
  test(`${caller}: samples presented during slow inference stay on the production wire`, () => {
    assert.equal(result.ok, true)
    assert.deepEqual(result.effects, { process: 0, network: 0, fetch: 0, native_capture: 0 })
    assert.equal(result.data_removed, true)
    assert.equal(result[caller].source_count, 96)
    assert.equal(result[caller].wire_count, 96, "capture must continue across the deferred ASR interval")
    assert.equal(result[caller].duplicate_count, 0)
  })
}
