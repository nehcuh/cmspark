import test from "node:test"
import assert from "node:assert/strict"
import { getActiveTabContext } from "../src/background/active-tab-hostname"

test("active context sends only browser-selected id and hostname, never URL secrets", async () => {
  const previous = (globalThis as any).chrome
  ;(globalThis as any).chrome = { tabs: { query: async (query: unknown) => {
    assert.deepEqual(query, { active: true, lastFocusedWindow: true })
    return [{ id: 17, url: "https://user:secret@example.com/path?token=secret#route" }]
  } } }
  try {
    const context = await getActiveTabContext()
    assert.deepEqual(context, { hostname: "example.com", context_tab_id: 17 })
    assert.ok(!JSON.stringify(context).includes("secret"))
    ;(globalThis as any).chrome.tabs.query = async () => [{ id: 17, url: "chrome://settings" }]
    assert.equal(await getActiveTabContext(), undefined)
    ;(globalThis as any).chrome.tabs.query = async () => [{ url: "https://example.com" }]
    assert.equal(await getActiveTabContext(), undefined)
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
})

test("context-only bridge resolves one tab and hashes routes before redacting URLs", async () => {
  const { BrowserBridge } = await import("../src/background/browser-bridge")
  const previous = (globalThis as any).chrome
  let url = "https://user:secret@example.com/path?token=secret#one"
  ;(globalThis as any).chrome = {
    tabs: { get: async (id: number) => { assert.equal(id, 17); return { id, url } }, query: async () => { throw new Error("must not enumerate unrelated tabs") } },
    debugger: { onDetach: { addListener() {} } },
  }
  try {
    const bridge = new BrowserBridge()
    const first = await bridge.execute("list_tabs", { __site_context_tab_id: 17 })
    assert.equal(first.success, true)
    assert.equal(first.data.site_target.url, "https://example.com/path")
    assert.ok(!JSON.stringify(first).includes("secret"))
    assert.match(first.data.site_target.navigation_key, /^[a-f0-9]{64}$/)
    const plainHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("https://example.com/path?token=secret#one"))
    assert.ok(first.data.site_target.navigation_key !== Array.from(new Uint8Array(plainHash), b => b.toString(16).padStart(2, "0")).join(""))
    assert.equal((await bridge.execute("list_tabs", { __site_context_tab_id: 17 })).data.site_target.navigation_key, first.data.site_target.navigation_key)
    url = "https://example.com/path?token=secret#two"
    const second = await bridge.execute("list_tabs", { __site_context_tab_id: 17 })
    assert.ok(first.data.site_target.navigation_key !== second.data.site_target.navigation_key)
    assert.equal(first.data.site_target.url, second.data.site_target.url)
    assert.equal((await bridge.execute("list_tabs", { __site_context_tab_id: -1 })).success, false)
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
})
