// Tool-arg zod schema tests (audit item 4)
//
// Verifies the per-tool validation gates the LLM's tool-call args before they
// reach executeTool. The recovery path (LLM-self-correction via tool_result
// error) is in adapter.ts; this file tests the pure validation logic.

import test from "node:test"
import assert from "node:assert/strict"
import {
  parseToolArgs,
  tryParseToolArgs,
  TOOL_ARG_SCHEMAS,
  setMcpSchemaResolverForTests,
  __test__,
} from "../src/bridge/tool-schemas.js"

// =============================================================================
// evaluate — high-risk (arbitrary JS in a real Chrome tab)
// =============================================================================

test("evaluate: well-formed args pass", () => {
  const out = parseToolArgs("evaluate", { tabId: 1, code: "1 + 1" })
  assert.equal(out.tabId, 1)
  assert.equal(out.code, "1 + 1")
})

test("evaluate: rejects code as number (must be string)", () => {
  // ZodError.message is a JSON dump of issues; check both substrings appear
  // (the regex doesn't span newlines, so check separately).
  try {
    parseToolArgs("evaluate", { tabId: 1, code: 123 })
    assert.fail("should have thrown")
  } catch (err: any) {
    assert.match(err.message, /code/i, "error should reference the field name")
    assert.match(err.message, /string/i, "error should mention the expected type")
  }
})

test("evaluate: rejects missing required tabId", () => {
  assert.throws(
    () => parseToolArgs("evaluate", { code: "1+1" }),
    /tabId/i,
  )
})

test("evaluate: rejects missing required code", () => {
  assert.throws(
    () => parseToolArgs("evaluate", { tabId: 1 }),
    /code/i,
  )
})

test("evaluate: rejects tabId as string (must be number)", () => {
  assert.throws(
    () => parseToolArgs("evaluate", { tabId: "1", code: "1+1" }),
    /tabId/i,
  )
})

test("evaluate: accepts optional await_promise + security_token", () => {
  const out = parseToolArgs("evaluate", {
    tabId: 1, code: "1+1", await_promise: false, security_token: "abc",
  })
  assert.equal(out.await_promise, false)
  assert.equal(out.security_token, "abc")
})

// =============================================================================
// navigate / create_tab — high-risk (drive browser to any URL)
// =============================================================================

test("navigate: rejects malformed URL", () => {
  assert.throws(
    () => parseToolArgs("navigate", { tabId: 1, url: "not-a-url" }),
    /url/i,
  )
})

test("navigate: accepts well-formed URL", () => {
  const out = parseToolArgs("navigate", { tabId: 1, url: "https://example.com/page" })
  assert.equal(out.url, "https://example.com/page")
})

test("create_tab: accepts http URL with optional active flag", () => {
  const out = parseToolArgs("create_tab", { url: "http://localhost:3000", active: false })
  assert.equal(out.url, "http://localhost:3000")
  assert.equal(out.active, false)
})

test("create_tab: rejects missing URL", () => {
  assert.throws(
    () => parseToolArgs("create_tab", {}),
    /url/i,
  )
})

// =============================================================================
// set_cookie / get_cookies / delete_cookie — high-risk (trust gate depends on
// `domain` being a string)
// =============================================================================

test("set_cookie: rejects domain as number", () => {
  assert.throws(
    () => parseToolArgs("set_cookie", { domain: 42, name: "x", value: "y" }),
    /domain/i,
  )
})

test("set_cookie: accepts full cookie spec", () => {
  const out = parseToolArgs("set_cookie", {
    domain: "example.com",
    name: "session",
    value: "abc",
    path: "/",
    secure: true,
    httpOnly: true,
  })
  assert.equal(out.domain, "example.com")
  assert.equal(out.secure, true)
})

test("get_cookies: requires domain string", () => {
  assert.throws(
    () => parseToolArgs("get_cookies", {}),
    /domain/i,
  )
  assert.throws(
    () => parseToolArgs("get_cookies", { domain: 42 }),
    /domain/i,
  )
  const out = parseToolArgs("get_cookies", { domain: "example.com" })
  assert.equal(out.domain, "example.com")
})

// =============================================================================
// osascript_eval — high-risk (arbitrary AppleScript on the host)
// =============================================================================

test("osascript_eval: rejects non-string expression", () => {
  assert.throws(
    () => parseToolArgs("osascript_eval", { expression: 42 }),
    /expression/i,
  )
})

test("osascript_eval: accepts string expression", () => {
  const out = parseToolArgs("osascript_eval", { expression: 'display dialog "hi"' })
  assert.equal(out.expression, 'display dialog "hi"')
})

// =============================================================================
// host_read — Phase 0 computer-use spike (Mail inbox top-1 read)
// =============================================================================

test("host_read: accepts empty params (application defaults at runtime)", () => {
  const out = parseToolArgs("host_read", {})
  // No required fields; application is optional with runtime default.
  assert.equal(out.application, undefined)
})

test("host_read: accepts application + max_chars", () => {
  const out = parseToolArgs("host_read", { application: "com.apple.mail", max_chars: 200 })
  assert.equal(out.application, "com.apple.mail")
  assert.equal(out.max_chars, 200)
})

test("host_read: rejects non-string application", () => {
  assert.throws(
    () => parseToolArgs("host_read", { application: 42 }),
    /application/i,
  )
})

test("host_read: rejects max_chars out of range", () => {
  assert.throws(() => parseToolArgs("host_read", { max_chars: 0 }), /max_chars|max/i)
  assert.throws(() => parseToolArgs("host_read", { max_chars: 99999 }), /max_chars|max/i)
})

// =============================================================================
// host_app — App tab WP3 (L0 no-arg launch of whitelisted apps)
// =============================================================================

test("host_app: accepts {app, action:'launch'} + optional security_token", () => {
  const out = parseToolArgs("host_app", { app: "win.app.cloudmusic", action: "launch" })
  assert.equal(out.app, "win.app.cloudmusic")
  assert.equal(out.action, "launch")
  const withToken = parseToolArgs("host_app", { app: "win.app.cloudmusic", action: "launch", security_token: "t" })
  assert.equal(withToken.security_token, "t")
})

test("host_app: rejects missing app, empty app, and non-launch actions", () => {
  assert.throws(() => parseToolArgs("host_app", { action: "launch" }))
  assert.throws(() => parseToolArgs("host_app", { app: "", action: "launch" }))
  assert.throws(() => parseToolArgs("host_app", { app: "win.app.x", action: "run_template" }))
  assert.throws(() => parseToolArgs("host_app", { app: "win.app.x" }))
})

// =============================================================================
// Generic fallback — non-high-risk tools pass through unchanged
// =============================================================================

test("unknown tool passes through unchanged (generic fallback)", () => {
  const args = { query: "list open tabs", arbitrary: [1, 2, 3], nested: { a: true } }
  const out = parseToolArgs("list_tabs", args)
  assert.deepEqual(out, args)
})

test("unknown tool accepts any shape including edge cases", () => {
  // Empty object — fine for tools with no required fields.
  assert.deepEqual(parseToolArgs("list_tabs", {}), {})
  // Wild shapes — generic fallback doesn't constrain.
  const wild = { foo: null, bar: [true, false, null] }
  assert.deepEqual(parseToolArgs("some_unknown_tool", wild), wild)
})

// =============================================================================
// tryParseToolArgs — Result-style variant
// =============================================================================

test("tryParseToolArgs returns ok:true + args on success", () => {
  const result = tryParseToolArgs("evaluate", { tabId: 1, code: "1+1" })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.args.tabId, 1)
    assert.equal(result.args.code, "1+1")
  }
})

test("tryParseToolArgs returns ok:false + readable error on failure", () => {
  const result = tryParseToolArgs("navigate", { tabId: 1, url: "garbage" })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.error, /navigate/, "error should name the tool")
    assert.match(result.error, /url/i, "error should mention the failing field")
  }
})

test("tryParseToolArgs error aggregates multiple field failures into one message", () => {
  // tabId wrong type AND url missing — both should appear in the error.
  const result = tryParseToolArgs("navigate", { tabId: "not-a-number" })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.error, /tabId/i)
    assert.match(result.error, /url/i)
    assert.match(result.error, /;/, "multiple issues should be separated by semicolons")
  }
})

// =============================================================================
// Sanity: every high-risk tool has a schema
// =============================================================================

test("TOOL_ARG_SCHEMAS covers the high-risk tools the audit named", () => {
  const expected = ["evaluate", "osascript_eval", "set_cookie", "navigate", "create_tab"]
  for (const name of expected) {
    assert.ok(name in TOOL_ARG_SCHEMAS, `${name} should have a zod schema`)
  }
})

// =============================================================================
// C-MCP-1: MCP tools use the server's inputSchema (no generic any-record bypass)
// =============================================================================

// Fixture: filesystem-style tool with a required `path: string`.
const FS_READ_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Absolute path to read" },
    encoding: { type: "string", description: "Optional encoding" },
  },
  required: ["path"],
  additionalProperties: false,
}

// Fixture: tool with mixed primitive types and arrays (typical MCP shape).
const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "integer" },
    count: { type: "number" },
    fresh: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["query"],
}

test("mcp: inputSchema with valid args parses successfully", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__filesystem__read_text_file" ? FS_READ_SCHEMA : undefined,
  )
  try {
    const out = parseToolArgs("mcp__filesystem__read_text_file", {
      path: "/tmp/foo.txt",
    }) as any
    assert.equal(out.path, "/tmp/foo.txt")
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: inputSchema rejects wrong-type required field (path: number)", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__filesystem__read_text_file" ? FS_READ_SCHEMA : undefined,
  )
  try {
    const result = tryParseToolArgs("mcp__filesystem__read_text_file", { path: 12345 })
    assert.equal(result.ok, false, "path:12345 must fail validation, not pass through")
    if (!result.ok) {
      assert.match(result.error, /path/i, "error should reference the bad field")
      assert.match(result.error, /mcp__filesystem__read_text_file/, "error should name the tool")
    }
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: inputSchema rejects missing required field", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__filesystem__read_text_file" ? FS_READ_SCHEMA : undefined,
  )
  try {
    const result = tryParseToolArgs("mcp__filesystem__read_text_file", {})
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /path/i)
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: inputSchema rejects unknown field when additionalProperties:false", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__filesystem__read_text_file" ? FS_READ_SCHEMA : undefined,
  )
  try {
    const result = tryParseToolArgs("mcp__filesystem__read_text_file", {
      path: "/x",
      sneaky: "extra",
    })
    assert.equal(result.ok, false, "additionalProperties:false should reject unknown keys")
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: mixed primitive types validated correctly (integer/number/boolean/array)", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__search__web" ? SEARCH_SCHEMA : undefined,
  )
  try {
    // All correct types pass.
    const ok = tryParseToolArgs("mcp__search__web", {
      query: "rust async",
      limit: 5,
      count: 1.5,
      fresh: true,
      tags: ["a", "b"],
    })
    assert.equal(ok.ok, true)

    // Integer mismatch — passing a non-integer number for an integer field fails.
    const intBad = tryParseToolArgs("mcp__search__web", { query: "x", limit: 1.5 })
    assert.equal(intBad.ok, false)

    // Boolean mismatch — passing a string for boolean fails.
    const boolBad = tryParseToolArgs("mcp__search__web", { query: "x", fresh: "yes" })
    assert.equal(boolBad.ok, false)

    // Array items type-checked — array of numbers for {array, items: string} fails.
    const arrBad = tryParseToolArgs("mcp__search__web", { query: "x", tags: [1, 2, 3] })
    assert.equal(arrBad.ok, false)
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: missing cached inputSchema falls back to generic record + emits warning", () => {
  // Resolver returns undefined — simulates server not having sent tools/list yet.
  setMcpSchemaResolverForTests(() => undefined)
  try {
    // Should not throw — graceful fallback.
    const out = parseToolArgs("mcp__filesystem__read_text_file", { path: 12345 }) as any
    // Generic fallback accepts any shape — the wrong type passes through.
    assert.equal(out.path, 12345)
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: empty object inputSchema accepts empty args (legitimate no-arg tool)", () => {
  setMcpSchemaResolverForTests((name) =>
    name === "mcp__svc__noop" ? { type: "object", properties: {} } : undefined,
  )
  try {
    const out = parseToolArgs("mcp__svc__noop", {})
    assert.deepEqual(out, {})
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: converter degrades unknown JSON-schema types to z.unknown() (fail-open)", () => {
  const schema = {
    type: "object",
    properties: {
      any: { oneOf: [{ type: "string" }, { type: "number" }] },
      ref: { $ref: "#/definitions/Foo" },
      regular: { type: "string" },
    },
    required: ["regular"],
  }
  setMcpSchemaResolverForTests(() => schema)
  try {
    // The unknown-typed fields accept anything; the typed one is still enforced.
    const ok = tryParseToolArgs("mcp__svc__mixed", { regular: "hi", any: 42, ref: { x: 1 } })
    assert.equal(ok.ok, true)

    const bad = tryParseToolArgs("mcp__svc__mixed", { any: 42 })
    assert.equal(bad.ok, false, "required field `regular` must still be enforced")
  } finally {
    setMcpSchemaResolverForTests(null)
  }
})

test("mcp: native tools still validate (no regression after MCP path added)", () => {
  // evaluate should still work — the native path is untouched for non-mcp__ names.
  const ok = tryParseToolArgs("evaluate", { tabId: 1, code: "1+1" })
  assert.equal(ok.ok, true)
  const bad = tryParseToolArgs("evaluate", { tabId: "x", code: "1+1" })
  assert.equal(bad.ok, false)
})

test("mcp: converter direct unit (jsonSchemaPrimitiveToZod round-trips)", () => {
  const { jsonSchemaPrimitiveToZod } = __test__
  assert.equal(jsonSchemaPrimitiveToZod({ type: "string" }).safeParse("x").success, true)
  assert.equal(jsonSchemaPrimitiveToZod({ type: "string" }).safeParse(1).success, false)
  assert.equal(jsonSchemaPrimitiveToZod({ type: "integer" }).safeParse(1.5).success, false)
  assert.equal(jsonSchemaPrimitiveToZod({ type: "boolean" }).safeParse("yes").success, false)
  assert.equal(
    jsonSchemaPrimitiveToZod({ type: "array", items: { type: "string" } }).safeParse(["a"]).success,
    true,
  )
  assert.equal(
    jsonSchemaPrimitiveToZod({ type: "array", items: { type: "string" } }).safeParse([1]).success,
    false,
  )
})

// =============================================================================
// host_computer — X4 type.text cap
// =============================================================================

test("host_computer: type text at the 2000-char cap passes", () => {
  const out = parseToolArgs("host_computer", {
    task: "t",
    app: "win.app.test",
    actions: [{ action: "type", text: "x".repeat(2000) }],
  })
  assert.equal(out.actions.length, 1)
})

test("host_computer: type text beyond 2000 chars is rejected at the schema boundary (X4)", () => {
  const bad = tryParseToolArgs("host_computer", {
    task: "t",
    app: "win.app.test",
    actions: [{ action: "type", text: "x".repeat(2001) }],
  })
  assert.equal(bad.ok, false)
})

// =============================================================================
// host_computer — WP2 key/scroll/drag primitives
// =============================================================================

test("host_computer: key chord passes; non-whitelist key is rejected", () => {
  const ok = parseToolArgs("host_computer", {
    task: "t",
    app: "win.app.test",
    actions: [{ action: "key", keys: ["ctrl", "enter"] }],
  })
  assert.equal(ok.actions.length, 1)
  for (const bad of [
    [{ action: "key", keys: ["a"] }], // printable — belongs to type
    [{ action: "key", keys: [] }], // empty chord
    [{ action: "key", keys: ["ctrl", "alt", "shift", "win", "enter"] }], // > MAX_KEY_CHORD
    [{ action: "key", keys: ["ctrl"], extra: 1 }], // strict — no extra fields
  ]) {
    assert.equal(tryParseToolArgs("host_computer", { task: "t", app: "win.app.test", actions: bad }).ok, false)
  }
})

test("host_computer: scroll bounds (delta 0 / beyond ±1200 / missing coords rejected)", () => {
  const ok = parseToolArgs("host_computer", {
    task: "t",
    app: "win.app.test",
    actions: [{ action: "scroll", x: 100, y: 100, delta: -240 }],
  })
  assert.equal(ok.actions.length, 1)
  for (const bad of [
    [{ action: "scroll", x: 1, y: 1, delta: 0 }],
    [{ action: "scroll", x: 1, y: 1, delta: 1201 }],
    [{ action: "scroll", x: 1, y: 1, delta: -1201 }],
    [{ action: "scroll", x: 1, delta: 120 }], // missing y
  ]) {
    assert.equal(tryParseToolArgs("host_computer", { task: "t", app: "win.app.test", actions: bad }).ok, false)
  }
})

test("host_computer: drag requires both endpoints", () => {
  const ok = parseToolArgs("host_computer", {
    task: "t",
    app: "win.app.test",
    actions: [{ action: "drag", x: 10, y: 10, x2: 200, y2: 200 }],
  })
  assert.equal(ok.actions.length, 1)
  assert.equal(
    tryParseToolArgs("host_computer", {
      task: "t", app: "win.app.test",
      actions: [{ action: "drag", x: 10, y: 10, x2: 200 }], // missing y2
    }).ok,
    false,
  )
})
