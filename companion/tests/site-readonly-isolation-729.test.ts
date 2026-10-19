import test from "node:test"
import assert from "node:assert/strict"
import {
  peekSiteOpBan, recordSiteOpFailure, resetSiteOpMemoryForTests,
  bannedSiteOpResult, SITE_ORIGIN_FAIL_ESCALATE, SITE_LOCATOR_FAIL_BAN,
  getOriginFailCount, getReadOnlyOriginFailCount, snapshotOriginCdpFails, hydrateOriginCdpFails,
  hydratePersistedSiteOpExperience, refreshPersistedSiteOpExperience, collectOriginFailedLocators,
  resetSiteOriginCounter, formatSiteOpMemoryPrompt,
} from "../src/tool/site-op-memory.js"
import { DOM_SCRIPT_LOOP_MAX, DOM_SCRIPT_VOLUME_MAX, isDomScriptTool } from "../src/tool/dom-script-budget.js"

const url = "https://example.test/view"
const reads = ["get_page_text", "get_page_html", "wait_for"]
function fail(thread: string, tool: string, selector: string, code = "ELEMENT_NOT_FOUND") {
  return recordSiteOpFailure(thread, tool, { tabId: 7, selector }, code, url)
}
function interactiveBan(thread: string) {
  for (let i = 0; i < SITE_ORIGIN_FAIL_ESCALATE; i++) fail(thread, "click", `#bad-${i}`)
}

test("#729: failed interactions never ban the three read-only DOM tools", () => {
  resetSiteOpMemoryForTests(); interactiveBan("read-after-click")
  for (const tool of reads) assert.deepEqual(peekSiteOpBan("read-after-click", tool, { tabId: 7, selector: "#bad-0" }, url), { banned: false }, tool)
  for (const tool of ["click", "type", "evaluate", "get_element_info", "get_interactive_snapshot"]) {
    const ban = peekSiteOpBan("read-after-click", tool, { tabId: 7, selector: "#new" }, url)
    assert.equal(ban.banned && ban.error_code, "SITE_OP_ESCALATE", tool)
  }
})

test("#729: repeated read failures do not poison interactive count or persisted injection history", () => {
  resetSiteOpMemoryForTests()
  for (let i = 0; i < SITE_ORIGIN_FAIL_ESCALATE; i++) fail("read-first", reads[i % reads.length], `#read-${i}`)
  assert.equal(getOriginFailCount("read-first", url), 0)
  assert.equal(getReadOnlyOriginFailCount("read-first", url), SITE_ORIGIN_FAIL_ESCALATE)
  assert.deepEqual(snapshotOriginCdpFails("read-first"), {})
  assert.deepEqual(collectOriginFailedLocators("read-first", url), [])
  assert.deepEqual(peekSiteOpBan("read-first", "click", { tabId: 7, selector: "#read-0" }, url), { banned: false })
})

test("#729: read-only origin fuse still stops cross-tool and fresh-locator storms at the original threshold", () => {
  resetSiteOpMemoryForTests()
  for (let i = 0; i < SITE_ORIGIN_FAIL_ESCALATE; i++) fail("read-fuse", reads[i % reads.length], `#read-${i}`)
  for (const tool of reads) {
    const ban = peekSiteOpBan("read-fuse", tool, { tabId: 7, selector: "#fresh" }, url)
    assert.equal(ban.banned, true, tool)
    if (ban.banned) {
      const envelope = bannedSiteOpResult(ban, { cuArmed: true })
      assert.equal(envelope.data.suggested_action, "switch_strategy")
      assert.match(envelope.error, /read-only|只读/i)
      assert.doesNotMatch(JSON.stringify(envelope), /host_computer|escalate_to_host/)
    }
  }
})

test("#729: same-tool locator read budget remains two and guidance never escalates authority", () => {
  resetSiteOpMemoryForTests()
  for (let i = 0; i < SITE_LOCATOR_FAIL_BAN; i++) fail("read-locator", "wait_for", "#never")
  const ban = peekSiteOpBan("read-locator", "wait_for", { tabId: 7, selector: "#never" }, url)
  assert.equal(ban.banned, true)
  if (ban.banned) {
    const r = bannedSiteOpResult(ban, { cuArmed: true })
    assert.match(r.error, /read-only|只读/i)
    assert.doesNotMatch(JSON.stringify(r), /host_computer/)
  }
  const prompt = formatSiteOpMemoryPrompt("read-locator", url, { cuArmed: true })
  assert.match(prompt, /read-only|只读/i)
  assert.doesNotMatch(prompt, /host_computer|Origin CDP escalate/)
})

test("#729: legacy persisted interaction bans and hydrated count do not take away observation", () => {
  resetSiteOpMemoryForTests()
  hydrateOriginCdpFails("old", { "https://example.test": { fails: 4, lastCode: "UNKNOWN" } })
  hydratePersistedSiteOpExperience("old", "example.test", [{ content: "[auto] DO NOT retry click css:#same on https://example.test: last ELEMENT_NOT_FOUND" }])
  for (const tool of reads) assert.deepEqual(peekSiteOpBan("old", tool, { tabId: 7, selector: "#same" }, url), { banned: false })
  assert.equal(peekSiteOpBan("old", "evaluate", { tabId: 7, selector: "#same" }, url).banned, true)
})

test("#729: explicitly identified legacy read history cannot hydrate into an interaction wildcard ban", () => {
  resetSiteOpMemoryForTests()
  const content = "[auto] DO NOT retry wait_for css:#read-only on https://example.test: last ELEMENT_NOT_FOUND"
  assert.equal(hydratePersistedSiteOpExperience("legacy-read", "example.test", [{ content }]), 0)
  assert.equal(refreshPersistedSiteOpExperience("refreshed-read", "https://example.test", [{ content, schema_version: 1, recorded_at: new Date().toISOString() }]), 0)
  for (const thread of ["legacy-read", "refreshed-read"]) {
    assert.deepEqual(peekSiteOpBan(thread, "click", { tabId: 7, selector: "#read-only" }, url), { banned: false })
    assert.equal(formatSiteOpMemoryPrompt(thread, url, { cuArmed: true }), "")
  }
})

test("#729: transport attach freeze still refuses reads and explicit count reset cannot thaw it", () => {
  resetSiteOpMemoryForTests()
  fail("frozen", "get_page_text", "#anything", "CDP_ATTACH_FAILED")
  resetSiteOriginCounter("frozen", "https://example.test")
  for (const tool of [...reads, "click", "evaluate"]) {
    const ban = peekSiteOpBan("frozen", tool, { tabId: 7 }, url)
    assert.equal(ban.banned && ban.error_code, "TAB_ATTACH_FROZEN", tool)
  }
})

test("#729: authenticated origin reset clears both runtime counters, not locator bans or other scopes", () => {
  resetSiteOpMemoryForTests(); interactiveBan("scope")
  for (let i = 0; i < 4; i++) fail("scope", "wait_for", `#read-${i}`)
  interactiveBan("other-thread")
  resetSiteOriginCounter("scope", "https://example.test")
  assert.deepEqual(peekSiteOpBan("scope", "get_page_text", { tabId: 7 }, url), { banned: false })
  assert.deepEqual(peekSiteOpBan("scope", "click", { tabId: 7, selector: "#fresh" }, url), { banned: false })
  assert.equal(peekSiteOpBan("other-thread", "click", { tabId: 7 }, url).banned, true)
})

test("#729: UNKNOWN read health still counts and never relaxes DOM-script limits or evaluate classification", () => {
  resetSiteOpMemoryForTests()
  for (let i = 0; i < 4; i++) recordSiteOpFailure("unknown", reads[i % 3], { tabId: 7, selector: `#${i}` }, undefined, url)
  assert.equal(peekSiteOpBan("unknown", "get_page_text", { tabId: 7 }, url).banned, true)
  assert.equal(getOriginFailCount("unknown", url), 0)
  assert.equal(getReadOnlyOriginFailCount("unknown", url), 4)
  assert.equal(DOM_SCRIPT_LOOP_MAX, 3); assert.equal(DOM_SCRIPT_VOLUME_MAX, 24)
  assert.equal(isDomScriptTool("evaluate", { code: "1" }), true)
})
