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
