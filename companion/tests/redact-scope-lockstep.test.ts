/**
 * #255 lock-step parity: the thread-JSON redactor (security/tool-persistence-
 * redact.ts) and the history.db redactor (history/store.ts redactForStorage)
 * run the SAME golden fixtures and must agree on fold vs release. This is the
 * third consistency pin (shared rule module + golden fixtures + behavior test)
 * — replaces the old "kept in sync by comment" arrangement.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { redactToolPayloadForPersistence } from "../src/security/tool-persistence-redact"
import { redactForStorage } from "../src/history/store"
import { READ_RELEASE_MAX_CHARS } from "../src/security/redact-rules"
import { REDACT_SCOPE_FIXTURES, type RedactScopeFixture } from "./fixtures/redact-scope-fixtures"

type ThreadClass = "collapse" | "release_truncated" | "release_full"

function classifyThread(fx: RedactScopeFixture): { cls: ThreadClass; out: ReturnType<typeof redactToolPayloadForPersistence> } {
  const out = redactToolPayloadForPersistence(fx.tool, fx.params, fx.result)
  const r = out.result as any
  if (r?.redacted === true || r?.data?.redacted === true) return { cls: "collapse", out }
  if (r?.data?.truncated === true) return { cls: "release_truncated", out }
  return { cls: "release_full", out }
}

/** history.db side: mimic the adapter's 500-char pre-cap, then redactForStorage. */
function classifyStore(fx: RedactScopeFixture): { folded: boolean; out: { params: string; result_summary: string } } {
  const summary = fx.result.success
    ? JSON.stringify(fx.result.data ?? {}).substring(0, 500)
    : ""
  const out = redactForStorage(fx.tool, JSON.stringify(fx.params), summary)
  return { folded: out.result_summary.startsWith("<redacted:"), out }
}

for (const fx of REDACT_SCOPE_FIXTURES) {
  test(`lock-step: ${fx.name}`, () => {
    const thread = classifyThread(fx)
    const store = classifyStore(fx)

    // 1) Both redactors agree on fold vs release.
    const threadFolded = thread.cls === "collapse"
    assert.equal(
      threadFolded,
      store.folded,
      `fold mismatch for "${fx.name}": thread=${thread.cls}, store.folded=${store.folded}`,
    )
    assert.equal(threadFolded, fx.expectFold, `golden expectation mismatch for "${fx.name}"`)

    // 2) Truncation envelope (thread JSON only): kept/total must be exact —
    //    the UI 三态 copy renders "已保留前 N/共 M 字符" from these fields.
    const data = (thread.out.result as any)?.data
    if (fx.expectTruncated) {
      assert.equal(thread.cls, "release_truncated")
      assert.equal(data.truncated, true)
      assert.equal(data.kept, READ_RELEASE_MAX_CHARS)
      assert.equal(data.total, JSON.stringify(fx.result.data).length)
      assert.equal(data.prefix.length, READ_RELEASE_MAX_CHARS)
    } else if (!fx.expectFold) {
      assert.equal(thread.cls, "release_full")
      assert.deepEqual(data, fx.result.data)
    }

    // 3) Folded rows must not retain any raw payload on either side.
    if (fx.expectFold) {
      const threadStr = JSON.stringify(thread.out.result)
      for (const probe of ["document.cookie", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "BEGIN RSA PRIVATE KEY"]) {
        assert.ok(!threadStr.includes(probe), `thread result leaked "${probe}" for "${fx.name}"`)
        assert.ok(!store.out.result_summary.includes(probe), `store summary leaked "${probe}" for "${fx.name}"`)
      }
    }

    // 4) Params are ALWAYS folded for codeish tools (both redactors).
    if (typeof fx.params.code === "string") {
      assert.ok(!JSON.stringify(thread.out.params).includes(fx.params.code), `thread params leaked code for "${fx.name}"`)
      assert.ok(!store.out.params.includes(fx.params.code), `store params leaked code for "${fx.name}"`)
    }
    if (typeof fx.params.security_token === "string") {
      assert.ok(!JSON.stringify(thread.out.params).includes(fx.params.security_token as string))
      assert.ok(!store.out.params.includes(fx.params.security_token as string))
    }
  })
}

test("lock-step: store side keeps read-tier summary verbatim when gates pass", () => {
  const fx = REDACT_SCOPE_FIXTURES.find((f) => f.name === "get_page_text benign keeps text")!
  const summary = JSON.stringify(fx.result.data)
  const { result_summary } = redactForStorage(fx.tool, JSON.stringify(fx.params), summary)
  assert.equal(result_summary, summary)
})
