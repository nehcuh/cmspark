import test from "node:test"
import assert from "node:assert/strict"
import { executeEnterpriseBrowser } from "../src/background/enterprise-browser"

test("enterprise profile mismatch never invokes Chrome action or screenshot and errors cannot expose page tokens", async () => {
  const previous = (globalThis as any).chrome
  let captures = 0, calls = 0
  ;(globalThis as any).chrome = { tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }, storage: { local: { get: async () => { calls++; throw new Error("PRIVATE_TOKEN_MUST_NOT_ESCAPE") } } } }
  try {
    const result = await executeEnterpriseBrowser("screenshot", { tabId: 7, __enterprise_guard: { version: 1, profile_id: "wrong" } }, async () => { captures++; return { success: true } })
    assert.equal(result.success, false); assert.equal(result.error, "ENTERPRISE_BROWSER_UNAVAILABLE")
    assert.equal(captures, 0); assert.equal(calls, 1)
    assert.ok(!JSON.stringify(result).includes("PRIVATE_TOKEN"))
  } finally { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous }
})

test("rule-free native ScriptInjection uses explicit JSON null, never unserializable undefined", async () => {
  const previous = (globalThis as any).chrome
  const profile = "00000000-0000-4000-8000-000000000011"
  let injections = 0
  ;(globalThis as any).chrome = {
    storage: { local: { get: async () => ({ enterprise_profile_id: profile }) } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, get: async () => ({ id: 7, url: "https://business.test/app" }), query: async () => [] },
    scripting: { executeScript: async (request: any) => {
      // This is Chrome's native serialization constraint. JSON.stringify alone
      // would silently convert undefined to null and mask the production bug.
      assert.equal(request.args.some((arg: unknown) => arg === undefined), false)
      assert.equal(request.args[1], null)
      injections++
      return [{ frameId: 0, documentId: "native-document", result: { url: "https://business.test/app", state: "ready" } }]
    } },
  }
  try {
    const result = await executeEnterpriseBrowser("list_tabs", { tabId: 7, __enterprise_guard: { version: 1, profile_id: profile, mode: "inspect", expires_at: new Date(Date.now() + 30000).toISOString(),
      policy: { navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [], login: [], ready: [{ selector: "#ready" }], login_markers: [] } } }, async () => ({ success: false }))
    assert.equal(result.success, true); assert.equal(injections, 1)
  } finally { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous }
})
