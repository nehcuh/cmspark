import test from "node:test"
import assert from "node:assert/strict"
import { refreshPersistedSiteOpExperience, resetSiteOpMemoryForTests, peekSiteOpBan, recordSiteOpFailure, forgetSiteOpScope, SITE_EXPERIENCE_TTL_MS, formatSiteOpMemoryPrompt } from "../src/tool/site-op-memory"
import { siteTargetFromBrowser } from "../src/site-context/target"
import { resolveBrowserSiteTarget } from "../src/site-context/browser-resolver"

const entry = (origin: string, recordedAt: number, text = "save") => ({
  content: `[auto] DO NOT retry click text:${text} on ${origin}: last ELEMENT_NOT_FOUND`,
  recorded_at: new Date(recordedAt).toISOString(), stale: false,
})

test("historical refresh expires and revokes independently from runtime failures", () => {
  resetSiteOpMemoryForTests()
  const now = Date.now()
  const origin = "https://www.example.com:8443"
  const row = entry(origin, now)
  assert.equal(refreshPersistedSiteOpExperience("a", origin, [row], now), 1)
  assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, origin).banned, true)
  assert.equal(peekSiteOpBan("a", "type", { tabId: 99, text: "save" }, origin).banned, true)
  for (const other of ["https://example.com:8443", "https://www.example.com", "http://www.example.com:8443"]) {
    assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, other).banned, false)
    assert.equal(formatSiteOpMemoryPrompt("a", other), "")
  }
  assert.equal(peekSiteOpBan("b", "click", { tabId: 1, text: "save" }, origin).banned, false)
  refreshPersistedSiteOpExperience("a", origin, [{ ...row, stale: true }], now)
  assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, origin).banned, false)
  refreshPersistedSiteOpExperience("a", origin, [row], now)
  recordSiteOpFailure("a", "click", { tabId: 1, text: "save" }, "ELEMENT_NOT_FOUND", origin)
  recordSiteOpFailure("a", "click", { tabId: 1, text: "save" }, "ELEMENT_NOT_FOUND", origin)
  refreshPersistedSiteOpExperience("a", origin, [], now)
  assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, origin).banned, true)
  forgetSiteOpScope("a")
  assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, origin).banned, false)
})

test("invalid, missing, expired, future, foreign and unknown-schema rows cannot restore bans", () => {
  resetSiteOpMemoryForTests()
  const now = Date.now(), origin = "https://example.com"
  const row = entry(origin, now)
  const rows = [
    { ...row, recorded_at: undefined }, { ...row, recorded_at: "invalid" },
    entry(origin, now - SITE_EXPERIENCE_TTL_MS), entry(origin, now + 1),
    entry("http://example.com", now), { ...row, schema_version: 2 },
  ]
  assert.equal(refreshPersistedSiteOpExperience("a", origin, rows, now), 0)
  assert.equal(formatSiteOpMemoryPrompt("a", origin), "")
  assert.equal(refreshPersistedSiteOpExperience("a", origin, [row], now), 1)
  assert.equal(refreshPersistedSiteOpExperience("a", origin, [row], now + SITE_EXPERIENCE_TTL_MS), 0)
  assert.equal(peekSiteOpBan("a", "click", { tabId: 1, text: "save" }, origin).banned, false)
})

test("browser resolution selects only the requested actual tab and fails closed on timeout", async () => {
  const target = await resolveBrowserSiteTarget(async (_id, tool, params, _signal, options) => {
    assert.equal(tool, "list_tabs")
    assert.deepEqual(params, { __thread_id: "thread-a" })
    assert.deepEqual(options, { siteContextTabId: 1 })
    return { success: true, data: { site_target: siteTargetFromBrowser(1, "https://user:secret@example.com/path?token=secret#route", Date.now()) } }
  }, "thread-a", 1)
  assert.equal(target?.url, "https://example.com/path")
  assert.ok(!JSON.stringify(target).includes("secret"))
  let aborted = false
  assert.equal(await resolveBrowserSiteTarget(async (_id, _tool, _params, signal) => {
    signal?.addEventListener("abort", () => { aborted = true })
    return new Promise(() => {})
  }, "thread-a", 1, undefined, 5), undefined)
  assert.equal(aborted, true)
})


test("context tab id is validated on create, regenerate and upload", async () => {
  const { validateWsMessage } = await import("../src/ws/validate")
  for (const type of ["chat.create", "chat.regenerate", "file.upload"]) {
    const message = { type, thread_id: "thread-a", message: "inspect", message_id: "message-a", files: [{ name: "a.txt", type: "text/plain", content: "a" }] }
    assert.equal(validateWsMessage({ ...message, context_tab_id: 17 }).valid, true)
    for (const invalid of ["17", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
      assert.equal(validateWsMessage({ ...message, context_tab_id: invalid }).valid, false)
    }
  }
})
