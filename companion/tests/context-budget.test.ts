import test from "node:test"
import assert from "node:assert/strict"
import {
  applyContextBudget,
  attachRollingSummaryToMessages,
  buildHandoffNotice,
  buildOmitNotice,
  buildRedactedTranscript,
  compactMessagesTurnSafe,
  estimateMessagesTokens,
  isOmitNotice,
  redactMessagesForCompaction,
  retainMidLoopRollingSummary,
  serializeMessage,
  shrinkToolBodiesToFit,
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

test("serializeMessage: user image parts do not stringify to [object Object]", () => {
  const m: CanonicalChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "请看这张图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ],
  }
  const s = serializeMessage(m)
  assert.doesNotMatch(s, /\[object Object\]/)
  assert.match(s, /请看这张图/)
  assert.match(s, /\[image\]/)
})

test("estimateMessagesTokens: image parts add 1600 not ~3", () => {
  const m: CanonicalChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "x" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ],
  }
  const n = estimateMessagesTokens([m])
  assert.ok(n >= 1600, `expected >=1600, got ${n}`)
})

test("estimateMessagesTokens: square >=1200 charges 2800", () => {
  const m: CanonicalChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "x" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" }, width: 1568, height: 1568 },
    ],
  }
  const n = estimateMessagesTokens([m])
  assert.ok(n >= 2800, `expected >=2800, got ${n}`)
})

test("redactMessagesForCompaction: user parts extract text, never replace on array", () => {
  const msgs: CanonicalChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "see this sk-abc123456789secret" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    },
  ]
  const red = redactMessagesForCompaction(msgs)
  assert.equal(typeof red[0].content, "string")
  assert.doesNotMatch(String(red[0].content), /\[object Object\]/)
  assert.match(String(red[0].content), /redacted-secret/)
  assert.doesNotMatch(String(red[0].content), /sk-abc123456789secret/)
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

test("Wave E P0-3: workspace_read_file body redacted like host_read", () => {
  const msgs: CanonicalChatMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "w1",
          type: "function",
          function: { name: "workspace_read_file", arguments: '{"path":".env"}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "w1",
      content: "API_KEY=sk-live-should-not-survive-compact\nDB_PASSWORD=hunter2",
    },
  ]
  const red = redactMessagesForCompaction(msgs)
  assert.equal(red[1].role, "tool")
  assert.match(String((red[1] as any).content), /workspace_read_file/)
  assert.doesNotMatch(String((red[1] as any).content), /sk-live-should-not-survive/)
  assert.doesNotMatch(String((red[1] as any).content), /hunter2/)
})

test("Wave E P1-1: budget notices frame machine memory not user intent", () => {
  const omit = buildOmitNotice(3)
  assert.match(String(omit.content), /MACHINE_WORKING_MEMORY/)
  assert.match(String(omit.content), /NOT user intent/)
  const sum = buildOmitNotice(2, "- did X")
  assert.match(String(sum.content), /MACHINE_WORKING_MEMORY/)
  const h = buildHandoffNotice(4, "目标:\n- ship Wave E")
  assert.match(String(h.content), /MACHINE_WORKING_MEMORY/)
  assert.match(String(h.content), /context_handoff/)
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

test("S52 N3: retainMidLoopRollingSummary orchestrates mid_loop keep+reattach", () => {
  const long = "x".repeat(400)
  const msgs: CanonicalChatMessage[] = [
    system("sys"),
    user(`old ${long}`),
    assistant(`a ${long}`),
    user(`old2 ${long}`),
    assistant(`a2 ${long}`),
    user("latest"),
  ]
  const tiny = 120
  const mid = compactMessagesTurnSafe(msgs, tiny)
  assert.equal(mid.compacted, true)
  // After M1 compact the request has plain omit, no summary text
  assert.ok(mid.messages.some(isOmitNotice))
  assert.doesNotMatch(String(mid.messages.find(isOmitNotice)!.content), /context_summary/)

  const retained = retainMidLoopRollingSummary({
    phase: "mid_loop",
    mode: "m1",
    messages: mid.messages,
    droppedCount: mid.droppedCount,
    // no rollingSummary this pass — prior lives in prevMeta only
    prevMeta: {
      rolling_summary: "did X; open tabs; pending Y",
      summary_sha256: "abc123",
      summary_bytes: 28,
    },
  })
  assert.equal(retained.reattached, true)
  assert.equal(retained.mode, "m2")
  assert.equal(retained.rollingSummary, "did X; open tabs; pending Y")
  assert.equal(retained.summarySha, "abc123")
  assert.match(String(retained.messages.find(isOmitNotice)!.content), /\[context_summary\]/)
  assert.match(String(retained.messages.find(isOmitNotice)!.content), /did X/)
  assert.equal(retained.messages.filter(isOmitNotice).length, 1)
  // Meta dual-truth fields for adapter write
  assert.equal(retained.keepSummary, "did X; open tabs; pending Y")
  assert.equal(retained.keepSha, "abc123")
})

test("S52 N3: retainMidLoopRollingSummary no-ops on pre_loop / already m2", () => {
  const base = [system("s"), buildOmitNotice(2), user("u")]
  const pre = retainMidLoopRollingSummary({
    phase: "pre_loop",
    mode: "m1",
    messages: base,
    droppedCount: 2,
    prevMeta: { rolling_summary: "should not reattach on pre_loop" },
  })
  assert.equal(pre.reattached, false)
  assert.equal(pre.mode, "m1")
  assert.doesNotMatch(String(pre.messages.find(isOmitNotice)!.content), /should not reattach/)

  const already = retainMidLoopRollingSummary({
    phase: "mid_loop",
    mode: "m2",
    messages: attachRollingSummaryToMessages(base, 2, "fresh this pass"),
    droppedCount: 2,
    rollingSummary: "fresh this pass",
    prevMeta: { rolling_summary: "older" },
  })
  assert.equal(already.reattached, false)
  assert.equal(already.mode, "m2")
  assert.match(String(already.messages.find(isOmitNotice)!.content), /fresh this pass/)
})

test("S52: shrink-only droppedCount 0 keeps Earlier N and does not write Earlier 0", () => {
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    buildOmitNotice(4),
    user("do it"),
  ]
  const retained = retainMidLoopRollingSummary({
    phase: "mid_loop",
    mode: "m1",
    messages: msgs,
    droppedCount: 0,
    prevMeta: {
      rolling_summary: "did X; pending Y",
      dropped_count: 4,
    },
  })
  const notice = retained.messages.find(isOmitNotice)
  assert.ok(notice)
  assert.match(String(notice!.content), /Earlier 4/)
  assert.doesNotMatch(String(notice!.content), /Earlier 0/)
  assert.match(String(notice!.content), /did X/)
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

function assistantTools(ids: string[]): CanonicalChatMessage {
  return {
    role: "assistant",
    content: "calling",
    tool_calls: ids.map((id) => ({
      id,
      type: "function" as const,
      function: { name: "get_page_text", arguments: "{}" },
    })),
  }
}

function toolMsg(id: string, content: string): CanonicalChatMessage {
  return { role: "tool", tool_call_id: id, content }
}

test("mid_loop pin: live assistant+tools after last user are undroppable", () => {
  const huge = "x".repeat(8000)
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    buildOmitNotice(4),
    user("do it"),
    assistantTools(["c1"]),
    toolMsg("c1", huge),
  ]
  const r = compactMessagesTurnSafe(msgs, 80, { phase: "mid_loop" })
  assert.ok(
    r.messages.some((m) => m.role === "assistant" && (m as any).tool_calls?.length === 1),
    "live assistant tool_calls must stay",
  )
  assert.ok(
    r.messages.some((m) => m.role === "tool" && (m as any).tool_call_id === "c1"),
    "live tool row must stay",
  )
  const realUsers = r.messages.filter((m) => m.role === "user" && !isOmitNotice(m))
  assert.equal(realUsers.length, 1)
  assert.equal(realUsers[0].content, "do it")
  const omit = r.messages.find((m) => isOmitNotice(m))
  assert.ok(omit, "shrink-only mid_loop must keep the sticky omit notice")
  assert.match(String((omit as { content?: string }).content), /Earlier 4/)
})

test("mid_loop pin: older turns before last user still drop", () => {
  const huge = "x".repeat(8000)
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("first"),
    assistant("old"),
    user("do it"),
    assistantTools(["c2"]),
    toolMsg("c2", huge),
  ]
  const r = compactMessagesTurnSafe(msgs, 80, { phase: "mid_loop" })
  assert.ok(r.compacted)
  assert.ok(!r.messages.some((m) => m.role === "user" && (m as any).content === "first"))
  assert.ok(r.messages.some((m) => m.role === "assistant" && (m as any).tool_calls?.length === 1))
  assert.ok(r.messages.some((m) => m.role === "tool" && (m as any).tool_call_id === "c2"))
})

test("pre_loop default: single-user live suffix remains droppable (not a pin)", () => {
  const huge = "x".repeat(8000)
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("do it"),
    assistantTools(["c1"]),
    toolMsg("c1", huge),
  ]
  const r = compactMessagesTurnSafe(msgs, 80)
  assert.ok(r.compacted)
  assert.ok(!r.messages.some((m) => m.role === "tool"), "pre_loop may drop completed suffix")
})

test("mid_loop pin: shrink tool bodies when suffix still over budget", () => {
  const huge = "x".repeat(20000)
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("do it"),
    assistantTools(["c1"]),
    toolMsg("c1", huge),
  ]
  const r = compactMessagesTurnSafe(msgs, 80, { phase: "mid_loop" })
  const tool = r.messages.find((m) => m.role === "tool") as { content: string } | undefined
  assert.ok(tool, "tool row kept")
  assert.ok(tool!.content.length < huge.length, "pinned tool body must shrink")
  assert.ok(r.tokensAfter <= 80 || tool!.content.length <= 120, "under budget or at min shrink")
})

const SECRET_JSON = '{"success":true,"data":"SECRET_PAYLOAD"}'
const SECRET_JSON_HUGE = `{"success":true,"data":"SECRET_PAYLOAD","pad":"${"A".repeat(4000)}"}`

test("T0b: shrinkToolBodiesToFit does not emit a JSON prefix of the tool body", () => {
  const wrapped =
    `<untrusted-abc source="tool">\n${SECRET_JSON_HUGE}\n</untrusted-abc>`
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("u"),
    { role: "tool", tool_call_id: "c1", content: wrapped },
  ]
  const ok = shrinkToolBodiesToFit(msgs, 40)
  assert.equal(ok, true)
  const body = String(msgs[2]!.content)
  assert.equal(SECRET_JSON_HUGE.startsWith(body), false, "must not be a prefix of the original JSON")
  assert.equal(body.includes('{"succes'), false, "must not leak mid-key JSON")
  assert.equal(body.includes("SECRET_PAYLOAD"), false)
  assert.match(body, /<untrusted-abc/)
  assert.match(body, /<\/untrusted-abc>/)
  assert.match(body, /\[tool_result_truncated chars=\d+\]/)
})

test("T0b: unwrapped JSON shrink is not a prefix and has no {\"succes", () => {
  const msgs: CanonicalChatMessage[] = [
    { role: "tool", tool_call_id: "c1", content: SECRET_JSON_HUGE },
  ]
  assert.equal(shrinkToolBodiesToFit(msgs, 20), true)
  const body = String(msgs[0]!.content)
  assert.equal(SECRET_JSON.startsWith(body.replace(/…$/, "")), false)
  assert.equal(body.includes('{"succes'), false)
  assert.match(body, /\[tool_result_truncated chars=\d+\]/)
})

function sensitiveSibling(name: string, id: string): CanonicalChatMessage {
  return {
    role: "assistant",
    content: "calling",
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  }
}

test("T0b: get_cookies / evaluate / shell_exec shrink to name + len only", () => {
  for (const name of ["get_cookies", "evaluate", "shell_exec"] as const) {
    const msgs: CanonicalChatMessage[] = [
      system("s"),
      user("u"),
      sensitiveSibling(name, "c1"),
      { role: "tool", tool_call_id: "c1", content: SECRET_JSON_HUGE },
    ]
    assert.equal(shrinkToolBodiesToFit(msgs, 20), true, name)
    const body = String(msgs[3]!.content)
    assert.equal(body.includes("SECRET_PAYLOAD"), false, name)
    assert.equal(body.includes('{"succes'), false, name)
    assert.match(body, new RegExp(`\\[${name}: len=\\d+\\]`))
  }
})

test("T0b: optional name on the tool message is enough to classify sensitive", () => {
  const msgs = [
    {
      role: "tool" as const,
      tool_call_id: "c1",
      name: "evaluate",
      content: SECRET_JSON_HUGE,
    },
  ] as CanonicalChatMessage[]
  assert.equal(shrinkToolBodiesToFit(msgs, 20), true)
  const body = String(msgs[0]!.content)
  assert.match(body, /\[evaluate: len=\d+\]/)
  assert.equal(body.includes("SECRET_PAYLOAD"), false)
})

test("T0b: CompactResult.shrunk is true when only shrink happened", () => {
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("do it"),
    assistantTools(["c1"]),
    toolMsg("c1", SECRET_JSON_HUGE),
  ]
  const r = compactMessagesTurnSafe(msgs, 80, { phase: "mid_loop" })
  assert.equal(r.droppedCount, 0)
  assert.equal(r.shrunk, true)
  assert.equal(r.compacted, true)
  const tool = r.messages.find((m) => m.role === "tool") as { content: string }
  assert.equal(String(tool.content).includes('{"succes'), false)
})

test("T0b: applyContextBudget surfaces shrunk when shrinkToolBodiesToFit ran", () => {
  const msgs: CanonicalChatMessage[] = [
    system("s"),
    user("do it"),
    assistantTools(["c1"]),
    toolMsg("c1", "Y".repeat(80000)),
  ]
  const r = applyContextBudget(msgs, 2000, [], { phase: "mid_loop" })
  assert.equal(r.droppedCount, 0)
  assert.equal(r.shrunk, true)
})
