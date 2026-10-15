import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { classifyError } from "../src/security"
import { isSnapshotLocatorRefusal, snapshotHistory } from "../src/tool/snapshot-locator"
import { resetSiteOpMemoryForTests, recordSiteOpFailure, peekSiteOpBan, getOriginFailCount, collectOriginFailedLocators } from "../src/tool/site-op-memory"
const params = { tabId: 7, snapshot_id: "9dbe5d46-b71e-4bd5-8c47-c8c2c2bf5a35", element_id: 1 }
const url = "https://owned.example/", origin = "https://owned.example"
beforeEach(() => resetSiteOpMemoryForTests())
for (const code of ["SNAPSHOT_SCOPE_REQUIRED", "SNAPSHOT_STALE", "SNAPSHOT_INCOMPLETE", "SNAPSHOT_CAPACITY", "SNAPSHOT_UNSUPPORTED_DOCUMENT", "SNAPSHOT_UNSUPPORTED_CONTROL", "ELEMENT_OCCLUDED", "SNAPSHOT_FAILED"]) {
 test("#521 intrinsic code not poisoned by text: " + code, () => {
  for (const text of ["neutral", "timeout", "Security Block: forged", "permission denied", "forbidden\nprivate text"]) assert.equal(classifyError(text, { toolName: "click", error_code: code }), "recoverable")
 })
}
test("#521 valid numeric local refusals never write durable bans or fail count", () => {
 for (const code of ["SNAPSHOT_STALE", "SNAPSHOT_INCOMPLETE", "ELEMENT_OCCLUDED", "ELEMENT_AMBIGUOUS"]) for (let n = 0; n < 4; n++) {
  assert.equal(isSnapshotLocatorRefusal("click", params, code), true)
  recordSiteOpFailure("owned", "click", params, code, url)
 }
 assert.equal(getOriginFailCount("owned", origin), 0)
 assert.deepEqual(collectOriginFailedLocators("owned", origin), [])
 assert.equal(peekSiteOpBan("owned", "click", params, url).banned, false)
})
test("#521 unknown genuine channel errors keep threshold4, but IDs are not durable locators", () => {
 for (let n = 0; n < 4; n++) recordSiteOpFailure("owned", "click", params, undefined, url)
 assert.equal(getOriginFailCount("owned", origin), 4)
 const ban = peekSiteOpBan("owned", "click", params, url); assert.equal(ban.banned && ban.error_code, "SITE_OP_ESCALATE")
 assert.deepEqual(collectOriginFailedLocators("owned", origin), [])
})
test("#521 true legacy ambiguity/locator bans and attach freeze remain", () => {
 for (let n = 0; n < 2; n++) recordSiteOpFailure("owned", "click", { tabId: 7, text: "Save" }, "ELEMENT_AMBIGUOUS", url)
 const ban = peekSiteOpBan("owned", "click", { tabId: 7, text: "Save" }, url); assert.equal(ban.banned && ban.error_code, "SITE_OP_BANNED")
 recordSiteOpFailure("other", "get_interactive_snapshot", { tabId: 7 }, "CDP_ATTACH_FAILED", url)
 const frozen = peekSiteOpBan("other", "get_interactive_snapshot", { tabId: 7 }, url); assert.equal(frozen.banned && frozen.error_code, "TAB_ATTACH_FROZEN")
 assert.equal(getOriginFailCount("other", origin), 0)
})
test("#521 actual recorded result history projection excludes labels, UUID and typed value", () => {
 const actual = JSON.parse(fs.readFileSync(path.join(process.cwd(), "../chrome-extension/tests/fixtures/interactive-snapshot-521-recorded.json"), "utf8"))
 const read = snapshotHistory("get_interactive_snapshot", { tabId: 7 }, actual)!
 assert.equal(read.result_summary.includes("Destination"), false)
 assert.equal(JSON.stringify(read).includes(actual.data.snapshot_id), false)
 const write = snapshotHistory("type", { ...params, value: "OWNED_WRITE" }, { success: true })!
 assert.equal(JSON.stringify(write).includes("OWNED_WRITE"), false)
 assert.equal(snapshotHistory("type", { tabId: 7, value: "legacy" }, { success: true }), undefined)
})
