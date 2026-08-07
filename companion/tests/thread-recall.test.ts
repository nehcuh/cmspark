import test from "node:test"
import assert from "node:assert/strict"
import {
  tokenizeQuery,
  scoreMessage,
  searchAndRedact,
  toCanonicalForRedact,
  redactHitExcerpt,
  type RecallSourceMessage,
} from "../src/threads/thread-recall"
import { appendRecallHintToNotices, buildOmitNotice, THREAD_RECALL_HINT } from "../src/llm/context-budget"

test("tokenizeQuery CJK bigrams", () => {
  const terms = tokenizeQuery("登录失败")
  assert.ok(terms.includes("登录") || terms.some((t) => t.includes("登录")))
  const t2 = tokenizeQuery("用户登录失败")
  assert.ok(t2.some((t) => t === "登录" || t === "用户" || t.length === 2))
})

test("scoreMessage multi-term", () => {
  const terms = tokenizeQuery("login error")
  assert.ok(scoreMessage("login failed with error", terms) >= 2)
  assert.equal(scoreMessage("nothing here", terms), 0)
})

test("CJK query matches Chinese content", () => {
  const msgs: RecallSourceMessage[] = [
    { id: "1", role: "user", content: "用户登录失败怎么办" },
    { id: "2", role: "assistant", content: "检查密码" },
  ]
  const hits = searchAndRedact(msgs, "登录", 5)
  assert.ok(hits.length >= 1)
  assert.match(hits[0].excerpt, /登录|用户/)
})

test("orphan get_cookies tool hit is redacted (synthetic assistant)", () => {
  const msgs: RecallSourceMessage[] = [
    {
      id: "t1",
      role: "tool",
      content: JSON.stringify({
        cookies: [{ name: "session", value: "super-secret-cookie-value-xyz" }],
      }),
      tool_calls: [{ id: "call_1", tool_name: "get_cookies", result: { cookies: [] } }],
    },
  ]
  const excerpt = redactHitExcerpt(msgs[0], msgs, 0)
  assert.ok(excerpt)
  assert.match(excerpt!, /get_cookies|redacted/i)
  assert.doesNotMatch(excerpt!, /super-secret-cookie/)
})

test("paired shell_exec is redacted", () => {
  const msgs: RecallSourceMessage[] = [
    {
      id: "a1",
      role: "assistant",
      content: null as any,
      tool_calls: [
        {
          id: "call_sh",
          function: { name: "shell_exec", arguments: '{"command":"cat /etc/passwd"}' },
        },
      ],
    },
    {
      id: "t2",
      role: "tool",
      content: JSON.stringify({ success: true, data: { stdout: "root:x:0:0:root:/root:/bin/bash\n" } }),
      tool_calls: [
        {
          id: "call_sh",
          tool_name: "shell_exec",
          result: { stdout: "root:x:0:0:root:/root:/bin/bash\n" },
        },
      ],
    },
  ]
  const hits = searchAndRedact(msgs, "shell_exec", 5)
  assert.ok(hits.length >= 1)
  const text = hits.map((h) => h.excerpt).join("\n")
  assert.doesNotMatch(text, /root:x:0:0/)
  assert.match(text, /shell_exec|redacted|outcome/i)
})

test("tool with no name is dropped", () => {
  const msgs: RecallSourceMessage[] = [
    {
      id: "t3",
      role: "tool",
      content: "secret-payload-abc",
      tool_calls: [{ id: "x", result: "secret-payload-abc" }],
    },
  ]
  const hits = searchAndRedact(msgs, "secret-payload", 5)
  // may score on content but redact drops unresolvable
  for (const h of hits) {
    assert.doesNotMatch(h.excerpt, /secret-payload-abc/)
  }
})

test("toCanonicalForRedact orphan synthesizes assistant", () => {
  const mini = toCanonicalForRedact({
    role: "tool",
    content: '{"cookies":[]}',
    tool_calls: [{ id: "c1", tool_name: "get_cookies" }],
  })
  assert.equal(mini.length, 2)
  assert.equal(mini[0].role, "assistant")
  assert.equal(mini[1].role, "tool")
  assert.ok((mini[0] as any).tool_calls?.[0]?.function?.name === "get_cookies")
})

test("appendRecallHintToNotices only when enabled", () => {
  const msgs = [buildOmitNotice(3)]
  const off = appendRecallHintToNotices(msgs, false)
  assert.ok(!String(off[0].content).includes("thread_recall"))
  const on = appendRecallHintToNotices(msgs, true)
  assert.ok(String(on[0].content).includes(THREAD_RECALL_HINT))
})

test("empty query terms yield no hits", () => {
  assert.deepEqual(searchAndRedact([{ role: "user", content: "hello" }], "   ", 5), [])
})

test("max_hits clamp and total char budget", () => {
  const msgs: RecallSourceMessage[] = []
  for (let i = 0; i < 20; i++) {
    msgs.push({ id: `u${i}`, role: "user", content: `keyword alpha hit number ${i} ${"x".repeat(200)}` })
  }
  const hits = searchAndRedact(msgs, "keyword alpha", 99)
  assert.ok(hits.length <= 12)
  const total = hits.reduce((n, h) => n + h.excerpt.length, 0)
  assert.ok(total <= 4000)
})

test("reasoning_content never appears in excerpt", () => {
  const msgs: RecallSourceMessage[] = [
    {
      id: "a",
      role: "assistant",
      content: "visible answer about widgets",
      reasoning_content: "SECRET_REASONING_SHOULD_NOT_LEAK_xyz",
    },
  ]
  const hits = searchAndRedact(msgs, "widgets", 5)
  assert.ok(hits.length >= 1)
  for (const h of hits) {
    assert.doesNotMatch(h.excerpt, /SECRET_REASONING/)
  }
})
