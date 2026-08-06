import test from "node:test"
import assert from "node:assert/strict"
import {
  applyContextBudget,
  attachRollingSummaryToMessages,
  buildOmitNotice,
  buildRedactedTranscript,
  compactMessagesTurnSafe,
  estimateMessagesTokens,
  isOmitNotice,
  redactMessagesForCompaction,
  serializeMessage,
} from "../src/llm/context-budget"
import { shouldRunM2 } from "../src/llm/context-budget-m2"
import type { CanonicalChatMessage } from "../src/llm/provider"

function user(content: string): CanonicalChatMessage {
  return { role: "user", content }
}
function assistant(content: string): CanonicalChatMessage {
  return { role: "assistant", content }
}
function system(content: string): CanonicalChatMessage {
  return { role: "system", content }
}

test("serializeMessage includes tool_call arguments", () => {
  const m: CanonicalChatMessage = {
    role: "assistant",
    content: "x",
    tool_calls: [
      {
        id: "1",
        type: "function",
        function: { name: "shell_exec", arguments: '{"cmd":"ls"}' },
      },
    ],
  }
  assert.match(serializeMessage(m), /shell_exec/)
  assert.match(serializeMessage(m), /ls/)
})

test("compactMessagesTurnSafe: no-op under budget", () => {
  const msgs = [system("s"), user("hi"), assistant("yo")]
  const r = compactMessagesTurnSafe(msgs, 1_000_000)
  assert.equal(r.compacted, false)
  assert.equal(r.droppedCount, 0)
  assert.equal(r.droppedMessages.length, 0)
  assert.equal(r.messages.length, 3)
})

test("compactMessagesTurnSafe: drops oldest and inserts omit notice", () => {
  const msgs: CanonicalChatMessage[] = [
    system("sys"),
    user("old-1 ".repeat(200)),
    assistant("a1 ".repeat(200)),
    user("old-2 ".repeat(200)),
    assistant("a2 ".repeat(200)),
    user("latest"),
  ]
  const tiny = 80
  const r = compactMessagesTurnSafe(msgs, tiny)
  assert.equal(r.compacted, true)
  assert.ok(r.droppedCount >= 1)
  assert.equal(r.droppedMessages.length, r.droppedCount)
  assert.ok(r.messages.some(isOmitNotice))
  assert.equal(r.messages.filter(isOmitNotice).length, 1)
  // last user retained
  const lastUser = [...r.messages].reverse().find((m) => m.role === "user" && !isOmitNotice(m))
  assert.equal(lastUser?.content, "latest")
  // system retained
  assert.equal(r.messages[0].role, "system")
})

test("compactMessagesTurnSafe: drops assistant+tool pair together", () => {
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("u1"),
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "tabs: " + "x".repeat(500) },
    user("u2-final"),
  ]
  const r = compactMessagesTurnSafe(msgs, 50)
  assert.equal(r.compacted, true)
  // no orphan tool without preceding assistant in remaining (rough: no lone tool at start after system/omit)
  for (let i = 0; i < r.messages.length; i++) {
    if (r.messages[i].role === "tool") {
      assert.ok(i > 0)
      // prior non-system should be assistant or tool
    }
  }
  const lastUser = [...r.messages].reverse().find((m) => m.role === "user" && !isOmitNotice(m))
  assert.equal(lastUser?.content, "u2-final")
})

test("omit notice shape", () => {
  const n = buildOmitNotice(3)
  assert.ok(isOmitNotice(n))
  assert.match(String(n.content), /3/)
})

test("applyContextBudget with huge window no-ops short history", () => {
  const msgs = [system("s"), user("hi")]
  const r = applyContextBudget(msgs, 1_000_000, [])
  assert.equal(r.compacted, false)
})

test("estimateMessagesTokens positive", () => {
  assert.ok(estimateMessagesTokens([user("你好 world")]) > 0)
})

test("redactMessagesForCompaction: cookies and shell_exec stripped", () => {
  const msgs: CanonicalChatMessage[] = [
    user("here is sk-abc123456789secret"),
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "get_cookies", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "shell_exec", arguments: "{}" } },
        { id: "c3", type: "function", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "session=supersecret" },
    { role: "tool", tool_call_id: "c2", content: "stdout with password=xyz" },
    { role: "tool", tool_call_id: "c3", content: '[{"id":1}]' },
  ]
  const red = redactMessagesForCompaction(msgs)
  assert.match(String(red[0].content), /redacted-secret/)
  assert.equal(red[2].role, "tool")
  assert.match(String((red[2] as any).content), /get_cookies: redacted/)
  assert.doesNotMatch(String((red[2] as any).content), /supersecret/)
  assert.match(String((red[3] as any).content), /shell_exec/)
  assert.doesNotMatch(String((red[3] as any).content), /password=xyz/)
  assert.match(String((red[4] as any).content), /id/)
})

test("buildRedactedTranscript + attachRollingSummaryToMessages", () => {
  const t = buildRedactedTranscript([user("hello"), assistant("world")], 1000)
  assert.match(t, /user:/)
  const base = [system("s"), buildOmitNotice(2), user("latest")]
  const withSum = attachRollingSummaryToMessages(base, 2, "- did X\n- open Y")
  assert.ok(isOmitNotice(withSum[1]))
  assert.match(String(withSum[1].content), /context_summary/)
  assert.match(String(withSum[1].content), /did X/)
})

test("S51 P0: mid_loop recompact re-attaches prior rolling summary (two-pass)", () => {
  // pre_loop-style compact with M2 summary in the request
  const long = "x".repeat(400)
  const msgs: CanonicalChatMessage[] = [
    system("sys"),
    user(`old-1 ${long}`),
    assistant(`a1 ${long}`),
    user(`old-2 ${long}`),
    assistant(`a2 ${long}`),
    user("latest-user"),
  ]
  const tiny = 120
  const pre = compactMessagesTurnSafe(msgs, tiny)
  assert.equal(pre.compacted, true)
  const withM2 = attachRollingSummaryToMessages(
    pre.messages,
    pre.droppedCount,
    "did X; open tabs; pending Y",
  )
  assert.ok(withM2.some((m) => isOmitNotice(m) && String(m.content).startsWith("[context_summary]")))
  assert.match(String(withM2.find(isOmitNotice)!.content), /did X/)

  // Simulate tool-round growth then mid_loop M1 compact (no rollingSummary in opts)
  const midInput: CanonicalChatMessage[] = [
    ...withM2,
    assistant("tool round"),
    { role: "tool", content: `huge tool result ${"y".repeat(500)}`, tool_call_id: "c1" } as any,
    user("continue"),
  ]
  const mid = compactMessagesTurnSafe(midInput, tiny)
  assert.equal(mid.compacted, true)
  // M1 strip leaves plain omit — then adapter re-attaches prior summary
  const reattached = attachRollingSummaryToMessages(
    mid.messages,
    mid.droppedCount,
    "did X; open tabs; pending Y",
  )
  const notice = reattached.find(isOmitNotice)
  assert.ok(notice, "omit/summary notice present")
  assert.match(String(notice!.content), /\[context_summary\]/)
  assert.match(String(notice!.content), /did X/)
  assert.equal(reattached.filter(isOmitNotice).length, 1)
})

test("shouldRunM2 gates (tuned strategy)", () => {
  // 2 msgs alone insufficient unless tokens high
  assert.equal(
    shouldRunM2(
      {
        compacted: true,
        droppedMessages: [user("a"), user("b")],
        droppedCount: 2,
        tokensBefore: 100,
        tokensAfter: 50,
        messages: [],
      },
      true,
      "pre_loop",
    ),
    false,
  )
  // ≥3 messages
  assert.equal(
    shouldRunM2(
      {
        compacted: true,
        droppedMessages: [user("a"), user("b"), user("c")],
        droppedCount: 3,
        tokensBefore: 100,
        tokensAfter: 50,
        messages: [],
      },
      true,
      "pre_loop",
    ),
    true,
  )
  // high token drop
  assert.equal(
    shouldRunM2(
      {
        compacted: true,
        droppedMessages: [user("a")],
        droppedCount: 1,
        tokensBefore: 2000,
        tokensAfter: 1000,
        messages: [],
      },
      true,
      "pre_loop",
    ),
    true,
  )
  // mid_loop never
  assert.equal(
    shouldRunM2(
      {
        compacted: true,
        droppedMessages: [user("a"), user("b"), user("c")],
        droppedCount: 3,
        tokensBefore: 100,
        tokensAfter: 50,
        messages: [],
      },
      true,
      "mid_loop",
    ),
    false,
  )
  assert.equal(
    shouldRunM2(
      {
        compacted: true,
        droppedMessages: [user("a"), user("b"), user("c")],
        droppedCount: 3,
        tokensBefore: 100,
        tokensAfter: 50,
        messages: [],
      },
      false,
      "pre_loop",
    ),
    false,
  )
})
