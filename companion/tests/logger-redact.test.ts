import test from "node:test"
import assert from "node:assert/strict"
import { redactLogData, redactUrl } from "../src/logger"

test("redactUrl strips userinfo credentials", () => {
  assert.equal(
    redactUrl("https://user:pass@internal.example.com/path"),
    "https://internal.example.com/path",
  )
})

test("redactUrl redacts secret query params and keeps non-secret params", () => {
  const raw = "https://example.com/cb?token=SECRET&keep=1&api_key=AK&code=AUTHCODE&safe=value"
  const out = redactUrl(raw)
  assert.ok(out.includes("token=%5BREDACTED%5D"), "token should be redacted")
  assert.ok(out.includes("api_key=%5BREDACTED%5D"), "api_key should be redacted")
  assert.ok(out.includes("code=%5BREDACTED%5D"), "code should be redacted")
  assert.ok(out.includes("keep=1"), "keep param should be preserved")
  assert.ok(out.includes("safe=value"), "safe param should be preserved")
})

test("redactUrl preserves host and path", () => {
  const out = redactUrl("https://user:pass@api.example.com/v1/resource?token=SECRET")
  assert.ok(out.startsWith("https://api.example.com/v1/resource?"), out)
})

test("redactUrl falls back to truncation for non-absolute URLs", () => {
  assert.equal(redactUrl("/relative/path?token=SECRET"), "/relative/path?token=SECRET")
  assert.equal(redactUrl("not a url"), "not a url")
})

test("redactUrl leaves empty and non-string inputs untouched", () => {
  assert.equal(redactUrl(""), "")
  assert.equal(redactUrl("http://example.com"), "http://example.com/")
})

test("redactLogData sanitizes url values instead of redacting the whole value", () => {
  const redacted = redactLogData({
    url: "https://user:pass@host/path?token=SECRET&keep=1",
    host: "host",
  }) as any

  assert.ok((redacted.url as string).includes("token=%5BREDACTED%5D"), "token should be redacted within url")
  assert.ok((redacted.url as string).includes("keep=1"), "keep param should be preserved")
  assert.ok((redacted.url as string).startsWith("https://host/path?"), "url host/path should be preserved")
  assert.equal(redacted.host, "host")
})

test("redactLogData still redacts sensitive keys", () => {
  const redacted = redactLogData({
    api_key: "sk-secret",
    headers: {
      authorization: "Bearer token",
      cookie: "sid=123",
      safe: "value",
    },
  }) as any

  assert.equal(redacted.api_key, "[REDACTED]")
  assert.equal(redacted.headers.authorization, "[REDACTED]")
  assert.equal(redacted.headers.cookie, "[REDACTED]")
  assert.equal(redacted.headers.safe, "value")
})

test("redactLogData redacts code and params keys defensively", () => {
  const redacted = redactLogData({
    code: "fetch('https://example.com')",
    params: { secret: "value" },
    error_code: "404",
  }) as any

  assert.equal(redacted.code, "[REDACTED]")
  assert.equal(redacted.params, "[REDACTED]")
  assert.equal(redacted.error_code, "404", "error_code should not be redacted")
})

test("redactUrl redacts OIDC id_token query param", () => {
  const out = redactUrl("https://example.com/cb?id_token=eyJhbGci&keep=1")
  assert.ok(out.includes("id_token=%5BREDACTED%5D"), "id_token should be redacted")
  assert.ok(out.includes("keep=1"), "non-secret param preserved")
})

test("redactLogData does not over-redact params substring keys", () => {
  // `params` is redacted (defensive), but `query_params` / `paramString` /
  // `myparams` are distinct keys whose values may be benign audit data.
  const redacted = redactLogData({
    myparams: "audit-trail",
    query_params: { page: 1 },
    paramString: "x",
  }) as any

  assert.equal(redacted.myparams, "audit-trail")
  assert.deepEqual(redacted.query_params, { page: 1 })
  assert.equal(redacted.paramString, "x")
})

test("redactLogData sanitizes URL-ish keys recursively", () => {
  const redacted = redactLogData({
    nested: {
      endpoint: "https://user:pass@api.example.com/v1?token=SECRET",
    },
    url: ["https://a.com?token=1", "https://b.com?api_key=2"],
  }) as any

  assert.ok((redacted.nested.endpoint as string).startsWith("https://api.example.com/v1?"))
  assert.ok((redacted.nested.endpoint as string).includes("token=%5BREDACTED%5D"))
  assert.ok((redacted.url[0] as string).includes("token=%5BREDACTED%5D"))
  assert.ok((redacted.url[1] as string).includes("api_key=%5BREDACTED%5D"))
})

test("redactLogData does not treat selector as sensitive", () => {
  const redacted = redactLogData({ selector: "#submit" }) as any
  assert.equal(redacted.selector, "#submit")
})

test("redactLogData truncates plain strings", () => {
  const long = "x".repeat(3000)
  const redacted = redactLogData({ note: long }) as any
  assert.ok((redacted.note as string).endsWith("…[truncated 1000 chars]"))
})
