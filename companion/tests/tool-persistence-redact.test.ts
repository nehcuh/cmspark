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

test("Authorization / Bearer / apiKey keys are redacted on generic tools", () => {
  const { params } = redactToolPayloadForPersistence(
    "mcp__http__fetch",
    { Authorization: "Bearer super-secret", Bearer: "abc", apiKey: "k-1", url: "https://example.com" },
    { success: true },
  )
  const p = params as any
  assert.ok(String(p.Authorization).startsWith("<redacted:"))
  assert.ok(String(p.Bearer).startsWith("<redacted:"))
  assert.ok(String(p.apiKey).startsWith("<redacted:"))
  assert.equal(p.url, "https://example.com")
  assert.ok(!JSON.stringify(params).includes("super-secret"))
})

test("passwd key and non-string Authorization/apiKey are redacted (S-D1/D2)", () => {
  const { params } = redactToolPayloadForPersistence(
    "mcp__http__fetch",
    {
      passwd: "hunter2-secret",
      headers: { Authorization: ["Bearer array-secret"] },
      apiKey: 123456789,
      url: "https://example.com",
    },
    { success: true },
  )
  const p = params as any
  assert.ok(String(p.passwd).startsWith("<redacted:"))
  assert.ok(String(p.headers.Authorization[0]).startsWith("<redacted:"))
  assert.ok(String(p.apiKey).startsWith("<redacted:"))
  assert.equal(p.url, "https://example.com")
  assert.ok(!JSON.stringify(params).includes("hunter2-secret"))
  assert.ok(!JSON.stringify(params).includes("array-secret"))
  assert.ok(!JSON.stringify(params).includes("123456789"))
})

test("object-valued Authorization bags are collapsed (N-D3)", () => {
  const { params } = redactToolPayloadForPersistence(
    "mcp__http__fetch",
    { Authorization: { scheme: "Bearer", value: "object-secret-LEAK" }, url: "https://example.com" },
    { success: true },
  )
  const p = params as any
  assert.equal(p.Authorization.redacted, true)
  assert.equal(p.url, "https://example.com")
  assert.ok(!JSON.stringify(params).includes("object-secret-LEAK"))
})

test("generic tool value keys stay (not a blanket secret name)", () => {
  const { params } = redactToolPayloadForPersistence(
    "get_page_text",
    { value: "visible-field", passwd: "hide-me" },
    { success: true },
  )
  const p = params as any
  assert.equal(p.value, "visible-field")
  assert.ok(String(p.passwd).startsWith("<redacted:"))
})

test("set_cookie extra Authorization param is redacted (S-D1 cookie branch)", () => {
  const { params } = redactToolPayloadForPersistence(
    "set_cookie",
    { name: "sid", value: "cookie-secret", Authorization: "Bearer extra" },
    { success: true },
  )
  const p = params as any
  assert.ok(String(p.value).startsWith("<redacted:"))
  assert.ok(String(p.Authorization).startsWith("<redacted:"))
  assert.ok(!JSON.stringify(params).includes("cookie-secret"))
  assert.ok(!JSON.stringify(params).includes("Bearer extra"))
})

test("evaluate data payload is always collapsed (even under 200 chars)", () => {
  const { result } = redactToolPayloadForPersistence(
    "evaluate",
    { code: "1+1" },
    { success: true, data: "short secret" },
  )
  const r = result as any
  assert.equal(r.data.redacted, true)
  assert.ok(!JSON.stringify(result).includes("short secret"))
})

test("plainErrorResult drops extra keys next to INTERRUPTED", () => {
  const { result } = redactToolPayloadForPersistence(
    "shell_exec",
    {},
    { success: false, error: "interrupted", error_code: "INTERRUPTED", stdout: "SECRET_ENV=1", stack: "trace" },
  )
  assert.deepEqual(result, { success: false, error: "interrupted", error_code: "INTERRUPTED" })
  assert.ok(!JSON.stringify(result).includes("SECRET_ENV"))
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

// --- INTERRUPTED passthrough (heal fillers must keep error_code on disk) ---

test("shell_exec INTERRUPTED filler keeps error_code and error verbatim", () => {
  const { params, result } = redactToolPayloadForPersistence(
    "shell_exec",
    {},
    { success: false, error: "interrupted", error_code: "INTERRUPTED" },
  )
  assert.deepEqual(result, { success: false, error: "interrupted", error_code: "INTERRUPTED" })
  assert.deepEqual(params, {})
})

test("host_computer INTERRUPTED filler is not collapsed", () => {
  const { result } = redactToolPayloadForPersistence(
    "host_computer",
    {},
    { success: false, error: "aborted", error_code: "INTERRUPTED" },
  )
  const r = result as any
  assert.equal(r.success, false)
  assert.equal(r.error, "aborted")
  assert.equal(r.error_code, "INTERRUPTED")
  assert.equal(r.redacted, undefined)
})

test("thread_recall INTERRUPTED filler keeps error_code while query param stays redacted", () => {
  const { params, result } = redactToolPayloadForPersistence(
    "thread_recall",
    { query: "my secret plans" },
    { success: false, error: "interrupted", error_code: "INTERRUPTED" },
  )
  const r = result as any
  assert.equal(r.error_code, "INTERRUPTED")
  assert.equal(r.redacted, undefined)
  const p = params as any
  assert.ok(String(p.query).startsWith("<redacted:"))
  assert.ok(!JSON.stringify(params).includes("my secret plans"))
})

test("mcp sensitive-name INTERRUPTED filler keeps error_code", () => {
  const { result } = redactToolPayloadForPersistence(
    "mcp__fs__read_file",
    {},
    { success: false, error: "interrupted", error_code: "INTERRUPTED" },
  )
  const r = result as any
  assert.equal(r.error_code, "INTERRUPTED")
  assert.equal(r.redacted, undefined)
})

test("data-bearing sensitive error results still get redacted (no passthrough)", () => {
  const big = "x".repeat(500)
  const { result } = redactToolPayloadForPersistence(
    "evaluate",
    { code: "1+1" },
    { success: false, error: "boom", error_code: "EVAL_FAILED", data: big },
  )
  const r = result as any
  assert.equal(r.success, false)
  assert.equal(r.error, "boom")
  assert.equal(r.error_code, undefined, "rebuild path still drops unknown codes")
  assert.equal(r.data.redacted, true)
  assert.ok(!JSON.stringify(result).includes(big))
})

test("createToolResultMessage persists INTERRUPTED marker for sensitive tools", () => {
  const msg = createToolResultMessage(
    "abc123",
    { id: "c9", function: { name: "shell_exec" } },
    { success: false, error: "interrupted", error_code: "INTERRUPTED" },
    {},
  )
  assert.ok(msg.content.includes("INTERRUPTED"))
  assert.equal((msg.tool_calls[0].result as any).error_code, "INTERRUPTED")
})
