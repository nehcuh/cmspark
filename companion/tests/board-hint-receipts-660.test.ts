import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { spawnSync } from "node:child_process"

for (const group of ["observed", "lifecycle"]) {
  test(`#660 real Hint producer/SW/component/reducer ${group} controls`, { timeout: 25_000 }, () => {
    const result = spawnSync(process.execPath, [path.resolve("tests/fixtures/board-hint-receipts-660.cjs"), group], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "SystemRoot", "WINDIR", "ComSpec"].includes(key))),
    })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const line = result.stdout.split("\n").find(line => line.startsWith("OWNED_HINT_660 "))
    assert.ok(line, result.stdout)
    console.log("OWNED_HINT_660_RECEIPT_BASE64 " + Buffer.from(line.slice("OWNED_HINT_660 ".length)).toString("base64")) // TAP-safe exact receipt bytes
    const receipt = JSON.parse(line.slice("OWNED_HINT_660 ".length))
    assert.equal(receipt.ok, true)
    assert.ok(receipt.controls.length >= (group === "observed" ? 4 : 9))
    assert.deepEqual(receipt.effects, { process: 0, network: 0, issuer: 0 })
    assert.equal(receipt.cleaned, true)
  })
}
