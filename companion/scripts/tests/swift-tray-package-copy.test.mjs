// Run only the actual cmp blocks against owned inert files, not the packager.
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const pkg = fs.readFileSync(path.join(root, "scripts/package.sh"), "utf8")
const dmg = fs.readFileSync(path.join(root, "scripts/create-dmg.sh"), "utf8")
function select(source, begin, end) {
  const start = source.indexOf(begin)
  assert.ok(start >= 0 && source.indexOf(begin, start + 1) < 0)
  const stop = source.indexOf(end, start)
  assert.ok(stop >= 0)
  return source.slice(start, stop + end.length)
}
const pkgBlock = select(pkg, 'if [ "${PLATFORM}" = "macos-arm64" ]; then\n  cmp -s', '\nfi')
const dmgBlock = select(dmg, 'cmp -s "${STAGING}/cmspark-agent.js" "${RESOURCES}/cmspark-agent.js"', 'echo "[create-dmg] ERROR: signed tray differs from staging" >&2; exit 1; }')

test("actual staging and signed-pair checks reject changes and absent files", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tray-copy-test-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const dist = path.join(temp, "companion/dist"), staging = path.join(temp, "staging"), resources = path.join(temp, "resources")
  for (const dir of [dist, staging, resources]) fs.mkdirSync(dir, { recursive: true })
  for (const dir of [dist, staging, resources]) for (const name of ["cmspark-agent.js", "cmspark-tray"]) fs.writeFileSync(path.join(dir, name), `fixture ${name}`)
  const env = { ...process.env, ROOT_DIR: temp, STAGING: staging, RESOURCES: resources, PLATFORM: "macos-arm64" }
  const run = block => spawnSync("bash", ["-c", `set -euo pipefail\n${block}`], { env, encoding: "utf8" }).status
  assert.equal(run(pkgBlock), 0)
  assert.equal(run(dmgBlock), 0)
  fs.writeFileSync(path.join(resources, "cmspark-tray"), "changed")
  assert.notEqual(run(dmgBlock), 0)
  fs.writeFileSync(path.join(staging, "cmspark-agent.js"), "changed")
  assert.notEqual(run(pkgBlock), 0)
  fs.writeFileSync(path.join(staging, "cmspark-agent.js"), "fixture cmspark-agent.js")
  fs.unlinkSync(path.join(staging, "cmspark-tray"))
  assert.notEqual(run(pkgBlock), 0)
})
