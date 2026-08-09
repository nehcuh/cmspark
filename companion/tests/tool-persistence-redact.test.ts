/**
 * SEC-C: durable thread tool rows must not keep cookie/shell/MCP secrets.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { redactToolPayloadForPersistence } from "../src/security/tool-persistence-redact"
import { createToolResultMessage } from "../src/llm/adapter"

test("cookie get_cookies redacts values in data", () => {
  const { result, params } = redactToolPayloadForPersistence(
    "get_cookies",
    { domain: "example.com" },
    {
      success: true,
      data: [{ name: "sid", domain: "example.com", value: "super-secret-session" }],
    },
  )
  const r = result as any
  assert.equal(r.success, true)
  assert.ok(r.data[0].value_hash)
  assert.equal(r.data[0].value, undefined)
  assert.equal((params as any).domain, "example.com")
  assert.ok(!JSON.stringify(result).includes("super-secret-session"))
})

test("evaluate redacts code param and caps data", () => {
  const longData = "x".repeat(500)
  const { params, result } = redactToolPayloadForPersistence(
    "evaluate",
    { code: "document.cookie", security_token: "tok-abc" },
    { success: true, data: longData },
  )
  const p = params as any
  assert.ok(String(p.code).startsWith("<redacted:"))
  assert.ok(String(p.security_token).startsWith("<redacted:"))
  assert.ok(!JSON.stringify(params).includes("document.cookie"))
  assert.ok(!JSON.stringify(params).includes("tok-abc"))
  assert.equal((result as any).data.redacted, true)
})

test("mcp file-like tool collapses result", () => {
  const { result } = redactToolPayloadForPersistence(
    "mcp__fs__read_file",
    { path: "/etc/passwd" },
    { success: true, data: "root:x:0:0" },
  )
  assert.equal((result as any).redacted, true)
  assert.ok(!JSON.stringify(result).includes("root:x"))
})

test("createToolResultMessage applies redact for cookies", () => {
  const msg = createToolResultMessage(
    "abc123",
    { id: "c1", function: { name: "get_cookies" } },
    { success: true, data: [{ name: "a", value: "LEAKME" }] },
    {},
  )
  assert.ok(!msg.content.includes("LEAKME"))
  assert.ok(!JSON.stringify(msg.tool_calls).includes("LEAKME"))
})

test("benign get_page_text still persists text", () => {
  const msg = createToolResultMessage(
    "abc123",
    { id: "c2", function: { name: "get_page_text" } },
    { success: true, data: { text: "hello page" } },
    { tabId: 1 },
  )
  assert.ok(msg.content.includes("hello page"))
})
