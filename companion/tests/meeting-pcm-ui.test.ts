import test from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

for (const { delayedRunner, delayedTerminal } of [{ delayedRunner: false, delayedTerminal: false }, { delayedRunner: true, delayedTerminal: false }, { delayedRunner: false, delayedTerminal: true }]) test(`actual MeetingPanel Begin/store/SSR DOM preserves labels through drain; actual Summoner New has bounded ownership${delayedRunner ? " with delayed runner start" : ""}${delayedTerminal ? " with declared 1100-turn terminal delivery" : ""}`, () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-494-ui-receipt-")), receipt = path.join(owned, "receipt.json")
  try {
    execFileSync(process.execPath, [path.resolve("tests/fixtures/meeting-pcm-ui.cjs")], { timeout: 20_000,
      env: { ...process.env, CMSPARK_494_REPO: path.resolve(".."), CMSPARK_494_UI_RECEIPT: receipt, CMSPARK_494_UI_DELAY_RUNNER_START: delayedRunner ? "1" : "0", CMSPARK_494_UI_DELAY_TERMINAL: delayedTerminal ? "1" : "0" } })
    const result = JSON.parse(fs.readFileSync(receipt, "utf8"))
    assert.equal(result.ok, true)
    assert.deepEqual(result.effects, { process: 0, network: 0, fetch: 0, native_capture: 0 })
    assert.equal(result.data_removed, true)
    assert.equal(result.result.capture_and_drain_label_disabled, true)
    assert.equal(result.result.raw_speaker, "张三")
    assert.equal(result.result.empty_id_effects, 0)
    assert.equal(result.summoner_new.failed_create_no_fake_id, true)
    assert.equal(result.summoner_new.late_reply_not_retargeted, true)
    assert.equal(result.summoner_html.parsed_queue_role, "status")
    assert.equal(result.controls.length, 4)
  } finally { fs.rmSync(owned, { recursive: true, force: true }) }
})
