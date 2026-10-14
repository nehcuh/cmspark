import test from "node:test"
import assert from "node:assert/strict"
import { executeEnterpriseBrowser } from "../src/background/enterprise-browser"

const profile = "00000000-0000-4000-8000-000000000625"
let removed: (id: number) => void = () => {}
function fixture() {
  const previous = (globalThis as any).chrome
  let injections = 0, captures = 0
  const frame = (id: number) => ({ frameId: id, documentId: "document-" + id, result: { url: "https://business.test/app?ticket=PRIVATE_QUERY", state: "ready" } })
  let results: any[] = [frame(0)], scriptingError: unknown, hasError = false
  ;(globalThis as any).chrome = {
    storage: { local: { get: async () => ({ enterprise_profile_id: profile }) } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener(fn: typeof removed) { removed = fn } }, query: async () => [] },
    scripting: { executeScript: async (request: any) => {
      injections++; assert.equal(request.args[1], null)
      if (hasError) throw scriptingError
      return results
    } },
  }
  const guard = { version: 1, profile_id: profile, mode: "inspect", expires_at: new Date(Date.now() + 60_000).toISOString(), policy: {
    navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [], login: [], ready: [{ selector: "#ready" }], login_markers: [],
  } }
  const inspect = (tabId = 200) => executeEnterpriseBrowser("list_tabs", { tabId, __enterprise_guard: guard }, async () => { captures++; return { success: false } })
  return { inspect, frame, setResults(value: any[]) { results = value }, setError(value: unknown) { scriptingError = value; hasError = true }, counts: () => ({ injections, captures }), close() {
    for (let id = 1; id <= 210; id++) removed(id)
    if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous
  } }
}
test("internal owned-tab history capacity has a fixed code and does not invoke Chrome on overflow", async () => {
  const h = fixture()
  try {
    for (let id = 1; id <= 128; id++) assert.equal((await h.inspect(id)).success, true)
    assert.deepEqual(await h.inspect(129), { success: false, error: "TAB_HISTORY_CAPACITY" })
    assert.equal((await h.inspect(128)).success, true) // existing owned tab remains usable at capacity
    assert.deepEqual(h.counts(), { injections: 129, captures: 0 })
  } finally { h.close() }
})
test("internal frame budget distinguishes 128 supported frames from overflow without leaking metadata", async () => {
  const h = fixture()
  try {
    h.setResults(Array.from({ length: 128 }, (_, id) => h.frame(id)))
    assert.equal((await h.inspect()).success, true)
    h.setResults(Array.from({ length: 129 }, (_, id) => h.frame(id)))
    assert.deepEqual(await h.inspect(), { success: false, error: "FRAME_UNAVAILABLE" })
    assert.equal(h.counts().captures, 0)
  } finally { h.close() }
})
test("internal missing subframe metadata has a fixed diagnostic instead of exporting a raw snapshot", async () => {
  const h = fixture()
  try {
    h.setResults([h.frame(0), { frameId: 1, result: { url: "https://business.test/app?ticket=PRIVATE_QUERY" } }])
    assert.deepEqual(await h.inspect(), { success: false, error: "FRAME_UNAVAILABLE" })
    assert.equal(h.counts().captures, 0)
  } finally { h.close() }
})
test("Chrome/page exceptions cannot impersonate new internal diagnostic codes or reveal raw messages", async () => {
  const h = fixture()
  try {
    for (const message of ["TAB_HISTORY_CAPACITY", "FRAME_UNAVAILABLE", "PRIVATE_QUERY https://business.test/app?ticket=PRIVATE_QUERY #secret"]) {
      h.setError(new Error(message))
      assert.deepEqual(await h.inspect(), { success: false, error: "ENTERPRISE_BROWSER_UNAVAILABLE" })
    }
    assert.equal(h.counts().captures, 0)
  } finally { h.close() }
})
test("non-Error scripting rejections are sanitized without throwing from the error handler", async () => {
  const h = fixture()
  try {
    for (const error of [null, undefined, "PRIVATE_QUERY", { message: "FRAME_UNAVAILABLE" }]) {
      h.setError(error)
      assert.deepEqual(await h.inspect(), { success: false, error: "ENTERPRISE_BROWSER_UNAVAILABLE" })
    }
    assert.equal(h.counts().captures, 0)
  } finally { h.close() }
})
