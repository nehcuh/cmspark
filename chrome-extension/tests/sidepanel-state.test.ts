import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, isTempUserMessageId, type AgentState } from "../src/sidepanel/store/agentStore"
import { newTempUserMessageId } from "../src/utils/temp-message-id"
import { normalizeConfig, parseChatUserAttachments, requestInitialSidePanelData, sanitizeHydratedMessages } from "../src/sidepanel/hooks/useWebSocket"
import type { SkillMeta } from "../src/sidepanel/types"

function stateWithThreads(): AgentState {
  return {
    ...initialState,
    activeThreadId: "thread-a",
    threads: [
      {
        id: "thread-a",
        alias: "A",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [101],
        active_skill_ids: ["browse"],
        skill_selection_mode: "manual",
        knowledge_selection_mode: "manual",
      },
      {
        id: "thread-b",
        alias: "B",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [202, 303],
        active_skill_ids: ["browse"],
        skill_selection_mode: "all",
        knowledge_selection_mode: "all",
      },
    ],
    pinnedTabIds: [101],
    skillSelectionMode: "manual",
    knowledgeSelectionMode: "manual",
  }
}

test("SET_ACTIVE_THREAD restores pinned tabs, skillSelectionMode, and knowledgeSelectionMode from thread metadata", () => {
  const next = agentReducer(stateWithThreads(), { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })

  assert.equal(next.activeThreadId, "thread-b")
  assert.deepEqual(next.pinnedTabIds, [202, 303])
  assert.deepEqual(next.messages, [])
  assert.equal(next.skillSelectionMode, "all")
  assert.equal(next.knowledgeSelectionMode, "all")
})

test("SET_ACTIVE_THREAD defaults skillSelectionMode to auto when thread has no mode", () => {
  const s = stateWithThreads()
  const threadWithoutMode = { ...s.threads[1], skill_selection_mode: undefined, knowledge_selection_mode: undefined }
  const state = { ...s, threads: [s.threads[0], threadWithoutMode] }
  const next = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })

  assert.equal(next.skillSelectionMode, "auto")
  assert.equal(next.knowledgeSelectionMode, "auto")
})

test("SET_PINNED_TABS updates active thread metadata", () => {
  const next = agentReducer(stateWithThreads(), { type: "SET_PINNED_TABS", tabIds: [404] })

  assert.deepEqual(next.pinnedTabIds, [404])
  assert.deepEqual(next.threads.find(t => t.id === "thread-a")?.pinned_tabs, [404])
  assert.deepEqual(next.threads.find(t => t.id === "thread-b")?.pinned_tabs, [202, 303])
})

test("SET_SKILLS coerces non-array to empty list (skill.list missing skills)", () => {
  const poisoned = agentReducer(initialState, { type: "SET_SKILLS", skills: undefined as any })
  assert.deepEqual(poisoned.skills, [])
  const ok = agentReducer(initialState, {
    type: "SET_SKILLS",
    skills: [{ name: "browse", description: "d", type: "prompt_template", builtin: true }],
  })
  assert.equal(ok.skills.length, 1)
  assert.equal(ok.skills[0].name, "browse")
})

test("normalizeConfig flattens companion config and keeps masked API keys out of UI state", () => {
  assert.deepEqual(normalizeConfig({
    llm: {
      base_url: "https://example.test/v1",
      api_key: "***",
      model_name: "model-x",
      temperature: 0.2,
      context_window: 4096,
    },
    trusted_domains: ["example.com", "*.company.com"],
  }), {
    base_url: "https://example.test/v1",
    api_key: "",
    // Masked key still signals "is set" so the UI can show "已配置 ✓"
    // without ever exposing the real key.
    api_key_set: true,
    model_name: "model-x",
    temperature: 0.2,
    context_window: 4096,
    protocol: "openai",
    client_header_profile: "none",
    trusted_domains: ["example.com", "*.company.com"],
    vision_enabled: false,
  })
})

test("normalizeConfig maps anthropic protocol and coding-plan profile", () => {
  const n = normalizeConfig({
    llm: {
      base_url: "https://gateway.example/v1",
      api_key: "",
      model_name: "claude-sonnet-4-6",
      temperature: 0.5,
      context_window: 200000,
      protocol: "anthropic",
      client_header_profile: "claude_code_compat",
    },
  })
  assert.equal(n.protocol, "anthropic")
  assert.equal(n.client_header_profile, "claude_code_compat")
  assert.equal(n.base_url, "https://gateway.example/v1")
})

test("normalizeConfig flattens thread_digest (Wave B)", () => {
  const n = normalizeConfig({
    llm: { base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" },
    thread_digest: { enabled: true, on_idle_hours: 48, max_per_day: 10 },
  })
  assert.equal(n.thread_digest_enabled, true)
  assert.equal(n.thread_digest_on_idle_hours, 48)
  assert.equal(n.thread_digest_max_per_day, 10)
})

test("normalizeConfig flattens context_compaction modes", () => {
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "prompt", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "prompt",
  )
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "off", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "off",
  )
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "auto", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "auto",
  )
})

test("pendingUploads is keyed by thread so concurrent uploads do not overwrite", () => {
  let s = agentReducer(initialState, {
    type: "SET_PENDING_UPLOAD",
    threadId: "thread-a",
    messageId: "thread-a_user_1_abc",
    composerText: "看图 A",
  })
  s = agentReducer(s, {
    type: "SET_PENDING_UPLOAD",
    threadId: "thread-b",
    messageId: "thread-b_user_2_def",
    composerText: "看图 B",
  })
  assert.equal(s.pendingUploads["thread-a"]?.messageId, "thread-a_user_1_abc")
  assert.equal(s.pendingUploads["thread-b"]?.messageId, "thread-b_user_2_def")
  s = agentReducer(s, { type: "CLEAR_PENDING_UPLOAD", threadId: "thread-a" })
  assert.equal(s.pendingUploads["thread-a"], undefined)
  assert.equal(s.pendingUploads["thread-b"]?.messageId, "thread-b_user_2_def")
  s = agentReducer(s, { type: "REQUEST_COMPOSER_RESTORE", text: "看图 B" })
  assert.equal(s.composerRestore?.text, "看图 B")
  s = agentReducer(s, { type: "CLEAR_COMPOSER_RESTORE" })
  assert.equal(s.composerRestore, null)
})

test("REMOVE_MESSAGE after F1 adopt is a no-op on the temp id (landed turn stays)", () => {
  const tempId = "thread-a_user_1730000000999_abc"
  const bubble = {
    id: tempId,
    thread_id: "thread-a",
    role: "user" as const,
    content: "landed",
    created_at: "2026-08-19T00:00:00.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubble })
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_persist_1",
      thread_id: "thread-a",
      role: "user",
      content: "landed",
      created_at: "2026-08-19T00:00:01.000Z",
      client_message_id: tempId,
    } as any,
  })
  assert.equal(s.messages[0]!.id, "thread-a_persist_1")
  s = agentReducer(s, { type: "REMOVE_MESSAGE", id: tempId })
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0]!.id, "thread-a_persist_1")
})

test("REMOVE_MESSAGE drops the optimistic upload bubble by exact id (post-#197 F2 failure retract)", () => {
  const bubble = {
    id: "thread-a_user_1_abc",
    thread_id: "thread-a",
    role: "user" as const,
    content: "请分析\n📎 shot.png",
    created_at: "2026-08-19T00:00:00.000Z",
  }
  const other = {
    id: "thread-a_user_2_def",
    thread_id: "thread-a",
    role: "user" as const,
    content: "keep me",
    created_at: "2026-08-19T00:00:01.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubble })
  s = agentReducer(s, { type: "ADD_MESSAGE", message: other })
  s = agentReducer(s, { type: "REMOVE_MESSAGE", id: bubble.id })
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0]!.id, other.id)
  const noop = agentReducer(s, { type: "REMOVE_MESSAGE", id: "missing" })
  assert.equal(noop.messages.length, 1)
})

test("ADD_MESSAGE dedupes by message id (optimistic panel + SW chat.user echo)", () => {
  const msg = {
    id: "thread-a_user_1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "from cockpit",
    created_at: "2026-07-28T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: msg })
  assert.equal(once.messages.length, 1)
  const twice = agentReducer(once, { type: "ADD_MESSAGE", message: { ...msg, content: "dup" } })
  assert.equal(twice.messages.length, 1)
  assert.equal(twice.messages[0].content, "from cockpit")
  const other = agentReducer(twice, {
    type: "ADD_MESSAGE",
    message: { ...msg, id: "thread-a_user_2", content: "second" },
  })
  assert.equal(other.messages.length, 2)
})

test("ADD_MESSAGE same id merges attachments without replacing content", () => {
  const msg = {
    id: "thread-a_user_1730000000000",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: msg })
  const att = { kind: "image" as const, name: "shot.png", mime: "image/png", preview_jpeg_b64: "abc" }
  const merged = agentReducer(once, {
    type: "ADD_MESSAGE",
    message: { ...msg, content: "ignored", attachments: [att] },
  })
  assert.equal(merged.messages.length, 1)
  assert.equal(merged.messages[0].content, "look")
  assert.equal(merged.messages[0].attachments?.[0]?.name, "shot.png")
  assert.equal(merged.messages[0].attachments?.[0]?.preview_jpeg_b64, "abc")
})

test("ADD_MESSAGE adopts persisted message_id onto last temp user bubble", () => {
  const optimistic = {
    id: "thread-a_user_1730000000000",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: optimistic })
  const persisted = {
    id: "thread-a_1730000000001_x7k2p1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look\n📎 shot.png",
    created_at: "2026-08-17T00:00:01.000Z",
    attachments: [{ kind: "image" as const, name: "shot.png", mime: "image/png" }],
  }
  const adopted = agentReducer(once, { type: "ADD_MESSAGE", message: persisted })
  assert.equal(adopted.messages.length, 1)
  assert.equal(adopted.messages[0].id, persisted.id)
  assert.equal(adopted.messages[0].content, "look", "keep optimistic caption")
  assert.equal(adopted.messages[0].attachments?.[0]?.name, "shot.png")
})

test("ADD_MESSAGE late temp echo after adopt does not duplicate", () => {
  const persisted = {
    id: "thread-a_1730000000001_x7k2p1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
    attachments: [{ kind: "image" as const, name: "shot.png", mime: "image/png" }],
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: persisted })
  const late = agentReducer(once, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_user_1730000000000",
      thread_id: "thread-a",
      role: "user",
      content: "look",
      created_at: "2026-08-17T00:00:00.000Z",
    },
  })
  assert.equal(late.messages.length, 1)
  assert.equal(late.messages[0].id, persisted.id)
  assert.equal(late.messages[0].attachments?.[0]?.name, "shot.png")
})

test("ADD_MESSAGE client_message_id adopts the matching temp bubble, not the last (F1)", () => {
  // Multi-surface race: panel + Cockpit each optimistic-append into the same
  // thread inside one WS window. The persist echo for the FIRST message must
  // not cross-adopt onto the SECOND bubble.
  const bubbleA = {
    id: "thread-a_user_1730000000001",
    thread_id: "thread-a",
    role: "user" as const,
    content: "from panel",
    created_at: "2026-08-18T00:00:00.000Z",
  }
  const bubbleB = {
    id: "thread-a_user_1730000000002",
    thread_id: "thread-a",
    role: "user" as const,
    content: "from cockpit",
    created_at: "2026-08-18T00:00:01.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubbleA })
  s = agentReducer(s, { type: "ADD_MESSAGE", message: bubbleB })
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1730000000003_persistA",
      thread_id: "thread-a",
      role: "user",
      content: "from panel",
      created_at: "2026-08-18T00:00:02.000Z",
      attachments: [{ kind: "image" as const, name: "shot.png", mime: "image/png" }],
      client_message_id: "thread-a_user_1730000000001",
    },
  })
  assert.equal(s.messages.length, 2)
  assert.equal(s.messages[0].id, "thread-a_1730000000003_persistA")
  assert.equal(s.messages[0].content, "from panel", "keep optimistic caption")
  assert.equal(s.messages[0].attachments?.[0]?.name, "shot.png")
  assert.equal(s.messages[1].id, "thread-a_user_1730000000002", "second bubble untouched")
})

test("ADD_MESSAGE client_message_id out-of-order echoes adopt their own bubbles (F1)", () => {
  const bubbleA = {
    id: "thread-a_user_1730000000001",
    thread_id: "thread-a",
    role: "user" as const,
    content: "first",
    created_at: "2026-08-18T00:00:00.000Z",
  }
  const bubbleB = {
    id: "thread-a_user_1730000000002",
    thread_id: "thread-a",
    role: "user" as const,
    content: "second",
    created_at: "2026-08-18T00:00:01.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubbleA })
  s = agentReducer(s, { type: "ADD_MESSAGE", message: bubbleB })
  // Echo for B lands before echo for A.
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1730000000004_persistB",
      thread_id: "thread-a",
      role: "user",
      content: "second",
      created_at: "2026-08-18T00:00:02.000Z",
      client_message_id: "thread-a_user_1730000000002",
    },
  })
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1730000000003_persistA",
      thread_id: "thread-a",
      role: "user",
      content: "first",
      created_at: "2026-08-18T00:00:03.000Z",
      client_message_id: "thread-a_user_1730000000001",
    },
  })
  assert.deepEqual(
    s.messages.map((m) => m.id),
    ["thread-a_1730000000003_persistA", "thread-a_1730000000004_persistB"],
  )
  assert.equal(s.messages[0].content, "first")
  assert.equal(s.messages[1].content, "second")
})

test("ADD_MESSAGE client_message_id without a matching bubble appends — no position guessing (F1)", () => {
  const bubble = {
    id: "thread-a_user_1730000000001",
    thread_id: "thread-a",
    role: "user" as const,
    content: "still optimistic",
    created_at: "2026-08-18T00:00:00.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubble })
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1730000000009_orphan",
      thread_id: "thread-a",
      role: "user",
      content: "from a closed surface",
      created_at: "2026-08-18T00:00:01.000Z",
      client_message_id: "thread-a_user_9999999999999",
    },
  })
  assert.equal(s.messages.length, 2)
  assert.equal(s.messages[0].id, "thread-a_user_1730000000001", "temp bubble keeps its temp id")
  assert.equal(s.messages[1].id, "thread-a_1730000000009_orphan")
})

test("ADD_MESSAGE without client_message_id keeps legacy last-temp adoption (F1 fallback)", () => {
  // Old companion: no correlation id → last temp bubble takes the persisted id.
  const bubbleA = {
    id: "thread-a_user_1730000000001",
    thread_id: "thread-a",
    role: "user" as const,
    content: "first",
    created_at: "2026-08-18T00:00:00.000Z",
  }
  const bubbleB = {
    id: "thread-a_user_1730000000002",
    thread_id: "thread-a",
    role: "user" as const,
    content: "second",
    created_at: "2026-08-18T00:00:01.000Z",
  }
  let s = agentReducer(initialState, { type: "ADD_MESSAGE", message: bubbleA })
  s = agentReducer(s, { type: "ADD_MESSAGE", message: bubbleB })
  s = agentReducer(s, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_1730000000003_persisted",
      thread_id: "thread-a",
      role: "user",
      content: "second",
      created_at: "2026-08-18T00:00:02.000Z",
    },
  })
  assert.equal(s.messages.length, 2)
  assert.equal(s.messages[0].id, "thread-a_user_1730000000001")
  assert.equal(s.messages[1].id, "thread-a_1730000000003_persisted")
})

test("isTempUserMessageId: panel/SW/file-upload vs companion persist", () => {
  assert.equal(isTempUserMessageId("thread-a_user_1730000000000", "thread-a"), true)
  // Random suffix (same-millisecond collision fix) — still a temp id.
  assert.equal(isTempUserMessageId("thread-a_user_1730000000000_x7k2p1", "thread-a"), true)
  assert.equal(isTempUserMessageId("thread-a_1730000000000", "thread-a"), true)
  // Companion persisted id `${threadId}_${ms}_${rand}` must NOT read as temp.
  assert.equal(isTempUserMessageId("thread-a_1730000000000_x7k2p1", "thread-a"), false)
  assert.equal(isTempUserMessageId("thread-b_user_1730000000000", "thread-a"), true)
})

test("newTempUserMessageId: format, temp-id recognition, same-ms uniqueness", () => {
  assert.equal(
    newTempUserMessageId("thread-a", 1730000000000, "x7k2p1"),
    "thread-a_user_1730000000000_x7k2p1",
  )
  assert.equal(
    newTempUserMessageId(undefined, 1730000000000, "x7k2p1"),
    "user_1730000000000_x7k2p1",
  )
  // Two sends in the same thread+millisecond must not share an id (they would
  // sameIdIdx-merge into one bubble in agentStore).
  const a = newTempUserMessageId("thread-a", 1730000000000, "aaaa01")
  const b = newTempUserMessageId("thread-a", 1730000000000, "bbbb02")
  assert.notStrictEqual(a, b)
  assert.equal(isTempUserMessageId(a, "thread-a"), true)
  assert.equal(isTempUserMessageId(b, "thread-a"), true)
})

test("parseChatUserAttachments: image only, skip junk", () => {
  assert.equal(parseChatUserAttachments(undefined), undefined)
  assert.equal(parseChatUserAttachments([]), undefined)
  const parsed = parseChatUserAttachments([
    { kind: "image", name: "a.png", mime: "image/png", sha256: "ab", bytes: 12, preview_jpeg_b64: "qq" },
    { kind: "file", name: "x.pdf", mime: "application/pdf" },
    { kind: "image", name: "", mime: "image/png" },
    null,
  ])
  assert.equal(parsed?.length, 1)
  assert.deepEqual(parsed![0], {
    kind: "image",
    name: "a.png",
    mime: "image/png",
    sha256: "ab",
    bytes: 12,
    preview_jpeg_b64: "qq",
  })
  const withHost = parseChatUserAttachments([
    { kind: "image", name: "shot.png", mime: "image/png", dest_host: "api.openai.com" },
  ])
  assert.equal(withHost?.[0]?.dest_host, "api.openai.com")
})

test("parseChatUserAttachments: preview_jpeg_b64 capped at 400_000 chars (F4)", () => {
  const oversized = "q".repeat(400_001)
  const parsed = parseChatUserAttachments([
    { kind: "image", name: "big.png", mime: "image/png", preview_jpeg_b64: oversized },
  ])
  assert.equal(parsed?.[0]?.preview_jpeg_b64?.length, 400_000)
  assert.equal(parsed?.[0]?.preview_jpeg_b64, oversized.slice(0, 400_000))
  // Boundary: exactly at the cap passes through intact.
  const atCap = "r".repeat(400_000)
  const parsedAtCap = parseChatUserAttachments([
    { kind: "image", name: "cap.png", mime: "image/png", preview_jpeg_b64: atCap },
  ])
  assert.equal(parsedAtCap?.[0]?.preview_jpeg_b64, atCap)
})

test("sanitizeHydratedMessages: hydrate path runs attachments through the sanitizer (F4)", () => {
  // Non-array input hydrates to an empty history (was `msg.messages || []`).
  assert.deepEqual(sanitizeHydratedMessages(undefined), [])
  assert.deepEqual(sanitizeHydratedMessages(null), [])

  const cleanMsg = { id: "m1", thread_id: "t", role: "user", content: "hi", created_at: "x" }
  const out = sanitizeHydratedMessages([
    cleanMsg,
    null,
    {
      id: "m2",
      thread_id: "t",
      role: "user",
      content: "with image",
      created_at: "x",
      attachments: [
        {
          kind: "image",
          name: `${"n".repeat(250)}.png`,
          mime: "image/png",
          preview_jpeg_b64: "q".repeat(500_000),
        },
        { kind: "file", name: "x.pdf", mime: "application/pdf" },
      ],
    },
    {
      id: "m3",
      thread_id: "t",
      role: "user",
      content: "junk attachments",
      created_at: "x",
      attachments: "not-an-array",
    },
  ])
  assert.equal(out.length, 4)
  // Messages without attachments pass through untouched (same reference).
  assert.equal(out[0], cleanMsg)
  assert.equal(out[1], null)
  // Same bounds as the live echo: name 200 / preview 400_000 / image-only.
  const atts = out[2]?.attachments
  assert.equal(atts?.length, 1)
  assert.equal(atts?.[0]?.name.length, 200)
  assert.equal(atts?.[0]?.preview_jpeg_b64?.length, 400_000)
  // Junk (non-array) attachments fail closed to undefined.
  assert.equal(out[3]?.attachments, undefined)
})

test("security confirmation requests are queued and removable", () => {
  const request = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["fetch("],
    code_preview: "fetch('/api')",
    risk_score: 80,
    risk_category: "eval",
    risk_level: "high" as const,
    auto_confirm_eligible: false,
  }

  const queued = agentReducer(initialState, { type: "ADD_SECURITY_CONFIRMATION", request })
  assert.equal(queued.pendingSecurityConfirmations.length, 1)
  assert.deepEqual(queued.pendingSecurityConfirmations[0], request)

  const removed = agentReducer(queued, { type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: "confirm-1" })
  assert.equal(removed.pendingSecurityConfirmations.length, 0)
})

test("initial side panel sync requests threads, skills, knowledge, config, and mcp servers exactly once per connection", () => {
  const sent: object[] = []
  const initializedRef = { current: false }

  // Production requestInitialSidePanelData (useWebSocket.ts) sends 7 messages
  // on connect: threads, skills, knowledge, config, MCP, user_env, unattended status.
  // Keep these in lock-step — a new initial-sync message means updating this
  // expected array. The CI extension `npm test` step now catches such drift.
  const expected = [
    { type: "thread.list" },
    { type: "skill.list" },
    { type: "knowledge.list" },
    { type: "config.get" },
    { type: "mcp.list" },
    { type: "user_env.list" },
    { type: "security.unattended.status" },
  ]

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), true)
  assert.deepEqual(sent, expected)
  assert.equal(initializedRef.current, true)

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), false)
  assert.deepEqual(sent, expected)
})

test("SET_THREADS keeps active thread when it exists in the new list and syncs metadata", () => {
  const s = { ...initialState, threads: [], activeThreadId: "t1" }
  const next = agentReducer(s, {
    type: "SET_THREADS",
    threads: [
      {
        id: "t1",
        alias: "T1",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [1],
        active_skill_ids: ["skill-a"],
        skill_selection_mode: "all",
        knowledge_selection_mode: "manual",
      },
    ],
  })

  assert.equal(next.activeThreadId, "t1")
  assert.deepEqual(next.pinnedTabIds, [1])
  assert.deepEqual(next.activeSkillIds, ["skill-a"])
  assert.equal(next.skillSelectionMode, "all")
  assert.equal(next.knowledgeSelectionMode, "manual")
})

test("SET_THREADS preserves active when list is only-trashed mishap (B2 residual)", () => {
  const s = {
    ...initialState,
    activeThreadId: "live1",
    threads: [
      {
        id: "live1",
        alias: "Live",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: ["browse"],
      },
    ],
  }
  const next = agentReducer(s as any, {
    type: "SET_THREADS",
    threads: [
      {
        id: "trash1",
        alias: "Gone",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
        trashed_at: "2026-08-01T00:00:00.000Z",
      },
    ] as any,
  })
  // only-trashed incoming: keep active id so open-trash cannot steal chat focus
  assert.equal(next.activeThreadId, "live1")
})

test("SET_THREADS clears active thread when it is not in the new list", () => {
  const s = { ...initialState, threads: [], activeThreadId: null }
  const next = agentReducer(s, {
    type: "SET_THREADS",
    threads: [
      {
        id: "t1",
        alias: "T1",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [1],
        active_skill_ids: ["skill-a"],
        skill_selection_mode: "all",
        knowledge_selection_mode: "manual",
      },
    ],
  })

  assert.equal(next.activeThreadId, null)
})

test("SET_THREADS defaults skillSelectionMode to auto when thread has no mode", () => {
  const s = { ...initialState, threads: [], activeThreadId: null }
  const next = agentReducer(s, {
    type: "SET_THREADS",
    threads: [
      {
        id: "t1",
        alias: "T1",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
      },
    ],
  })

  assert.equal(next.skillSelectionMode, "auto")
  assert.equal(next.knowledgeSelectionMode, "auto")
})

test("SET_SKILL_SELECTION_MODE updates state", () => {
  const next = agentReducer(initialState, { type: "SET_SKILL_SELECTION_MODE", mode: "manual" })
  assert.equal(next.skillSelectionMode, "manual")
})

test("SET_KNOWLEDGE_SELECTION_MODE updates state", () => {
  const next = agentReducer(initialState, { type: "SET_KNOWLEDGE_SELECTION_MODE", mode: "all" })
  assert.equal(next.knowledgeSelectionMode, "all")
})

test("REMOVE_THREADS drops multiple ids, falls back active, clears busy", () => {
  const base = stateWithThreads()
  const withBusy: AgentState = {
    ...base,
    activeThreadId: "thread-a",
    threadBusyById: { "thread-a": true, "thread-b": true, "other": true },
    messages: [{ id: "m1", role: "user", content: "hi" } as any],
  }
  const next = agentReducer(withBusy, {
    type: "REMOVE_THREADS",
    threadIds: ["thread-a", "missing"],
  })
  assert.equal(next.threads.length, 1)
  assert.equal(next.threads[0].id, "thread-b")
  assert.equal(next.activeThreadId, "thread-b")
  assert.deepEqual(next.messages, [])
  assert.equal(next.threadBusyById["thread-a"], undefined)
  assert.equal(next.threadBusyById["thread-b"], true)
  assert.equal(next.threadBusyById["other"], true)
  assert.deepEqual(next.pinnedTabIds, [202, 303])
})

test("reducer handles unknown action type without crashing", () => {
  const next = agentReducer(initialState, { type: "UNKNOWN_ACTION_XYZ" as any })
  assert.equal(next, initialState)
})
